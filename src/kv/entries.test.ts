import { describe, expect, it } from 'vitest';

import { formatKvValue, parseKvCount, toKvPage } from './entries';

/** One page exactly as `kv list -o json` emits it (cli/pkg/cmd/kv/common.go). */
const response = {
    data: [
        {
            key: 'orders/cursor',
            value: { since: '2026-08-01', page: 3 },
            versionstamp: '00000000000000010000',
            createdAt: '2026-08-05T09:15:00Z',
            expiresAt: '2026-08-12T09:15:00Z',
        },
        {
            key: 'dedupe/abc',
            value: 'seen',
            versionstamp: '00000000000000020000',
            createdAt: '2026-08-05T10:00:00Z',
        },
    ],
    pagination: { nextCursor: 'opaque-next', prevCursor: 'opaque-prev' },
};

describe('toKvPage', () => {
    it('reads entries out of the data envelope', () => {
        expect(toKvPage(response).entries.map((e) => e.key)).toEqual([
            'orders/cursor',
            'dedupe/abc',
        ]);
    });

    it('carries both cursors through verbatim', () => {
        expect(toKvPage(response)).toMatchObject({
            nextCursor: 'opaque-next',
            prevCursor: 'opaque-prev',
        });
    });

    it('treats a missing pagination block as "no more pages in either direction"', () => {
        expect(toKvPage({ data: [] })).toMatchObject({ nextCursor: '', prevCursor: '' });
    });

    it('treats a bare array response as a single unpaged page', () => {
        const page = toKvPage([{ key: 'a', value: 1 }]);
        expect(page.entries).toHaveLength(1);
        expect(page.nextCursor).toBe('');
    });

    it('survives the CLI printing nothing at all', () => {
        expect(toKvPage(undefined)).toEqual({ entries: [], nextCursor: '', prevCursor: '' });
    });

    it('ignores a non-string cursor rather than stringifying it into a bad request', () => {
        const page = toKvPage({ data: [], pagination: { nextCursor: 7 } });
        expect(page.nextCursor).toBe('');
    });

    it('formats createdAt for display but keeps the original for the detail view', () => {
        const [entry] = toKvPage(response).entries;
        expect(entry.rawCreatedAt).toBe('2026-08-05T09:15:00Z');
        expect(entry.createdAt).toMatch(/^2026-08-05 \d{2}:15:00$/);
    });

    it('reports a null expiresAt as no expiry, since the field is nullable', () => {
        const [, entry] = toKvPage(response).entries;
        expect(entry.expiresAt).toBe('');
    });

    it('exposes the versionstamp', () => {
        expect(toKvPage(response).entries[0].versionstamp).toBe('00000000000000010000');
    });

    it('makes key and value searchable together, with original case preserved', () => {
        const page = toKvPage({ data: [{ key: 'Orders/Cursor', value: 'SinceDate' }] });
        expect(page.entries[0].searchText).toBe('Orders/Cursor SinceDate');
    });

    it('names a keyless entry rather than rendering a blank row', () => {
        expect(toKvPage({ data: [{ value: 1 }] }).entries[0].key).toBe('(no key)');
    });
});

describe('parseKvCount', () => {
    // `kv count` prints a bare struct, not a slice: utils.Print marshals
    // printableCount directly, so the payload is {"count":N}.
    it('reads the total out of the bare struct the CLI prints', () => {
        expect(parseKvCount({ count: 4210 })).toBe(4210);
    });

    it('treats zero as a real answer, not a missing one', () => {
        expect(parseKvCount({ count: 0 })).toBe(0);
    });

    it('also copes with an items-wrapped shape, which the printer uses for slices', () => {
        expect(parseKvCount({ type: 'printableCount', items: [{ count: 7 }] })).toBe(7);
    });

    it('reports nothing rather than guessing a total it cannot read', () => {
        expect(parseKvCount(undefined)).toBeUndefined();
        expect(parseKvCount({})).toBeUndefined();
        expect(parseKvCount({ count: 'many' })).toBeUndefined();
        expect(parseKvCount({ count: Number.NaN })).toBeUndefined();
    });
});

describe('formatKvValue', () => {
    it('returns a string value unchanged', () => {
        expect(formatKvValue('seen')).toBe('seen');
    });

    it('leaves a timestamp-shaped value exactly as stored, because it is opaque state', () => {
        expect(formatKvValue('2026-08-01T00:00:00Z')).toBe('2026-08-01T00:00:00Z');
    });

    it('pretty-prints an object, which only ever renders in the expanded detail', () => {
        expect(formatKvValue({ page: 3 })).toBe('{\n  "page": 3\n}');
    });

    it('keeps numbers and booleans distinguishable from their string forms', () => {
        expect(formatKvValue(0)).toBe('0');
        expect(formatKvValue(false)).toBe('false');
    });

    it('shows a stored null as null, not as an empty cell', () => {
        expect(formatKvValue(null)).toBe('null');
    });

    it('renders an absent value as empty', () => {
        expect(formatKvValue(undefined)).toBe('');
    });
});
