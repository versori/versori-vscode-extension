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
    const entries = projectEntries(raw);

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

function projectEntries(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (!raw || typeof raw !== 'object') {
        return [];
    }

    const record = raw as Record<string, unknown>;
    for (const key of ['projects', 'items', 'results']) {
        if (Array.isArray(record[key])) {
            return record[key] as unknown[];
        }
    }
    return [];
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
