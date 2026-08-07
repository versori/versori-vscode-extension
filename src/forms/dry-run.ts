export type DryRunAction =
    | 'create'
    | 'update'
    | 'delete'
    | 'upload'
    | 'asset-upload'
    | 'asset-delete'
    | 'asset-download';

export interface DryRunChange {
    action: DryRunAction;
    path: string;
}

export interface DryRunPreview {
    changes: DryRunChange[];
    notes: string[];
}

export const DRY_RUN_ACTION_ORDER: DryRunAction[] = [
    'create',
    'update',
    'delete',
    'upload',
    'asset-upload',
    'asset-download',
    'asset-delete',
];

/**
 * Parse CLI dry-run text from sync / deploy / versions create into structured
 * file actions. Unknown lines become notes so the preview still surfaces them.
 */
export function parseDryRunOutput(text: string): DryRunPreview {
    const changes: DryRunChange[] = [];
    const notes: string[] = [];
    let section: 'delete' | 'upload' | 'asset-upload' | undefined;

    for (const raw of text.split(/\r?\n/)) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed === '(no output)') {
            continue;
        }

        const create = trimmed.match(/^Would create:\s*(.+)$/i);
        if (create) {
            changes.push({ action: 'create', path: create[1].trim() });
            section = undefined;
            continue;
        }

        const update = trimmed.match(/^Would update:\s*(.+)$/i);
        if (update) {
            changes.push({ action: 'update', path: update[1].trim() });
            section = undefined;
            continue;
        }

        const assetDelete = trimmed.match(/^Would delete asset:\s*(.+)$/i);
        if (assetDelete) {
            changes.push({ action: 'asset-delete', path: assetDelete[1].trim() });
            section = undefined;
            continue;
        }

        const assetDownload = trimmed.match(/^Would download asset:\s*(.+)$/i);
        if (assetDownload) {
            changes.push({ action: 'asset-download', path: assetDownload[1].trim() });
            section = undefined;
            continue;
        }

        if (/^Files that would be deleted:\s*$/i.test(trimmed)) {
            section = 'delete';
            continue;
        }
        if (/^Files that would be uploaded:\s*$/i.test(trimmed)) {
            section = 'upload';
            continue;
        }
        if (/^Assets that would be uploaded:\s*$/i.test(trimmed)) {
            section = 'asset-upload';
            continue;
        }

        if (section && !/^(Would |Files that|Assets that|No --confirm|Dry-run)/i.test(trimmed)) {
            const action =
                section === 'delete'
                    ? 'delete'
                    : section === 'upload'
                      ? 'upload'
                      : 'asset-upload';
            changes.push({ action, path: trimmed });
            continue;
        }

        section = undefined;
        notes.push(trimmed);
    }

    return { changes, notes };
}

export function summarizeDryRun(preview: DryRunPreview): string {
    if (preview.changes.length === 0) {
        return 'No file changes';
    }
    const counts = new Map<DryRunAction, number>();
    for (const change of preview.changes) {
        counts.set(change.action, (counts.get(change.action) ?? 0) + 1);
    }
    return DRY_RUN_ACTION_ORDER.filter((action) => counts.has(action))
        .map((action) => `${counts.get(action)} ${actionLabel(action, counts.get(action) ?? 0)}`)
        .join(' · ');
}

/** Group changes by action for a stable create → update → delete preview order. */
export function groupDryRunChanges(
    changes: readonly DryRunChange[],
): Array<{ action: DryRunAction; paths: string[] }> {
    return DRY_RUN_ACTION_ORDER.flatMap((action) => {
        const paths = changes
            .filter((change) => change.action === action)
            .map((change) => change.path);
        return paths.length > 0 ? [{ action, paths }] : [];
    });
}

export function actionLabel(action: DryRunAction, count = 1): string {
    switch (action) {
        case 'create':
            return count === 1 ? 'create' : 'creates';
        case 'update':
            return count === 1 ? 'update' : 'updates';
        case 'delete':
            return count === 1 ? 'delete' : 'deletes';
        case 'upload':
            return count === 1 ? 'upload' : 'uploads';
        case 'asset-upload':
            return count === 1 ? 'asset upload' : 'asset uploads';
        case 'asset-delete':
            return count === 1 ? 'asset delete' : 'asset deletes';
        case 'asset-download':
            return count === 1 ? 'asset download' : 'asset downloads';
    }
}

export function actionIcon(action: DryRunAction): string {
    switch (action) {
        case 'create':
            return '$(diff-added)';
        case 'update':
            return '$(diff-modified)';
        case 'delete':
            return '$(diff-removed)';
        case 'upload':
        case 'asset-upload':
            return '$(cloud-upload)';
        case 'asset-delete':
            return '$(trash)';
        case 'asset-download':
            return '$(cloud-download)';
    }
}

export function actionHeading(action: DryRunAction): string {
    switch (action) {
        case 'create':
            return 'Would create';
        case 'update':
            return 'Would update';
        case 'delete':
            return 'Would delete';
        case 'upload':
            return 'Would upload';
        case 'asset-upload':
            return 'Would upload asset';
        case 'asset-delete':
            return 'Would delete asset';
        case 'asset-download':
            return 'Would download asset';
    }
}
