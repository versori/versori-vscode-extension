import { describe, expect, it } from 'vitest';

import { fieldKeys, flattenDeep, severitiesOf, toLogEntries } from './entries';

// The real shape, verified against `versori projects logs -o json`: NDJSON, one
// object per line, identifiers nested under `fields`.
const record = {
    timestamp: '2026-04-08T10:00:53Z',
    severity: 'INFO',
    message: 'DurableInterpreter.executionCompleted',
    fields: {
        activationId: '01KJSEM00G33P0TR2VNF84KZ7X',
        durationMs: 323,
        executionId: '01KZ6027279A4F6BA03D4HP9ZQ',
        externalUserId: '__versori_static_user__',
        level: 'INFO',
        name: 'default',
        triggerName: 'get-pricing',
    },
};

describe('flattenDeep', () => {
    it('joins nested keys with dots', () => {
        expect(flattenDeep({ fields: { name: 'default' } })).toEqual([
            { key: 'fields.name', value: 'default' },
        ]);
    });

    it('stringifies arrays rather than exploding them into indexed keys', () => {
        expect(flattenDeep({ tags: ['a', 'b'] })).toEqual([{ key: 'tags', value: '["a","b"]' }]);
    });

    it('drops empty, null and undefined values, which are pure noise', () => {
        expect(flattenDeep({ a: '', b: null, c: undefined, d: 0 })).toEqual([
            { key: 'd', value: '0' },
        ]);
    });

    it('drops secret-named keys wherever they are nested', () => {
        const fields = flattenDeep({ fields: { apiKey: 'sk-live-1', name: 'ok' } });
        expect(fields.map((f) => f.key)).toEqual(['fields.name']);
    });

    it('stops descending at MAX_FIELD_DEPTH instead of recursing without bound', () => {
        const deep = { a: { b: { c: { d: { e: 'far' } } } } };
        const keys = flattenDeep(deep).map((f) => f.key);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('a.b.c.d');
    });

    it('redacts secrets nested inside arrays, not just at the top level', () => {
        // A workflow can put objects inside array-valued fields; a secret in one of
        // those objects must not survive stringification into the field value.
        const fields = flattenDeep({ fields: { tags: [{ apiKey: 'sk-live-SECRET', ok: 'y' }] } });
        expect(fields).toEqual([
            { key: 'fields.tags', value: '[{"apiKey":"[redacted]","ok":"y"}]' },
        ]);
    });

    it('redacts a secret below MAX_FIELD_DEPTH instead of stringifying it whole', () => {
        const deep = { a: { b: { c: { d: { apiKey: 'sk-live-SECRET', e: 'far' } } } } };
        const fields = flattenDeep(deep);
        expect(fields).toHaveLength(1);
        expect(fields[0].value).not.toContain('sk-live-SECRET');
    });
});

