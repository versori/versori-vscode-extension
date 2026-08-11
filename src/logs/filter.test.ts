import { describe, expect, it } from 'vitest';

import { LogEntry, toLogEntries } from './entries';
import { EMPTY_FILTER, matchesEntry, parseTerms, visibleIndices } from './filter';

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

describe('parseTerms', () => {
    it('splits on commas so several noisy messages can be excluded at once', () => {
        expect(parseTerms('heartbeat, DurableInterpreter')).toEqual([
            'heartbeat',
            'DurableInterpreter',
        ]);
    });

    it('splits on newlines too, for pasted lists', () => {
        expect(parseTerms('heartbeat\nDurableInterpreter')).toEqual([
            'heartbeat',
            'DurableInterpreter',
        ]);
    });

    it('drops empty segments, so a trailing comma is harmless', () => {
        expect(parseTerms('heartbeat,,  ,')).toEqual(['heartbeat']);
    });

    it('returns nothing for blank input', () => {
        expect(parseTerms('   ')).toEqual([]);
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
