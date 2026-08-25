import { envelopeItems } from '../cli-json';
import { byCodePoint } from './sort';

/** Paths present locally but absent from the selected version. */
export function foreignSidecarPaths(existingFiles: string[], versionFiles: string[]): string[] {
    const versionPaths = new Set(versionFiles.map(normalizeRelativePath));

    return existingFiles
        .map(normalizeRelativePath)
        .filter((file) => !versionPaths.has(file))
        .sort(byCodePoint);
}

/** File paths from the `projects files -o json` list envelope. */
export function versionFilePaths(raw: unknown): string[] {
    return envelopeItems(raw, ['items'])
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return '';
            }
            const filename = (item as Record<string, unknown>).filename;
            return typeof filename === 'string' ? filename : '';
        })
        .filter((filename) => filename !== '');
}

function normalizeRelativePath(file: string): string {
    return file.replace(/\\/g, '/');
}
