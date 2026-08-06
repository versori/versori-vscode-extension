import { describe, expect, it } from 'vitest';

import { CONTROLS_SCRIPT, FIELD_PICKER_SCRIPT } from '../webview/shell';
import { DEFAULT_COLUMNS, RESULTS_SCRIPT } from './html';

/**
 * Executes `RESULTS_SCRIPT` against a stubbed DOM, driving it through its real
 * entry point — a `results` message on the window — combined with the real
 * `CONTROLS_SCRIPT` and `FIELD_PICKER_SCRIPT` (rather than stubs), because the
 * behaviour under test — the picker's `(n/m)` label and which columns the table
 * renders — only exists at the seam between the two scripts. `renderFieldPicker`
 * itself is exercised in `shell.test.ts`; here it is exercised through the
 * column-picker contract `pickColumns()` builds on top of it.
 */
interface StubNode {
    id: string;
    tag: string;
    className: string;
    value: string;
    checked: boolean;
    textContent: string;
    dataset: Record<string, string>;
    style: Record<string, string>;
    children: StubNode[];
    classList: {
        toggle(name: string, force?: boolean): boolean;
        add(name: string): void;
        remove(name: string): void;
        contains(name: string): boolean;
    };
    appendChild(child: StubNode): void;
    addEventListener(name: string, fn: () => void): void;
    fire(name: string): void;
}

/** Payload fields the script reads. Mirrors `ResultsPayload`. */
interface TestPayload {
    heading: string;
    subtitle: string;
    command: string;
    columns: string[];
    allColumns: string[];
    rows: Array<Record<string, string>>;
    levelColumn?: string;
    levels: Array<string | undefined>;
    rawJson: string;
    error?: string;
    controls?: unknown[];
    controlValues?: Record<string, unknown>;
    controlError?: string;
}

/** Ids the script looks up at load time and during a render. */
const ELEMENT_IDS = [
    'heading',
    'subtitle',
    'command',
    'raw',
    'controls',
    'filter',
    'count',
    'columnPicker',
    'toggleRaw',
    'refresh',
    'body',
];

function makeNode(tag: string, all: StubNode[]): StubNode {
    const listeners: Record<string, Array<() => void>> = {};
    const classes = new Set<string>();
    let text = '';

    const self: StubNode = {
        id: '',
        tag,
        get className() {
            return [...classes].join(' ');
        },
        set className(value: string) {
            classes.clear();
            for (const name of value.split(' ').filter(Boolean)) {
                classes.add(name);
            }
        },
        value: '',
        checked: false,
        get textContent() {
            return text;
        },
        set textContent(value: string) {
            text = value;
            // Matches the DOM: assigning text content discards child nodes,
            // which is how every render in this script clears its host.
            if (value === '') {
                self.children.length = 0;
            }
        },
        dataset: {},
        style: {},
        children: [],
        classList: {
            toggle(name, force) {
                const on = force === undefined ? !classes.has(name) : Boolean(force);
                if (on) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }
                return on;
            },
            add: (name) => void classes.add(name),
            remove: (name) => void classes.delete(name),
            contains: (name) => classes.has(name),
        },
        appendChild(child) {
            self.children.push(child);
        },
        addEventListener(name, fn) {
            (listeners[name] ??= []).push(fn);
        },
        fire(name) {
            (listeners[name] ?? []).forEach((fn) => fn());
        },
    };

    all.push(self);
    return self;
}

