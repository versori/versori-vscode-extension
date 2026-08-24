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
 * Always ignored by basename, whatever the patterns say. The CLI applies this
 * before its pattern list and negation cannot override it.
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
 * One path component against one pattern component, using Go's
 * `filepath.Match` rules: `*` and `?` never cross a separator, `[...]` is a
 * character class, and `\` escapes the next character.
 */
function matchSegment(pattern: string, name: string): boolean {
    return segmentRegExp(pattern).test(name);
}

function segmentRegExp(pattern: string): RegExp {
    let source = '';

    for (let i = 0; i < pattern.length; i += 1) {
        const char = pattern[i];

        if (char === '\\' && i + 1 < pattern.length) {
            i += 1;
            source += escapeLiteral(pattern[i]);
            continue;
        }

        if (char === '*') {
            source += '[^/]*';
            continue;
        }

        if (char === '?') {
            source += '[^/]';
            continue;
        }

        if (char === '[') {
            const close = pattern.indexOf(']', i + 1);
            if (close === -1) {
                // An unterminated class is a literal `[`, as filepath.Match
                // treats it (it returns ErrBadPattern; a literal is the closest
                // non-throwing reading, and sync would just not match either).
                source += '\\[';
                continue;
            }

            const body = pattern.slice(i + 1, close);
            // Go negates with `^`, glob(7) also allows `!`; a leading `^` that
            // is meant literally cannot be expressed either way, so both map to
            // a negated JS class.
            const negated = body.startsWith('^') || body.startsWith('!');
            source += `[${negated ? `^${body.slice(1)}` : body}]`;
            i = close;
            continue;
        }

        source += escapeLiteral(char);
    }

    return new RegExp(`^${source}$`);
}

function escapeLiteral(char: string): string {
    return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