describe('toLogEntries', () => {
    it('promotes message, severity and timestamp out of the field list', () => {
        const [entry] = toLogEntries([record]);

        expect(entry.message).toBe('DurableInterpreter.executionCompleted');
        expect(entry.severity).toBe('INFO');
        expect(entry.rawTimestamp).toBe('2026-04-08T10:00:53Z');
        expect(entry.fields.map((f) => f.key)).not.toContain('message');
        expect(entry.fields.map((f) => f.key)).not.toContain('severity');
        expect(entry.fields.map((f) => f.key)).not.toContain('timestamp');
    });

    it('keeps every remaining identifier as a flattened field', () => {
        const [entry] = toLogEntries([record]);
        expect(entry.fields).toEqual(
            expect.arrayContaining([
                { key: 'fields.triggerName', value: 'get-pricing' },
                { key: 'fields.durationMs', value: '323' },
            ]),
        );
    });

    it('formats the timestamp for display but keeps the raw one', () => {
        const [entry] = toLogEntries([record]);
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(entry.rawTimestamp).toBe('2026-04-08T10:00:53Z');
    });

    it('maps severity to a chip class', () => {
        expect(toLogEntries([record])[0].level).toBe('info');
        expect(toLogEntries([{ ...record, severity: 'ERROR' }])[0].level).toBe('error');
    });

    it('falls back to the nested level when severity is absent', () => {
        const [entry] = toLogEntries([{ ...record, severity: undefined }]);
        expect(entry.severity).toBe('INFO');
    });

    it('uses the error as the headline when there is no message', () => {
        const [entry] = toLogEntries([
            { timestamp: record.timestamp, severity: 'ERROR', error: 'connect ECONNREFUSED' },
        ]);
        expect(entry.message).toBe('connect ECONNREFUSED');
    });

    it('never leaves the headline blank, so no entry renders as an empty row', () => {
        const [entry] = toLogEntries([{ timestamp: record.timestamp, severity: 'INFO' }]);
        expect(entry.message).toBe('(no message)');
    });

    it('builds searchText from the headline, severity and every field value', () => {
        const [entry] = toLogEntries([record]);
        expect(entry.searchText).toContain('DurableInterpreter.executionCompleted');
        expect(entry.searchText).toContain('get-pricing');
        expect(entry.searchText).toContain('INFO');
    });

    it('preserves original case in searchText, so case-sensitive matching is possible', () => {
        expect(toLogEntries([record])[0].searchText).toContain('DurableInterpreter');
    });

    it('returns an empty list for the no-rows signal', () => {
        // `projects logs` exits 0 and prints zero bytes when there is nothing.
        expect(toLogEntries(undefined)).toEqual([]);
    });

    it('redacts secrets nested inside arrays wherever they occur, so they never reach searchText either', () => {
        const [entry] = toLogEntries([
            {
                timestamp: record.timestamp,
                severity: 'INFO',
                message: 'x',
                fields: { tags: [{ apiKey: 'sk-live-SECRET', ok: 'y' }] },
            },
        ]);
        expect(entry.fields.map((f) => f.value).join(' ')).not.toContain('sk-live-SECRET');
        expect(entry.searchText).not.toContain('sk-live-SECRET');
    });

    it('drops the error-only headline from the field list, so it is not shown twice', () => {
        const [entry] = toLogEntries([
            { timestamp: record.timestamp, severity: 'ERROR', error: 'connect ECONNREFUSED' },
        ]);
        expect(entry.message).toBe('connect ECONNREFUSED');
        expect(entry.fields.map((f) => f.key)).not.toContain('error');
    });

    it('keeps error as a field when message already won the headline, so nothing goes missing', () => {
        const [entry] = toLogEntries([
            {
                timestamp: record.timestamp,
                severity: 'ERROR',
                message: 'request failed',
                error: 'connect ECONNREFUSED',
            },
        ]);
        expect(entry.message).toBe('request failed');
        expect(entry.fields).toEqual(
            expect.arrayContaining([{ key: 'error', value: 'connect ECONNREFUSED' }]),
        );
    });
});

describe('fieldKeys', () => {
    it('orders keys by how often they are populated, most-filled first', () => {
        const entries = toLogEntries([
            { timestamp: record.timestamp, severity: 'INFO', message: 'a', fields: { name: 'x' } },
            {
                timestamp: record.timestamp,
                severity: 'INFO',
                message: 'b',
                fields: { name: 'y', rare: 'z' },
            },
        ]);
        expect(fieldKeys(entries)).toEqual(['fields.name', 'fields.rare']);
    });
});

describe('severitiesOf', () => {
    it('lists distinct severities worst-first, so the noisy ones sort last', () => {
        const entries = toLogEntries([
            { timestamp: record.timestamp, severity: 'DEBUG', message: 'a' },
            { timestamp: record.timestamp, severity: 'ERROR', message: 'b' },
            { timestamp: record.timestamp, severity: 'INFO', message: 'c' },
            { timestamp: record.timestamp, severity: 'ERROR', message: 'd' },
        ]);
        expect(severitiesOf(entries)).toEqual(['ERROR', 'INFO', 'DEBUG']);
    });
});
