import * as fs from 'node:fs';

import { CompareDirection } from './changes';
import { ComparePair } from './pairs';

/** workspaceState key — workspace-scoped, so sessions do not leak between projects. */
export const COMPARE_SESSION_KEY = 'versori.lastCompare';

/**
 * Last successful Compare. Plain data only: workspaceState JSON-serialises this,
 * so a Uri or Buffer here would come back unusable after the host restarts.
 */
export interface LastCompare {
    projectDir: string;
    sidecar: string;
    versionName: string;
    versionTimestamp: string;
    pairs: ComparePair[];
    direction: CompareDirection;
}

/** The slice of workspaceState the compare session needs. */
export interface CompareSessionStore {
    get(): LastCompare | undefined;
    save(session: LastCompare): void | PromiseLike<void>;
}

/** Enough of a Memento to persist the session without importing vscode. */
export interface CompareSessionMemento {
    get(key: string): unknown;
    update(key: string, value: LastCompare): void | PromiseLike<void>;
}

const DIRECTIONS = new Set<CompareDirection>(['version-to-working', 'working-to-version']);

/**
 * Rehydrate a stored session, or treat it as absent.
 *
 * The stored copy can be stale (sidecar deleted, project moved) or a leftover
 * from an older shape, so a missing path or a malformed value is absent —
 * never a throw.
 */
export function createCompareSessionStore(
    memento: CompareSessionMemento,
    exists: (filePath: string) => boolean = (filePath) => fs.existsSync(filePath),
): CompareSessionStore {
    return {
        get(): LastCompare | undefined {
            const session = parseStoredCompareSession(memento.get(COMPARE_SESSION_KEY));
            if (!session || !compareSessionStillOnDisk(session, exists)) {
                return undefined;
            }
            return session;
        },
        save(session: LastCompare): void | PromiseLike<void> {
            return memento.update(COMPARE_SESSION_KEY, session);
        },
    };
}

/** True when both roots the diffs would open still exist. */
export function compareSessionStillOnDisk(
    session: LastCompare,
    exists: (filePath: string) => boolean = (filePath) => fs.existsSync(filePath),
): boolean {
    return exists(session.projectDir) && exists(session.sidecar);
}

/**
 * Accept a stored value only when every field is the current plain shape.
 *
 * Callers must not let a bad payload throw: workspaceState can hold anything.
 */
export function parseStoredCompareSession(value: unknown): LastCompare | undefined {
    try {
        if (!isRecord(value)) {
            return undefined;
        }

        const projectDir = asNonEmptyString(value.projectDir);
        const sidecar = asNonEmptyString(value.sidecar);
        const versionName = asNonEmptyString(value.versionName);
        const versionTimestamp = asString(value.versionTimestamp);
        const direction = asDirection(value.direction);
        const pairs = asPairs(value.pairs);
        if (!projectDir || !sidecar || !versionName || versionTimestamp === undefined || !direction || !pairs) {
            return undefined;
        }

        return { projectDir, sidecar, versionName, versionTimestamp, pairs, direction };
    } catch {
        return undefined;
    }
}

function asPairs(value: unknown): ComparePair[] | undefined {
    if (!Array.isArray(value) || value.length === 0) {
        return undefined;
    }

    const pairs: ComparePair[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            return undefined;
        }
        const relativePath = asNonEmptyString(item.relativePath);
        if (!relativePath || typeof item.workingExists !== 'boolean' || typeof item.sidecarExists !== 'boolean') {
            return undefined;
        }
        pairs.push({
            relativePath,
            workingExists: item.workingExists,
            sidecarExists: item.sidecarExists,
        });
    }
    return pairs;
}

function asDirection(value: unknown): CompareDirection | undefined {
    return typeof value === 'string' && DIRECTIONS.has(value as CompareDirection)
        ? (value as CompareDirection)
        : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
