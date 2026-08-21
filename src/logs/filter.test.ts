import { describe, expect, it } from 'vitest';

import { LogEntry, toLogEntries } from './entries';
import {
    appendExpression,
    EMPTY_FILTER,
    fieldExpression,
    fieldPrefixExpression,
    matchesEntry,
    messageExpression,
    parseExpression,
    splitExpressions,
    visibleIndices,
} from './filter';

const entries = toLogEntries([
    {
        timestamp: '2026-04-08T10:00:53Z',
        severity: 'INFO',
        message: 'DurableInterpreter.executionCompleted',
        fields: { triggerName: 'get-pricing', name: 'default' },
    },
    {
        timestamp: '2026-04-08T10:00:54Z',
        severity: 'DEBUG',
        message: 'heartbeat',
        fields: { triggerName: 'get-pricing' },
    },
    {
        timestamp: '2026-04-08T10:00:55Z',
        severity: 'ERROR',
        message: 'connect ECONNREFUSED',
        fields: { triggerName: 'sync-orders' },
    },
]);

/** Newest-first from `toLogEntries` — look up by message so order changes do not break filters. */
function byMessage(message: string): LogEntry {
    const entry = entries.find((candidate) => candidate.message === message);
    if (!entry) {
        throw new Error(`missing fixture entry ${message}`);
    }
    return entry;
}

const completed = byMessage('DurableInterpreter.executionCompleted');
const heartbeat = byMessage('heartbeat');
const refused = byMessage('connect ECONNREFUSED');

describe('splitExpressions', () => {
    it('splits on commas, so several noisy messages can be excluded at once', () => {
        expect(splitExpressions('heartbeat, DurableInterpreter')).toEqual([
            'heartbeat',
            'DurableInterpreter',
        ]);
    });

    it('splits on newlines, which is what the action menus append', () => {
        expect(splitExpressions('heartbeat\nDurableInterpreter')).toEqual([
            'heartbeat',
            'DurableInterpreter',
        ]);
    });

    it('does not split on a comma inside a quoted value, so a generated expression round-trips', () => {
        expect(splitExpressions('message="Error fetching orders, retrying"')).toEqual([
            'message="Error fetching orders, retrying"',
        ]);
    });

    it('still splits on a newline between two quoted expressions', () => {
        expect(splitExpressions('message="a, b"\nmessage="c"')).toEqual([
            'message="a, b"',
            'message="c"',
        ]);
    });

    it('drops blanks, so a trailing comma is harmless', () => {
        expect(splitExpressions('heartbeat,,  ,')).toEqual(['heartbeat']);
    });

    it('drops exact duplicates, keeping the first, so clicking Include twice is idempotent', () => {
        expect(splitExpressions('heartbeat\nfoo\nheartbeat')).toEqual(['heartbeat', 'foo']);
    });

    it('returns nothing for blank input', () => {
        expect(splitExpressions('   ')).toEqual([]);
    });
});

describe('parseExpression', () => {
    it('reads bare text as an anywhere substring', () => {
        expect(parseExpression('get-pricing')).toEqual({ kind: 'text', value: 'get-pricing' });
    });

    it('reads an exact message', () => {
        expect(parseExpression('message="Error fetching workflows"')).toEqual({
            kind: 'message',
            value: 'Error fetching workflows',
            prefix: false,
        });
    });

    it('reads a message prefix', () => {
        expect(parseExpression('message^="Error fetching"')).toEqual({
            kind: 'message',
            value: 'Error fetching',
            prefix: true,
        });
    });

    it('reads an exact field value at a path', () => {
        expect(parseExpression('fields.executionId="01ABC"')).toEqual({
            kind: 'field',
            path: 'fields.executionId',
            value: '01ABC',
            prefix: false,
        });
    });

    it('reads a field value prefix', () => {
        expect(parseExpression('fields.route^="/orders/"')).toEqual({
            kind: 'field',
            path: 'fields.route',
            value: '/orders/',
            prefix: true,
        });
    });

    it('reads a field-path prefix', () => {
        expect(parseExpression('fields.error.*')).toEqual({
            kind: 'fieldPrefix',
            path: 'fields.error',
        });
    });

    it('accepts an unquoted value, so hand-typing is not punished', () => {
        expect(parseExpression('fields.name=default')).toEqual({
            kind: 'field',
            path: 'fields.name',
            value: 'default',
            prefix: false,
        });
    });

    it('unescapes a quoted value, so quotes and newlines round-trip through a menu action', () => {
        expect(parseExpression('message="say \\"hi\\""')).toEqual({
            kind: 'message',
            value: 'say "hi"',
            prefix: false,
        });
    });

    it('falls back to plain text for a half-typed expression rather than hiding every row', () => {
        expect(parseExpression('message=')).toEqual({ kind: 'text', value: 'message=' });
        expect(parseExpression('message="unterminated')).toEqual({
            kind: 'text',
            value: 'message="unterminated',
        });
    });
});

