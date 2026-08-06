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
    IssueChange,
    issueControls,
} from './args';
import { IssuesPayload, renderIssuesHtml } from './html';
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