function harness() {
    const all: StubNode[] = [];
    const byId = new Map<string, StubNode>();

    for (const id of ELEMENT_IDS) {
        const element = makeNode('div', all);
        element.id = id;
        byId.set(id, element);
    }

    const documentStub = {
        getElementById: (id: string) => byId.get(id),
        createElement: (tag: string) => makeNode(tag, all),
    };

    let onMessage: ((event: { data: unknown }) => void) | undefined;
    const windowStub = {
        addEventListener(name: string, fn: (event: { data: unknown }) => void) {
            if (name === 'message') {
                onMessage = fn;
            }
        },
    };

    // Combined exactly as `htmlDocument` assembles a real panel: the shared
    // shell scripts and the panel script share one top-level function scope, so
    // `RESULTS_SCRIPT`'s IIFE can call `renderControls`/`renderFieldPicker`
    // without either being passed in as a stub.
    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        CONTROLS_SCRIPT + FIELD_PICKER_SCRIPT + RESULTS_SCRIPT,
    )(documentStub, windowStub, () => ({ postMessage: () => {} }));

    const columnPicker = byId.get('columnPicker') as StubNode;
    const body = byId.get('body') as StubNode;

    return {
        sendResults(payload: TestPayload) {
            if (!onMessage) {
                throw new Error('the script never registered a message listener');
            }
            onMessage({ data: { type: 'results', payload } });
        },
        pickerLabel(): string {
            // The toggle button is appended first, the menu last.
            return columnPicker.children[0].textContent;
        },
        toggleColumn(name: string) {
            const menu = columnPicker.children.find((c) => c.className === 'menu');
            const row = menu?.children.find((r) => r.children[1]?.textContent === name);
            if (!row) {
                throw new Error(`no column picker entry for "${name}"`);
            }
            const box = row.children[0];
            box.checked = !box.checked;
            box.fire('change');
        },
        headerTexts(): string[] {
            const scroll = body.children[0];
            const table = scroll?.children[0];
            const thead = table?.children[0];
            const headRow = thead?.children[0];
            return (headRow?.children ?? []).map((th) => th.textContent);
        },
    };
}

function columns(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `col${i}`);
}

function payloadWith(cols: string[]): TestPayload {
    const row = Object.fromEntries(cols.map((c) => [c, `${c}-value`]));
    return {
        heading: 'Versions',
        subtitle: 'Context: dev',
        command: 'versori versions list',
        columns: cols,
        allColumns: cols,
        rows: [row],
        levels: [undefined],
        rawJson: '[]',
    };
}

describe('results column picker (executed)', () => {
    it('shows the first DEFAULT_COLUMNS columns by default', () => {
        const view = harness();
        const cols = columns(15);
        view.sendResults(payloadWith(cols));

        expect(view.headerTexts()).toEqual(cols.slice(0, DEFAULT_COLUMNS));
        expect(view.pickerLabel()).toBe(`Columns (${DEFAULT_COLUMNS}/15)`);
    });

    it('ticking a hidden column adds it to the table in the data\'s own order', () => {
        const view = harness();
        const cols = columns(15);
        view.sendResults(payloadWith(cols));

        // col12 is beyond the default 12, so it starts unticked.
        view.toggleColumn('col12');

        expect(view.headerTexts()).toEqual(cols.slice(0, DEFAULT_COLUMNS).concat('col12'));
        expect(view.pickerLabel()).toBe('Columns (13/15)');
    });

    it('unticking a shown column removes it from the table', () => {
        const view = harness();
        const cols = columns(15);
        view.sendResults(payloadWith(cols));

        view.toggleColumn('col0');

        expect(view.headerTexts()).toEqual(cols.slice(1, DEFAULT_COLUMNS));
        expect(view.pickerLabel()).toBe('Columns (11/15)');
    });

    it('resets to the default selection when a refresh changes the column shape', () => {
        const view = harness();
        view.sendResults(payloadWith(columns(15)));
        view.toggleColumn('col12');
        expect(view.pickerLabel()).toBe('Columns (13/15)');

        // A different command's columns are unrelated to the previous one's.
        const nextCols = ['name', 'status', 'createdAt'];
        view.sendResults(payloadWith(nextCols));

        expect(view.headerTexts()).toEqual(nextCols);
        expect(view.pickerLabel()).toBe('Columns (3/3)');
    });
});
