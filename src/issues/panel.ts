import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, run, runJson } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { flattenDeep, LogField } from '../logs/entries';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues } from '../results/controls';
import { redact } from '../results/rows';
import {
    buildIssueGetArgs,
    buildIssueListArgs,
    buildIssueUpdateArgs,
    ISSUE_SEVERITIES,
    IssueChange,
    issueControls,
} from './args';
import { IssuesPayload, renderIssuesHtml } from './html';
import {
    buildBindingListArgs,
    buildChannelCreateArgs,
    buildChannelListArgs,
    buildLinkArgs,
    buildUnlinkArgs,
    ChannelRow,
    toBindingRows,
    toChannelRows,
} from './notifications';
import { toIssueRows } from './rows';

export interface IssuesDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.issues';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
    /**
     * Target and control set for the project the panel is currently showing.
     *
     * These live on the record rather than being captured by the message
     * handler's closure: `deps.state` is a snapshot, and reopening the panel
     * from a different project replaces it. Closing over the creating call's
     * parameters made an in-panel Refresh — or a status change — run against
     * the project the panel was first opened from.
     */
    deps: IssuesDeps;
    controls: Control[];
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

export async function showIssuesPanel(deps: IssuesDeps, environments: string[]): Promise<void> {
    const controls = issueControls(environments);

    if (open) {
        open.panel.reveal();
        // Retarget before loading: the panel may have been opened from another
        // project, and the message handler reads these on every action.
        open.deps = deps;
        open.controls = controls;
        await load(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Issues · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, values: defaultValues(controls), deps, controls };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderIssuesHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: {
            type?: string;
            controls?: ControlValues;
            id?: string;
            change?: IssueChange;
            label?: string;
        }) => {
            if (message?.type === 'refresh') {
                if (message.controls) {
                    entry.values = { ...entry.values, ...message.controls };
                }
                void load(entry);
            } else if (message?.type === 'update' && message.id && message.change) {
                // Only ever reached from a click or a dropdown change in the panel.
                void update(entry, message.id, message.change);
            } else if (message?.type === 'detail' && message.id) {
                void detail(entry, message.id);
            } else if (message?.type === 'link') {
                // Each of the three below is reached only from its own button.
                void linkChannel(entry);
            } else if (message?.type === 'unlink' && message.id) {
                void unlinkChannel(entry, message.id, message.label ?? 'this channel');
            } else if (message?.type === 'createChannel') {
                void createChannel(entry);
            }
        },
    );

    await load(entry);
}

function defaultValues(controls: Control[]): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps, values, controls } = entry;
    const args = [
        'projects',
        'issues',
        'list',
        ...projectArgs(deps.state),
        ...buildIssueListArgs(values),
    ];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);
    const heading = `Issues · ${values.environment}`;

    const base: IssuesPayload = {
        heading,
        subtitle: subtitle(deps.state),
        command,
        controls,
        controlValues: values,
        issues: [],
        rawJson: '',
    };

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runJson<unknown>(deps.bin, spec),
        );

        const issues = toIssueRows(raw);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(`${issues.length} issue(s)`);

        await post(entry, { ...base, issues, rawJson: JSON.stringify(redact(raw), null, 2) });

        // Independent command, so it runs after the issues are on screen rather
        // than delaying them — and its own failure stays inside its section.
        await loadBindings(entry);
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);
        await post(entry, { ...base, error: message });
    }
}

/**
 * Apply a status or severity change, then reload.
 *
 * Runs only from an explicit action in the panel — never from opening,
 * refreshing or filtering. No modal confirmation: every transition here is
 * reversible with another `issues update`, so a mis-click costs one more click,
 * not data.
 */
async function update(entry: OpenPanel, id: string, change: IssueChange): Promise<void> {
    const deps = entry.deps;

    let args: string[];
    try {
        args = [...buildIssueUpdateArgs(id, change), ...projectArgs(deps.state)];
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
    }

    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
        json: false,
    };

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Versori: updating issue' },
            () => run(deps.bin, spec),
        );

        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        void vscode.window.showInformationMessage(
            change.status ? `Issue ${change.status}.` : `Issue severity set to ${change.severity}.`,
        );

        await load(entry);
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        deps.output.appendLine(message);
        void vscode.window.showErrorMessage(`Versori: could not update the issue — ${message}`);
    }
}

