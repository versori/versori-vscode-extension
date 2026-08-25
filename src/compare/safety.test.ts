import { describe, expect, it } from 'vitest';

import { foreignSidecarPaths, versionFilePaths } from './safety';

describe('foreignSidecarPaths', () => {
    it('accepts an empty folder', () => {
        expect(foreignSidecarPaths([], ['src/index.ts'])).toEqual([]);
    });

    it('accepts a clean prior checkout including nested parent directories', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'README.md', kind: 'file' },
                    { path: 'src', kind: 'directory' },
                    { path: 'src/deep', kind: 'directory' },
                    { path: 'src/deep/index.ts', kind: 'file' },
                ],
                ['README.md', 'src/deep/index.ts'],
            ),
        ).toEqual([]);
    });

    it('accepts a checkout that is a subset of the version', () => {
        expect(
            foreignSidecarPaths([{ path: 'README.md', kind: 'file' }], [
                'README.md',
                'src/index.ts',
            ]),
        ).toEqual([]);
    });

    it('reports an otherwise empty subdirectory as foreign', () => {
        expect(
            foreignSidecarPaths([{ path: 'empty', kind: 'directory' }], ['src/index.ts']),
        ).toEqual(['empty']);
    });

    it('reports one foreign file', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'README.md', kind: 'file' },
                    { path: 'notes.txt', kind: 'file' },
                ],
                ['README.md'],
            ),
        ).toEqual(['notes.txt']);
    });

    it('accepts a version file parent and reports only genuinely extra entries', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'src', kind: 'directory' },
                    { path: 'src/index.ts', kind: 'file' },
                    { path: 'src/spare', kind: 'directory' },
                ],
                ['src/index.ts'],
            ),
        ).toEqual(['src/spare']);
    });

    it('never reports ancestors of version files as foreign', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'one', kind: 'directory' },
                    { path: 'one/two', kind: 'directory' },
                    { path: 'one/two/three', kind: 'directory' },
                ],
                ['one/two/three/file.ts'],
            ),
        ).toEqual([]);
    });

    it('rejects non-regular nodes and wrong entry kinds even at expected paths', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'src', kind: 'directory' },
                    { path: 'src/index.ts', kind: 'other' },
                    { path: 'README.md', kind: 'directory' },
                ],
                ['src/index.ts', 'README.md'],
            ),
        ).toEqual(['README.md', 'src/index.ts']);
    });

    it('reports many foreign entries in stable order', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'z-last', kind: 'directory' },
                    { path: 'src', kind: 'directory' },
                    { path: 'src/index.ts', kind: 'file' },
                    { path: 'a-first.txt', kind: 'file' },
                ],
                ['src/index.ts'],
            ),
        ).toEqual(['a-first.txt', 'z-last']);
    });

    it('normalises path separators on both sides', () => {
        expect(
            foreignSidecarPaths(
                [
                    { path: 'src', kind: 'directory' },
                    { path: 'src\\index.ts', kind: 'file' },
                    { path: 'nested\\foreign.txt', kind: 'file' },
                ],
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

    it('refuses an invalid envelope or malformed row', () => {
        expect(() => versionFilePaths({ nope: [] })).toThrow('invalid projects files response');
        expect(() => versionFilePaths({ items: [{ size: 1 }] })).toThrow(
            'invalid projects files filename at index 0',
        );
    });
});
