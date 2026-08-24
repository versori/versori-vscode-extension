export interface ComparePair {
    /** `/`-separated path, relative to each side's root. */
    relativePath: string;
    workingExists: boolean;
    sidecarExists: boolean;
}

/**
 * Order paths by code point, not by locale.
 *
 * `localeCompare` collates by the host's locale, so the same file list can come
 * back in a different order on a different machine — and these lists are both
 * asserted on in tests and rendered as a diff list. Code-point order is stable
 * everywhere and is what `LC_ALL=C sort` and `git ls-files` produce.
 */
export function byCodePoint(a: string, b: string): number {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

/**
 * Union both file lists into one ordered pair list.
 *
 * A path present on only one side is kept, not dropped: that is exactly the
 * added-or-deleted file the user opened Compare to see. Both lists must have
 * been produced with the *same* matcher, or a file ignored on one side only
 * would read as a spurious add or delete.
 */
export function comparePairs(workingFiles: string[], sidecarFiles: string[]): ComparePair[] {
    const working = new Set(workingFiles);
    const sidecar = new Set(sidecarFiles);

    return [...new Set([...workingFiles, ...sidecarFiles])]
        .sort(byCodePoint)
        .map((relativePath) => ({
            relativePath,
            workingExists: working.has(relativePath),
            sidecarExists: sidecar.has(relativePath),
        }));
}
