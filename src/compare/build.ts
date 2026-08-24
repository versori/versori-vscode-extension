import * as path from 'node:path';

import { safeSyncSubfolderName } from '../sync/build';
import { VersionEntry } from '../versions/list';

export interface CompareValues {
    projectId: string;
    directory: string;
    versionId: string;
}

/**
 * Build the argv for the sidecar checkout Compare Version diffs against.
 *
 * Every flag is mandatory here, unlike the Sync form: `--confirm` because there
 * is no second confirmation after the version pick, and `--no-pin` because a
 * throwaway comparison folder must not claim itself as a Versori project.
 */
export function buildCompareArgs(values: CompareValues): string[] {
    const projectId = values.projectId.trim();
    const directory = values.directory.trim();
    const versionId = values.versionId.trim();

    if (!projectId || !directory || !versionId) {
        throw new Error('a project, target directory, and version are required');
    }

    return [
        'projects',
        'sync',
        '--project',
        projectId,
        '--directory',
        directory,
        '--version',
        versionId,
        '--confirm',
        '--no-pin',
    ];
}

/**
 * Sanitised folder names that more than one version would claim.
 *
 * Version names are free text and are sanitised the same way sync's subfolder
 * name is, so two differently-named versions can collapse onto one path. Only
 * those get an id suffix, so the common case keeps a readable folder name.
 */
export function collidingSidecarNames(versions: VersionEntry[]): Set<string> {
    const counts = new Map<string, number>();

    for (const version of versions) {
        const name = safeSyncSubfolderName(version.name);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return new Set(
        [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
    );
}

export function compareSidecarName(
    versionName: string,
    versionId: string,
    collides: boolean,
): string {
    const sanitized = safeSyncSubfolderName(versionName);
    return collides ? `${sanitized}-${versionId.slice(0, 8)}` : sanitized;
}

/**
 * The sibling folder a version is checked out into.
 *
 * A sibling rather than a child, so a re-sync of the working project never
 * sees the comparison folder as a local-only file to delete.
 */
export function compareSidecarDirectory(
    projectDir: string,
    versionName: string,
    versionId: string,
    collides: boolean,
): string {
    const project = path.resolve(projectDir);
    const suffix = compareSidecarName(versionName, versionId, collides);
    const sidecar = path.join(path.dirname(project), `${path.basename(project)}-${suffix}`);

    if (path.resolve(sidecar) === project) {
        // Unreachable while the suffix is non-empty, but this is the one thing a
        // --confirm sync into the wrong path would destroy, so it is checked
        // rather than reasoned about.
        throw new Error('the comparison folder cannot be the project folder');
    }

    return sidecar;
}
