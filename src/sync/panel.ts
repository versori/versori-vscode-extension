import * as vscode from 'vscode';

import { runJson } from '../cli';
import { FormDeps, show } from '../forms/panel';
import { readBoolean } from '../forms/build';
import { ResolvedState } from '../resolver/types';
import { buildSyncArgs, parseProjectList, projectPickItems } from './build';

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
export async function openSyncForm(deps: SyncDeps): Promise<void> {
    const raw = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Versori: loading projects' },
        () => runJson<ProjectListResponse>(deps.bin, { args: ['projects', 'list'] }),
    );

    const projects = parseProjectList(raw);
    if (projects.length === 0) {
        void vscode.window.showWarningMessage('Versori: no projects found in the active context.');
        return;
    }

    const picked = await vscode.window.showQuickPick(
        projectPickItems(projects, deps.state.projectId),
        {
            title: 'Sync which project?',
            placeHolder: 'Select a project to sync',
        },
    );
    if (!picked) {
        return;
    }

    const directory = await resolveDirectory(deps, picked.projectId, picked.label);
    if (!directory) {
        return;
    }

    const state = syncState(deps.state, picked.projectId, directory);

    show(
        { ...deps, state },
        {
            viewType: 'versori.syncForm',
            title: `Sync · ${picked.label}`,
            heading: 'Sync project',
            subtitle: subtitle(picked.label, picked.projectId, directory, state),
            dryRunFieldId: 'dryRun',
            dryRunLabel: 'Run dry run',
            liveLabel: `Sync ${picked.label}`,
            refreshOnReopen: true,
            confirmWhenLive: true,
            // Sync always confirms. There is intentionally no setting that can
            // turn this safety gate off.
            confirmSettingId: '',
            confirmMessage: `This will overwrite local changes in "${directory}" and delete local files not present in remote project "${picked.label}" (${picked.projectId}).`,
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

async function resolveDirectory(
    deps: SyncDeps,
    projectId: string,
    projectName: string,
): Promise<string | undefined> {
    if (deps.state.projectId === projectId && deps.state.projectDir) {
        return deps.state.projectDir;
    }

    const folders = await vscode.window.showOpenDialog({
        title: `Choose a directory for ${projectName}`,
        openLabel: 'Use this directory',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });

    return folders?.[0]?.fsPath;
}

function syncState(state: ResolvedState, projectId: string, directory: string): ResolvedState {
    if (state.projectId === projectId && state.projectDir) {
        return { ...state, projectDir: directory };
    }

    const activeContextName =
        state.activeContextName ?? (state.source === 'active' ? state.contextName : undefined);

    return {
        projectId,
        projectDir: directory,
        contextName: activeContextName,
        activeContextName,
        source: activeContextName ? 'active' : 'none',
        overridesActive: false,
    };
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
