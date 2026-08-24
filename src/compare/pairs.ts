export interface ComparePair {
    /** `/`-separated path, relative to each side's root. */
    relativePath: string;
    workingExists: boolean;
    sidecarExists: boolean;
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
        .sort((a, b) => a.localeCompare(b))
        .map((relativePath) => ({
            relativePath,
            workingExists: working.has(relativePath),
            sidecarExists: sidecar.has(relativePath),
        }));
}
