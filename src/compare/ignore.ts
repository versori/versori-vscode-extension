/**
 * Port of the CLI's `.gitignore` matcher (`cli/pkg/utils/gitignore.go`).
 *
 * Compare Version has to hide exactly the files a sync would hide, or every
 * ignored file shows up as a spurious deletion in the diff. Matching the CLI's
 * dialect matters more than matching real git: this mirrors that file's rules,
 * including its quirks (root-level `.gitignore` only, prefix-matching anchored
 * patterns, last-match-wins).
 */
export interface IgnoreMatcher {
    matches(relativePath: string, isDir: boolean): boolean;
}

/**
 * Always ignored, checked before the pattern list, and `!` cannot bring these
 * back.
 *
 * Deliberately broader than the CLI, which tests `filepath.Base` only: this
 * matches the name in ANY path segment, so `.git/HEAD` is ignored too. The
 * walker prunes `.git` directories before descending, so the two never
 * actually disagree — and where they would, hiding git internals from a
 * project diff is what we want.
 */
const ALWAYS_IGNORED_NAMES = new Set(['.git']);

interface Pattern {
    negated: boolean;
    dirOnly: boolean;
    anchored: boolean;
    hasDoubleAsterisk: boolean;
    segments: string[];
}

export const EMPTY_IGNORE: IgnoreMatcher = {
    matches(relativePath: string): boolean {
        return isAlwaysIgnored(relativePath);
    },
};

export function parseGitignore(text: string): IgnoreMatcher {
    const patterns = text
        .split('\n')
        .map((line) => parseLine(line))
        .filter((pattern): pattern is Pattern => pattern !== undefined);

    if (patterns.length === 0) {
        return EMPTY_IGNORE;
    }

    return {
        matches(relativePath: string, isDir: boolean): boolean {
            if (isAlwaysIgnored(relativePath)) {
                return true;
            }

            const segments = toPosix(relativePath).split('/');
            let ignored = false;

            // Last match wins, so every pattern is evaluated in file order.
            for (const pattern of patterns) {
                if (patternMatches(pattern, segments, isDir)) {
                    ignored = !pattern.negated;
                }
            }

            return ignored;
        },
    };
}

function isAlwaysIgnored(relativePath: string): boolean {
    return toPosix(relativePath)
        .split('/')
        .some((segment) => ALWAYS_IGNORED_NAMES.has(segment));
}

/**
 * Normalise a relative path for matching.
 *
 * Caller contract: paths arrive as walker-built relative paths, so they are
 * never empty and never contain a doubled separator. The CLI's matcher returns
 * false for the empty root and collapses `//` via `filepath.Abs`; neither case
 * is reachable here, so neither is guarded.
 */
