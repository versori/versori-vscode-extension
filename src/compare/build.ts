import * as fs from 'node:fs';
import * as path from 'node:path';

import { CommandSpec } from '../cli';
import { contextFor } from '../commands/target';
import { ResolvedState } from '../resolver/types';
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

/** CLI invocation for the destructive sidecar checkout. */
export function buildCompareCheckoutSpec(
    state: ResolvedState,
    values: CompareValues,
): CommandSpec {
    return {
        args: buildCompareArgs(values),
        json: false,
        context: contextFor(state),
    };
}

/** CLI invocation used to prove an existing sidecar belongs to this version. */
export function buildCompareFilesSpec(
    state: ResolvedState,
    projectId: string,
    versionId: string,
): CommandSpec {
    return {
        args: [
            'projects',
            'files',
            '--project',
            projectId.trim(),
            '--version',
            versionId.trim(),
        ],
        context: contextFor(state),
    };
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

    assertSafeCompareTarget(project, sidecar);

    return sidecar;
}

/**
 * Refuse any target that can resolve to the working project.
 *
 * The lexical check protects the normal non-existent-target case. Existing
 * paths are also compared canonically, and a symlink target is never reusable:
 * the CLI follows symlinks while writing a confirmed sync.
 */
export function assertSafeCompareTarget(projectDir: string, sidecarDir: string): void {
    const project = path.resolve(projectDir);
    const sidecar = path.resolve(sidecarDir);

    if (sidecar === project) {
        throw new Error('the comparison folder cannot be the project folder');
    }

    const sidecarStat = lstatIfExists(sidecar);
    if (sidecarStat?.isSymbolicLink()) {
        throw new Error('the comparison folder cannot be a symbolic link');
    }
    if (sidecarStat && !sidecarStat.isDirectory()) {
        throw new Error('the comparison path already exists and is not a folder');
    }

    const canonicalProject = realpathIfExists(project) ?? project;
    const canonicalSidecar = sidecarStat ? fs.realpathSync(sidecar) : sidecar;
    if (canonicalSidecar === canonicalProject) {
        throw new Error('the comparison folder cannot resolve to the project folder');
    }
}

function lstatIfExists(target: string): fs.Stats | undefined {
    try {
        return fs.lstatSync(target);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw err;
    }
}

function realpathIfExists(target: string): string | undefined {
    try {
        return fs.realpathSync(target);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw err;
    }
}
