import { describe, expect, it } from 'vitest';

import { parseContextList } from './contexts';

/** Trimmed from real `versori context list -o json` output (JWTs removed). */
const REAL_RESPONSE = {
    type: 'Context',
    items: [
        { Name: 'walmart', OrganisationId: '01J1YE...', JWT: 'redacted' },
        { Name: 'deel', OrganisationId: '01J5E5...', JWT: 'redacted' },
        { Name: '*rithum', OrganisationId: '01JWGW...', JWT: 'redacted' },
    ],
};

describe('parseContextList', () => {
    it('reads the items[] wrapper the CLI actually returns', () => {
        expect(parseContextList(REAL_RESPONSE)).toEqual([
            { name: 'walmart', active: false },
            { name: 'deel', active: false },
            { name: 'rithum', active: true },
        ]);
    });

    it('strips the active marker so the name is usable with `context select`', () => {
        const [entry] = parseContextList({ items: [{ Name: '*rithum' }] });

        expect(entry.name).toBe('rithum');
        expect(entry.active).toBe(true);
    });

    it('accepts a bare array', () => {
        expect(parseContextList([{ Name: 'a' }, { name: 'b' }])).toEqual([
            { name: 'a', active: false },
            { name: 'b', active: false },
        ]);
    });

    it('accepts plain strings', () => {
        expect(parseContextList(['a', '*b'])).toEqual([
            { name: 'a', active: false },
            { name: 'b', active: true },
        ]);
    });

    it('degrades to an empty list for unexpected shapes', () => {
        expect(parseContextList(null)).toEqual([]);
        expect(parseContextList({})).toEqual([]);
        expect(parseContextList('nope')).toEqual([]);
        expect(parseContextList({ items: 'not an array' })).toEqual([]);
    });

    it('skips entries with no usable name', () => {
        expect(parseContextList({ items: [{ Name: '' }, {}, { Name: 'ok' }] })).toEqual([
            { name: 'ok', active: false },
        ]);
    });
});
