import { LogEntry } from './entries';

export interface LogFilter {
    /**
     * Comma- or newline-separated substrings. An entry matching **any** of them
     * is kept; empty keeps everything. Alternatives rather than a conjunction,
     * so two triggers can be watched at once.
     */
    include: string;
    /** Same syntax. An entry matching **any** term is hidden. */
    exclude: string;
    /** Severities to keep. Empty keeps all. Compared case-insensitively. */
    severities: string[];
    caseSensitive: boolean;
}

export const EMPTY_FILTER: LogFilter = {
    include: '',
    exclude: '',
    severities: [],
    caseSensitive: false,
};

/**
 * One filter clause.
 *
 * `text` is the generic path and matches anywhere in the entry, including field
 * names. The others are the scoped forms the row and field action menus
 * generate, which is the whole reason they exist: an exact title or field value
 * cannot be expressed as a substring without also matching it incidentally
 * elsewhere in the record.
 */
export type Expression =
    | { kind: 'text'; value: string }
    | { kind: 'message'; value: string; prefix: boolean }
    | { kind: 'field'; path: string; value: string; prefix: boolean }
    | { kind: 'fieldPrefix'; path: string };

/**
 * One Include/Exclude box, as a list of expression source strings.
 *
 * Newlines always separate — that is what the action menus append. Commas also
 * separate, for backward compatibility with the comma-separated boxes this panel
 * shipped with, but **not inside a quoted value**: menu-generated expressions
 * JSON-quote the value precisely so a message containing a comma survives.
 *
 * Exact duplicates are dropped so clicking the same menu action twice is
 * idempotent, and the first occurrence wins so the user's own ordering stands.
 */
export function splitExpressions(text: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let current = '';
    let quoted = false;

    const flush = () => {
        const token = current.trim();
        current = '';
        if (token && !seen.has(token)) {
            seen.add(token);
            out.push(token);
        }
    };

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (char === '"' && text[index - 1] !== '\\') {
            quoted = !quoted;
            current += char;
            continue;
        }
        if (char === '\n' || (char === ',' && !quoted)) {
            flush();
            continue;
        }
        current += char;
    }
    flush();

    return out;
}

/** `message` / `fields.x` `=` or `^=` value. Paths are the flattened form the panel renders. */
const SCOPED = /^([A-Za-z0-9_.\-[\]]+)(\^?=)([\s\S]*)$/;
/** `fields.error.*` — any field under a path. */
const FIELD_PREFIX = /^([A-Za-z0-9_.\-[\]]+)\.\*$/;

/**
 * Read one expression.
 *
 * Never throws and never returns "matches nothing": anything unrecognised or
 * half-typed becomes a plain substring. A parser that failed closed would blank
 * the whole list on the keystroke *before* the one that completes an expression,
 * which reads as the panel breaking.
 */
export function parseExpression(token: string): Expression {
    const asText: Expression = { kind: 'text', value: token };

    const fieldPrefix = FIELD_PREFIX.exec(token);
    if (fieldPrefix) {
        return { kind: 'fieldPrefix', path: fieldPrefix[1] };
    }

    const scoped = SCOPED.exec(token);
    if (!scoped) {
        return asText;
    }

    const [, path, operator, rest] = scoped;
    const value = unquote(rest);
    if (value === undefined || value === '') {
        return asText;
    }

    const prefix = operator === '^=';
    return path === 'message'
        ? { kind: 'message', value, prefix }
        : { kind: 'field', path, value, prefix };
}

