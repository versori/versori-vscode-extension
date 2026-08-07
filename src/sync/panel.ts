import * as path from 'node:path';
import * as vscode from 'vscode';

import { runJson } from '../cli';
import { FormDeps, runForm } from '../forms/panel';
import { readBoolean } from '../forms/build';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { ResolvedState } from '../resolver/types';
import {
    buildSyncConfirmationMessage,
    buildSyncArgs,
    buildSyncTargetDirectory,
    defaultSyncCreateSubfolder,
    fixedSyncDirectory,
    normalizeSyncDirectory,
    parseProjectList,
    projectPickItems,
    safeSyncSubfolderName,
    selectSyncDefaultDirectory,
    syncState,
} from './build';

export interface SyncDeps extends FormDeps {
    /** Invalidates the local resolver after a live sync writes `.versori`. */
    onContextChanged: () => void;
}

export interface SyncFormOptions {
    /** Folder supplied by an Explorer context action, shown first in choices. */
    preferredDirectory?: string;
    /** Workspace root used for relative typed paths. */
    workspaceRoot?: string;
    /** Context actions target exactly the chosen folder, with no subfolder UI. */
    hideCreateSubfolder?: boolean;
}

interface ProjectListResponse {
    projects?: unknown[];
}

/**
 * Choose a remote project and open the guarded sync form.
 *
 * Listing is organisation-scoped and deliberately runs without a cwd, so the
 * picker reflects the active CLI context even when the current project pins a
 * different context in `.versori`.
 */
export async function openSyncForm(
    deps: SyncDeps,
    popup: PopupSession,
    options: SyncFormOptions = {},
): Promise<'menu' | 'close'> {
    popup.loading('Sync', 'Loading projects…');
    const raw = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Versori: loading projects' },
        () => runJson<ProjectListResponse>(deps.bin, { args: ['projects', 'list'] }),
    );
    if (!popup.isVisible()) {
        return 'menu';
    }

    const projects = parseProjectList(raw);
    if (projects.length === 0) {
        popup.close();
        await vscode.window.showWarningMessage('Versori: no projects found in the active context.');
        return 'menu';
    }

    while (true) {
        const picked = await popup.choose({
            title: 'Select remote project to sync',
            placeholder: 'Choose the remote project',
            items: projectPickItems(projects, deps.state.projectId).map((project) => ({
                ...project,
                label: `$(cloud) ${project.label}`,
                value: project,
            })),
            back: true,
        });
        if (picked === undefined || picked === POPUP_BACK) {
            return 'menu';
        }

        let directory: string | typeof POPUP_BACK | undefined;
        try {
            const fixedDirectory = options.hideCreateSubfolder
                ? fixedSyncDirectory(options.preferredDirectory, options.workspaceRoot)
                : undefined;
            directory =
                fixedDirectory ??
                (await resolveDirectory(
                    deps,
                    picked.projectId,
                    picked.label,
                    popup,
                    options,
                ));
        } catch (err) {
            await showDirectoryError(popup, err);
            continue;
        }
        if (directory === POPUP_BACK) {
            continue;
        }
        if (directory === undefined) {
            return 'menu';
        }

        const state = syncState(deps.state, picked.projectId, directory);
        const createSubfolder = defaultSyncCreateSubfolder({
            currentProjectId: deps.state.projectId,
            selectedProjectId: picked.projectId,
            currentProjectDirectory: deps.state.projectDir,
            selectedDirectory: directory,
        });
        const defaultSubfolderName = safeSyncSubfolderName(picked.label);
        const targetDirectory = (values: Record<string, string | boolean>): string => {
            const typed =
                typeof values.subfolderName === 'string' ? values.subfolderName.trim() : '';
            return buildSyncTargetDirectory(
                directory,
                !options.hideCreateSubfolder && values.createSubfolder === true,
                typed || defaultSubfolderName,
            );
        };

        return runForm(
            { ...deps, state },
            popup,
            {
                title: `Sync · ${picked.label}`,
                heading: 'Sync project',
                subtitle: subtitle(picked.label, picked.projectId, directory, state),
                dryRunFieldId: 'dryRun',
                dryRunLabel: '$(eye) Preview sync',
                liveLabel: `$(cloud-download) Sync ${picked.label} live`,
                confirmWhenLive: true,
                // Sync always confirms. There is intentionally no setting that can
                // turn this safety gate off.
                confirmSettingId: '',
                confirmMessage: (values) =>
                    buildSyncConfirmationMessage(
                        picked.label,
                        picked.projectId,
                        targetDirectory(values),
                    ),
                closeAfterRun: true,
                commandCwd: null,
                fields: [
                    {
                        kind: 'checkbox',
                        id: 'dryRun',
                        label: '$(eye) Dry run',
                        value: true,
                        hint: 'Preview creates, updates, and deletes; live sync requires confirmation.',
                    },
                    ...(options.hideCreateSubfolder
                        ? []
                        : [
                              {
                                  kind: 'checkbox' as const,
                                  id: 'createSubfolder',
                                  label: '$(folder) Create subfolder',
                                  value: createSubfolder,
                                  hint: createSubfolder
                                      ? 'Keeps the selected folder from being overwritten at its root.'
                                      : 'Re-syncing the current project folder targets that folder directly.',
                              },
                              {
                                  kind: 'text' as const,
                                  id: 'subfolderName',
                                  label: '$(edit) Subfolder name',
                                  placeholder: defaultSubfolderName,
                                  value: defaultSubfolderName,
                                  hint: 'Shown when Create subfolder is on. Blank uses the project name.',
                              },
                          ]),
                    {
                        kind: 'checkbox',
                        id: 'assets',
                        label: '$(package) Include assets',
                        value: false,
                        hint: 'Also sync project assets.',
                    },
                ],
                buildArgs: (values) =>
                    buildSyncArgs({
                        projectId: picked.projectId,
                        directory: targetDirectory(values),
                        assets: readBoolean(values, 'assets'),
                        dryRun: readBoolean(values, 'dryRun'),
                    }),
                successMessage: (values) =>
                    `Synced ${picked.label} into ${targetDirectory(values)}.`,
                onLiveSuccess: deps.onContextChanged,
            },
        );
    }
}

