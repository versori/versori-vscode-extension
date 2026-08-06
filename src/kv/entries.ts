import { formatCell, Row, unwrapRows } from '../results/rows';

export interface KvEntry {
    /** Display key. Prefix-stripped by the CLI in friendly mode. Never blank. */
    key: string;
    /** The stored value, stringified faithfully. Only ever shown expanded. */
    value: string;
    /** Local-time createdAt for the collapsed row. */
    createdAt: string;
    /** Exactly as the CLI emitted it, for the expanded detail. */
    rawCreatedAt: string;
    /** Local-time expiresAt — the TTL. Empty when the entry never expires. */
    expiresAt: string;
    versionstamp: string;
    /** Key + value, original case, for substring matching in the panel. */
    searchText: string;
}

export interface KvPage {
    entries: KvEntry[];
    /**
     * Cursors exactly as the response carried them. Empty means there is no page
     * in that direction — the CLI documents an empty `nextCursor` as the end.
     *
     * These are opaque: nothing derives one from a key, and nothing rewrites one.
     */
    nextCursor: string;
    prevCursor: string;
}

/**
 * Turn a `kv list -o json` response into one page.
 *
 * The envelope is `{ data: [...], pagination: { nextCursor, prevCursor } }`.
 * `unwrapRows` finds `data`, but discards `pagination`, so the cursors are read
 * from the raw response separately — losing them would strand the user on the
 * first page with no way to reach the rest of the store.
 */
export function toKvPage(raw: unknown): KvPage {
    return { entries: unwrapRows(raw).map(toEntry), ...cursorsOf(raw) };
}

function cursorsOf(raw: unknown): { nextCursor: string; prevCursor: string } {
    const pagination =
        raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>).pagination
            : undefined;

    if (!pagination || typeof pagination !== 'object') {
        return { nextCursor: '', prevCursor: '' };
    }

    const block = pagination as Record<string, unknown>;

    return { nextCursor: cursor(block.nextCursor), prevCursor: cursor(block.prevCursor) };
}

/** Only a string is a usable cursor; anything else is treated as absent. */
function cursor(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function toEntry(row: Row): KvEntry {
    const key = (typeof row.key === 'string' && row.key) || '(no key)';

    // Not redacted, and not matched against isSecretKey: a KV entry's only key
    // name is "key", so the heuristic would fire on `auth/apiKey` while happily
    // showing `config/stripe_live`. The expand affordance is the protection —
    // the value is off-screen until the user deliberately opens the row.
    const value = formatKvValue(row.value);

    const rawCreatedAt = typeof row.createdAt === 'string' ? row.createdAt : '';
    const rawExpiresAt = typeof row.expiresAt === 'string' ? row.expiresAt : '';

    return {
        key,
        value,
        createdAt: rawCreatedAt ? formatCell(rawCreatedAt) : '',
        rawCreatedAt,
        expiresAt: rawExpiresAt ? formatCell(rawExpiresAt) : '',
        versionstamp: typeof row.versionstamp === 'string' ? row.versionstamp : '',
        searchText: `${key} ${value}`,
    };
}

/**
 * The total from `kv count`, or undefined when the response held no readable
 * number.
 *
 * `kv count` prints a bare struct — `utils.Print` marshals `printableCount`
 * directly rather than through the slice path — so the payload is
 * `{"count":N}`. `unwrapRows` normalises both that and the `items`-wrapped
 * shape the printer uses for slices, so one read covers either.
 *
 * Undefined rather than 0 on a bad shape: reporting "0 entries" for a response
 * that was never understood would be a confident lie about the store.
 */
export function parseKvCount(raw: unknown): number | undefined {
    const total = unwrapRows(raw)[0]?.count;

    return typeof total === 'number' && Number.isFinite(total) ? total : undefined;
}

/**
 * Stringify a stored value faithfully.
 *
 * Deliberately not `formatCell`: that rewrites anything ISO-8601-shaped into
 * local time, and a KV value is opaque workflow state — a stored cursor of
 * `2026-08-01T00:00:00Z` must read back as itself. Objects are indented because
 * they only ever appear in the expanded detail block, which has the room.
 */
export function formatKvValue(value: unknown): string {
    if (value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2) ?? '';
}
