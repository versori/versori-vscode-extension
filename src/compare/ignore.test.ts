import { describe, expect, it } from 'vitest';

import { EMPTY_IGNORE, parseGitignore } from './ignore';

/**
 * Every case here is a rule from the CLI's `pkg/utils/gitignore.go`, including
 * the places that file departs from real git. Compare Version must hide exactly
 * the files a sync hides, so the CLI's dialect is the contract, not git's.
 */

describe('parseGitignore line parsing', () => {
    it('ignores blank lines and # comments', () => {
        const ignore = parseGitignore('\n# a comment\n\n   \nnode_modules\n');

        expect(ignore.matches('node_modules', true)).toBe(true);
        expect(ignore.matches('src', true)).toBe(false);
    });

    it('trims trailing whitespace so a padded pattern still matches', () => {
        expect(parseGitignore('node_modules  \n').matches('node_modules', true)).toBe(true);
    });

    it('treats a file of only blanks and comments as ignoring nothing', () => {
        expect(parseGitignore('# nothing here\n\n').matches('anything', false)).toBe(false);
    });
});

describe('parseGitignore anchoring', () => {
    it('matches an unanchored single segment at any depth', () => {
        const ignore = parseGitignore('node_modules\n');

        expect(ignore.matches('node_modules', true)).toBe(true);
        expect(ignore.matches('a/node_modules', true)).toBe(true);
        expect(ignore.matches('a/b/node_modules/c.js', false)).toBe(true);
    });

    it('prefix-matches a leading-slash pattern from the root only', () => {
        const ignore = parseGitignore('/dist\n');

        expect(ignore.matches('dist', true)).toBe(true);
        expect(ignore.matches('dist/a.js', false)).toBe(true);
        expect(ignore.matches('src/dist', true)).toBe(false);
    });

    it('anchors any pattern containing a slash implicitly', () => {
        const ignore = parseGitignore('src/gen\n');

        expect(ignore.matches('src/gen/a.ts', false)).toBe(true);
        expect(ignore.matches('a/src/gen', true)).toBe(false);
    });
});

describe('parseGitignore directory-only patterns', () => {
    it('applies a trailing-slash pattern to directories only', () => {
        const ignore = parseGitignore('build/\n');

        expect(ignore.matches('build', true)).toBe(true);
        expect(ignore.matches('build', false)).toBe(false);
    });
});

describe('parseGitignore negation', () => {
    it('lets a later ! line rescue a file an earlier line ignored', () => {
        const ignore = parseGitignore('*.log\n!keep.log\n');

        expect(ignore.matches('a.log', false)).toBe(true);
        expect(ignore.matches('keep.log', false)).toBe(false);
    });

    it('ignores both when the ! line comes first, because the last match wins', () => {
        const ignore = parseGitignore('!keep.log\n*.log\n');

        expect(ignore.matches('a.log', false)).toBe(true);
        expect(ignore.matches('keep.log', false)).toBe(true);
    });
});

describe('parseGitignore double asterisk', () => {
    it('matches everything below a trailing **', () => {
        const ignore = parseGitignore('src/**\n');

        expect(ignore.matches('src/a/b.ts', false)).toBe(true);
        expect(ignore.matches('lib/a.ts', false)).toBe(false);
    });

    it('spans zero or more directories for a ** in the middle', () => {
        const ignore = parseGitignore('src/**/gen\n');

        expect(ignore.matches('src/gen', true)).toBe(true);
        expect(ignore.matches('src/a/gen', true)).toBe(true);
        expect(ignore.matches('src/a/b/gen', true)).toBe(true);
        expect(ignore.matches('src/a/b/other', true)).toBe(false);
    });
});

