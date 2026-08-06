import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, run } from '../cli';
import { contextFor } from '../commands/target';
import { resolveEnvironmentNames } from '../environments';
import { ResolvedState } from '../resolver/types';
import { buildDeployArgs, buildVersionArgs, readBoolean, readString } from './build';
import { renderFormHtml } from './html';
import { FormSpec, FormValues, SubmitMessage } from './types';

const CONFIRM_SETTING = 'versori.confirmDeploy';

export interface FormDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

/** Open panels, keyed by view type, so a second invocation reveals rather than duplicates. */
const openPanels = new Map<string, vscode.WebviewPanel>();

/**
 * Which target each open panel was built for, keyed by view type.
 *
 * `refreshOnReopen: false` exists so that reopening Deploy or Save version keeps
 * a half-typed version description rather than throwing it away. But the
 * revealed panel's handler closes over the first call's `deps` and `spec`, so
 * `buildArgs` still carries the *original* project — reopening Deploy from
 * project B revealed A's form, and submitting deployed A.
 *
 * Recording the target lets both properties hold at once: reveal-and-retain
 * within a project, rebuild across projects. The key covers exactly what
 * `buildArgs` and the `CommandSpec` close over — the project id, the spawn cwd
 * and the context — so a panel is only ever revealed when every one of them
 * still matches.
 */
const openTargets = new Map<string, string>();

function targetKey(state: ResolvedState): string {
    // Newline-joined: neither a context name, a ULID project id nor a path
    // contains one, so the three parts cannot run together ambiguously.
    return [state.contextName ?? '', state.projectId ?? '', state.projectDir ?? ''].join('\n');
}

export async function openDeployForm(deps: FormDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    const confirmWhenLive = vscode.workspace
        .getConfiguration()
        .get<boolean>(CONFIRM_SETTING, true);

    show(deps, {
        viewType: 'versori.deployForm',
        title: `Deploy · ${projectName(deps.state)}`,
        heading: 'Deploy project',
        subtitle: subtitle(deps.state),
        dryRunFieldId: 'dryRun',
        dryRunLabel: 'Run dry run',
        liveLabel: 'Deploy to {environment}',
        // Nothing here is a snapshot of remote state, and reopening should not
        // discard a half-written version description.
        refreshOnReopen: false,
        confirmWhenLive,
        confirmSettingId: CONFIRM_SETTING,
        // Names the project as well as the environment: the last gate should
        // surface the thing that would be wrong. An environment name alone reads
        // as correct even when the panel is pointed at another project.
        confirmMessage: `This will deploy ${deployTarget(deps.state)} for real to {environment}.`,
        buildArgs: (values) =>
            buildDeployArgs({
                projectId: deps.state.projectId,
                name: readString(values, 'name'),
                description: readString(values, 'description'),
                environment: readString(values, 'environment'),
                dryRun: readBoolean(values, 'dryRun'),
            }),
        successMessage: (values) => `Deployed to ${readString(values, 'environment')}.`,
        fields: [
            {
                kind: 'text',
                id: 'name',
                label: 'Version name',
                placeholder: 'leave blank for a UTC timestamp',
                value: '',
                hint: 'Optional. The CLI names the version after the current time when blank.',
            },
            {
                kind: 'textarea',
                id: 'description',
                label: 'Description',
                placeholder: 'what changed in this version',
                value: '',
                hint: 'Optional, but it becomes the changelog entry for this version.',
            },
            {
                kind: 'select',
                id: 'environment',
                label: 'Environment',
                value: environments[0],
                options: environments,
            },
            {
                kind: 'checkbox',
                id: 'dryRun',
                label: 'Dry run — list the files that would upload, deploy nothing',
                value: true,
                hint: 'Untick to deploy for real.',
            },
        ],
    });
}

export function openSaveVersionForm(deps: FormDeps): void {
    show(deps, {
        viewType: 'versori.saveVersionForm',
        title: `Save version · ${projectName(deps.state)}`,
        heading: 'Save version',
        subtitle: subtitle(deps.state),
        dryRunFieldId: 'dryRun',
        dryRunLabel: 'Run dry run',
        liveLabel: 'Save version',
        // A version is an inert snapshot — it makes nothing live, so the extra
        // confirmation that guards deploy would be friction without a purpose.
        refreshOnReopen: false,
        confirmWhenLive: false,
        confirmSettingId: '',
        confirmMessage: '',
        buildArgs: (values) =>
            buildVersionArgs({
                projectId: deps.state.projectId,
                name: readString(values, 'name'),
                description: readString(values, 'description'),
                dryRun: readBoolean(values, 'dryRun'),
            }),
        successMessage: (values) =>
            `Saved version "${readString(values, 'name')}" — a checkpoint only, not deployed.`,
        fields: [
            {
                kind: 'text',
                id: 'name',
                label: 'Version name',
                placeholder: 'e.g. order-webhook',
                value: defaultVersionName(),
                required: true,
                hint: 'Required — the CLI opens an editor when this is blank, which would hang.',
            },
            {
                kind: 'textarea',
                id: 'description',
                label: 'Description',
                placeholder: 'what changed',
                value: '',
                required: true,
                hint: 'Required, for the same reason. Reads as the changelog entry.',
            },
            {
                kind: 'checkbox',
                id: 'dryRun',
                label: 'Dry run — list the files that would upload, save nothing',
                value: true,
                hint: 'Untick to save the checkpoint. Saving never deploys.',
            },
        ],
    });
}

