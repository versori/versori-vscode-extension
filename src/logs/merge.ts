import { assignIds, LogEntry } from './entries';

export interface MergeResult {
    /** The retained page, newest first, trimmed to the limit. */
    entries: LogEntry[];
    /** How many occurrences this poll actually added. Drives the pending-new count. */
    added: number;
}

/**
 * Fold one poll's response into the retained page.
 *
 * Comparison is **occurrence-aware**, not set-based: two byte-equivalent log
 * lines are two events, and a workflow that logs the same message twice in a
 * second must not have one of them silently dropped. So for each digest the
 * merge asks how many the response has versus how many are already held, and
 * only the surplus is new.
 *
 * New occurrences are prepended rather than merged by timestamp. The poll window
 * is a moving interval ending at "now", so its entries are newer than everything
 * held; re-sorting the whole page would buy nothing and would let a single
 * clock-skewed record reorder rows under the user's cursor.
 */
export function mergeEntries(
    previous: LogEntry[],
    incoming: LogEntry[],
    limit: number,
): MergeResult {
    if (incoming.length === 0) {
        return { entries: previous, added: 0 };
    }

    const held = new Map<string, number>();
    for (const entry of previous) {
        held.set(entry.digest, (held.get(entry.digest) ?? 0) + 1);
    }

    const budget = new Map<string, number>();
    for (const entry of incoming) {
        budget.set(entry.digest, (budget.get(entry.digest) ?? 0) + 1);
    }

    // Walk newest-first (incoming is already newest-first) so surplus picks are
    // the newest occurrences — those belong at the top of the page; oldest-first
    // would keep the stale end of the surplus and bury fresher lines below it.
    const fresh: LogEntry[] = [];
    for (const entry of incoming) {
        const surplus = (budget.get(entry.digest) ?? 0) - (held.get(entry.digest) ?? 0);
        if (surplus > 0) {
            fresh.push(entry);
            budget.set(entry.digest, (budget.get(entry.digest) ?? 0) - 1);
        }
    }

    const merged = [...fresh, ...previous];

    return {
        entries: assignIds(limit > 0 ? merged.slice(0, limit) : merged),
        added: fresh.length,
    };
}
