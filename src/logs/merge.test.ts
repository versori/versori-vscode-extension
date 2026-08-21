import { describe, expect, it } from 'vitest';

import { toLogEntries } from './entries';
import { mergeEntries } from './merge';

/** One CLI response. `toLogEntries` sorts newest-first and assigns ids. */
function page(...messages: Array<[string, string]>) {
    return toLogEntries(
        messages.map(([timestamp, message]) => ({ timestamp, severity: 'INFO', message })),
    );
}

const previous = page(
    ['2026-04-08T10:00:02Z', 'b'],
    ['2026-04-08T10:00:01Z', 'a'],
);

describe('mergeEntries', () => {
    it('prepends only the entries the retained page does not already have', () => {
        const incoming = page(['2026-04-08T10:00:03Z', 'c'], ['2026-04-08T10:00:02Z', 'b']);
        const result = mergeEntries(previous, incoming, 200);

        expect(result.entries.map((e) => e.message)).toEqual(['c', 'b', 'a']);
        expect(result.added).toBe(1);
    });

    it('adds nothing when the poll window returns only entries already held', () => {
        const result = mergeEntries(previous, page(['2026-04-08T10:00:02Z', 'b']), 200);

        expect(result.entries.map((e) => e.message)).toEqual(['b', 'a']);
        expect(result.added).toBe(0);
    });

    it('keeps two byte-equivalent entries as two entries — a repeated log line is real data', () => {
        const twice = page(['2026-04-08T10:00:05Z', 'tick'], ['2026-04-08T10:00:05Z', 'tick']);
        const result = mergeEntries([], twice, 200);

        expect(result.entries).toHaveLength(2);
        expect(result.added).toBe(2);
    });

    it('adds only the extra occurrence when an overlapping poll repeats one it already showed', () => {
        const held = page(['2026-04-08T10:00:05Z', 'tick']);
        const both = page(['2026-04-08T10:00:05Z', 'tick'], ['2026-04-08T10:00:05Z', 'tick']);
        const result = mergeEntries(held, both, 200);

        expect(result.entries).toHaveLength(2);
        expect(result.added).toBe(1);
        // Same digest/message — only object identity shows the surplus was prepended.
        expect(result.entries[0]).toBe(both[0]);
        expect(result.entries[1]).toBe(held[0]);
    });

    it('trims to the limit from the oldest end, so a long live session stays bounded', () => {
        const result = mergeEntries(
            previous,
            page(['2026-04-08T10:00:04Z', 'd'], ['2026-04-08T10:00:03Z', 'c']),
            3,
        );

        expect(result.entries.map((e) => e.message)).toEqual(['d', 'c', 'b']);
    });

    it('renumbers ids after trimming so the webview and host agree on identity', () => {
        const result = mergeEntries(previous, page(['2026-04-08T10:00:03Z', 'c']), 200);

        expect(result.entries.every((entry) => entry.id !== '')).toBe(true);
        expect(new Set(result.entries.map((e) => e.id)).size).toBe(3);
    });

    it('leaves the held page untouched when the poll returns nothing', () => {
        const result = mergeEntries(previous, [], 200);

        expect(result.entries).toEqual(previous);
        expect(result.added).toBe(0);
    });

    it('treats a non-positive limit as no trimming, so a bad control value cannot empty the view', () => {
        const result = mergeEntries(previous, page(['2026-04-08T10:00:03Z', 'c']), 0);

        expect(result.entries).toHaveLength(3);
    });
});
