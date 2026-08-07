import * as vscode from 'vscode';

import { runJson } from '../cli';
import { FormDeps, runForm } from '../forms/panel';
import { readBoolean } from '../forms/build';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { ResolvedState } from '../resolver/types';
import {
    buildSyncArgs,
    normalizeSyncDirectory,
    parseProjectList,
    projectPickItems,
    syncState,
} from './build';

export interface SyncDeps extends FormDeps {
    /** Invalidates the local resolver after a live sync writes `.versori`. */
    onContextChanged: () => void;
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
            title: 'Sync which project?',
            placeholder: 'Select a project to sync',
            items: projectPickItems(projects, deps.state.projectId).map((project) => ({
                ...project,
                value: project,
            })),
            back: true,
        });
        if (picked === undefined || picked === POPUP_BACK) {
            return 'menu';
        }

        const directory = await resolveDirectory(deps, picked.projectId, picked.label, popup);
        if (directory === POPUP_BACK) {
            continue;
        }
        if (directory === undefined) {
            return 'menu';
        }

        const state = syncState(deps.state, picked.projectId, directory);

        return runForm(
            { ...deps, state },
            popup,
            {
                title: `Sync · ${picked.label}`,
                heading: 'Sync project',
                subtitle: subtitle(picked.label, picked.projectId, directory, state),
                dryRunFieldId: 'dryRun',
                dryRunLabel: 'Run dry run',
                liveLabel: `Sync ${picked.label}`,
                confirmWhenLive: true,
                // Sync always confirms. There is intentionally no setting that can
                // turn this safety gate off.
                confirmSettingId: '',
                confirmMessage: `This will overwrite local changes in "${directory}" and delete local files not present in remote project "${picked.label}" (${picked.projectId}).`,
                commandCwd: null,
                fields: [
                    {
                        kind: 'checkbox',
                        id: 'dryRun',
                        label: 'Dry run — preview creates, updates, and deletes',
                        value: true,
                        hint: 'Untick only after reviewing the output. Live sync requires confirmation.',
                    },
                    {
                        kind: 'checkbox',
                        id: 'assets',
                        label: 'Include assets',
                        value: false,
                        hint: 'Also sync project assets.',
                    },
                ],
                buildArgs: (values) =>
                    buildSyncArgs({
                        projectId: picked.projectId,
                        directory,
                        assets: readBoolean(values, 'assets'),
                        dryRun: readBoolean(values, 'dryRun'),
                    }),
                successMessage: () => `Synced ${picked.label} into ${directory}.`,
                onLiveSuccess: deps.onContextChanged,
            },
        );
    }
}

type DirectoryChoice =
    | { kind: 'directory'; directory: string }
    | { kind: 'typed' };

async function resolveDirectory(
    deps: SyncDeps,
    projectId: string,
    projectName: string,
    popup: PopupSession,
): Promise<string | typeof POPUP_BACK | undefined> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    while (true) {
        const choice = await popup.choose<DirectoryChoice>({
            title: `Choose a directory for ${projectName}`,
            placeholder: 'Select a folder or type another path',
            items: directoryItems(deps, projectId),
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

function directoryItems(deps: SyncDeps, projectId: string): Array<{
    label: string;
    description?: string;
    value: DirectoryChoice;
}> {
    const items: Array<{
        label: string;
        description?: string;
        value: DirectoryChoice;
    }> = [];
    const seen = new Set<string>();

    if (deps.state.projectId === projectId && deps.state.projectDir) {
        items.push({
            label: 'Current project directory',
            description: deps.state.projectDir,
            value: { kind: 'directory', directory: deps.state.projectDir },
        });
        seen.add(deps.state.projectDir);
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const directory = folder.uri.fsPath;
        if (seen.has(directory)) {
            continue;
        }
        seen.add(directory);
        items.push({
            label: folder.name,
            description: directory,
            value: { kind: 'directory', directory },
        });
    }

    items.push({
        label: 'Type another folder path',
        description: 'Enter an absolute or workspace-relative path',
        value: { kind: 'typed' },
    });
    return items;
}

function subtitle(
    projectName: string,
    projectId: string,
    directory: string,
    state: ResolvedState,
): string {
    const parts = [
        `Context: ${state.contextName ?? 'none'}`,
        `Project: ${projectName} (${projectId})`,
        `Directory: ${directory}`,
    ];
    if (state.overridesActive) {
        parts.push(`pinned by .versori, overriding ${state.activeContextName}`);
    }
    return parts.join('  ·  ');
}
