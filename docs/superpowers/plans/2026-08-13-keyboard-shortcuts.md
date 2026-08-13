# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Versori menu action a bindable VS Code command, ship no default keybindings, add a **Configure keyboard shortcuts** row that opens the Keybindings editor filtered to `versori.`, and show each user-bound chord next to its action in the popup, the status bar tooltip, and the Activity Bar launcher.

**Architecture:** A single exported action registry (`MENU_ACTIONS` in `src/commands/menu.ts`) becomes the one source of truth for label, title, project requirement, and handler. The QuickPick renders rows from it via a new pure ordering module (`src/commands/layout.ts`); `src/extension.ts` registers one VS Code command per entry from the same table, so there is exactly one implementation per action. Chords are read from the user's `keybindings.json` — VS Code exposes no `getKeybinding` API — by a small `src/keybindings/` trio: a dependency-free JSONC parser, a dependency-free chord pretty-printer, and a thin file-reading store.

**Tech Stack:** TypeScript 5.5 (strict, `Node16` modules), VS Code extension API `^1.90.0`, vitest 4 for unit tests, esbuild for bundling. No new runtime or dev dependencies.

**Spec:** [docs/superpowers/specs/2026-08-13-keyboard-shortcuts-and-jetbrains-equivalent-design.md](../specs/2026-08-13-keyboard-shortcuts-and-jetbrains-equivalent-design.md)

## Global Constraints

- **Version stays `0.1.0`.** Do not touch `version` in `package.json`.
- **No `contributes.keybindings`.** The extension ships zero default chords, including `cmd+shift+d`. Do not add the key, even commented out.
- **No new dependencies.** JSONC is parsed by hand-written code in `src/keybindings/parse.ts`. Do not add `jsonc-parser` or anything else to `package.json`.
- **No `versori.shortcuts` setting.** Chords come only from the user keymap.
- **Indentation is 4 spaces in `.ts` files, 2 spaces in `package.json`.** Match each file's existing style exactly.
- **Existing command ids are never renamed:** `versori.showMenu`, `versori.showOutput`, `versori.syncProjectHere`, `versori.deployProject`, `versori.saveVersion` keep their ids so existing user bindings survive.
- **Explorer context menus keep** Sync / Deploy / Save version on folders, calling those same three ids.
- **Out of scope, do not implement:** the JetBrains plugin, `@ext:` settings navigation, changes to dry-run/confirm/form behaviour, an Activity Bar command tree, marketplace publishing.
- **`tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`.** An orphaned import fails `npm run typecheck`; remove imports you stop using.
- **Verification commands:** `npm run typecheck` and `npm test` must both pass before every commit.
- **Commit prefixes:** every commit message starts with `feat:` or `fix:` (repo convention, see `git log`).

## Deviations from the spec (deliberate, review these first)

1. **New module `src/commands/layout.ts`** — not in the spec's architecture table. It is pure (no `vscode` import) and holds only the row ordering, so the popup layout — the part most likely to silently regress during the registry refactor — gets unit tests. The spec's testing philosophy ("parse/format carry the tests" because `vscode` modules cannot be tested here) is the reason this exists.
2. **`src/keybindings/store.ts` does not import `vscode`.** The spec's table says it does. It takes `context.globalStorageUri.fsPath` as a plain string instead, which is strictly simpler and changes no behaviour. It stays untested, as the spec says.
3. **The Configure row shows a chord if the user bound one.** The spec's table says "No chord (we do not ship one)" — read as *we ship no default*, not *suppress the user's own binding*. Hiding a chord the user deliberately set would be a surprise. All rows follow one rule: show the chord when bound, show nothing when not.

---

## File Structure

| File | Responsibility | Imports `vscode`? | Unit tested? |
|---|---|---|---|
| `src/keybindings/parse.ts` | **Create.** String-aware JSONC strip; last-wins `command → key` map; `-command` unbinds | no | yes |
| `src/keybindings/parse.test.ts` | **Create.** Comments, trailing commas, last-wins, unbind, malformed input | no | — |
| `src/keybindings/format.ts` | **Create.** Chord pretty-print per platform; `appendChord` | no | yes |
| `src/keybindings/format.test.ts` | **Create.** macOS glyphs, non-macOS labels, multi-part chords, `appendChord` | no | — |
| `src/keybindings/store.ts` | **Create.** Resolve `User/keybindings.json`, read it, expose `chordFor(command)` | no | no — I/O only |
| `src/commands/layout.ts` | **Create.** Popup row order for in-project and no-project menus | no | yes |
| `src/commands/layout.test.ts` | **Create.** Ordering, Configure row last, no-project omissions | no | — |
| `src/commands/menu.ts` | **Modify.** Export `MENU_ACTIONS` + `actionFor` + `reportError`; render rows from layout; append chords | yes | no |
| `src/extension.ts` | **Modify.** Register one command per action; Uri-or-`lastState` scope; own the `KeybindingStore` | yes | no |
| `src/statusbar.ts` | **Modify.** Append `Shortcut: <chord>` to tooltips | yes | no |
| `src/sidebar.ts` | **Modify.** Append open-menu chord to the launcher description | yes | no |
| `package.json` | **Modify.** Declare all 18 commands; retitle Sync. No `keybindings` block | — | — |
| `README.md` | **Modify.** Document no defaults, how to bind, remote caveat | — | — |

---

### Task 1: Keymap parsing

**Files:**
- Create: `src/keybindings/parse.ts`
- Test: `src/keybindings/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `stripJsonComments(text: string): string`
  - `parseKeybindings(text: string, prefix?: string): Map<string, string>` — maps command id to the raw `key` string (e.g. `'cmd+shift+d'`). Later entries win; `-versori.x` removes `versori.x`; any parse failure yields an empty map.

- [ ] **Step 1: Write the failing test**

Create `src/keybindings/parse.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { parseKeybindings, stripJsonComments } from './parse';

