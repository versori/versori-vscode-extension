import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, displayCommand, run, runJson } from '../cli';
import { contextFor } from '../commands/target';
import { resolveEnvironmentNames } from '../environments';
import { FormDeps } from '../forms/panel';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { ResolvedState } from '../resolver/types';
import { handleNavMessage } from '../webview/nav';
import {
    buildEditArgs,
    configFromEditor,
    editorFromConfig,
    readResourceConfig,
    ResourceConfig,
    ResourceEditorState,
} from './config';
import { renderResourcesHtml, ResourcesPayload } from './html';

const VIEW_TYPE = 'versori.resources';
const CONFIRM_YES = 'YES — Proceed';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    deps: FormDeps;
    environment: string;
    current: ResourceConfig;
}

/** Single panel — a second invocation retargets rather than stacking. */
let open: OpenPanel | undefined;

/**
 * Resource editor for one project environment.
 *
 * Values are read from `projects details` and written with `projects edit`,
 * which PUTs the whole deployment config — so the form is prefilled with the
 * current state and `buildEditArgs` re-sends the fields that would otherwise be
 * dropped. See config.ts for the two flags that behave that way.
 *
 * The editor itself is a WebviewPanel (literal range sliders). Environment
 * picking stays on the shared QuickPick popup; the parent owns menu wiring.
 */
export async function openResourcesForm(
    deps: FormDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    const picked =
        environments.length === 1
            ? environments[0]
            : await popup.choose({
                  title: 'Edit resources for which environment?',
                  items: environments.map((environment) => ({
                      label: environment,
                      value: environment,
                  })),
                  back: true,
              });
    if (picked === undefined || picked === POPUP_BACK) {
        return 'menu';
    }
    const environment = picked;

    let current: ResourceConfig | undefined;
    try {
        popup.loading('Resources', 'Reading current resource configuration…');
        const details = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: reading resources' },
            () =>
                runJson<unknown>(deps.bin, {
                    args: ['projects', 'details', deps.state.projectId as string],
                    cwd: deps.state.projectDir,
                    context: contextFor(deps.state),
                }),
        );
        if (!popup.isVisible()) {
            return 'menu';
        }
        current = readResourceConfig(details, environment);
    } catch (err) {
        popup.close();
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        deps.output.appendLine(`could not read resources: ${message}`);
        await vscode.window.showErrorMessage(`Versori: could not read resources — ${message}`);
        return 'menu';
    }

    if (!current) {
        popup.close();
        await vscode.window.showErrorMessage(
            `Versori: no environment named "${environment}" in this project.`,
        );
        return 'menu';
    }

    popup.close();
    await showResourcesPanel(deps, environment, current);
    return 'close';
}

async function showResourcesPanel(
    deps: FormDeps,
    environment: string,
    current: ResourceConfig,
): Promise<void> {
    if (open) {
        open.panel.reveal();
        open.deps = deps;
        open.environment = environment;
        open.current = current;
        await postResources(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        `Resources · ${projectName(deps.state)}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, deps, environment, current };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderResourcesHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage((message: { type?: string; editor?: ResourceEditorState }) => {
        if (handleNavMessage(message, panel)) {
            return;
        }
        if (message?.type === 'apply' && message.editor) {
            void applyResources(entry, message.editor);
        }
    });

    await postResources(entry);
}

async function postResources(entry: OpenPanel): Promise<void> {
    const payload: ResourcesPayload = {
        heading: 'Environment Config',
        subtitle: subtitle(entry.deps.state),
        environment: entry.environment,
        editor: editorFromConfig(entry.current),
    };
    await entry.panel.webview.postMessage({ type: 'resources', payload });
}

async function applyResources(entry: OpenPanel, editor: ResourceEditorState): Promise<void> {
    const { deps, environment, current } = entry;
    const next = configFromEditor(editor);

    let args: string[];
    try {
        args = buildEditArgs(environment, current, next, deps.state.projectId);
    } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        await postStatus(entry, { busy: false, error: text });
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `This changes the live deployment config for ${environment}. A running environment may restart.`,
        { modal: true },
        CONFIRM_YES,
    );
    if (confirmed !== CONFIRM_YES) {
        await postStatus(entry, { busy: false });
        return;
    }

    await postStatus(entry, { busy: true });

    const command = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
        json: false as const,
    };

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Versori: updating resources' },
            () => run(deps.bin, command),
        );
        const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
        deps.output.appendLine(`$ ${displayCommand(command)}`);
        if (text) {
            deps.output.appendLine(text);
        }
        deps.output.appendLine('');

        entry.current = next;
        const success = `Updated resources for ${environment}.`;
        await postStatus(entry, {
            busy: false,
            success,
            editor: editorFromConfig(next),
        });
        void vscode.window.showInformationMessage(`Versori: ${success}`);
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        deps.output.appendLine(`could not update resources: ${message}`);
        deps.output.appendLine('');
        await postStatus(entry, { busy: false, error: message });
        await vscode.window.showErrorMessage(`Versori: could not update resources — ${message}`);
    }
}

function postStatus(
    entry: OpenPanel,
    message: {
        busy?: boolean;
        error?: string;
        success?: string;
        editor?: ResourceEditorState;
    },
): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'status', ...message });
}

function projectName(state: ResolvedState): string {
    return state.projectDir ? path.basename(state.projectDir) : 'project';
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
