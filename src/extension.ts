import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { findCli } from './cli';
import { showMenu } from './commands/menu';
import { FormDeps, openDeployForm, openSaveVersionForm } from './forms/panel';
import { PopupSession } from './forms/popup';
import { LocalContextResolver } from './resolver/local';
import { ContextResolver, EMPTY_STATE, ResolvedState } from './resolver/types';
import { VersoriStatusBar } from './statusbar';
import { openSyncForm } from './sync/panel';

const MENU_COMMAND = 'versori.showMenu';
const CLI_PATH_SETTING = 'versori.cliPath';
const CONTEXT_SYNC_COMMAND = 'versori.syncProjectHere';
const CONTEXT_DEPLOY_COMMAND = 'versori.deployProject';
const CONTEXT_SAVE_COMMAND = 'versori.saveVersion';

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('Versori');
    context.subscriptions.push(output);

    const resolver: ContextResolver = new LocalContextResolver({
        log: (message) => output.appendLine(message),
    });

    const statusBar = new VersoriStatusBar(MENU_COMMAND);
    context.subscriptions.push(statusBar);

    // The directory currently being reported on, so the bar does not blank when
    // focus moves to a terminal. Never holds a resolved result — see Scope.
    let lastScope: Scope | undefined;
    let lastState: ResolvedState = EMPTY_STATE;

    const cliPath = (): string | undefined => {
        const configured = vscode.workspace
            .getConfiguration()
            .get<string>(CLI_PATH_SETTING, '')
            .trim();
        return findCli(configured || undefined);
    };

    const refresh = (): void => {
        const bin = cliPath();
        if (!bin) {
            const configured = vscode.workspace
                .getConfiguration()
                .get<string>(CLI_PATH_SETTING, '')
                .trim();
            statusBar.renderCliMissing(configured || undefined);
            return;
        }

        lastScope = currentScope(lastScope);
        lastState = resolver.resolve(lastScope?.dir, lastScope?.boundary);
        statusBar.render(lastState);
    };

    const invalidateAndRefresh = (): void => {
        resolver.invalidate();
        refresh();
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(MENU_COMMAND, async () => {
            const bin = cliPath();
            if (!bin) {
                await promptForCliPath();
                return;
            }

            await showMenu({
                bin,
                state: lastState,
                output,
                onContextChanged: invalidateAndRefresh,
                getState: () => lastState,
            });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('versori.showOutput', () => output.show(true)),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(CONTEXT_SYNC_COMMAND, async (uri: vscode.Uri) => {
            const bin = cliPath();
            if (!bin) {
                await promptForCliPath();
                return;
            }

            const popup = new PopupSession();
            try {
                const scope = scopeForUri(uri);
                if (!scope) {
                    await showContextMessage(
                        popup,
                        'Sync project',
                        '$(info) Select a local Explorer folder',
                        'This command needs a folder from the local file explorer.',
                    );
                    return;
                }

                await openSyncForm(
                    {
                        bin,
                        state: resolver.resolve(scope.dir, scope.boundary),
                        output,
                        onContextChanged: invalidateAndRefresh,
                    },
                    popup,
                    {
                        preferredDirectory: scope.dir,
                        workspaceRoot: scope.boundary,
                        hideCreateSubfolder: true,
                    },
                );
            } finally {
                popup.dispose();
            }
        }),
        vscode.commands.registerCommand(CONTEXT_DEPLOY_COMMAND, (uri: vscode.Uri) =>
            runProjectContextForm(
                uri,
                'Deploy project',
                openDeployForm,
                cliPath,
                resolver,
                output,
            ),
        ),
        vscode.commands.registerCommand(CONTEXT_SAVE_COMMAND, (uri: vscode.Uri) =>
            runProjectContextForm(
                uri,
                'Save version',
                openSaveVersionForm,
                cliPath,
                resolver,
                output,
            ),
        ),
    );

    // --- invalidation sources -------------------------------------------------

    const versoriWatcher = vscode.workspace.createFileSystemWatcher('**/.versori');
    versoriWatcher.onDidCreate(invalidateAndRefresh);
    versoriWatcher.onDidChange(invalidateAndRefresh);
    versoriWatcher.onDidDelete(invalidateAndRefresh);
    context.subscriptions.push(versoriWatcher);

    context.subscriptions.push(watchCliConfig(invalidateAndRefresh, output));

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(refresh),
        vscode.workspace.onDidChangeWorkspaceFolders(invalidateAndRefresh),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CLI_PATH_SETTING)) {
                refresh();
            }
        }),
    );

    refresh();
}