type DirectoryChoice =
    | { kind: 'directory'; directory: string }
    | { kind: 'browse' }
    | { kind: 'typed' };

async function resolveDirectory(
    deps: SyncDeps,
    projectId: string,
    projectName: string,
    popup: PopupSession,
    options: SyncFormOptions,
): Promise<string | typeof POPUP_BACK | undefined> {
    const workspaceRoot =
        options.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    while (true) {
        const choice = await popup.choose<DirectoryChoice>({
            title: `Choose a directory for ${projectName}`,
            placeholder: 'Select a folder or type another path',
            items: directoryItems(deps, projectId, options.preferredDirectory),
            back: true,
        });
        if (choice === undefined || choice === POPUP_BACK) {
            return POPUP_BACK;
        }
        if (choice.kind === 'directory') {
            try {
                return normalizeSyncDirectory(choice.directory, workspaceRoot);
            } catch (err) {
                await showDirectoryError(popup, err);
                continue;
            }
        }

        if (choice.kind === 'browse') {
            popup.close();

            let selected: vscode.Uri[] | undefined;
            try {
                selected = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    defaultUri: defaultDirectoryUri(deps, projectId, options.preferredDirectory),
                });
            } catch (err) {
                await showDirectoryError(popup, err);
                continue;
            }

            const selectedDirectory = selected?.[0];
            if (!selectedDirectory) {
                // Escape/Back in the native browser returns to this same
                // directory-choice screen when the PopupSession is shown below.
                continue;
            }

            try {
                return normalizeSyncDirectory(selectedDirectory.fsPath, workspaceRoot);
            } catch (err) {
                await showDirectoryError(popup, err);
                continue;
            }
        }

        const typed = await popup.input({
            title: `Directory for ${projectName}`,
            placeholder: 'Absolute or workspace-relative path',
            value: workspaceRoot ?? '',
            back: true,
        });
        if (typed === undefined || typed === POPUP_BACK) {
            continue;
        }

        try {
            return normalizeSyncDirectory(typed, workspaceRoot);
        } catch (err) {
            await showDirectoryError(popup, err);
        }
    }
}

