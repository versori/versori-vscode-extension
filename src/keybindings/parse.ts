/**
 * Reading VS Code's user keymap without a dependency.
 *
 * `keybindings.json` is JSONC: line and block comments plus trailing commas.
 * Both are stripped by a character scanner rather than a regex, because a
 * regex cannot tell a `//` inside a URL string from the start of a comment,
 * and would silently eat the rest of that line.
 */

const DEFAULT_PREFIX = 'versori.';

/** JSONC to JSON: drops comments and trailing commas, preserving string content. */
export function stripJsonComments(text: string): string {
    let out = '';
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
                out += char;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inString) {
            out += char;
            if (char === '\\') {
                // Escaped character: copy it verbatim so `\"` cannot end the string.
                out += next ?? '';
                i++;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            out += char;
            continue;
        }

        if (char === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        if (char === '}' || char === ']') {
            // Safe: we are outside a string, so this comma cannot be data.
            out = out.replace(/,\s*$/, '');
        }

        out += char;
    }

    return out;
}

/**
 * Command id to raw chord, for commands under `prefix`.
 *
 * Later rows win, matching VS Code's own resolution. A `-command` row is an
 * unbind and removes any chord recorded so far. Anything unparseable yields an
 * empty map: no chords is always a safe answer.
 */
export function parseKeybindings(
    text: string,
    prefix: string = DEFAULT_PREFIX,
): Map<string, string> {
    const chords = new Map<string, string>();

    let parsed: unknown;
    try {
        parsed = JSON.parse(stripJsonComments(text));
    } catch {
        return chords;
    }

    if (!Array.isArray(parsed)) {
        return chords;
    }

    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }

        const row = entry as { command?: unknown; key?: unknown };
        if (typeof row.command !== 'string') {
            continue;
        }

        if (row.command.startsWith('-')) {
            const unbound = row.command.slice(1);
            if (unbound.startsWith(prefix)) {
                chords.delete(unbound);
            }
            continue;
        }

        if (!row.command.startsWith(prefix) || typeof row.key !== 'string') {
            continue;
        }

        const key = row.key.trim();
        if (key) {
            chords.set(row.command, key);
        }
    }

    return chords;
}