describe('parseGitignore globs', () => {
    it('matches * against a whole segment, not a prefix of one', () => {
        const ignore = parseGitignore('*.ts\n');

        expect(ignore.matches('a.ts', false)).toBe(true);
        expect(ignore.matches('a.tsx', false)).toBe(false);
    });

    it('matches ? against exactly one character', () => {
        const ignore = parseGitignore('a?.ts\n');

        expect(ignore.matches('a1.ts', false)).toBe(true);
        expect(ignore.matches('a12.ts', false)).toBe(false);
    });

    it('matches a character class against exactly its members', () => {
        const ignore = parseGitignore('[ab].ts\n');

        expect(ignore.matches('a.ts', false)).toBe(true);
        expect(ignore.matches('b.ts', false)).toBe(true);
        expect(ignore.matches('c.ts', false)).toBe(false);
    });

    it('negates a class on ^ only, so a leading ! is an ordinary member', () => {
        // Go's filepath.Match, which the CLI uses: `!` inside a class is
        // literal. This is the opposite of real git, and deliberate.
        const bang = parseGitignore('[!ab].ts\n');

        expect(bang.matches('a.ts', false)).toBe(true);
        expect(bang.matches('b.ts', false)).toBe(true);
        expect(bang.matches('!.ts', false)).toBe(true);
        expect(bang.matches('c.ts', false)).toBe(false);

        const caret = parseGitignore('[^ab].ts\n');

        expect(caret.matches('c.ts', false)).toBe(true);
        expect(caret.matches('a.ts', false)).toBe(false);
    });

    it('never matches an inverted range, which Go accepts and we must not throw on', () => {
        const ignore = parseGitignore('[z-a].ts\n');

        expect(ignore.matches('a.ts', false)).toBe(false);
        expect(ignore.matches('z.ts', false)).toBe(false);
    });

    it('matches nothing for a pattern Go rejects as ErrBadPattern', () => {
        // The CLI discards the error and carries on, so a malformed line must
        // never abort the walk and never widen the match.
        for (const pattern of ['[abc.ts', 'a\\', '[].ts', '[-a].ts', '[a-].ts']) {
            const ignore = parseGitignore(`${pattern}\n`);

            expect(() => ignore.matches('a.ts', false)).not.toThrow();
            expect(ignore.matches('a.ts', false)).toBe(false);
            expect(ignore.matches(pattern, false)).toBe(false);
        }
    });
});

describe('parseGitignore per-segment matching', () => {
    it('tests a single-segment pattern against every path component', () => {
        // matchUnanchored loops over each component for a one-segment pattern,
        // so both of these follow from the same Go rule.
        const ignore = parseGitignore('*.ts\n');

        expect(ignore.matches('a/b.ts', false)).toBe(true);
        expect(ignore.matches('a.ts/b', false)).toBe(true);
    });

    it('never lets a * inside a multi-segment pattern cross a separator', () => {
        const ignore = parseGitignore('src/*.ts\n');

        expect(ignore.matches('src/a.ts', false)).toBe(true);
        expect(ignore.matches('src/a/b.ts', false)).toBe(false);
    });
});

describe('always-ignored names', () => {
    it('ignores .git even against an explicit ! line', () => {
        expect(parseGitignore('!.git\n').matches('.git', true)).toBe(true);
    });

    it('ignores .git at any depth, and its contents', () => {
        const ignore = parseGitignore('node_modules\n');

        expect(ignore.matches('.git/config', false)).toBe(true);
        expect(ignore.matches('a/.git/config', false)).toBe(true);
    });

    it('ignores .git even with no patterns at all', () => {
        expect(EMPTY_IGNORE.matches('.git', true)).toBe(true);
        expect(EMPTY_IGNORE.matches('a/.git/config', false)).toBe(true);
    });
});

describe('EMPTY_IGNORE', () => {
    it('ignores nothing but the always-ignored names', () => {
        expect(EMPTY_IGNORE.matches('anything', false)).toBe(false);
        expect(EMPTY_IGNORE.matches('node_modules/x.js', false)).toBe(false);
    });
});
