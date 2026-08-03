/**
 * Keys whose values must never be rendered.
 *
 * `versori context list -o json` returns full JWTs; other commands may embed
 * credentials. Redaction is by key name because the values themselves are not
 * reliably recognisable.
 */
const SECRET_KEY = /jwt|token|secret|password|passwd|apikey|api_key|credential|authorization/i;

export function isSecretKey(key: string): boolean {
    return SECRET_KEY.test(key);
}

export type Row = Record<string, unknown>;

/**
 * Pull the row array out of a CLI response.
 *
 * List commands wrap results as `{"type":"Context","items":[...]}`. Bare arrays
 * and single objects are also accepted so an unfamiliar shape still renders.
 */
export function unwrapRows(raw: unknown): Row[] {
    if (Array.isArray(raw)) {
        return raw.filter(isRow);
    }

    if (raw && typeof raw === 'object') {
        const record = raw as Record<string, unknown>;

        for (const key of ['items', 'results', 'data', 'logs', 'versions', 'issues']) {
            if (Array.isArray(record[key])) {
                return (record[key] as unknown[]).filter(isRow);
            }
        }

        return [record];
    }

    return [];
}

function isRow(value: unknown): value is Row {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Expand one level of nested objects into `parent.child` keys.
 *
 * Log entries nest their most useful identifiers under `fields`
 * (`executionId`, `name`, `triggerName`, ...). Left alone, that whole object
 * collapses into a single unreadable JSON cell. Only one level is expanded —
 * deeper structures still render as JSON, which keeps the column count sane.
 */
export function flattenRow(row: Row): Row {
    const out: Row = {};

    for (const [key, value] of Object.entries(row)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [childKey, childValue] of Object.entries(value as Row)) {
                out[`${key}.${childKey}`] = childValue;
            }
        } else {
            out[key] = value;
        }
    }

    return out;
}

/**
 * Column order: preferred keys first (when present), then everything else in
 * first-seen order. Secret-named keys are dropped entirely.
 *
 * Columns are derived from the data rather than hardcoded so commands whose
 * shape is not known in advance still render usefully.
 */
export function deriveColumns(rows: Row[], preferred: string[] = []): string[] {
    const seen: string[] = [];

    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!seen.includes(key) && !isSecretKey(key)) {
                seen.push(key);
            }
        }
    }

    const lead = preferred.filter((key) =>
        seen.some((candidate) => candidate.toLowerCase() === key.toLowerCase()),
    );

    const leadActual = lead.map(
        (key) => seen.find((candidate) => candidate.toLowerCase() === key.toLowerCase()) as string,
    );

    // Log entries are heterogeneous — each workflow puts different keys under
    // `fields`, so the union across a page can run to dozens of mostly-blank
    // columns. Ordering the remainder by how often it is actually populated
    // puts the useful ones first, so capping the display keeps the signal.
    const rest = seen
        .filter((key) => !leadActual.includes(key))
        .map((key) => ({ key, filled: countFilled(rows, key) }))
        .sort((a, b) => b.filled - a.filled)
        .map((entry) => entry.key);

    return [...leadActual, ...rest];
}

function countFilled(rows: Row[], key: string): number {
    return rows.reduce((total, row) => {
        const value = row[key];
        return value === null || value === undefined || value === '' ? total : total + 1;
    }, 0);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Render one cell as display text. Never returns undefined. */
export function formatCell(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '';
    }

    if (typeof value === 'string') {
        return ISO_DATE.test(value) ? formatTimestamp(value) : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    return JSON.stringify(value);
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}

/**
 * Severity/level class for colour coding, or undefined when the value is not a
 * recognised level. Used for both log levels and issue severities.
 */
export function levelClass(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    switch (value.trim().toLowerCase()) {
        case 'critical':
        case 'fatal':
        case 'error':
            return 'error';
        case 'high':
        case 'warn':
        case 'warning':
            return 'warn';
        case 'info':
        case 'medium':
            return 'info';
        case 'debug':
        case 'trace':
        case 'low':
            return 'muted';
        default:
            return undefined;
    }
}

/** Strip secret-named keys recursively, for the raw-JSON view. */
export function redact(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redact);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, inner]) =>
                isSecretKey(key) ? [key, '[redacted]'] : [key, redact(inner)],
            ),
        );
    }

    return value;
}
