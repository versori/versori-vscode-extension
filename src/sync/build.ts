import * as path from 'node:path';

import { envelopeItems, text } from '../cli-json';
import { ResolvedState } from '../resolver/types';

export interface SyncValues {
    projectId: string;
    directory: string;
    assets: boolean;
    dryRun: boolean;
}

export interface ProjectEntry {
    id: string;
    name: string;
}

export interface ProjectPickItem {
    label: string;
    description: string;
    projectId: string;
}

export function normalizeSyncDirectory(input: string, workspaceRoot?: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('a target directory is required');
    }
    return path.isAbsolute(trimmed)
        ? path.normalize(trimmed)
        : path.resolve(workspaceRoot ?? process.cwd(), trimmed);
}

export function fixedSyncDirectory(
    preferredDirectory: string | undefined,
    workspaceRoot?: string,
): string | undefined {
    if (!preferredDirectory?.trim()) {
        return undefined;
    }
    return normalizeSyncDirectory(preferredDirectory, workspaceRoot);
}

export function validateSyncSubfolderName(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('a subfolder name is required');
    }
    if (trimmed === '.' || trimmed === '..') {
        throw new Error('a subfolder name cannot be "." or ".."');
    }
    if (
        path.isAbsolute(trimmed) ||
        path.posix.isAbsolute(trimmed) ||
        path.win32.isAbsolute(trimmed) ||
        /[\\/]/.test(trimmed)
    ) {
        throw new Error('a subfolder name must be a single relative path component');
    }
    return trimmed;
}

export function safeSyncSubfolderName(projectName: string): string {
    const sanitized = projectName
        .trim()
        .replace(/\s*[\\/]\s*/g, ' - ')
        .replace(/[:*?"<>|]/g, '-')
        .replace(/[\u0000-\u001f]/g, '-')
        .trim();

    try {
        return validateSyncSubfolderName(sanitized);
    } catch {
        return 'versori-project';
    }
}

export function buildSyncTargetDirectory(
    selectedDirectory: string,
    createSubfolder: boolean,
    subfolderName: string,
): string {
    const parent = selectedDirectory.trim();
    if (!parent) {
        throw new Error('a target directory is required');
    }
    if (!createSubfolder) {
        return parent;
    }
    return path.join(parent, validateSyncSubfolderName(subfolderName));
}

export interface SyncCreateSubfolderOptions {
    currentProjectId?: string;
    selectedProjectId: string;
    currentProjectDirectory?: string;
    selectedDirectory: string;
}

export function defaultSyncCreateSubfolder(options: SyncCreateSubfolderOptions): boolean {
    const currentDirectory = options.currentProjectDirectory?.trim();
    const selectedDirectory = options.selectedDirectory.trim();
    const isCurrentTarget =
        options.currentProjectId === options.selectedProjectId &&
        currentDirectory !== undefined &&
        currentDirectory !== '' &&
        selectedDirectory !== '' &&
        path.resolve(currentDirectory) === path.resolve(selectedDirectory);

    return !isCurrentTarget;
}

export interface SyncDefaultDirectoryOptions {
    preferredDirectory?: string;
    currentProjectId?: string;
    selectedProjectId: string;
    currentProjectDirectory?: string;
    activeEditorWorkspaceDirectory?: string;
    firstWorkspaceDirectory?: string;
}

/**
 * Choose the folder the native browser should open at without checking that it
 * exists: VS Code can still navigate to a missing path and the CLI can create
 * a new Sync target after confirmation.
 */
export function selectSyncDefaultDirectory(
    options: SyncDefaultDirectoryOptions,
): string | undefined {
    const candidates = [
        options.preferredDirectory,
        options.currentProjectId === options.selectedProjectId
            ? options.currentProjectDirectory
            : undefined,
        options.activeEditorWorkspaceDirectory,
        options.firstWorkspaceDirectory,
    ];

    for (const candidate of candidates) {
        const trimmed = candidate?.trim();
        if (trimmed) {
            return trimmed;
        }
    }
    return undefined;
}

export function buildSyncConfirmationMessage(
    projectName: string,
    projectId: string,
    directory: string,
): string {
    return [
        'THIS WILL DELETE FILES IN THIS FOLDER',
        directory,
        '',
        `Remote project: ${projectName} (${projectId})`,
        '',
        'Live sync replaces local project files with the remote project.',
        'Local-only files can be removed and local edits can be overwritten.',
    ].join('\n');
}

export function syncState(
    state: ResolvedState,
    projectId: string,
    directory: string,
): ResolvedState {
    if (state.projectId === projectId && state.projectDir === directory) {
        return state;
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

/**
 * Build the argv for `projects sync`.
 *
 * The CLI's safe default is a dry run. `--confirm` is appended only after the
 * form's dry-run checkbox has been explicitly unticked.
 */
export function buildSyncArgs(values: SyncValues): string[] {
    const projectId = values.projectId.trim();
    const directory = values.directory.trim();

    if (!projectId || !directory) {
        throw new Error('a project and target directory are required');
    }

    const args = ['projects', 'sync', '--project', projectId, '--directory', directory];

    if (values.assets) {
        args.push('--assets');
    }
    if (!values.dryRun) {
        args.push('--confirm');
    }

    return args;
}

/** Parse the `{ projects: [...] }` response emitted by `projects list -o json`. */
export function parseProjectList(raw: unknown): ProjectEntry[] {
    const entries = envelopeItems(raw, ['projects', 'items', 'results']);

    return entries
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return undefined;
            }

            const record = entry as Record<string, unknown>;
            const id = text(record.id ?? record.Id ?? record.ID);
            if (!id) {
                return undefined;
            }

            return {
                id,
                name: text(record.name ?? record.Name) || id,
            };
        })
        .filter((entry): entry is ProjectEntry => entry !== undefined);
}

/**
 * Convert projects to QuickPick data, keeping the current project visible and
 * first without changing the CLI's alphabetical ordering for the others.
 */
export function projectPickItems(
    projects: ProjectEntry[],
    currentProjectId: string | undefined,
): ProjectPickItem[] {
    return [...projects]
        .sort((a, b) => {
            const current = Number(b.id === currentProjectId) - Number(a.id === currentProjectId);
            return current || a.name.localeCompare(b.name);
        })
        .map((project) => ({
            label: project.name,
            description:
                project.id === currentProjectId
                    ? `${project.id} (current project)`
                    : project.id,
            projectId: project.id,
        }));
}
