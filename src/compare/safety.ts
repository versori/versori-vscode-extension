import { byCodePoint } from './sort';
import { TreeEntry } from './tree';

/** Entries that cannot have come from a clean checkout of the selected version. */
export function foreignSidecarPaths(inventory: TreeEntry[], versionFiles: string[]): string[] {
    const expectedFiles = new Set(versionFiles.map(normalizeRelativePath));
    const expectedDirectories = new Set<string>();

    for (const file of expectedFiles) {
        let separator = file.lastIndexOf('/');
        while (separator > 0) {
            expectedDirectories.add(file.slice(0, separator));
            separator = file.lastIndexOf('/', separator - 1);
        }
    }

    return inventory
        .filter((entry) => {
            const entryPath = normalizeRelativePath(entry.path);
            if (entry.kind === 'file') {
                return !expectedFiles.has(entryPath);
            }
            if (entry.kind === 'directory') {
                return !expectedDirectories.has(entryPath);
            }
            return true;
        })
        .map((entry) => normalizeRelativePath(entry.path))
        .sort(byCodePoint);
}

/** File paths from the `projects files -o json` list envelope. */
export function versionFilePaths(raw: unknown): string[] {
    const items =
        Array.isArray(raw)
            ? raw
            : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
              ? ((raw as Record<string, unknown>).items as unknown[])
              : undefined;
    if (!items) {
        throw new Error('invalid projects files response');
    }

    return items.map((item, index) => {
        if (!item || typeof item !== 'object') {
            throw new Error(`invalid projects files item at index ${index}`);
        }
        const filename = (item as Record<string, unknown>).filename;
        if (typeof filename !== 'string' || filename === '') {
            throw new Error(`invalid projects files filename at index ${index}`);
        }
        return filename;
    });
}

function normalizeRelativePath(file: string): string {
    return file.replace(/\\/g, '/');
}
