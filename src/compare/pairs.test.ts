import { describe, expect, it } from 'vitest';

import { comparePairs } from './pairs';

describe('comparePairs', () => {
    it('marks a file both sides hold as present on both', () => {
        expect(comparePairs(['both.ts'], ['both.ts'])).toEqual([
            { relativePath: 'both.ts', workingExists: true, sidecarExists: true },
        ]);
    });

    it('keeps a working-only file, which reads as a deletion in the version', () => {
        expect(comparePairs(['only.ts'], [])).toEqual([
            { relativePath: 'only.ts', workingExists: true, sidecarExists: false },
        ]);
    });

    it('keeps a sidecar-only file, which reads as an addition in the version', () => {
        expect(comparePairs([], ['only.ts'])).toEqual([
            { relativePath: 'only.ts', workingExists: false, sidecarExists: true },
        ]);
    });

    it('unions both sides into one code-point-ordered list', () => {
        expect(
            comparePairs(['both', 'working-only'], ['both', 'sidecar-only']).map(
                (pair) => pair.relativePath,
            ),
        ).toEqual(['both', 'sidecar-only', 'working-only']);
        // Code point, not locale: uppercase sorts before lowercase.
        expect(
            comparePairs(['logo.png'], ['README.md']).map((pair) => pair.relativePath),
        ).toEqual(['README.md', 'logo.png']);
    });

    it('emits one pair per path even when a side repeats it', () => {
        expect(comparePairs(['dup.ts', 'dup.ts'], ['dup.ts'])).toEqual([
            { relativePath: 'dup.ts', workingExists: true, sidecarExists: true },
        ]);
    });

    it('has nothing to compare when neither side has files', () => {
        expect(comparePairs([], [])).toEqual([]);
    });
});
