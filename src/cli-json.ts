/**
 * Shapes the CLI's list commands come back in.
 *
 * Most commands print a `{type, items}` envelope, a few print a bare array, and
 * the key has drifted across commands (`projects`, `versions`), so each caller
 * names the keys it accepts rather than this guessing.
 */
export function envelopeItems(raw: unknown, keys: string[]): unknown[] {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (!raw || typeof raw !== 'object') {
        return [];
    }

    const record = raw as Record<string, unknown>;
    for (const key of keys) {
        if (Array.isArray(record[key])) {
            return record[key] as unknown[];
        }
    }
    return [];
}

/** A trimmed string, or `''` for anything that is not one. */
export function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
