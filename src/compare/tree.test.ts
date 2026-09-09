import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listProjectFiles, listTreeEntries, loadProjectIgnore } from './tree';
import { EMPTY_IGNORE } from './ignore';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'versori-compare-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, contents = 'x'): void {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

function listed(): string[] {
    return listProjectFiles(root, loadProjectIgnore(root));
}

describe('listProjectFiles', () => {
    it('returns nested files as /-separated relative paths in code-point order', () => {
        write('src/index.ts');
        write('src/deep/nested.ts');
        write('README.md');
        write('logo.png');

        // Code point, not locale: uppercase sorts before lowercase.
        expect(listed()).toEqual([
            'README.md',
            'logo.png',
            'src/deep/nested.ts',
            'src/index.ts',
        ]);
    });

    it('lists files only, never the directories holding them', () => {
        write('src/index.ts');
        fs.mkdirSync(path.join(root, 'empty'), { recursive: true });

        expect(listed()).toEqual(['src/index.ts']);
    });

    it('excludes the root .versori pin but not a nested one', () => {
        write('.versori', '{"projectId":"01PROJECT"}');
        write('src/.versori', 'a nested file that happens to share the name');
        write('src/index.ts');

        expect(listed()).toEqual(['src/.versori', 'src/index.ts']);
    });

    it('excludes root versori-research entirely, contents included', () => {
        write('versori-research/asset.png');
        write('versori-research/nested/deep.png');
        write('README.md');

        expect(listed()).toEqual(['README.md']);
    });

    it('excludes root versori-compare-* checkouts so they are not diffs against themselves', () => {
        write('versori-compare-v1.2/src/index.ts');
        write('versori-compare-v1.2/README.md');
        write('src/index.ts');
        write('README.md');

        expect(listed()).toEqual(['README.md', 'src/index.ts']);
    });

    it('honours the root .gitignore while still listing the .gitignore itself', () => {
        write('.gitignore', 'node_modules/\n*.log\nbuild/\n');
        write('node_modules/x.js');
        write('a.log');
        write('build/out.js');
        write('src/index.ts');

        expect(listed()).toEqual(['.gitignore', 'src/index.ts']);
    });

    it('never lists .git internals, with or without a .gitignore', () => {
        write('.git/config', '[core]\n');
        write('src/index.ts');

        expect(listed()).toEqual(['src/index.ts']);

        write('.gitignore', '*.log\n');

        expect(listed()).toEqual(['.gitignore', 'src/index.ts']);
    });

    it('returns an empty list for a root that does not exist', () => {
        expect(listProjectFiles(path.join(root, 'missing'), EMPTY_IGNORE)).toEqual([]);
    });
});

describe('listTreeEntries', () => {
    it('returns an empty inventory for an empty folder', () => {
        expect(listTreeEntries(root)).toEqual([]);
    });

    it('lists every file, directory, and other node without filtering', () => {
        write('.git/config');
        write('.gitignore', '*.log\n');
        write('.versori');
        write('ignored.log');
        write('src/index.ts');
        write('versori-research/asset.png');
        fs.mkdirSync(path.join(root, 'empty'));
        fs.symlinkSync(path.join(root, 'src'), path.join(root, 'linked-src'));

        expect(listTreeEntries(root)).toEqual([
            { path: '.git', kind: 'directory' },
            { path: '.git/config', kind: 'file' },
            { path: '.gitignore', kind: 'file' },
            { path: '.versori', kind: 'file' },
            { path: 'empty', kind: 'directory' },
            { path: 'ignored.log', kind: 'file' },
            { path: 'linked-src', kind: 'other' },
            { path: 'src', kind: 'directory' },
            { path: 'src/index.ts', kind: 'file' },
            { path: 'versori-research', kind: 'directory' },
            { path: 'versori-research/asset.png', kind: 'file' },
        ]);
    });
});

describe('loadProjectIgnore', () => {
    it('ignores nothing but .git when the project has no .gitignore', () => {
        const ignore = loadProjectIgnore(root);

        expect(ignore.matches('node_modules/x.js', false)).toBe(false);
        expect(ignore.matches('anything', false)).toBe(false);
        expect(ignore.matches('.git/config', false)).toBe(true);
    });

    it('reads the root .gitignore and only the root one', () => {
        write('.gitignore', '*.log\n');
        write('src/.gitignore', 'index.ts\n');

        const ignore = loadProjectIgnore(root);

        expect(ignore.matches('a.log', false)).toBe(true);
        expect(ignore.matches('src/index.ts', false)).toBe(false);
    });

    it('degrades to ignoring nothing when the .gitignore cannot be read', () => {
        // An unreadable .gitignore is swallowed like a missing one, so the walk
        // lists files a sync would hide. Pinned as the current behaviour.
        fs.mkdirSync(path.join(root, '.gitignore'));
        write('a.log');

        expect(loadProjectIgnore(root).matches('a.log', false)).toBe(false);
        expect(listed()).toEqual(['a.log']);
    });
});