describe('expression serialisation', () => {
    it('quotes a message so punctuation, commas and quotes survive a round-trip', () => {
        const text = messageExpression('Error, "really": failed');
        expect(parseExpression(text)).toEqual({
            kind: 'message',
            value: 'Error, "really": failed',
            prefix: false,
        });
    });

    it('marks a prefix expression with ^=', () => {
        expect(messageExpression('Error fetching', true)).toBe('message^="Error fetching"');
        expect(fieldExpression('fields.route', '/orders/', true)).toBe('fields.route^="/orders/"');
    });

    it('writes a field-path prefix as path.*', () => {
        expect(fieldPrefixExpression('fields.error')).toBe('fields.error.*');
    });
});

describe('appendExpression', () => {
    it('appends on a new line, preserving what the user typed', () => {
        expect(appendExpression('heartbeat', 'message="boom"')).toBe('heartbeat\nmessage="boom"');
    });

    it('is a no-op when the expression is already there, so clicking twice does not duplicate it', () => {
        expect(appendExpression('heartbeat\nmessage="boom"', 'message="boom"')).toBe(
            'heartbeat\nmessage="boom"',
        );
    });

    it('starts a fresh box without a leading newline', () => {
        expect(appendExpression('', 'message="boom"')).toBe('message="boom"');
        expect(appendExpression('  \n', 'message="boom"')).toBe('message="boom"');
    });

    it('recognises a duplicate typed with a trailing comma', () => {
        expect(appendExpression('message="boom",', 'message="boom"')).toBe('message="boom",');
    });
});

describe('matchesEntry', () => {
    it('keeps everything under the empty filter', () => {
        expect(entries.every((e) => matchesEntry(e, EMPTY_FILTER))).toBe(true);
    });

    it('matches include terms against fields, not just the message', () => {
        expect(matchesEntry(completed, { ...EMPTY_FILTER, include: 'get-pricing' })).toBe(true);
        expect(matchesEntry(refused, { ...EMPTY_FILTER, include: 'get-pricing' })).toBe(false);
    });

    it('treats several include terms as alternatives', () => {
        const filter = { ...EMPTY_FILTER, include: 'heartbeat, ECONNREFUSED' };
        expect(matchesEntry(heartbeat, filter)).toBe(true);
        expect(matchesEntry(refused, filter)).toBe(true);
        expect(matchesEntry(completed, filter)).toBe(false);
    });

    it('hides an entry matching any exclude term', () => {
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, exclude: 'heartbeat' })).toBe(false);
        expect(matchesEntry(completed, { ...EMPTY_FILTER, exclude: 'heartbeat' })).toBe(true);
    });

    it('lets exclude win over include, so a narrowed view can still drop noise', () => {
        const filter = { ...EMPTY_FILTER, include: 'get-pricing', exclude: 'heartbeat' };
        expect(matchesEntry(completed, filter)).toBe(true);
        expect(matchesEntry(heartbeat, filter)).toBe(false);
    });

    it('ignores case by default', () => {
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, exclude: 'HEARTBEAT' })).toBe(false);
    });

    it('respects case when asked', () => {
        expect(
            matchesEntry(heartbeat, { ...EMPTY_FILTER, exclude: 'HEARTBEAT', caseSensitive: true }),
        ).toBe(true);
        expect(
            matchesEntry(heartbeat, { ...EMPTY_FILTER, exclude: 'heartbeat', caseSensitive: true }),
        ).toBe(false);
    });

    it('keeps only the selected severities when any are selected', () => {
        const filter = { ...EMPTY_FILTER, severities: ['ERROR'] };
        expect(matchesEntry(refused, filter)).toBe(true);
        expect(matchesEntry(completed, filter)).toBe(false);
    });

    it('compares severities case-insensitively, whatever the workflow emitted', () => {
        expect(matchesEntry(refused, { ...EMPTY_FILTER, severities: ['error'] })).toBe(true);
    });
});

