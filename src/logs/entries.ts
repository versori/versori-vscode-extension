import { formatCell, isSecretKey, levelClass, redact, Row, unwrapRows } from '../results/rows';

export interface LogField {
    key: string;
    value: string;
}

export interface LogEntry {
    /**
     * Stable identity for the webview: it records which rows are expanded by id
     * and restores them after a re-render, so this must survive a live merge.
     */
    id: string;
    /** Display timestamp, local time. */
    timestamp: string;
    /** Exactly as the CLI emitted it. */
    rawTimestamp: string;
    severity: string;
    /** Chip class from levelClass(), or undefined for an unrecognised severity. */
    level?: string;
    /** The headline. Never blank. */
    message: string;
    fields: LogField[];
    /**
     * Headline + severity + both timestamp forms + every field **name and
     * value**, original case, for substring matching.
     */
    searchText: string;
    /**
     * Opaque canonical form of the untouched source record, for occurrence-aware
     * deduplication in src/logs/merge.ts. Never displayed.
     */
    digest: string;
    /** Redacted copy of the source record, for Copy JSON. */
    raw: Row;
}

/**
 * How far into a nested value to descend before stringifying.
 *
 * Log records are workflow-authored, so nesting is unbounded in principle. Four
 * levels covers `fields.error.cause.code` and stops a pathological record from
 * producing hundreds of keys.
 */
export const MAX_FIELD_DEPTH = 4;

/**
 * Keys shown in a dedicated UI slot regardless of content, so they are always
 * excluded from the field list.
 */
const HEADLINE_KEYS = new Set(['timestamp', 'time', 'severity', 'level']);

/**
 * Headline candidates, in priority order. Unlike HEADLINE_KEYS, these are only
 * excluded from the field list when they are the one that actually won the
 * headline — otherwise a row with both `message` and `error` would silently
 * drop the unused one instead of just showing it twice.
 */
const MESSAGE_KEYS = ['message', 'msg', 'error'];

/**
 * Flatten a value into dotted `parent.child` fields.
 *
 * Arrays are stringified rather than indexed: an array of ten items would
 * otherwise become ten fields, which buries the useful ones. Empty values are
 * dropped — a field with nothing in it is noise in a list this dense.
 */
export function flattenDeep(value: unknown, prefix = '', depth = 0): LogField[] {
    if (value === null || value === undefined || value === '') {
        return [];
    }

    const nested =
        typeof value === 'object' && !Array.isArray(value) && depth < MAX_FIELD_DEPTH;

    if (!nested) {
        // A terminal value can still be, or contain, a secret — an array of
        // objects (never descended into) or an object at the depth cutoff both
        // land here whole. redact() recurses through both before it is stringified.
        return prefix ? [{ key: prefix, value: formatCell(redact(value)) }] : [];
    }

    const out: LogField[] = [];
    for (const [key, child] of Object.entries(value as Row)) {
        if (isSecretKey(key)) {
            continue;
        }
        out.push(...flattenDeep(child, prefix ? `${prefix}.${key}` : key, depth + 1));
    }

    return out;
}

/**
 * Turn a `projects logs` response into entries.
 *
 * Accepts the NDJSON array `runJson` produces, and `undefined` — which is the
 * CLI's success-with-no-rows signal (it exits 0 and prints zero bytes).
 *
 * The CLI emits ascending time order (oldest first). This viewer reverses that
 * so the panel opens on the newest line — what a human scanning for a failure
 * wants. Agents still get ascending NDJSON from the CLI itself.
 *
 * Verified against real output: each NDJSON line is
 * { fields:{activationId,executionId,externalUserId,level,name,triggerName},
 *   message, severity, timestamp, error }
 */
export function toLogEntries(raw: unknown): LogEntry[] {
    return assignIds(
        unwrapRows(raw)
            .map(toEntry)
            .sort((a, b) => compareTimestampsDesc(a.rawTimestamp, b.rawTimestamp)),
    );
}

/** Newest first. Missing / unparseable timestamps sink to the bottom. */
function compareTimestampsDesc(a: string, b: string): number {
    const aMs = Date.parse(a);
    const bMs = Date.parse(b);
    const aOk = Number.isFinite(aMs);
    const bOk = Number.isFinite(bMs);

    if (aOk && bOk) {
        return bMs - aMs;
    }
    if (aOk) {
        return -1;
    }
    if (bOk) {
        return 1;
    }
    return 0;
}