export function show(deps: FormDeps, spec: FormSpec): void {
    const existing = openPanels.get(spec.viewType);
    const key = targetKey(deps.state);

    if (existing) {
        // Reveal-and-retain, but only for the project the open panel was built
        // for. That keeps a half-typed version description across a same-project
        // reopen without ever revealing — and submitting — another project's form.
        if (!spec.refreshOnReopen && openTargets.get(spec.viewType) === key) {
            existing.reveal();
            return;
        }

        // Either the spec is snapshot-backed (Resources), or the target changed.
        //
        // Snapshot case: the caller has just re-read the state this spec was built
        // from, while the open panel still holds the previous snapshot in both its
        // fields and its `buildArgs` closure. Revealing it would submit those
        // stale values — and for a read-modify-write command that silently
        // reverts whatever changed in between. Losing unsubmitted keystrokes is
        // much the cheaper harm: reopening from the menu means "show me the
        // current config".
        //
        // Changed-target case: same reasoning, worse consequence — the stale
        // `buildArgs` would deploy the project the panel was first opened from.
        existing.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
        spec.viewType,
        spec.title,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    openPanels.set(spec.viewType, panel);
    openTargets.set(spec.viewType, key);
    // Identity-checked: a refresh disposes the previous panel for this view type,
    // and that dispose must not evict the replacement registered just above. The
    // target is removed under the same guard, so the two maps cannot fall out of
    // step whether the dispose handler runs synchronously or is deferred.
    panel.onDidDispose(() => {
        if (openPanels.get(spec.viewType) === panel) {
            openPanels.delete(spec.viewType);
            openTargets.delete(spec.viewType);
        }
    });

    panel.webview.html = renderFormHtml(spec, crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(async (message: SubmitMessage | { type: 'cancel' }) => {
        if (message.type === 'cancel') {
            panel.dispose();
            return;
        }

        if (message.type !== 'submit') {
            return;
        }

        // Only forms that read a setting may turn it off. Otherwise ticking
        // "Don't ask again" here would disable another command's confirmation.
        if (message.dontAskAgain && spec.confirmSettingId) {
            await vscode.workspace
                .getConfiguration()
                .update(spec.confirmSettingId, false, vscode.ConfigurationTarget.Global);
        }

        await execute(deps, spec, panel, message.values, message.dontAskAgain);
    });
}

async function execute(
    deps: FormDeps,
    spec: FormSpec,
    panel: vscode.WebviewPanel,
    values: FormValues,
    confirmDisabled: boolean,
): Promise<void> {
    let args: string[];
    try {
        args = spec.buildArgs(values);
    } catch (err) {
        await post(panel, false, errorText(err), confirmDisabled);
        return;
    }

    const cmd: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
        json: false,
    };
    const dryRun = readBoolean(values, spec.dryRunFieldId);

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Versori: ${spec.heading}` },
            () => run(deps.bin, cmd),
        );

        deps.output.appendLine(`$ ${displayCommand(cmd)}`);
        deps.output.appendLine(result.stdout.trimEnd());
        deps.output.appendLine('');

        await post(panel, true, result.stdout || '(no output)', confirmDisabled);

        if (!dryRun) {
            vscode.window.showInformationMessage(spec.successMessage(values));
        }
    } catch (err) {
        deps.output.appendLine(`$ ${displayCommand(cmd)}`);
        deps.output.appendLine(errorText(err));
        deps.output.appendLine('');

        await post(panel, false, errorText(err), confirmDisabled);
    }
}

function post(
    panel: vscode.WebviewPanel,
    ok: boolean,
    text: string,
    confirmDisabled: boolean,
): Thenable<boolean> {
    return panel.webview.postMessage({ type: 'result', ok, text, confirmDisabled });
}

function projectName(state: ResolvedState): string {
    return state.projectDir ? path.basename(state.projectDir) : 'project';
}

/**
 * The project a deploy would actually hit, for the confirmation bar.
 *
 * The folder name is what the user recognises; the id is what the CLI is sent,
 * so both are named. When there is no id the CLI resolves the project from the
 * spawn cwd, and saying so is more use than printing nothing.
 */
function deployTarget(state: ResolvedState): string {
    return state.projectId
        ? `${projectName(state)} (${state.projectId})`
        : `${projectName(state)} (resolved from the current folder)`;
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    if (state.overridesActive) {
        parts.push(`pinned by .versori, overriding ${state.activeContextName}`);
    }
    return parts.join('  ·  ');
}

function defaultVersionName(): string {
    // Mirrors the CLI's own default format: 2006-01-02-15-04-05, UTC.
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function errorText(err: unknown): string {
    if (err instanceof CliError) {
        return err.stderr || err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