describe('matchesEntry with scoped expressions', () => {
    it('matches an exact message and rejects a mere substring of it', () => {
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, include: 'message="heartbeat"' })).toBe(
            true,
        );
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, include: 'message="heart"' })).toBe(false);
    });

    it('matches a message prefix', () => {
        const filter = { ...EMPTY_FILTER, include: 'message^="connect"' };
        expect(matchesEntry(refused, filter)).toBe(true);
        expect(matchesEntry(heartbeat, filter)).toBe(false);
        // Needle mid-message / only as a suffix must not match — `includes`,
        // `indexOf(...) >= 0`, and `endsWith` would all accept these wrongly.
        const midConnect = toLogEntries([{ message: 'failed to connect' }])[0];
        const suffixConnect = toLogEntries([{ message: 'will reconnect' }])[0];
        expect(matchesEntry(midConnect, filter)).toBe(false);
        expect(matchesEntry(suffixConnect, filter)).toBe(false);
    });

    it('matches an exact field value at a path, not the same text at another path', () => {
        const filter = { ...EMPTY_FILTER, include: 'fields.triggerName="get-pricing"' };
        expect(matchesEntry(completed, filter)).toBe(true);
        expect(matchesEntry(refused, filter)).toBe(false);
        expect(matchesEntry(completed, { ...EMPTY_FILTER, include: 'fields.name="get-pricing"' })).toBe(
            false,
        );
    });

    it('matches a field value prefix', () => {
        const filter = { ...EMPTY_FILTER, include: 'fields.triggerName^="get-"' };
        expect(matchesEntry(completed, filter)).toBe(true);
        expect(matchesEntry(refused, filter)).toBe(false);
        // Same start-only invariant on field values — mid and suffix fixtures
        // catch `includes` / `indexOf` / `endsWith` stand-ins for `^=`.
        const midGet = toLogEntries([
            { message: 'm', fields: { triggerName: 'widget-get-pricing' } },
        ])[0];
        const suffixGet = toLogEntries([
            { message: 'm', fields: { triggerName: 'legacy-get-' } },
        ])[0];
        expect(matchesEntry(midGet, filter)).toBe(false);
        expect(matchesEntry(suffixGet, filter)).toBe(false);
    });

    it('matches an entry that has any field under a path prefix', () => {
        const filter = { ...EMPTY_FILTER, include: 'fields.*' };
        expect(matchesEntry(completed, filter)).toBe(true);
        expect(matchesEntry(toLogEntries([{ message: 'bare' }])[0], filter)).toBe(false);
    });

    it('treats a terminal field named exactly like the prefix as being under it', () => {
        const stringError = toLogEntries([
            { timestamp: '2026-04-08T10:00:56Z', severity: 'ERROR', message: 'm', fields: { error: 'boom' } },
        ])[0];
        expect(matchesEntry(stringError, { ...EMPTY_FILTER, include: 'fields.error.*' })).toBe(true);
    });

    it('finds a field name through generic text, so a value need not be known', () => {
        expect(matchesEntry(completed, { ...EMPTY_FILTER, include: 'triggerName' })).toBe(true);
    });

    it('treats two exact-title includes as alternatives, so both sets of logs show', () => {
        const filter = {
            ...EMPTY_FILTER,
            include: 'message="heartbeat"\nmessage="connect ECONNREFUSED"',
        };
        expect(matchesEntry(heartbeat, filter)).toBe(true);
        expect(matchesEntry(refused, filter)).toBe(true);
        expect(matchesEntry(completed, filter)).toBe(false);
    });

    it('lets a scoped exclude win over a matching include', () => {
        const filter = {
            ...EMPTY_FILTER,
            include: 'fields.triggerName="get-pricing"',
            exclude: 'message="heartbeat"',
        };
        expect(matchesEntry(completed, filter)).toBe(true);
        expect(matchesEntry(heartbeat, filter)).toBe(false);
    });

    it('applies Match case to scoped values as well as plain text', () => {
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, include: 'message="HEARTBEAT"' })).toBe(
            true,
        );
        expect(
            matchesEntry(heartbeat, {
                ...EMPTY_FILTER,
                include: 'message="HEARTBEAT"',
                caseSensitive: true,
            }),
        ).toBe(false);
    });

    it('composes severity with expressions as a further narrowing', () => {
        const filter = { ...EMPTY_FILTER, include: 'fields.*', severities: ['ERROR'] };
        expect(matchesEntry(refused, filter)).toBe(true);
        expect(matchesEntry(completed, filter)).toBe(false);
    });

    it('keeps every entry when a malformed expression is the only include', () => {
        // Half-typed: falls back to a substring that matches nothing rather than
        // hiding everything with an unparseable clause.
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, include: 'message=' })).toBe(false);
        expect(matchesEntry(heartbeat, { ...EMPTY_FILTER, include: 'heartbeat, message=' })).toBe(
            true,
        );
    });
});

describe('visibleIndices', () => {
    it('returns positions in the original list, so the webview can show and hide rows', () => {
        // Newest-first: refused (0), heartbeat (1), completed (2) — exclude heartbeat → [0, 2].
        expect(visibleIndices(entries, { ...EMPTY_FILTER, exclude: 'heartbeat' })).toEqual([0, 2]);
    });

    it('returns every index under the empty filter', () => {
        expect(visibleIndices(entries, EMPTY_FILTER)).toEqual([0, 1, 2]);
    });

    it('returns an empty list when nothing survives', () => {
        expect(visibleIndices(entries, { ...EMPTY_FILTER, include: 'nothing-matches' })).toEqual([]);
    });

    it('exposes newest-first order from toLogEntries', () => {
        expect(entries.map((entry) => entry.message)).toEqual([
            'connect ECONNREFUSED',
            'heartbeat',
            'DurableInterpreter.executionCompleted',
        ]);
    });
});
