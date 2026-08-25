import { ComparePair } from './pairs';

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
