/**
 * Chord display, matching each platform's own spelling.
 *
 * Modifier order is preserved exactly as the user wrote it in
 * `keybindings.json`; we do not normalise into VS Code's canonical order,
 * so the popup always agrees with the file the user edited.
 */

const MAC_GLYPHS: Record<string, string> = {
    cmd: '⌘',
    command: '⌘',
    meta: '⌘',
    win: '⌘',
    shift: '⇧',
    alt: '⌥',
    option: '⌥',
    ctrl: '⌃',
    control: '⌃',
};

const LABELS: Record<string, string> = {
    cmd: 'Cmd',
    command: 'Cmd',
    meta: 'Meta',
    win: 'Win',
    shift: 'Shift',
    alt: 'Alt',
    option: 'Alt',
    ctrl: 'Ctrl',
    control: 'Ctrl',
};

/** `'cmd+shift+d'` → `'⌘⇧D'` (macOS) or `'Cmd+Shift+D'` (elsewhere). */
export function formatChord(
    key: string,
    platform: NodeJS.Platform = process.platform,
): string {
    const mac = platform === 'darwin';

    return key
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => formatPart(part, mac))
        .join(' ');
}

/**
 * Join a description and a chord for a QuickPick row.
 *
 * An unbound action keeps its description exactly as it was — no "not set"
 * placeholder, and no dangling separator.
 */
export function appendChord(
    description: string | undefined,
    chord: string | undefined,
): string | undefined {
    if (!chord) {
        return description;
    }
    return description ? `${description} · ${chord}` : chord;
}

function formatPart(part: string, mac: boolean): string {
    const tokens = part.split('+').filter(Boolean);
    if (tokens.length === 0) {
        // `key` was something like `'+'`; show it as typed rather than blank.
        return part;
    }

    const rendered = tokens.map((token) => formatToken(token, mac));
    return mac ? rendered.join('') : rendered.join('+');
}

function formatToken(token: string, mac: boolean): string {
    const lower = token.toLowerCase();
    const modifier = mac ? MAC_GLYPHS[lower] : LABELS[lower];
    if (modifier) {
        return modifier;
    }

    return lower.length === 1
        ? lower.toUpperCase()
        : lower.charAt(0).toUpperCase() + lower.slice(1);
}