/** Fetch one issue's authoritative detail, for the expanded row. */
async function detail(entry: OpenPanel, id: string): Promise<void> {
    const deps = entry.deps;
    const environment = String(entry.values.environment ?? '');
    const spec: CommandSpec = {
        args: [...buildIssueGetArgs(id, environment), ...projectArgs(deps.state)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };

    try {
        const raw = await runJson<unknown>(deps.bin, spec);
        const fields: LogField[] = flattenDeep(redact(raw));
        await entry.panel.webview.postMessage({ type: 'detail', id, fields });
    } catch (err) {
        await entry.panel.webview.postMessage({
            type: 'detail',
            id,
            fields: [],
            error: errorText(err),
        });
    }
}

/**
 * Bindings for the selected environment.
 *
 * Failure is reported inside the section rather than as a modal: the issues are
 * already on screen and are still worth reading without their delivery bindings.
 */
async function loadBindings(entry: OpenPanel): Promise<void> {
    const deps = entry.deps;
    const environment = String(entry.values.environment ?? '');
    const spec: CommandSpec = {
        args: [...buildBindingListArgs(environment), ...projectArgs(deps.state)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };

    try {
        const raw = await runJson<unknown>(deps.bin, spec);
        await entry.panel.webview.postMessage({
            type: 'notifications',
            bindings: toBindingRows(raw),
        });
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        deps.output.appendLine(message);
        await entry.panel.webview.postMessage({
            type: 'notifications',
            bindings: [],
            error: message,
        });
    }
}

/**
 * Link an existing channel to this project + environment.
 *
 * Multi-step native prompts rather than a webview form: each step is cancellable,
 * and the CLI's own pickers cannot be used because a spawned process has no TTY.
 * Nothing runs until the last prompt is answered — cancelling any step returns
 * before `mutate`, so no command is issued and no state is left half-built.
 */
async function linkChannel(entry: OpenPanel): Promise<void> {
    const deps = entry.deps;
    const environment = String(entry.values.environment ?? '');
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    let channels: ChannelRow[];
    try {
        channels = toChannelRows(
            // Organisation-scoped: no --project, which this command would reject.
            await runJson<unknown>(deps.bin, {
                args: buildChannelListArgs(),
                cwd: deps.state.projectDir,
                context: contextFor(deps.state),
            }),
        );
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: could not list channels — ${errorText(err)}`);
        return;
    }

    if (channels.length === 0) {
        void vscode.window.showWarningMessage(
            'Versori: this organisation has no notification channels yet. Create one first.',
        );
        return;
    }

    const picked = await vscode.window.showQuickPick(
        channels.map((channel) => ({
            label: channel.name,
            description: channel.email,
            id: channel.id,
        })),
        { title: `Link a channel to ${environment}`, ignoreFocusOut: true },
    );
    if (!picked) {
        return;
    }

    // Empty selection means every severity, which is the CLI's own default.
    const severities = await vscode.window.showQuickPick(ISSUE_SEVERITIES, {
        title: 'Email for which severities? (none selected = all)',
        canPickMany: true,
        ignoreFocusOut: true,
    });
    if (severities === undefined) {
        return;
    }

    const filterTitle = await vscode.window.showInputBox({
        title: 'Only email when the issue title contains... (optional)',
        placeHolder: 'leave blank for no title filter',
        ignoreFocusOut: true,
    });
    // Blank is a legitimate answer here — only dismissal aborts.
    if (filterTitle === undefined) {
        return;
    }

    await mutate(
        entry,
        'linking channel',
        () =>
            buildLinkArgs({
                channelId: picked.id,
                environment,
                severities,
                filterTitle,
            }),
        `Linked "${picked.label}" to ${environment}.`,
    );
}

/** Remove a binding. Modal-confirmed: alerts stop firing until it is re-linked. */
async function unlinkChannel(entry: OpenPanel, id: string, label: string): Promise<void> {
    const environment = String(entry.values.environment ?? '');

    const confirmed = await vscode.window.showWarningMessage(
        `Unlink "${label}" from ${environment}?`,
        {
            modal: true,
            detail:
                'Issues will still be raised, but will stop sending email. ' +
                'The channel itself is not deleted.',
        },
        'Unlink',
    );
    // Dismissing the modal yields undefined, so only the explicit button proceeds.
    if (confirmed !== 'Unlink') {
        return;
    }

    await mutate(
        entry,
        'unlinking channel',
        () => buildUnlinkArgs(id, environment),
        `Unlinked "${label}".`,
    );
}

/** Create an organisation-wide email channel. Does not link it — that is a second step. */
async function createChannel(entry: OpenPanel): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: 'Channel name',
        placeHolder: 'e.g. Ops on-call',
        ignoreFocusOut: true,
    });
    // Blank is treated as cancel: the CLI requires a name, so there is nothing
    // to create and nothing to report.
    if (!name) {
        return;
    }

    const email = await vscode.window.showInputBox({
        title: 'Primary email address',
        placeHolder: 'ops@example.com',
        ignoreFocusOut: true,
    });
    if (!email) {
        return;
    }

    const cc = await vscode.window.showInputBox({
        title: 'CC addresses (optional, comma-separated)',
        placeHolder: 'leave blank for none',
        ignoreFocusOut: true,
    });
    // Blank means no CCs; only dismissal aborts.
    if (cc === undefined) {
        return;
    }

    await mutate(
        entry,
        'creating channel',
        () =>
            buildChannelCreateArgs({
                name,
                email,
                cc: cc
                    .split(',')
                    .map((address) => address.trim())
                    .filter(Boolean),
            }),
        `Created channel "${name}". Link it to an environment to start emailing.`,
        // Organisation-scoped: `channels create` has no --project flag and cobra
        // would reject the command outright.
        false,
    );
}

/**
 * Run a notification mutation, report it, and refresh the bindings section.
 *
 * Reached only from `linkChannel`, `unlinkChannel` and `createChannel`, each of
 * which has already collected an explicit user answer at every step.
 */
async function mutate(
    entry: OpenPanel,
    title: string,
    args: () => string[],
    success: string,
    /** False for organisation-scoped commands, which reject --project. */
    projectScoped = true,
): Promise<void> {
    const deps = entry.deps;

    let spec: CommandSpec;
    try {
        spec = {
            args: [...args(), ...(projectScoped ? projectArgs(deps.state) : [])],
            cwd: deps.state.projectDir,
            context: contextFor(deps.state),
            json: false,
        };
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
    }

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Versori: ${title}` },
            () => run(deps.bin, spec),
        );

        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        void vscode.window.showInformationMessage(success);
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        deps.output.appendLine(message);
        void vscode.window.showErrorMessage(`Versori: ${title} failed — ${message}`);
    }

    await loadBindings(entry);
}

function post(entry: OpenPanel, payload: IssuesPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'issues', payload });
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}

function errorText(err: unknown): string {
    if (err instanceof CliError) {
        return err.stderr || err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