export function deactivate(): void {
    // All disposables are registered on the extension context.
}

/**
 * The directory the status bar is currently reporting on.
 *
 * Only a directory is remembered, never a resolved result. An earlier version
 * cached the `ResolvedState` itself, which `resolver.invalidate()` could not
 * reach — so a `.versori` edit left the bar showing the old project and a stale
 * override warning indefinitely. Keeping the resolver as the single cache means
 * invalidation always takes effect.
 */
interface Scope {
    dir: string;
    boundary?: string;
}

type ProjectContextForm = (
    deps: FormDeps,
    popup: PopupSession,
) => Promise<'menu' | 'close'>;

async function runProjectContextForm(
    uri: vscode.Uri,
    heading: string,
    form: ProjectContextForm,
    cliPath: () => string | undefined,
    resolver: ContextResolver,
    output: vscode.OutputChannel,
): Promise<void> {
    const bin = cliPath();
    if (!bin) {
        await promptForCliPath();
        return;
    }

    const popup = new PopupSession();
    try {
        const scope = scopeForUri(uri);
        if (!scope) {
            await showContextMessage(
                popup,
                heading,
                '$(info) Select a local Explorer folder',
                'This command needs a folder from the local file explorer.',
            );
            return;
        }

        const state = resolver.resolve(scope.dir, scope.boundary);
        if (!state.projectId || !state.projectDir) {
            await showContextMessage(
                popup,
                heading,
                '$(info) This folder is not a Versori project',
                'Open a folder containing a .versori file before running this project action. No CLI command was run.',
            );
            return;
        }

        await form({ bin, state, output }, popup);
    } finally {
        popup.dispose();
    }
}

function scopeForUri(uri: vscode.Uri | undefined): Scope | undefined {
    if (!uri || uri.scheme !== 'file') {
        return undefined;
    }

    return {
        dir: uri.fsPath,
        boundary: vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath,
    };
}

async function showContextMessage(
    popup: PopupSession,
    heading: string,
    label: string,
    detail: string,
): Promise<void> {
    await popup.choose({
        title: heading,
        placeholder: detail,
        items: [
            {
                label,
                description: detail,
                detail: 'No CLI command was run.',
                value: true,
            },
        ],
    });
}

/**
 * Pick the directory to resolve against: the active editor's, else the last one
 * we reported on (so the bar does not blank when focus moves to a terminal),
 * else the first workspace folder.
 */
function currentScope(previous: Scope | undefined): Scope | undefined {
    const editor = vscode.window.activeTextEditor;

    if (editor && editor.document.uri.scheme === 'file') {
        const uri = editor.document.uri;
        return {
            dir: path.dirname(uri.fsPath),
            boundary: vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath,
        };
    }

    if (previous) {
        return previous;
    }

    const first = vscode.workspace.workspaceFolders?.[0];
    return first ? { dir: first.uri.fsPath, boundary: first.uri.fsPath } : undefined;
}

/**
 * Watch `~/.versori/config.yaml` for context switches made in a terminal.
 *
 * It lives outside the workspace, so `createFileSystemWatcher` cannot see it.
 * The directory is watched rather than the file so that an atomic
 * write-and-rename (which replaces the inode) is still noticed.
 */
function watchCliConfig(
    onChange: () => void,
    output: vscode.OutputChannel,
): vscode.Disposable {
    const dir = path.join(os.homedir(), '.versori');

    let watcher: fs.FSWatcher | undefined;
    try {
        watcher = fs.watch(dir, (_event, filename) => {
            if (!filename || filename === 'config.yaml') {
                onChange();
            }
        });
    } catch {
        // No ~/.versori yet — the user has not run `versori context add`.
        output.appendLine(`not watching ${dir} (directory does not exist yet)`);
    }

    return new vscode.Disposable(() => watcher?.close());
}

async function promptForCliPath(): Promise<void> {
    const action = await vscode.window.showErrorMessage(
        'Versori CLI not found. VS Code cannot see shell aliases — set an absolute path.',
        'Open settings',
    );

    if (action === 'Open settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', CLI_PATH_SETTING);
    }
}
