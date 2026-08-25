import { describe, expect, it } from 'vitest';

import { foreignSidecarPaths, versionFilePaths } from './safety';

describe('foreignSidecarPaths', () => {
    it('accepts an empty folder', () => {
        expect(foreignSidecarPaths([], ['src/index.ts'])).toEqual([]);
    });

    it('accepts an exact checkout', () => {
        expect(
            foreignSidecarPaths(['README.md', 'src/index.ts'], ['README.md', 'src/index.ts']),
        ).toEqual([]);
    });

    it('accepts a checkout that is a subset of the version', () => {
        expect(foreignSidecarPaths(['README.md'], ['README.md', 'src/index.ts'])).toEqual([]);
    });

    it('reports one foreign file', () => {
        expect(foreignSidecarPaths(['README.md', 'notes.txt'], ['README.md'])).toEqual([
            'notes.txt',
        ]);
    });

    it('reports many foreign files in stable order', () => {
        expect(
            foreignSidecarPaths(
                ['z-last.txt', 'src/index.ts', 'a-first.txt'],
                ['src/index.ts'],
            ),
        ).toEqual(['a-first.txt', 'z-last.txt']);
    });

    it('normalises path separators on both sides', () => {
        expect(
            foreignSidecarPaths(
                ['src\\index.ts', 'nested\\foreign.txt'],
                ['src/index.ts', 'other\\file.ts'],
            ),
        ).toEqual(['nested/foreign.txt']);
    });
});

describe('versionFilePaths', () => {
    it('reads filenames from the projects files envelope', () => {
        expect(
            versionFilePaths({
                type: 'FileSummary',
                items: [
                    { filename: 'src/index.ts', size: 1, content: 'x' },
                    { filename: 'README.md', size: 0, content: '' },
                ],
            }),
        ).toEqual(['src/index.ts', 'README.md']);
    });

    it('drops malformed rows', () => {
        expect(versionFilePaths({ items: [{ size: 1 }, null, 'nope'] })).toEqual([]);
    });
});