function toEntry(row: Row): LogEntry {
    const nested = (row.fields ?? {}) as Row;

    const rawTimestamp = firstString(row.timestamp, row.time);
    const severity = firstString(row.severity, row.level, nested.level, nested.severity);
    const headline = firstKeyedString(row, MESSAGE_KEYS);
    const message = headline.value || '(no message)';

    const excluded = new Set(HEADLINE_KEYS);
    if (headline.key) {
        excluded.add(headline.key);
    }

    const fields = flattenDeep(
        Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key))),
    );

    const timestamp = rawTimestamp ? formatCell(rawTimestamp) : '';

    return {
        // Replaced by assignIds() once the whole page is ordered — an ordinal
        // cannot be known from one row in isolation.
        id: '',
        timestamp,
        rawTimestamp,
        severity,
        level: levelClass(severity),
        message,
        fields,
        searchText: [
            message,
            severity,
            rawTimestamp,
            timestamp,
            // Names as well as values: "executionId" should find every entry that
            // carries one, without the user knowing any particular value.
            ...fields.map((field) => `${field.key} ${field.value}`),
        ].join(' '),
        digest: sourceDigest(row),
        raw: redact(row) as Row,
    };
}

function firstString(...candidates: unknown[]): string {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate) {
            return candidate;
        }
        if (typeof candidate === 'number' || typeof candidate === 'boolean') {
            return String(candidate);
        }
    }
    return '';
}

/** Like firstString, but also reports which key won, so callers can exclude
 * just that one from the field list instead of every candidate. */
function firstKeyedString(row: Row, keys: string[]): { key?: string; value: string } {
    for (const key of keys) {
        const value = firstString(row[key]);
        if (value) {
            return { key, value };
        }
    }
    return { value: '' };
}

/** Rank for severity ordering. Unrecognised severities sort after known ones. */
const SEVERITY_RANK: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    muted: 3,
};

/** Distinct severities, worst first, so the noisy levels sort last. */
export function severitiesOf(entries: LogEntry[]): string[] {
    const seen: string[] = [];

    for (const entry of entries) {
        if (entry.severity && !seen.includes(entry.severity)) {
            seen.push(entry.severity);
        }
    }

    return seen.sort((a, b) => severityRank(a) - severityRank(b) || a.localeCompare(b));
}

/** Rank for severity ordering. Unrecognised severities sort after known ones. */
export function severityRank(severity: string): number {
    const cls = levelClass(severity);
    return cls ? SEVERITY_RANK[cls] : 4;
}

/**
 * Canonical form of a source record, used only for comparing occurrences.
 *
 * The whole row is included rather than just timestamp/severity/message/fields:
 * a digest narrower than the record can call two different entries identical,
 * and the cost of being wrong in that direction is a real log line silently
 * dropped by the live merge. Key order is normalised because JSON key order is
 * not guaranteed across responses.
 *
 * Computed **before** redaction — two records differing only in a credential
 * value are different records, and after redaction they would not be.
 */
export function sourceDigest(row: Row): string {
    return JSON.stringify(canonical(row));
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (value && typeof value === 'object') {
        const row = value as Row;
        return Object.fromEntries(
            Object.keys(row)
                .sort()
                .map((key) => [key, canonical(row[key])]),
        );
    }
    return value;
}

/**
 * Assign presentation ids.
 *
 * Ordinals are counted from the **oldest** end even though the list is
 * newest-first. A live poll prepends, so counting from the newest end would
 * renumber every existing occurrence of a repeated message each time another one
 * arrived — and the webview restores expanded rows by id, so those rows would
 * collapse (or the wrong ones would reopen) on every tick.
 *
 * The id is a short hash of the digest rather than the digest itself: the digest
 * contains the whole record, and ids travel to the webview on every payload and
 * sit in `data-id` attributes. A hash collision can only restore the wrong row's
 * expanded state, which is why comparison in merge.ts uses the digest instead.
 */
export function assignIds(entries: LogEntry[]): LogEntry[] {
    const seen = new Map<string, number>();

    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        const ordinal = seen.get(entry.digest) ?? 0;
        seen.set(entry.digest, ordinal + 1);
        entry.id = `${shortHash(entry.digest)}#${ordinal}`;
    }

    return entries;
}

/** FNV-1a, 32-bit. Short, deterministic, and no crypto import in a pure module. */
function shortHash(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
