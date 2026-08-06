import { describe, expect, it } from 'vitest';

import {
    deriveColumns,
    flattenRow,
    formatCell,
    isSecretKey,
    levelClass,
    redact,
    unwrapRows,
} from './rows';

describe('unwrapRows', () => {
    it('unwraps the items envelope the CLI returns', () => {
        expect(unwrapRows({ type: 'Context', items: [{ Name: 'a' }, { Name: 'b' }] })).toEqual([
            { Name: 'a' },
            { Name: 'b' },
        ]);
    });

    it('accepts a bare array', () => {
        expect(unwrapRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    });

    it('wraps a single object as one row', () => {
        expect(unwrapRows({ name: 'proj', id: '01X' })).toEqual([{ name: 'proj', id: '01X' }]);
    });

    it('drops non-object entries', () => {
        expect(unwrapRows([{ a: 1 }, 'nope', null, 42])).toEqual([{ a: 1 }]);
    });

    it('returns nothing for scalars', () => {
        expect(unwrapRows(null)).toEqual([]);
        expect(unwrapRows('text')).toEqual([]);
    });
});

describe('flattenRow', () => {
    it('expands a real log entry’s nested fields', () => {
        const entry = {
            fields: { executionId: '01EXEC', name: 'orders', triggerName: 'cron' },
            message: 'ExecutionCompleted',
            severity: 'INFO',
            timestamp: '2026-07-24T14:36:00Z',
            error: '',
        };

        expect(flattenRow(entry)).toEqual({
            'fields.executionId': '01EXEC',
            'fields.name': 'orders',
            'fields.triggerName': 'cron',
            message: 'ExecutionCompleted',
            severity: 'INFO',
            timestamp: '2026-07-24T14:36:00Z',
            error: '',
        });
    });

    it('leaves flat rows untouched', () => {
        expect(flattenRow({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
    });

    it('does not expand arrays into numbered columns', () => {
        expect(flattenRow({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] });
    });

    it('only expands one level', () => {
        expect(flattenRow({ a: { b: { c: 1 } } })).toEqual({ 'a.b': { c: 1 } });
    });

    it('lets secret filtering still catch nested keys', () => {
        const flat = flattenRow({ auth: { token: 'ey...', user: 'me' } });

        expect(deriveColumns([flat])).toEqual(['auth.user']);
    });
});

describe('deriveColumns', () => {
    it('puts preferred columns first, case-insensitively', () => {
        const rows = [{ id: '1', name: 'a', created: 'x' }];

        expect(deriveColumns(rows, ['Name', 'Created'])).toEqual(['name', 'created', 'id']);
    });

    it('keeps unlisted columns in first-seen order', () => {
        const rows = [{ z: 1, a: 2 }, { m: 3 }];

        expect(deriveColumns(rows)).toEqual(['z', 'a', 'm']);
    });

    it('ignores preferred names that are absent', () => {
        expect(deriveColumns([{ a: 1 }], ['nope', 'a'])).toEqual(['a']);
    });

    it('orders non-preferred columns by how often they are populated', () => {
        // Log rows are heterogeneous; sparse workflow-specific fields sink.
        const rows = [
            { common: 'a', sparse: '', mid: 'x' },
            { common: 'b', sparse: '', mid: 'y' },
            { common: 'c', sparse: 'once', mid: '' },
        ];

        expect(deriveColumns(rows)).toEqual(['common', 'mid', 'sparse']);
    });

    it('keeps preferred columns first even when rarely populated', () => {
        const rows = [{ always: 'x', rare: '' }, { always: 'y', rare: '' }, { always: 'z', rare: 'v' }];

        expect(deriveColumns(rows, ['rare'])).toEqual(['rare', 'always']);
    });

    it('never exposes secret-named keys', () => {
        const rows = [{ Name: 'ctx', JWT: 'ey...', apiKey: 'k', OrganisationId: '01X' }];

        expect(deriveColumns(rows)).toEqual(['Name', 'OrganisationId']);
    });
});

describe('isSecretKey', () => {
    it.each(['JWT', 'jwt', 'accessToken', 'client_secret', 'apiKey', 'api_key', 'Password'])(
        'flags %s',
        (key) => expect(isSecretKey(key)).toBe(true),
    );

    // The HTTP header conventions, which is the form these names actually take
    // when a workflow logs a request it made.
    it.each(['x-api-key', 'api-key', 'X-API-Key', 'cookie', 'set-cookie', 'Set-Cookie'])(
        'flags the header spelling %s',
        (key) => expect(isSecretKey(key)).toBe(true),
    );

    it.each(['name', 'id', 'environment', 'description'])('allows %s', (key) =>
        expect(isSecretKey(key)).toBe(false),
    );
});

describe('formatCell', () => {
    it('renders blanks for empty values', () => {
        expect(formatCell(null)).toBe('');
        expect(formatCell(undefined)).toBe('');
        expect(formatCell('')).toBe('');
    });

    it('passes plain strings through', () => {
        expect(formatCell('hello')).toBe('hello');
    });

    it('reformats ISO timestamps for readability', () => {
        expect(formatCell('2026-07-31T14:05:09Z')).toMatch(/^2026-07-31 \d{2}:\d{2}:09$/);
    });

    it('leaves date-like strings that are not valid dates alone', () => {
        expect(formatCell('2026-99-99T99:99:99')).toBe('2026-99-99T99:99:99');
    });

    it('serialises objects compactly', () => {
        expect(formatCell({ a: 1 })).toBe('{"a":1}');
    });
});

describe('levelClass', () => {
    it('maps severities and log levels', () => {
        expect(levelClass('critical')).toBe('error');
        expect(levelClass('ERROR')).toBe('error');
        expect(levelClass('warn')).toBe('warn');
        expect(levelClass('high')).toBe('warn');
        expect(levelClass('info')).toBe('info');
        expect(levelClass('debug')).toBe('muted');
    });

    it('returns undefined for anything else', () => {
        expect(levelClass('banana')).toBeUndefined();
        expect(levelClass(42)).toBeUndefined();
    });
});

describe('redact', () => {
    it('replaces secret values at any depth', () => {
        expect(redact({ items: [{ Name: 'a', JWT: 'ey...' }] })).toEqual({
            items: [{ Name: 'a', JWT: '[redacted]' }],
        });
    });

    it('leaves ordinary data untouched', () => {
        expect(redact({ a: [1, 'two', { b: true }] })).toEqual({ a: [1, 'two', { b: true }] });
    });

    it('masks the hyphenated header spellings a workflow is likely to log', () => {
        expect(
            redact({ fields: { headers: { 'x-api-key': 'sk-live-1', cookie: 'session=abc' } } }),
        ).toEqual({
            fields: { headers: { 'x-api-key': '[redacted]', cookie: '[redacted]' } },
        });
    });
});
