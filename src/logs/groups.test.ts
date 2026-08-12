import { describe, expect, it } from 'vitest';

import { toLogEntries } from './entries';
import { visibleIndices } from './filter';
import { EMPTY_FILTER } from './filter';
import { groupByTitle } from './groups';

const entries = toLogEntries([
    { timestamp: '2026-04-08T10:00:01Z', severity: 'INFO', message: 'fetch orders' },
    { timestamp: '2026-04-08T10:00:02Z', severity: 'ERROR', message: 'fetch orders' },
    { timestamp: '2026-04-08T10:00:03Z', severity: 'INFO', message: 'heartbeat' },
    { timestamp: '2026-04-08T10:00:04Z', severity: 'WARN', message: 'fetch orders' },
]);

describe('groupByTitle', () => {
    it('groups by exact message and counts the visible instances', () => {
        const groups = groupByTitle(entries, visibleIndices(entries, EMPTY_FILTER));

        expect(groups.map((g) => [g.message, g.indices.length])).toEqual([
            ['fetch orders', 3],
            ['heartbeat', 1],
        ]);
    });

    it('orders groups by their newest member', () => {
        // "fetch orders" is newest at 10:00:04, so it leads.
        const groups = groupByTitle(entries, visibleIndices(entries, EMPTY_FILTER));
        expect(groups[0].message).toBe('fetch orders');
    });

    it('reports the worst severity present, not the newest one', () => {
        const groups = groupByTitle(entries, visibleIndices(entries, EMPTY_FILTER));

        // Newest member is WARN, but an ERROR is in the group.
        expect(groups[0].severity).toBe('ERROR');
        expect(groups[0].level).toBe('error');
    });

    it('reports the latest timestamp in the group', () => {
        const groups = groupByTitle(entries, visibleIndices(entries, EMPTY_FILTER));
        expect(groups[0].latest).toBe(entries[0].timestamp);
    });

    it('lists members newest-first', () => {
        const groups = groupByTitle(entries, visibleIndices(entries, EMPTY_FILTER));
        expect(groups[0].indices.map((i) => entries[i].severity)).toEqual(['WARN', 'ERROR', 'INFO']);
    });

    it('groups only the entries that survived the filter', () => {
        const indices = visibleIndices(entries, { ...EMPTY_FILTER, severities: ['ERROR'] });
        const groups = groupByTitle(entries, indices);

        expect(groups).toHaveLength(1);
        expect(groups[0].indices).toHaveLength(1);
    });

    it('returns nothing when nothing is visible', () => {
        expect(groupByTitle(entries, [])).toEqual([]);
    });

    it('does not merge two different messages that share a prefix', () => {
        const pair = toLogEntries([
            { timestamp: '2026-04-08T10:00:01Z', severity: 'INFO', message: 'fetch' },
            { timestamp: '2026-04-08T10:00:02Z', severity: 'INFO', message: 'fetch orders' },
        ]);
        expect(groupByTitle(pair, visibleIndices(pair, EMPTY_FILTER))).toHaveLength(2);
    });
});
