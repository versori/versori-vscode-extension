import { flattenDeep, LogField } from '../logs/entries';
import { formatCell, levelClass, Row, unwrapRows } from '../results/rows';

export interface IssueRow {
    id: string;
    /** Headline. Falls back to the message, then to a placeholder. */
    title: string;
    message: string;
    severity: string;
    /** Chip class from levelClass(). Issue severities share the log level colours. */
    severityLevel?: string;
    status: string;
    /** Formatted lastSeenAt. */
    lastSeen: string;
    seenCount: string;
    /** Everything not in the headline, flattened for the expanded view. */
    fields: LogField[];
}

/** Keys shown in the headline, so they are not repeated in the field list. */
const HEADLINE_KEYS = new Set([
    'id',
    'title',
    'message',
    'severity',
    'status',
    'lastSeenAt',
    'seenCount',
]);

export function toIssueRows(raw: unknown): IssueRow[] {
    return unwrapRows(raw)
        .map(toRow)
        .filter((row): row is IssueRow => row !== undefined);
}

function toRow(row: Row): IssueRow | undefined {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) {
        // Every action needs the id; a row without one is not actionable.
        return undefined;
    }

    const message = typeof row.message === 'string' ? row.message : '';
    const title = (typeof row.title === 'string' && row.title) || message || '(untitled issue)';
    const severity = typeof row.severity === 'string' ? row.severity : '';

    return {
        id,
        title,
        message,
        severity,
        severityLevel: levelClass(severity),
        status: typeof row.status === 'string' ? row.status : '',
        lastSeen: row.lastSeenAt ? formatCell(row.lastSeenAt) : '',
        seenCount: row.seenCount === undefined ? '' : formatCell(row.seenCount),
        fields: flattenDeep(
            Object.fromEntries(Object.entries(row).filter(([key]) => !HEADLINE_KEYS.has(key))),
        ),
    };
}