/** `undefined` for an unterminated or non-string quoted value, so the caller can fall back. */
function unquote(text: string): string | undefined {
    const trimmed = text.trim();

    if (!trimmed.startsWith('"')) {
        return trimmed;
    }

    try {
        const parsed = JSON.parse(trimmed) as unknown;
        return typeof parsed === 'string' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function parseFilterText(text: string): Expression[] {
    return splitExpressions(text).map(parseExpression);
}

/**
 * Whether an entry survives the filter.
 *
 * Order is severity, then include, then exclude — exclude last so narrowing to a
 * trigger and still dropping its noisy heartbeat works. Includes are
 * alternatives, which is what lets two exact titles be watched side by side.
 */
export function matchesEntry(entry: LogEntry, filter: LogFilter): boolean {
    if (
        filter.severities.length > 0 &&
        !filter.severities.some((s) => s.toLowerCase() === entry.severity.toLowerCase())
    ) {
        return false;
    }

    const include = parseFilterText(filter.include);
    if (
        include.length > 0 &&
        !include.some((expression) => matchesExpression(entry, expression, filter.caseSensitive))
    ) {
        return false;
    }

    return !parseFilterText(filter.exclude).some((expression) =>
        matchesExpression(entry, expression, filter.caseSensitive),
    );
}

/**
 * One clause against one entry.
 *
 * Field **paths** are always compared exactly — they are the flattened paths the
 * panel itself emitted into the menu, not something the user typed from memory,
 * so folding their case would only create false matches. Match case applies to
 * the textual values on both sides.
 */
function matchesExpression(entry: LogEntry, expression: Expression, caseSensitive: boolean): boolean {
    const fold = (text: string) => (caseSensitive ? text : text.toLowerCase());

    switch (expression.kind) {
        case 'text':
            return fold(entry.searchText).includes(fold(expression.value));

        case 'message':
            return expression.prefix
                ? fold(entry.message).startsWith(fold(expression.value))
                : fold(entry.message) === fold(expression.value);

        case 'field':
            return entry.fields.some(
                (field) =>
                    field.key === expression.path &&
                    (expression.prefix
                        ? fold(field.value).startsWith(fold(expression.value))
                        : fold(field.value) === fold(expression.value)),
            );

        case 'fieldPrefix':
            // `fields.error.*` also matches a terminal field named exactly
            // `fields.error` — an `error` that arrived as a string rather than an
            // object is the same thing the user is asking about.
            return entry.fields.some(
                (field) =>
                    field.key === expression.path ||
                    field.key.startsWith(`${expression.path}.`),
            );
    }
}

/**
 * Positions of the surviving entries.
 *
 * Indices rather than entries: the panel posts these back to the webview, which
 * shows and hides rows it has already rendered. Re-sending the entries on every
 * keystroke would copy the whole page across the message boundary.
 */
export function visibleIndices(entries: LogEntry[], filter: LogFilter): number[] {
    const out: number[] = [];

    entries.forEach((entry, index) => {
        if (matchesEntry(entry, filter)) {
            out.push(index);
        }
    });

    return out;
}

/**
 * Serialisers for the row and field action menus.
 *
 * Values are JSON-quoted unconditionally rather than only when they need it:
 * uniform output means `splitExpressions` and `unquote` have exactly one shape
 * to handle, and a message that gains a comma later cannot change how an
 * expression already in the box is read.
 */
export function messageExpression(message: string, prefix = false): string {
    return `message${prefix ? '^' : ''}=${JSON.stringify(message)}`;
}

export function fieldExpression(path: string, value: string, prefix = false): string {
    return `${path}${prefix ? '^' : ''}=${JSON.stringify(value)}`;
}

export function fieldPrefixExpression(path: string): string {
    return `${path}.*`;
}

/**
 * Add an expression to a filter box.
 *
 * Appends on its own line and leaves everything already typed untouched — the
 * boxes stay editable, and an action is an addition to the user's filter rather
 * than a replacement of it. A duplicate is ignored, compared after splitting so
 * an expression the user typed with a trailing comma still counts as present.
 */
export function appendExpression(text: string, expression: string): string {
    if (splitExpressions(text).includes(expression)) {
        return text;
    }

    const existing = text.replace(/\s+$/, '');
    return existing ? `${existing}\n${expression}` : expression;
}