describe('stripJsonComments', () => {
    it('removes line and block comments', () => {
        const text = `[
            // a leading note
            { "key": "cmd+d" } /* trailing block */
        ]`;
        expect(JSON.parse(stripJsonComments(text))).toEqual([{ key: 'cmd+d' }]);
    });

    it('leaves comment-like text inside strings alone', () => {
        // The reason this is hand-written rather than a regex: a naive strip
        // eats the rest of any line containing a URL.
        const text = '[{ "command": "open", "args": "https://example.com/x" }]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([
            { command: 'open', args: 'https://example.com/x' },
        ]);
    });

    it('drops trailing commas before a closing brace or bracket', () => {
        const text = '[{ "key": "cmd+d", },]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([{ key: 'cmd+d' }]);
    });

    it('keeps a comma that is part of a string value', () => {
        const text = '[{ "key": "cmd+d", "args": "a, }" }]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([
            { key: 'cmd+d', args: 'a, }' },
        ]);
    });

    it('preserves escaped quotes inside strings', () => {
        const text = '[{ "args": "say \\"hi\\" // not a comment" }]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([
            { args: 'say "hi" // not a comment' },
        ]);
    });
});

describe('parseKeybindings', () => {
    it('collects versori chords', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "versori.deployProject" },
            { "key": "cmd+shift+l", "command": "versori.logs" }
        ]`;
        expect(parseKeybindings(text)).toEqual(
            new Map([
                ['versori.deployProject', 'cmd+shift+d'],
                ['versori.logs', 'cmd+shift+l'],
            ]),
        );
    });

    it('ignores commands from other extensions', () => {
        const text = '[{ "key": "cmd+p", "command": "workbench.action.quickOpen" }]';
        expect(parseKeybindings(text).size).toBe(0);
    });

    it('lets a later row win', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "versori.deployProject" },
            { "key": "cmd+alt+d", "command": "versori.deployProject" }
        ]`;
        expect(parseKeybindings(text).get('versori.deployProject')).toBe('cmd+alt+d');
    });

    it('treats a leading dash as an unbind', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "versori.deployProject" },
            { "key": "cmd+shift+d", "command": "-versori.deployProject" }
        ]`;
        expect(parseKeybindings(text).has('versori.deployProject')).toBe(false);
    });

    it('keeps a binding made after an unbind', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "-versori.deployProject" },
            { "key": "cmd+alt+d", "command": "versori.deployProject" }
        ]`;
        expect(parseKeybindings(text).get('versori.deployProject')).toBe('cmd+alt+d');
    });

    it('records a chord even when the row has a when clause', () => {
        // We cannot evaluate `when`, so we show the key and say so in the README.
        const text =
            '[{ "key": "cmd+shift+d", "command": "versori.deployProject", "when": "editorFocus" }]';
        expect(parseKeybindings(text).get('versori.deployProject')).toBe('cmd+shift+d');
    });

    it('ignores rows with a missing or blank key', () => {
        const text = `[
            { "command": "versori.logs" },
            { "key": "   ", "command": "versori.issues" }
        ]`;
        expect(parseKeybindings(text).size).toBe(0);
    });

    it('returns an empty map for malformed, empty, or non-array input', () => {
        expect(parseKeybindings('not json at all {').size).toBe(0);
        expect(parseKeybindings('').size).toBe(0);
        expect(parseKeybindings('{ "key": "cmd+d" }').size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/keybindings/parse.test.ts`
Expected: FAIL — `Failed to resolve import "./parse"`.

- [ ] **Step 3: Write the implementation**

Create `src/keybindings/parse.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/keybindings/parse.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/keybindings/parse.ts src/keybindings/parse.test.ts
git commit -m "feat: parse versori chords out of the user keymap"
```

---

### Task 2: Chord formatting

**Files:**
- Create: `src/keybindings/format.ts`
- Test: `src/keybindings/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `formatChord(key: string, platform?: NodeJS.Platform): string` — `'cmd+shift+d'` → `'⌘⇧D'` on `'darwin'`, `'Ctrl+Shift+D'` elsewhere.
  - `appendChord(description: string | undefined, chord: string | undefined): string | undefined` — joins with `' · '`; returns the description untouched when there is no chord.

Modifier order is **preserved as written** — do not reorder into VS Code's canonical `⌃⌥⇧⌘` sequence. The spec's own example (`cmd+shift+d` → `⌘⇧D`) is written in file order, and reordering would make the popup disagree with what the user typed into `keybindings.json`.

- [ ] **Step 1: Write the failing test**

Create `src/keybindings/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { appendChord, formatChord } from './format';

describe('formatChord on macOS', () => {
    it('renders modifiers as glyphs with no separator', () => {
        expect(formatChord('cmd+shift+d', 'darwin')).toBe('⌘⇧D');
    });

    it('accepts the meta, option, and control spellings', () => {
        expect(formatChord('meta+option+ctrl+k', 'darwin')).toBe('⌘⌥⌃K');
    });

    it('keeps two-part chords separated by a space', () => {
        expect(formatChord('cmd+k cmd+s', 'darwin')).toBe('⌘K ⌘S');
    });

    it('title-cases named keys', () => {
        expect(formatChord('cmd+escape', 'darwin')).toBe('⌘Escape');
        expect(formatChord('f5', 'darwin')).toBe('F5');
    });
});

describe('formatChord off macOS', () => {
    it('renders title-cased modifiers joined by plus', () => {
        expect(formatChord('ctrl+shift+d', 'win32')).toBe('Ctrl+Shift+D');
        expect(formatChord('ctrl+alt+l', 'linux')).toBe('Ctrl+Alt+L');
    });

    it('keeps two-part chords separated by a space', () => {
        expect(formatChord('ctrl+k ctrl+s', 'win32')).toBe('Ctrl+K Ctrl+S');
    });
});

describe('appendChord', () => {
    it('appends the chord after a middot', () => {
        expect(appendChord('dry run by default', '⌘⇧D')).toBe('dry run by default · ⌘⇧D');
    });

    it('leaves an unbound description untouched', () => {
        expect(appendChord('dry run by default', undefined)).toBe('dry run by default');
    });

    it('adds no separator when there is no description', () => {
        expect(appendChord(undefined, '⌘⇧D')).toBe('⌘⇧D');
    });

    it('returns undefined when there is neither', () => {
        expect(appendChord(undefined, undefined)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/keybindings/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the implementation**

Create `src/keybindings/format.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/keybindings/format.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/keybindings/format.ts src/keybindings/format.test.ts
git commit -m "feat: pretty-print keyboard chords per platform"
```

---

### Task 3: Keymap store

**Files:**
- Create: `src/keybindings/store.ts`

**Interfaces:**
- Consumes: `parseKeybindings` (Task 1), `formatChord` (Task 2).
- Produces: `class KeybindingStore` with
  - `constructor(globalStorageFsPath: string, platform?: NodeJS.Platform)`
  - `refresh(): void` — re-read the keymap file
  - `chordFor(command: string): string | undefined` — pretty-printed chord, or `undefined` when unbound

No unit test: this file is filesystem I/O and a two-line path join. Its logic lives in Tasks 1 and 2, which are tested. Verification here is `npm run typecheck` plus the manual pass in Task 8.

- [ ] **Step 1: Write the implementation**

Create `src/keybindings/store.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

import { formatChord } from './format';
import { parseKeybindings } from './parse';

/**
 * The user's Versori chords, read straight from `keybindings.json`.
 *
 * VS Code exposes no API for "what is bound to this command", so the keymap
 * file is read directly. It is small and read only when a surface is being
 * rebuilt, which is why there is no watcher: binding a key and reopening the
 * menu is enough, with no window reload.
 *
 * On a remote workspace this reads the *remote* keymap, which may not be the
 * chords the client actually sends. Showing what we can read is honest; the
 * README documents the limitation.
 */
export class KeybindingStore {
    private chords = new Map<string, string>();

    /**
     * @param globalStorageFsPath `ExtensionContext.globalStorageUri.fsPath`,
     *     i.e. `…/User/globalStorage/<publisher>.<name>`.
     */
    constructor(
        private readonly globalStorageFsPath: string,
        private readonly platform: NodeJS.Platform = process.platform,
    ) {
        this.refresh();
    }

    /** Re-read the keymap. Call before rebuilding any surface that shows chords. */
    refresh(): void {
        try {
            const text = fs.readFileSync(this.keymapPath(), 'utf8');
            this.chords = parseKeybindings(text);
        } catch {
            // Missing or unreadable keymap: the user has bound nothing we can see.
            this.chords = new Map();
        }
    }

    /** Display chord for a command, or undefined when it is unbound. */
    chordFor(command: string): string | undefined {
        const key = this.chords.get(command);
        return key ? formatChord(key, this.platform) : undefined;
    }

    private keymapPath(): string {
        // globalStorage/<publisher>.<name> → up two levels is the `User` directory.
        return path.resolve(this.globalStorageFsPath, '..', '..', 'keybindings.json');
    }
}
```

- [ ] **Step 2: Verify it compiles and the suite still passes**

Run: `npm run typecheck && npm test`
Expected: typecheck silent; vitest reports all existing suites plus Tasks 1–2 passing.

- [ ] **Step 3: Commit**

```bash
git add src/keybindings/store.ts
git commit -m "feat: read the user keymap for versori chords"
```

---

### Task 4: Popup row ordering

**Files:**
- Create: `src/commands/layout.ts`
- Test: `src/commands/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type MenuRow = { kind: 'section'; label: string } | { kind: 'notice' } | { kind: 'action'; command: string }`
  - `menuLayout(inProject: boolean): MenuRow[]`

The section labels and row order are exactly today's, taken from `buildItems` in `src/commands/menu.ts`. The only change is the new **Configure keyboard shortcuts** row, last under **Context**, in both layouts.

- [ ] **Step 1: Write the failing test**

Create `src/commands/layout.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { MenuRow, menuLayout } from './layout';

function commands(rows: MenuRow[]): string[] {
    return rows.flatMap((row) => (row.kind === 'action' ? [row.command] : []));
}

function sections(rows: MenuRow[]): string[] {
    return rows.flatMap((row) => (row.kind === 'section' ? [row.label] : []));
}

describe('menuLayout in a project', () => {
    const rows = menuLayout(true);

    it('keeps the established section order', () => {
        expect(sections(rows)).toEqual([
            'Project management',
            'KV',
            'Connectors and connections',
            'Users and variables',
            'Observe',
            'Context',
        ]);
    });

    it('lists every project action', () => {
        expect(commands(rows)).toEqual([
            'versori.deployProject',
            'versori.saveVersion',
            'versori.syncProjectHere',
            'versori.showVersions',
            'versori.resources',
            'versori.kvEntries',
            'versori.kvStores',
            'versori.connectors',
            'versori.staticConnections',
            'versori.connections',
            'versori.activations',
            'versori.variables',
            'versori.logs',
            'versori.issues',
            'versori.switchContext',
            'versori.showOutput',
            'versori.configureKeybindings',
        ]);
    });

    it('shows no no-project notice', () => {
        expect(rows.some((row) => row.kind === 'notice')).toBe(false);
    });

    it('never lists the menu command as a row inside the menu', () => {
        expect(commands(rows)).not.toContain('versori.showMenu');
    });
});

describe('menuLayout outside a project', () => {
    const rows = menuLayout(false);

    it('opens with the notice', () => {
        expect(rows[0]).toEqual({ kind: 'notice' });
    });

    it('offers only the actions that work without a project', () => {
        expect(commands(rows)).toEqual([
            'versori.syncProjectHere',
            'versori.kvStores',
            'versori.connections',
            'versori.switchContext',
            'versori.showOutput',
            'versori.configureKeybindings',
        ]);
    });

    it('uses the narrower section labels', () => {
        expect(sections(rows)).toEqual([
            'Project management',
            'KV',
            'Connections',
            'Context',
        ]);
    });
});

describe('both layouts', () => {
    it('end with the configure row, which is always reachable', () => {
        for (const rows of [menuLayout(true), menuLayout(false)]) {
            expect(rows[rows.length - 1]).toEqual({
                kind: 'action',
                command: 'versori.configureKeybindings',
            });
        }
    });

    it('list each command at most once', () => {
        for (const rows of [menuLayout(true), menuLayout(false)]) {
            const listed = commands(rows);
            expect(new Set(listed).size).toBe(listed.length);
        }
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/commands/layout.test.ts`
Expected: FAIL — `Failed to resolve import "./layout"`.

- [ ] **Step 3: Write the implementation**

Create `src/commands/layout.ts`:

```typescript
/**
 * The order of rows in the Versori QuickPick.
 *
 * Kept free of `vscode` so the layout — the part most likely to regress when
 * actions are added — is unit tested, while `menu.ts` stays responsible only
 * for turning these rows into QuickPick items.
 */
export type MenuRow =
    | { kind: 'section'; label: string }
    | { kind: 'notice' }
    | { kind: 'action'; command: string };

function section(label: string): MenuRow {
    return { kind: 'section', label };
}

function action(command: string): MenuRow {
    return { kind: 'action', command };
}

/**
 * Rows for the root menu.
 *
 * The Context group is identical in both layouts, and always ends with
 * Configure keyboard shortcuts — a user with no project must still be able to
 * reach the Keybindings editor.
 */
export function menuLayout(inProject: boolean): MenuRow[] {
    const context: MenuRow[] = [
        section('Context'),
        action('versori.switchContext'),
        action('versori.showOutput'),
        action('versori.configureKeybindings'),
    ];

    if (!inProject) {
        return [
            { kind: 'notice' },
            section('Project management'),
            action('versori.syncProjectHere'),
            section('KV'),
            action('versori.kvStores'),
            section('Connections'),
            action('versori.connections'),
            ...context,
        ];
    }

    return [
        section('Project management'),
        action('versori.deployProject'),
        action('versori.saveVersion'),
        action('versori.syncProjectHere'),
        action('versori.showVersions'),
        action('versori.resources'),
        section('KV'),
        action('versori.kvEntries'),
        action('versori.kvStores'),
        section('Connectors and connections'),
        action('versori.connectors'),
        action('versori.staticConnections'),
        action('versori.connections'),
        section('Users and variables'),
        action('versori.activations'),
        action('versori.variables'),
        section('Observe'),
        action('versori.logs'),
        action('versori.issues'),
        ...context,
    ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/commands/layout.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/commands/layout.ts src/commands/layout.test.ts
git commit -m "feat: describe the versori menu layout as data"
```

---

### Task 5: Action registry and chords in the popup

**Files:**
- Modify: `src/commands/menu.ts` (rewrite `MenuDeps`, `buildItems`, `reportError`; add `MenuAction`, `MENU_ACTIONS`, `actionFor`)
- Modify: `src/extension.ts:30-90` (create the `KeybindingStore`, pass `chordFor` into `showMenu`)

**Interfaces:**
- Consumes: `menuLayout`, `MenuRow` (Task 4); `appendChord` (Task 2); `KeybindingStore` (Task 3).
- Produces:
  - `interface MenuAction { command: string; title: string; label: string; description?: string | ((state: ResolvedState) => string | undefined); needsProject: boolean; run: (deps: MenuDeps, popup: PopupSession) => Promise<'menu' | 'close'>; }`
  - `const MENU_ACTIONS: MenuAction[]`
  - `function actionFor(command: string): MenuAction | undefined`
  - `async function reportError(output: vscode.OutputChannel, err: unknown): Promise<void>` (was private, and took `MenuDeps`)
  - `MenuDeps` gains `chordFor: (command: string) => string | undefined`

`title` is the human name (`'Deploy Project'`). It is the heading of the "no synced project" message in Task 6 and mirrors the `Versori: <title>` strings written into `package.json`.

This task is a behaviour-preserving refactor plus chords. The popup must look identical apart from appended chords.

- [ ] **Step 1: Add the chord source and the registry types to `menu.ts`**

In `src/commands/menu.ts`, add these imports next to the existing ones:

```typescript
import { appendChord } from '../keybindings/format';
import { MenuRow, menuLayout } from './layout';
```

Extend `MenuDeps` (currently at `src/commands/menu.ts:22-32`) with one field:

```typescript
export interface MenuDeps {
    /** Absolute path to the versori binary. */
    bin: string;
    /** State for the file the user is looking at. */
    state: ResolvedState;
    output: vscode.OutputChannel;
    /** Called after the active context changes, so the status bar can refresh. */
    onContextChanged: () => void;
    /** Reads the latest resolver state before the root menu is rendered. */
    getState: () => ResolvedState;
    /** Chord the user bound to a command, already pretty-printed. */
    chordFor: (command: string) => string | undefined;
}
```

- [ ] **Step 2: Replace `buildItems` with the registry**

Delete the whole existing `buildItems` function (`src/commands/menu.ts:82-191`) and put this in its place. `section` and `ActionItem` above it stay as they are.

```typescript
/**
 * One menu action: a QuickPick row *and* a bindable command.
 *
 * The registry is the single source of truth. `buildItems` renders it into the
 * popup and `extension.ts` registers a command per entry from the same list,
 * so keyboard, Command Palette, and popup always run identical code.
 */
export interface MenuAction {
    /** Command id, stable forever — users bind these. */
    command: string;
    /** Human name; the Palette shows `Versori: <title>`. */
    title: string;
    /** QuickPick label, including its `$(icon)`. */
    label: string;
    description?: string | ((state: ResolvedState) => string | undefined);
    /** Needs a resolved project; without one the command reports it and stops. */
    needsProject: boolean;
    run: (deps: MenuDeps, popup: PopupSession) => Promise<'menu' | 'close'>;
}

export const MENU_ACTIONS: MenuAction[] = [
    {
        command: 'versori.deployProject',
        title: 'Deploy Project',
        label: '$(rocket) Deploy...',
        description: 'dry run by default',
        needsProject: true,
        run: (deps, popup) => openDeployForm(deps, popup),
    },
    {
        command: 'versori.saveVersion',
        title: 'Save Version',
        label: '$(save) Save version...',
        description: 'checkpoint only — does not deploy',
        needsProject: true,
        run: (deps, popup) => openSaveVersionForm(deps, popup),
    },
    {
        command: 'versori.syncProjectHere',
        title: 'Sync',
        label: '$(cloud-download) Sync...',
        description: 'pull remote files — dry run by default',
        needsProject: false,
        run: openSyncForm,
    },
    {
        command: 'versori.showVersions',
        title: 'Versions',
        label: '$(history) Versions',
        needsProject: true,
        run: showVersions,
    },
    {
        command: 'versori.resources',
        title: 'Resources',
        label: '$(dashboard) Resources...',
        description: 'CPU/memory/storage sliders, scaling, static IP',
        needsProject: true,
        run: (deps, popup) => openResourcesForm(deps, popup),
    },
    {
        command: 'versori.kvEntries',
        title: 'KV Entries',
        label: '$(database) KV entries',
        description: 'read, set, edit, delete, and wipe with confirmation',
        needsProject: true,
        run: showKvEntries,
    },
    {
        command: 'versori.kvStores',
        title: 'KV Stores',
        label: '$(database) KV stores',
        description: 'organisation-wide, grouped by project when possible',
        needsProject: false,
        run: showKvStores,
    },
    {
        command: 'versori.connectors',
        title: 'Connectors',
        label: '$(plug) Connectors',
        needsProject: true,
        run: showConnectors,
    },
    {
        command: 'versori.staticConnections',
        title: 'Static Connections',
        label: '$(key) Static connections',
        description: 'connections bound to an environment',
        needsProject: true,
        run: showStaticConnections,
    },
    {
        command: 'versori.connections',
        title: 'Connections',
        label: '$(plug) Connections',
        description: 'organisation-wide',
        needsProject: false,
        run: showConnections,
    },
    {
        command: 'versori.activations',
        title: 'Activations',
        label: '$(organization) Activations',
        description: 'users, activation connections, and runtime variables',
        needsProject: true,
        run: showActivations,
    },
    {
        command: 'versori.variables',
        title: 'Variables',
        label: '$(symbol-variable) Variables',
        description: 'project activation-variable schema',
        needsProject: true,
        run: showVariables,
    },
    {
        command: 'versori.logs',
        title: 'Logs',
        label: '$(output) Logs',
        needsProject: true,
        run: showLogs,
    },
    {
        command: 'versori.issues',
        title: 'Issues',
        label: '$(warning) Issues',
        needsProject: true,
        run: showIssues,
    },
    {
        command: 'versori.switchContext',
        title: 'Switch Context',
        label: '$(gear) Switch context...',
        description: (state) => state.activeContextName ?? 'none active',
        needsProject: false,
        run: switchContext,
    },
    {
        command: 'versori.showOutput',
        title: 'Show Output',
        label: '$(list-flat) Show output log',
        needsProject: false,
        run: async (deps, popup) => {
            popup.close();
            deps.output.show(true);
            return 'close';
        },
    },
    {
        command: 'versori.configureKeybindings',
        title: 'Configure Keyboard Shortcuts',
        label: '$(keyboard) Configure keyboard shortcuts',
        needsProject: false,
        run: configureKeybindings,
    },
];

const ACTIONS_BY_COMMAND = new Map(MENU_ACTIONS.map((action) => [action.command, action]));

export function actionFor(command: string): MenuAction | undefined {
    return ACTIONS_BY_COMMAND.get(command);
}

function buildItems(deps: MenuDeps): ActionItem[] {
    const inProject = Boolean(deps.state.projectId && deps.state.projectDir);

    return menuLayout(inProject).flatMap((row) => {
        const item = rowItem(row, deps);
        return item ? [item] : [];
    });
}

function rowItem(row: MenuRow, deps: MenuDeps): ActionItem | undefined {
    if (row.kind === 'section') {
        return section(row.label);
    }

    if (row.kind === 'notice') {
        return {
            label: '$(info) No synced project for this file',
            detail: 'Open a file inside a directory containing a .versori to enable project actions.',
        };
    }

    const action = actionFor(row.command);
    if (!action) {
        return undefined;
    }

    const described =
        typeof action.description === 'function'
            ? action.description(deps.state)
            : action.description;

    return {
        label: action.label,
        description: appendChord(described, deps.chordFor(action.command)),
        run: action.run,
    };
}

/**
 * Open the Keybindings editor filtered to this extension's commands.
 *
 * Settings (`@ext:`) is deliberately not used: that page cannot assign keys.
 */
async function configureKeybindings(
    _deps: MenuDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    popup.close();
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'versori.');
    return 'close';
}
```

- [ ] **Step 3: Make `reportError` reusable**

`extension.ts` needs the same error reporting for command invocations. Change the signature at `src/commands/menu.ts` from `async function reportError(deps: MenuDeps, err: unknown)` to:

```typescript
export async function reportError(
    output: vscode.OutputChannel,
    err: unknown,
): Promise<void> {
    const message = err instanceof CliError ? err.stderr || err.message : String(err);

    if (err instanceof CliError) {
        output.appendLine(`$ versori ${err.argv.join(' ')}`);
    }
    output.appendLine(message);
    output.appendLine('');

    const action = await vscode.window.showErrorMessage(
        `Versori: ${firstLine(message)}`,
        'Show output',
    );
    if (action === 'Show output') {
        output.show(true);
    }
}
```

Update its only existing call site inside `showMenu` (`src/commands/menu.ts:65`) from `await reportError(menuDeps, err);` to:

```typescript
await reportError(menuDeps.output, err);
```

- [ ] **Step 4: Feed chords in from `extension.ts`**

In `src/extension.ts`, add the import:

```typescript
import { KeybindingStore } from './keybindings/store';
```

Create the store immediately after the output channel is created (`src/extension.ts:23-24`):

```typescript
    const keybindings = new KeybindingStore(context.globalStorageUri.fsPath);
    const chordFor = (command: string): string | undefined => keybindings.chordFor(command);
```

In `refresh()` (`src/extension.ts:51`), re-read the keymap first so the status bar tooltip and sidebar pick up new bindings without a reload — add this as the first line of the function body:

```typescript
        keybindings.refresh();
```

In the `MENU_COMMAND` handler (`src/extension.ts:75-89`), refresh before opening and pass `chordFor`:

```typescript
        vscode.commands.registerCommand(MENU_COMMAND, async () => {
            const bin = cliPath();
            if (!bin) {
                await promptForCliPath();
                return;
            }

            keybindings.refresh();
            await showMenu({
                bin,
                state: lastState,
                output,
                onContextChanged: invalidateAndRefresh,
                getState: () => lastState,
                chordFor,
            });
        }),
```

- [ ] **Step 5: Verify the build and the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck silent; every suite passes, including the Task 4 layout tests that now describe the shipped menu.

- [ ] **Step 6: Commit**

```bash
git add src/commands/menu.ts src/extension.ts
git commit -m "feat: drive the versori menu from a shared action registry"
```

---

### Task 6: One command per action

**Files:**
- Modify: `src/extension.ts` (register from `MENU_ACTIONS`; Uri-or-`lastState` scope; drop the standalone `showOutput` registration)
- Modify: `package.json:38-59` (`contributes.commands`)

**Interfaces:**
- Consumes: `MENU_ACTIONS`, `MenuAction`, `actionFor`, `reportError` (Task 5).
- Produces: nothing for later tasks.

Rules this task implements, from the spec:
- A command invoked **with** a folder `Uri` (Explorer) scopes to that folder — today's behaviour, unchanged.
- A command invoked **without** one (keyboard, Palette, popup) scopes to `lastState`.
- A command needing a project, invoked with no project in `lastState`, shows the same "no synced project" information the popup shows. It never invents a project.

- [ ] **Step 1: Update the `menu` imports in `extension.ts`**

Replace `import { showMenu } from './commands/menu';` with:

```typescript
import { MENU_ACTIONS, MenuAction, actionFor, reportError, showMenu } from './commands/menu';
```

- [ ] **Step 2: Add the shared invocation path**

Inside `activate`, after the `MENU_COMMAND` registration block, add:

```typescript
    /** Everything a menu action needs when it is run as a command. */
    const menuDeps = (bin: string): MenuDeps => ({
        bin,
        state: lastState,
        output,
        onContextChanged: invalidateAndRefresh,
        getState: () => lastState,
        chordFor,
    });

    /**
     * Run a menu action outside the popup.
     *
     * Scope is `lastState` — the file the user is looking at — which is exactly
     * what the popup would have used. A project action with no project says so
     * rather than guessing one.
     */
    const runAction = async (action: MenuAction): Promise<void> => {
        const bin = cliPath();
        if (!bin) {
            await promptForCliPath();
            return;
        }

        keybindings.refresh();

        const popup = new PopupSession();
        try {
            if (action.needsProject && !(lastState.projectId && lastState.projectDir)) {
                await showContextMessage(
                    popup,
                    action.title,
                    '$(info) No synced project for this file',
                    'Open a file inside a directory containing a .versori to enable project actions.',
                );
                return;
            }

            await action.run(menuDeps(bin), popup);
        } catch (err) {
            popup.close();
            await reportError(output, err);
        } finally {
            popup.dispose();
        }
    };
```

Add `MenuDeps` to the menu import from Step 1 so the helper's return type resolves:

```typescript
import {
    MENU_ACTIONS,
    MenuAction,
    MenuDeps,
    actionFor,
    reportError,
    showMenu,
} from './commands/menu';
```

- [ ] **Step 3: Register every action, and delete the standalone `showOutput` registration**

Remove this block entirely (`src/extension.ts:92-94`) — `versori.showOutput` is now a registry entry, and registering an id twice throws at activation:

```typescript
    context.subscriptions.push(
        vscode.commands.registerCommand('versori.showOutput', () => output.show(true)),
    );
```

In its place:

```typescript
    // Explorer entries own their own registration below: they take a folder Uri.
    const EXPLORER_COMMANDS = new Set([
        CONTEXT_SYNC_COMMAND,
        CONTEXT_DEPLOY_COMMAND,
        CONTEXT_SAVE_COMMAND,
    ]);

    for (const action of MENU_ACTIONS) {
        if (EXPLORER_COMMANDS.has(action.command)) {
            continue;
        }
        context.subscriptions.push(
            vscode.commands.registerCommand(action.command, () => runAction(action)),
        );
    }
```

- [ ] **Step 4: Make the three Explorer commands work without a Uri**

Change the sync registration (`src/extension.ts:97`) so a keyboard or Palette invocation falls through to the shared path instead of demanding an Explorer folder:

```typescript
        vscode.commands.registerCommand(CONTEXT_SYNC_COMMAND, async (uri?: vscode.Uri) => {
            if (!uri) {
                // Keyboard or Palette: same scope the popup would have used.
                await runAction(actionFor(CONTEXT_SYNC_COMMAND)!);
                return;
            }

            const bin = cliPath();
            if (!bin) {
                await promptForCliPath();
                return;
            }

            const popup = new PopupSession();
            try {
                const scope = scopeForUri(uri);
                if (!scope) {
                    await showContextMessage(
                        popup,
                        'Sync project',
                        '$(info) Select a local Explorer folder',
                        'This command needs a folder from the local file explorer.',
                    );
                    return;
                }

                await openSyncForm(
                    {
                        bin,
                        state: resolver.resolve(scope.dir, scope.boundary),
                        output,
                        onContextChanged: invalidateAndRefresh,
                    },
                    popup,
                    {
                        preferredDirectory: scope.dir,
                        workspaceRoot: scope.boundary,
                        hideCreateSubfolder: true,
                    },
                );
            } finally {
                popup.dispose();
            }
        }),
```

Change the deploy and save registrations (`src/extension.ts:135-154`) the same way:

```typescript
        vscode.commands.registerCommand(CONTEXT_DEPLOY_COMMAND, async (uri?: vscode.Uri) => {
            if (!uri) {
                await runAction(actionFor(CONTEXT_DEPLOY_COMMAND)!);
                return;
            }
            await runProjectContextForm(
                uri,
                'Deploy project',
                openDeployForm,
                cliPath,
                resolver,
                output,
            );
        }),
        vscode.commands.registerCommand(CONTEXT_SAVE_COMMAND, async (uri?: vscode.Uri) => {
            if (!uri) {
                await runAction(actionFor(CONTEXT_SAVE_COMMAND)!);
                return;
            }
            await runProjectContextForm(
                uri,
                'Save version',
                openSaveVersionForm,
                cliPath,
                resolver,
                output,
            );
        }),
```

- [ ] **Step 5: Declare every command in `package.json`**

Replace the whole `contributes.commands` array (`package.json:38-59`) with the list below. Titles mirror each action's `title`, so the Palette and the popup agree. **Do not add a `keybindings` block.**

```json
    "commands": [
      {
        "command": "versori.showMenu",
        "title": "Versori: Show Menu"
      },
      {
        "command": "versori.deployProject",
        "title": "Versori: Deploy Project"
      },
      {
        "command": "versori.saveVersion",
        "title": "Versori: Save Version"
      },
      {
        "command": "versori.syncProjectHere",
        "title": "Versori: Sync"
      },
      {
        "command": "versori.showVersions",
        "title": "Versori: Versions"
      },
      {
        "command": "versori.resources",
        "title": "Versori: Resources"
      },
      {
        "command": "versori.kvEntries",
        "title": "Versori: KV Entries"
      },
      {
        "command": "versori.kvStores",
        "title": "Versori: KV Stores"
      },
      {
        "command": "versori.connectors",
        "title": "Versori: Connectors"
      },
      {
        "command": "versori.staticConnections",
        "title": "Versori: Static Connections"
      },
      {
        "command": "versori.connections",
        "title": "Versori: Connections"
      },
      {
        "command": "versori.activations",
        "title": "Versori: Activations"
      },
      {
        "command": "versori.variables",
        "title": "Versori: Variables"
      },
      {
        "command": "versori.logs",
        "title": "Versori: Logs"
      },
      {
        "command": "versori.issues",
        "title": "Versori: Issues"
      },
      {
        "command": "versori.switchContext",
        "title": "Versori: Switch Context"
      },
      {
        "command": "versori.showOutput",
        "title": "Versori: Show Output"
      },
      {
        "command": "versori.configureKeybindings",
        "title": "Versori: Configure Keyboard Shortcuts"
      }
    ],
```

- [ ] **Step 6: Confirm no `keybindings` contribution and no version bump crept in**

Run: `node -e "const p=require('./package.json'); console.log('keybindings:', p.contributes.keybindings); console.log('commands:', p.contributes.commands.length); console.log('version:', p.version)"`
Expected: `keybindings: undefined`, `commands: 18`, `version: 0.1.0`.

- [ ] **Step 7: Verify the build and the suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck silent, all suites pass, esbuild writes `dist/extension.js`.

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: make every versori menu action a bindable command"
```

---

### Task 7: Open-menu chord on the status bar and Activity Bar

**Files:**
- Modify: `src/statusbar.ts` (constructor takes a chord getter; `markdown` appends a `Shortcut:` line)
- Modify: `src/sidebar.ts` (constructor takes a chord getter; launcher description gains the chord)
- Modify: `src/extension.ts:30-41` (pass the getters)

**Interfaces:**
- Consumes: `appendChord` (Task 2), the `chordFor` closure (Task 5).
- Produces: nothing for later tasks.

Only `versori.showMenu`'s chord appears on these two surfaces — they are launchers for the menu, not command lists.

- [ ] **Step 1: Append the shortcut line to status bar tooltips**

In `src/statusbar.ts`, change the constructor to take the chord getter:

```typescript
    constructor(
        commandId: string,
        private readonly menuChord: () => string | undefined,
    ) {
        this.item = vscode.window.createStatusBarItem(
            'versori.context',
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.item.name = 'Versori';
        this.item.command = commandId;
        this.item.show();
    }
```

Make `markdown` a private method so every tooltip picks the chord up in one place — CLI-missing included, because the shortcut still opens the same prompt there. Delete the module-level `markdown` function at the bottom of the file and add this method to the class, just above `dispose()`:

```typescript
    /**
     * Tooltip body, with the open-menu chord as a final line when the user has
     * bound one. Every tooltip goes through here, so no surface can drift.
     */
    private markdown(lines: string[]): vscode.MarkdownString {
        const chord = this.menuChord();
        const body = chord ? [...lines, '', `Shortcut: ${chord}`] : lines;

        const md = new vscode.MarkdownString(body.join('\n'));
        md.isTrusted = false;
        return md;
    }
```

Then change all four `markdown([...])` call sites in `renderCliMissing` and `render` to `this.markdown([...])`. There are four: `src/statusbar.ts:33`, `:51`, `:69`, and `:82`.

- [ ] **Step 2: Append the chord to the Activity Bar launcher**

In `src/sidebar.ts`, add the import:

```typescript
import { appendChord } from './keybindings/format';
```

Take the chord getter as a third constructor parameter:

```typescript
    constructor(
        private readonly menuCommand: string,
        private readonly getState: () => ResolvedState,
        private readonly menuChord: () => string | undefined,
    ) {}
```

And append it to the description in `getChildren` (`src/sidebar.ts:48`):

```typescript
        item.description = appendChord(sidebarDescription(state), this.menuChord());
```

- [ ] **Step 3: Pass the getters in `extension.ts`**

Update the two constructions (`src/extension.ts:30` and `:37`):

```typescript
    const statusBar = new VersoriStatusBar(MENU_COMMAND, () => chordFor(MENU_COMMAND));
```

```typescript
    const sidebar = new VersoriSidebar(MENU_COMMAND, () => lastState, () => chordFor(MENU_COMMAND));
```

Both are constructed after `chordFor` (added in Task 5, immediately after the output channel), so the closure is in scope.

- [ ] **Step 4: Verify the build and the suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck silent, all suites pass, bundle written.

- [ ] **Step 5: Commit**

```bash
git add src/statusbar.ts src/sidebar.ts src/extension.ts
git commit -m "feat: show the open-menu chord on the status bar and sidebar"
```

---

### Task 8: Documentation and manual verification

**Files:**
- Modify: `README.md` (new section before `## Setup` at `README.md:174`)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Document the shortcut behaviour**

Insert this section into `README.md` immediately before the `## Setup` heading (currently `README.md:174`):

```markdown
## Keyboard shortcuts

Every menu action is a command, so all of them can be bound to a key. The extension ships
**no default shortcuts** — nothing is taken from your keymap until you choose it.

To bind one, open the Versori menu and pick **Configure keyboard shortcuts** (the last row,
always present). That opens VS Code's Keyboard Shortcuts editor filtered to `versori.`, listing
every action including **Versori: Show Menu**. You can also reach them all from the Command
Palette by typing `Versori:`.

Once bound, the chord is shown next to its action:

- in the menu, after the row's description — `Deploy...  dry run by default · ⌘⇧D`
- on the status bar tooltip and the Activity Bar launcher, for **Show Menu** only

Chords are read from your `keybindings.json` when the menu opens, so binding a key and
reopening the menu is enough — no window reload.

Two limitations worth knowing:

- A binding with a `when` clause is shown as if it always applies. The extension reads the
  keymap file and cannot evaluate `when`.
- Over Remote SSH, the keymap that is read is the **remote** one, which may not be where your
  shortcuts live. The actions still work; only the displayed chord may be missing or wrong.

Invoked from the keyboard or the Command Palette, an action targets the file you are looking at
— the same project the status bar names. Deploy, Sync, and Save version invoked from the
Explorer's right-click menu target the folder you clicked instead. A project action with no
synced project reports that rather than picking one for you.
```

- [ ] **Step 2: Run the full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck silent; all suites pass; `dist/extension.js` written.

- [ ] **Step 3: Manual pass in an Extension Development Host**

Press <kbd>F5</kbd> and work through every item. Fix and re-verify anything that fails before committing.

- [ ] Open a file inside a synced project. The menu shows all sections and, last under **Context**, **Configure keyboard shortcuts**.
- [ ] Pick **Configure keyboard shortcuts**. The popup closes and the Keyboard Shortcuts editor opens, filtered to `versori.`, listing 18 commands with no chord assigned to any of them.
- [ ] Bind `versori.deployProject` to `cmd+shift+d` (`ctrl+shift+d` off macOS). Reopen the menu **without reloading the window**: the Deploy row reads `dry run by default · ⌘⇧D`.
- [ ] Press that chord with the popup closed. The deploy form opens for the project the status bar names.
- [ ] Unbind it. Reopen the menu: the description is back to `dry run by default`, with no separator and no "not set".
- [ ] Bind `versori.showMenu` to `cmd+shift+m`. Hover the status bar item: the tooltip ends with `Shortcut: ⌘⇧M`. The Activity Bar launcher description reads `<context> · <project> · ⌘⇧M`.
- [ ] Open a file **outside** any synced project. The menu shows the no-project notice, Sync / KV stores / Connections, and still ends with **Configure keyboard shortcuts**.
- [ ] With no project resolved, run **Versori: Logs** from the Command Palette. It reports "No synced project for this file" and runs no CLI command.
- [ ] Right-click a project folder in the Explorer → **Deploy**. It still targets that folder, not the active editor's project.
- [ ] Run **Versori: Sync** from the Palette. It opens the normal sync form (project picker, subfolder choice), not the Explorer-scoped variant.
- [ ] Run **Versori: Show Output** from the Palette. The Versori output channel opens.
- [ ] Hand-edit `keybindings.json` to be invalid (delete a closing brace). Reopen the menu: rows render with no chords and nothing errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "feat: document versori keyboard shortcuts"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Every menu action a bindable command | 5 (registry), 6 (registration + `package.json`) |
| No default keybindings shipped | 6 (Global Constraints; verified in Step 6) |
| Configure row opens Keybindings filtered to `versori.` | 5 (`configureKeybindings`), 4 (row placed last) |
| Chords shown only where bound, next to the action | 5 (popup), 7 (status bar, sidebar) |
| Existing ids unchanged; Explorer menus unchanged | 6 (Steps 3–4) |
| `Uri` scope vs `lastState` scope | 6 (Step 4) |
| Project action with no project reports it | 6 (Step 2, `needsProject`) |
| JSONC parse, no new dependency, last wins, `-command` unbinds | 1 |
| `when` clauses ignored, still shown | 1 (test), 8 (README) |
| Missing / unreadable / malformed keymap → no chords | 1, 3 |
| Platform pretty-printing | 2 |
| Re-read on popup open, tooltip rebuild, sidebar refresh | 5 (Step 4), 6 (Step 2) |
| Popup grouping unchanged, Configure last and always visible | 4 |
| Activity Bar stays a single launcher | 7 (description only; no tree added) |
| Module split, `vscode`-free modules tested | 1–4 |
| Parse / format / manual test list | 1, 2, 8 |
| README | 8 |
| Version stays `0.1.0`, 4-space `.ts` indentation | Global Constraints; verified in 6 Step 6 |
| JetBrains plugin | Not implemented — spec records it as a follow-on product |

**Placeholder scan:** none. Every step carries the code or the exact command to run.

**Type consistency:** `MenuDeps.chordFor` (Task 5) is supplied by the `chordFor` closure in `extension.ts` (Task 5 Step 4) and reused by `runAction` (Task 6) and both launcher surfaces (Task 7). `appendChord` returns `string | undefined`, matching `QuickPickItem.description` and `TreeItem.description`. `reportError(output, err)` has one signature, used by `showMenu` and `runAction`. `menuLayout` emits only command ids present in `MENU_ACTIONS` — Task 4's test pins the ids and Task 5's registry defines exactly those seventeen.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-keyboard-shortcuts.md`.

## Post-review corrections

Task 6's `runAction` snippet was wrong: it gated every Palette/keyboard command on the CLI binary, including `versori.showOutput` and `versori.configureKeybindings`. Those two touch no CLI. With the binary missing, Show Output is how the user diagnoses that state, and Configure is the only way to reach the Keybindings editor once `versori.showMenu` has already bailed.

Shipped code keeps `runAction` as written for CLI-backed commands. A second skip set (`CLI_FREE_COMMANDS`) excludes those two ids from the `MENU_ACTIONS` registration loop. They are registered directly — `output.show(true)` and `workbench.action.openGlobalKeybindings` with query `versori.` — with no CLI gate. The `MENU_ACTIONS` table entries are unchanged; the popup still calls their `run` handlers, and that path already requires a CLI.