function toPosix(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parseLine(rawLine: string): Pattern | undefined {
    let line = rawLine.replace(/[ \t\r]+$/, '');
    if (line === '' || line.startsWith('#')) {
        return undefined;
    }

    let negated = false;
    if (line.startsWith('!')) {
        negated = true;
        line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith('/')) {
        dirOnly = true;
        line = line.slice(0, -1);
    }

    let anchored = false;
    if (line.startsWith('/')) {
        anchored = true;
        line = line.slice(1);
    } else if (line.includes('/')) {
        anchored = true;
    }

    return {
        negated,
        dirOnly,
        anchored,
        hasDoubleAsterisk: line.includes('**'),
        segments: line.split('/'),
    };
}

function patternMatches(pattern: Pattern, pathSegments: string[], isDir: boolean): boolean {
    if (pattern.dirOnly && !isDir) {
        return false;
    }
    if (pattern.hasDoubleAsterisk) {
        return matchDoubleAsterisk(pattern.segments, pathSegments);
    }
    if (pattern.anchored) {
        return matchAnchored(pattern.segments, pathSegments);
    }
    return matchUnanchored(pattern.segments, pathSegments);
}

/** Prefix match from segment 0, so `src/gen` also covers `src/gen/a.ts`. */
function matchAnchored(patternSegments: string[], pathSegments: string[]): boolean {
    if (pathSegments.length < patternSegments.length) {
        return false;
    }
    return patternSegments.every((segment, i) => matchSegment(segment, pathSegments[i]));
}

function matchUnanchored(patternSegments: string[], pathSegments: string[]): boolean {
    if (patternSegments.length === 1) {
        return pathSegments.some((segment) => matchSegment(patternSegments[0], segment));
    }

    for (let start = 0; start <= pathSegments.length - patternSegments.length; start += 1) {
        if (patternSegments.every((segment, i) => matchSegment(segment, pathSegments[start + i]))) {
            return true;
        }
    }
    return false;
}

function matchDoubleAsterisk(patternSegments: string[], pathSegments: string[]): boolean {
    if (patternSegments.length === 0) {
        return pathSegments.length === 0;
    }

    const [head, ...rest] = patternSegments;

    if (head === '**') {
        if (rest.length === 0) {
            return true;
        }
        for (let skip = 0; skip <= pathSegments.length; skip += 1) {
            if (matchDoubleAsterisk(rest, pathSegments.slice(skip))) {
                return true;
            }
        }
        return false;
    }

    if (pathSegments.length === 0 || !matchSegment(head, pathSegments[0])) {
        return false;
    }

    return matchDoubleAsterisk(rest, pathSegments.slice(1));
}

/**
 * One path component against one pattern component, following Go's
 * `filepath.Match` rather than JS RegExp conventions.
 *
 * A pattern Go rejects as `ErrBadPattern` matches nothing: the CLI discards
 * that error and carries on, so Compare must too. Returning `undefined` from
 * `segmentRegExp` — rather than throwing, or falling back to a literal — is
 * what keeps a malformed `.gitignore` from aborting a walk that sync would
 * complete.
 */
function matchSegment(pattern: string, name: string): boolean {
    const expression = segmentRegExp(pattern);
    return expression !== undefined && expression.test(name);
}

/** `undefined` for any pattern Go treats as `ErrBadPattern`. */
function segmentRegExp(pattern: string): RegExp | undefined {
    let source = '';
    let i = 0;

    while (i < pattern.length) {
        const char = pattern[i];

        if (char === '\\') {
            // Go: a trailing backslash is ErrBadPattern.
            if (i + 1 >= pattern.length) {
                return undefined;
            }
            source += escapeLiteral(pattern[i + 1]);
            i += 2;
            continue;
        }

        if (char === '*') {
            source += '[^/]*';
            i += 1;
            continue;
        }

        if (char === '?') {
            source += '[^/]';
            i += 1;
            continue;
        }

        if (char === '[') {
            const parsed = parseClass(pattern, i);
            if (parsed === undefined) {
                return undefined;
            }
            source += parsed.source;
            i = parsed.next;
            continue;
        }

        source += escapeLiteral(char);
        i += 1;
    }

    try {
        return new RegExp(`^${source}$`);
    } catch {
        // Unreachable while parseClass is correct, but Go discards
        // ErrBadPattern and so must we: never abort the walk.
        return undefined;
    }
}

interface ClassParse {
    /** Regex source matching exactly one character. */
    source: string;
    /** Index just past the closing `]`. */
    next: number;
}

/**
 * Parse a `[...]` class the way Go does, not the way JS would.
 *
 * The differences all matter here:
 *  - only `^` negates; a leading `!` is an ordinary member
 *  - the class must be non-empty, and `-` may not stand where an endpoint is
 *    due, so `[]`, `[-a]`, and `[a-]` are all ErrBadPattern
 *  - an unterminated class is ErrBadPattern
 *  - `\` escapes the next character inside the class
 *  - an inverted range like `[z-a]` is legal in Go and simply never matches,
 *    where JS would throw — so it is dropped rather than emitted
 */
function parseClass(pattern: string, open: number): ClassParse | undefined {
    let i = open + 1;

    let negated = false;
    if (pattern[i] === '^') {
        negated = true;
        i += 1;
    }

    const parts: string[] = [];
    let endpoints = 0;

    for (;;) {
        if (i >= pattern.length) {
            return undefined;
        }
        if (pattern[i] === ']' && endpoints > 0) {
            i += 1;
            break;
        }

        const lo = readClassChar(pattern, i);
        if (lo === undefined) {
            return undefined;
        }
        i = lo.next;

        let hi = lo;
        if (pattern[i] === '-') {
            const after = readClassChar(pattern, i + 1);
            if (after === undefined) {
                return undefined;
            }
            hi = after;
            i = after.next;
        }

        endpoints += 1;

        if (lo.char <= hi.char) {
            parts.push(
                lo.char === hi.char
                    ? escapeClassChar(lo.char)
                    : `${escapeClassChar(lo.char)}-${escapeClassChar(hi.char)}`,
            );
        }
    }

    if (parts.length === 0) {
        // Every range was inverted, so no character matches one. Go compares
        // `match == negated`, so a negated class that matched nothing matches.
        return { source: negated ? '[^]' : '[^\\s\\S]', next: i };
    }

    return { source: `[${negated ? '^' : ''}${parts.join('')}]`, next: i };
}

interface ClassChar {
    char: string;
    next: number;
}

/** Go's `getEsc`: rejects `-` and `]`, and honours a `\` escape. */
function readClassChar(pattern: string, i: number): ClassChar | undefined {
    if (i >= pattern.length || pattern[i] === '-' || pattern[i] === ']') {
        return undefined;
    }
    if (pattern[i] === '\\') {
        if (i + 1 >= pattern.length) {
            return undefined;
        }
        return { char: pattern[i + 1], next: i + 2 };
    }
    return { char: pattern[i], next: i + 1 };
}

/** Escape a literal character for use inside a JS character class. */
function escapeClassChar(char: string): string {
    return /[\\\]^-]/.test(char) ? `\\${char}` : char;
}

function escapeLiteral(char: string): string {
    return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
