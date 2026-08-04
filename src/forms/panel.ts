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
        confirmWhenLive,
        confirmMessage: 'This will deploy for real to {environment}.',
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
        confirmWhenLive: false,
        confirmMessage: '',
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

function show(deps: FormDeps, spec: FormSpec): void {
    const existing = openPanels.get(spec.viewType);
    if (existing) {
        existing.reveal();
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        spec.viewType,
        spec.title,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    openPanels.set(spec.viewType, panel);
    panel.onDidDispose(() => openPanels.delete(spec.viewType));

    panel.webview.html = renderFormHtml(spec, crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(async (message: SubmitMessage | { type: 'cancel' }) => {
        if (message.type === 'cancel') {
            panel.dispose();
            return;
        }

        if (message.type !== 'submit') {
            return;
        }

        if (message.dontAskAgain) {
            await vscode.workspace
                .getConfiguration()
                .update(CONFIRM_SETTING, false, vscode.ConfigurationTarget.Global);
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
        args = argsFor(spec.viewType, values, deps.state.projectId);
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
            vscode.window.showInformationMessage(
                spec.viewType === 'versori.deployForm'
                    ? `Deployed to ${readString(values, 'environment')}.`
                    : `Saved version "${readString(values, 'name')}" — a checkpoint only, not deployed.`,
            );
        }
    } catch (err) {
        deps.output.appendLine(`$ ${displayCommand(cmd)}`);
        deps.output.appendLine(errorText(err));
        deps.output.appendLine('');

        await post(panel, false, errorText(err), confirmDisabled);
    }
}

function argsFor(viewType: string, values: FormValues, projectId?: string): string[] {
    const dryRun = readBoolean(values, 'dryRun');

    if (viewType === 'versori.deployForm') {
        return buildDeployArgs({
            projectId,
            name: readString(values, 'name'),
            description: readString(values, 'description'),
            environment: readString(values, 'environment'),
            dryRun,
        });
    }

    return buildVersionArgs({
        projectId,
        name: readString(values, 'name'),
        description: readString(values, 'description'),
        dryRun,
    });
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