async function showDirectoryError(popup: PopupSession, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    popup.close();
    await vscode.window.showErrorMessage(`Versori: ${message}`);
}

function directoryItems(
    deps: SyncDeps,
    projectId: string,
    preferredDirectory?: string,
): Array<{
    label: string;
    description?: string;
    detail?: string;
    value: DirectoryChoice;
}> {
    const items: Array<{
        label: string;
        description?: string;
        detail?: string;
        value: DirectoryChoice;
    }> = [];
    const seen = new Set<string>();

    if (preferredDirectory?.trim()) {
        const directory = preferredDirectory.trim();
        items.push({
            label: '$(folder-opened) Explorer folder',
            description: directory,
            detail: 'Selected folder from the Explorer',
            value: { kind: 'directory', directory },
        });
        seen.add(directory);
    }

    if (deps.state.projectId === projectId && deps.state.projectDir) {
        if (!seen.has(deps.state.projectDir)) {
            items.push({
                label: '$(folder-opened) Current project folder',
                description: deps.state.projectDir,
                detail: 'Best match for this remote project',
                value: { kind: 'directory', directory: deps.state.projectDir },
            });
            seen.add(deps.state.projectDir);
        }
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const directory = folder.uri.fsPath;
        if (seen.has(directory)) {
            continue;
        }
        seen.add(directory);
        items.push({
            label: `$(folder) ${folder.name}`,
            description: directory,
            detail: 'Workspace folder',
            value: { kind: 'directory', directory },
        });
    }

    items.push({
        label: '$(folder-opened) Browse for a folder…',
        description: 'Open the native folder browser',
        value: { kind: 'browse' },
    });
    items.push({
        label: '$(edit) Type another folder path',
        description: 'Enter an absolute or workspace-relative path',
        detail: 'A .versori file is not required',
        value: { kind: 'typed' },
    });
    return items;
}

function defaultDirectoryUri(
    deps: SyncDeps,
    projectId: string,
    preferredDirectory?: string,
): vscode.Uri | undefined {
    const activeWorkspace = vscode.window.activeTextEditor
        ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
        : undefined;
    const firstWorkspace = vscode.workspace.workspaceFolders?.[0];
    const selectedDirectory = selectSyncDefaultDirectory({
        preferredDirectory,
        currentProjectId: deps.state.projectId,
        selectedProjectId: projectId,
        currentProjectDirectory: deps.state.projectDir,
        activeEditorWorkspaceDirectory: activeWorkspace?.uri.fsPath,
        firstWorkspaceDirectory: firstWorkspace?.uri.fsPath,
    });

    if (!selectedDirectory) {
        return undefined;
    }

    if (
        deps.state.projectId === projectId &&
        deps.state.projectDir?.trim() === selectedDirectory
    ) {
        // Do not stat this path: a missing target is valid and can be created
        // by the CLI after live confirmation.
        return vscode.Uri.file(selectedDirectory);
    }

    if (activeWorkspace?.uri.fsPath.trim() === selectedDirectory) {
        return activeWorkspace.uri;
    }

    if (firstWorkspace?.uri.fsPath.trim() === selectedDirectory) {
        return firstWorkspace.uri;
    }

    return vscode.Uri.file(selectedDirectory);
}

function subtitle(
    projectName: string,
    projectId: string,
    directory: string,
    state: ResolvedState,
): string {
    const parts = [
        `Context: ${state.contextName ?? 'none'}`,
        `Remote project: ${projectName} (${projectId})`,
        `Target folder: ${compactDirectory(directory)}`,
    ];
    if (state.overridesActive) {
        parts.push(`pinned by .versori, overriding ${state.activeContextName}`);
    }
    return parts.join('  ·  ');
}

function compactDirectory(directory: string): string {
    const normalized = path.normalize(directory);
    const base = path.basename(normalized);
    if (!base || base === path.parse(normalized).root) {
        return normalized;
    }
    return `…${path.sep}${base}`;
}
