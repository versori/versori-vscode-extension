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
