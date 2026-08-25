import { ComparePair } from './pairs';

/**
 * Which side of each pair is the diff original (left) vs modified (right).
 *
 * `version-to-working` is the default: the saved version is the baseline, so a
 * working-only file reads as an addition. `working-to-version` is the old
 * left-equals-working layout.
 */
export type CompareDirection = 'version-to-working' | 'working-to-version';

/** Reads a pair's side, or undefined when that side has no file. */
export type SideReader = (relativePath: string, side: 'working' | 'version') => Buffer | undefined;

/**
 * The pairs worth showing.
 *
 * A diff view shows changes, so a file identical on both sides is dropped: an
 * earlier version listed every path, and 57 of 63 rows opened as diffs with
 * nothing highlighted, burying the four that mattered. A one-sided file is
 * always a change — it is the add or delete the user came to see.
 */
export function changedPairs(pairs: ComparePair[], read: SideReader): ComparePair[] {
    return pairs.filter((pair) => {
        if (!pair.workingExists || !pair.sidecarExists) {
            return true;
        }

        const working = read(pair.relativePath, 'working');
        const version = read(pair.relativePath, 'version');
        if (working === undefined || version === undefined) {
            return true;
        }

        return !working.equals(version);
    });
}
