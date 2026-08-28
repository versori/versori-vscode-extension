import { describe, expect, it } from 'vitest';

import { envelopeItems, text } from './cli-json';

describe('envelopeItems', () => {
    it('passes a bare array through untouched', () => {
        const raw = [{ id: '01A' }, { id: '01B' }];

        expect(envelopeItems(raw, ['items'])).toEqual(raw);
    });

    it('unwraps the named key of an envelope', () => {
        expect(envelopeItems({ type: 'VersionSummary', items: [1, 2] }, ['items'])).toEqual([
            1, 2,
        ]);
    });

    it('resolves keys in the order the caller listed them, not the object order', () => {
        expect(envelopeItems({ items: [1], results: [2] }, ['results', 'items'])).toEqual([2]);
        expect(envelopeItems({ items: [1], results: [2] }, ['items', 'results'])).toEqual([1]);
    });

    it('treats anything that is not an array or envelope as no items', () => {
        expect(envelopeItems(undefined, ['items'])).toEqual([]);
        expect(envelopeItems(null, ['items'])).toEqual([]);
        expect(envelopeItems('(no items)', ['items'])).toEqual([]);
        expect(envelopeItems(7, ['items'])).toEqual([]);
        expect(envelopeItems({ type: 'VersionSummary' }, ['items'])).toEqual([]);
    });

    it('skips a matching key whose value is not an array', () => {
        expect(envelopeItems({ items: 'none' }, ['items'])).toEqual([]);
        expect(envelopeItems({ items: 'none', results: [2] }, ['items', 'results'])).toEqual([2]);
    });
});

describe('text', () => {
    it('trims a string', () => {
        expect(text('  01VERSION  ')).toBe('01VERSION');
    });

    it('reads any non-string as an empty string', () => {
        expect(text(undefined)).toBe('');
        expect(text(null)).toBe('');
        expect(text(7)).toBe('');
        expect(text({ id: '01A' })).toBe('');
    });
});
