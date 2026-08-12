import { LogEntry, severityRank } from './entries';

export interface LogGroup {
    /** The exact message every member shares. */
    message: string;
    /** Raw severity string of the worst member, for the chip label. */
    severity: string;
    /** Chip class for that severity, or undefined if it is unrecognised. */
    level?: string;
    /** Display timestamp of the newest member. */
    latest: string;
    /**
     * Positions in the full entry list, newest first. Indices rather than
     * entries: the webview already holds the page and renders rows from it, and
     * copying entries here would duplicate the whole payload per group.
     */
    indices: number[];
}

/**
 * Collapse the visible entries into one row per exact message title.
 *
 * Takes the already-filtered index list rather than filtering here, so grouping
 * can never disagree with the Include/Exclude/severity result — there is exactly
 * one implementation of "is this entry visible", in src/logs/filter.ts.
 *
 * Newest-group-first is not computed here — it is inherited. Callers must pass
 * `indices` ascending over a newest-first `entries` page (the shape
 * `toLogEntries` + `visibleIndices` already produce). Under that contract the
 * first sighting of each message is its newest occurrence, so Map insertion
 * order is newest-group-first and member `push` order is newest-first. No sort
 * (a sort could disagree with the row order rendered underneath). An unsorted
 * or oldest-first page silently yields wrong group order, wrong `latest`, and
 * oldest-first `indices` — this module will not correct that.
 */
export function groupByTitle(entries: LogEntry[], indices: number[]): LogGroup[] {
    const groups = new Map<string, LogGroup>();

    for (const index of indices) {
        const entry = entries[index];
        if (!entry) {
            continue;
        }

        const existing = groups.get(entry.message);
        if (!existing) {
            groups.set(entry.message, {
                message: entry.message,
                severity: entry.severity,
                level: entry.level,
                latest: entry.timestamp,
                indices: [index],
            });
            continue;
        }

        existing.indices.push(index);

        // Worst severity present, not the newest — a group that contains one
        // error must read as an error however many infos followed it.
        if (severityRank(entry.severity) < severityRank(existing.severity)) {
            existing.severity = entry.severity;
            existing.level = entry.level;
        }
    }

    return [...groups.values()];
}
