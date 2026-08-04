import { formatCell, isSecretKey, levelClass, Row, unwrapRows } from '../results/rows';

export interface LogField {
    key: string;
    value: string;
}

export interface LogEntry {
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
    /** Headline + severity + every field value, original case, for substring matching. */
    searchText: string;
}

/**
 * How far into a nested value to descend before stringifying.
 *
 * Log records are workflow-authored, so nesting is unbounded in principle. Four
 * levels covers `fields.error.cause.code` and stops a pathological record from
 * producing hundreds of keys.
 */
export const MAX_FIELD_DEPTH = 4;

/** Keys promoted to the headline, so they are not repeated in the field list. */
const HEADLINE_KEYS = new Set(['timestamp', 'time', 'severity', 'level', 'message', 'msg']);

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
        return prefix ? [{ key: prefix, value: formatCell(value) }] : [];
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
 * Verified against real output: each NDJSON line is
 * { fields:{activationId,executionId,externalUserId,level,name,triggerName},
 *   message, severity, timestamp, error }
 */
export function toLogEntries(raw: unknown): LogEntry[] {
    return unwrapRows(raw).map(toEntry);
}

function toEntry(row: Row): LogEntry {
    const nested = (row.fields ?? {}) as Row;

    const rawTimestamp = firstString(row.timestamp, row.time);
    const severity = firstString(row.severity, row.level, nested.level, nested.severity);
    const message = firstString(row.message, row.msg, row.error) || '(no message)';

    const fields = flattenDeep(
        Object.fromEntries(Object.entries(row).filter(([key]) => !HEADLINE_KEYS.has(key))),
    );

    return {
        timestamp: rawTimestamp ? formatCell(rawTimestamp) : '',
        rawTimestamp,
        severity,
        level: levelClass(severity),
        message,
        fields,
        searchText: [message, severity, ...fields.map((f) => f.value)].join(' '),
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

/**
 * Every field key present, most-populated first.
 *
 * Derived from the data rather than hardcoded: each workflow puts different keys
 * under `fields`, so which ones are worth showing differs per project.
 */
export function fieldKeys(entries: LogEntry[]): string[] {
    const counts = new Map<string, number>();

    for (const entry of entries) {
        for (const field of entry.fields) {
            counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
        }
    }

    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(
        ([key]) => key,
    );
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

    return seen.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function rank(severity: string): number {
    const cls = levelClass(severity);
    return cls ? SEVERITY_RANK[cls] : 4;
}
