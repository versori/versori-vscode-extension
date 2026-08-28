import { describe, expect, it, vi } from 'vitest';

import { changedPairs, compareTitle, SideReader } from './changes';
import { ComparePair } from './pairs';

function pair(
    relativePath: string,
    workingExists: boolean,
    sidecarExists: boolean,
): ComparePair {
    return { relativePath, workingExists, sidecarExists };
}

function reader(files: Record<string, { working?: Buffer; version?: Buffer }>): SideReader {
    return (relativePath, side) => files[relativePath]?.[side];
}

describe('changedPairs', () => {
    it('keeps a working-only file', () => {
        const read = vi.fn<SideReader>();

        expect(changedPairs([pair('added.ts', true, false)], read)).toEqual([
            pair('added.ts', true, false),
        ]);
        expect(read).not.toHaveBeenCalled();
    });

    it('keeps a version-only file', () => {
        expect(
            changedPairs([pair('gone.ts', false, true)], reader({})),
        ).toEqual([pair('gone.ts', false, true)]);
    });

    it('drops a file whose bytes match on both sides', () => {
        const same = Buffer.from('unchanged\n');

        expect(
            changedPairs(
                [pair('same.ts', true, true)],
                reader({ 'same.ts': { working: same, version: Buffer.from('unchanged\n') } }),
            ),
        ).toEqual([]);
    });

    it('keeps a file whose bytes differ on both sides', () => {
        const both = pair('changed.ts', true, true);

        expect(
            changedPairs(
                [both],
                reader({
                    'changed.ts': { working: Buffer.from('new\n'), version: Buffer.from('old\n') },
                }),
            ),
        ).toEqual([both]);
    });

    it('treats an unreadable side as changed rather than dropping the pair', () => {
        const both = pair('maybe.ts', true, true);

        expect(
            changedPairs(
                [both],
                reader({ 'maybe.ts': { working: Buffer.from('ok\n') } }),
            ),
        ).toEqual([both]);
        expect(
            changedPairs(
                [both],
                reader({ 'maybe.ts': { version: Buffer.from('ok\n') } }),
            ),
        ).toEqual([both]);
        expect(changedPairs([both], reader({}))).toEqual([both]);
    });
});

describe('compareTitle', () => {
    it('names the version as the baseline under version-to-working', () => {
        expect(compareTitle('v1.2', 'version-to-working')).toBe('v1.2 → Working copy');
    });

    it('names the working copy as the baseline under working-to-version', () => {
        expect(compareTitle('v1.2', 'working-to-version')).toBe('Working copy → v1.2');
    });
});
