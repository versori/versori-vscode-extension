import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { KV_SCRIPT, renderKvHtml } from './html';

/**
 * Executes `KV_SCRIPT` against a stubbed DOM, driving it through its real entry
 * point — a `kv` message on the window — the same way `src/logs/html.test.ts`
 * and `src/issues/html.test.ts` do.
 *
 * Execution rather than pattern-matching is what lets the load-bearing promise
 * of this panel be asserted: that a collapsed row never puts the stored value on
 * screen. Reading the template literal could not prove that.
 */
interface StubNode {
    id: string;
    tag: string;
    className: string;
    value: string;
    disabled: boolean;
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
    querySelector(selector: string): StubNode | undefined;
    addEventListener(name: string, fn: () => void): void;
    fire(name: string): void;
}

/** Payload fields the script reads. Mirrors `KvPayload`. */
interface TestPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: unknown[];
    controlValues: Record<string, unknown>;
    controlError?: string;
    entries: Array<{
        key: string;
        value: string;
        createdAt: string;
        rawCreatedAt: string;
        expiresAt: string;
        versionstamp: string;
        searchText: string;
    }>;
    page: number;
    hasNext: boolean;
    hasPrev: boolean;
    rawJson: string;
    error?: string;
}

const ELEMENT_IDS = [
    'heading',
    'subtitle',
    'command',
    'raw',
    'controls',
    'filter',
    'count',
    'body',
    'expandAll',
    'toggleRaw',
    'refresh',
    'prevPage',
    'nextPage',
    'pageInfo',
    'runCount',
    'total',
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
        disabled: false,
        get textContent() {
            return text;
        },
        set textContent(value: string) {
            text = value;
            // Matches the DOM: assigning text content discards child nodes, so a
            // detached row stops being reachable from querySelectorAll.
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
        querySelector(selector) {
            // Recursive and class-or-tag, matching the real DOM: the script looks
            // up `.twist` from the row it lives two levels below, and the detail
            // list by tag name. A shallow class-only stub answers undefined for
            // both, which would fake a failure the browser never has.
            const want = selector.replace('.', '');
            const hit = (node: StubNode) =>
                selector.startsWith('.') ? node.classList.contains(want) : node.tag === want;

            const walk = (node: StubNode): StubNode | undefined => {
                for (const child of node.children) {
                    if (hit(child)) {
                        return child;
                    }
                    const found = walk(child);
                    if (found) {
                        return found;
                    }
                }
                return undefined;
            };

            return walk(self);
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

function descendants(node: StubNode, out: StubNode[]): StubNode[] {
    for (const child of node.children) {
        out.push(child);
        descendants(child, out);
    }
    return out;
}

/** Text of a node and everything under it, which is what a user actually reads. */
function visibleText(node: StubNode): string {
    return [node.textContent, ...descendants(node, []).map((n) => n.textContent)]
        .filter(Boolean)
        .join(' ');
}

interface RenderedRow {
    open: boolean;
    /** Everything the collapsed row puts on screen. */
    headText: string;
    /** The expanded detail, as dt -> dd pairs. */
    fields: Array<[string, string]>;
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
        // Reachability-based, unlike the flat scan in logs/html.test.ts: this
        // panel re-renders its list on every keystroke in the filter box, and a
        // stale detached row must not answer a query.
        querySelectorAll: (selector: string) => {
            const want = selector.replace('.', '');
            const seen: StubNode[] = [];
            for (const root of byId.values()) {
                descendants(root, seen);
            }
            return seen.filter((node) => node.classList.contains(want));
        },
    };

    const posted: Array<Record<string, unknown>> = [];
    let onMessage: ((event: { data: unknown }) => void) | undefined;
    const windowStub = {
        addEventListener(name: string, fn: (event: { data: unknown }) => void) {
            if (name === 'message') {
                onMessage = fn;
            }
        },
    };

    // `RAW_PANE_SCRIPT` is concatenated rather than stubbed, exactly as
    // `htmlDocument` assembles a real panel: the raw pane's toggle and its
    // per-payload reset are the behaviour under test below, so a stub would
    // assert nothing.
    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        'renderControls',
        RAW_PANE_SCRIPT + KV_SCRIPT,
    )(
        documentStub,
        windowStub,
        () => ({ postMessage: (m: Record<string, unknown>) => void posted.push(m) }),
        // Exercised by shell.test.ts; here it only needs to exist.
        () => {},
    );

    return {
        posted,
        node: (id: string) => byId.get(id) as StubNode,
        send(payload: TestPayload) {
            if (!onMessage) {
                throw new Error('the script never registered a message listener');
            }
            onMessage({ data: { type: 'kv', payload } });
        },
        sendCount(message: { total?: number; error?: string }) {
            if (!onMessage) {
                throw new Error('the script never registered a message listener');
            }
            onMessage({ data: { type: 'count', ...message } });
        },
        type(needle: string) {
            const box = byId.get('filter') as StubNode;
            box.value = needle;
            box.fire('input');
        },
        click(id: string) {
            (byId.get(id) as StubNode).fire('click');
        },
        clickRow(index: number) {
            const row = documentStub.querySelectorAll('.entry')[index];
            (row.querySelector('.head') as StubNode).fire('click');
        },
        rows(): RenderedRow[] {
            return documentStub.querySelectorAll('.entry').map((row) => {
                const head = row.querySelector('.head') as StubNode;
                const list = (row.querySelector('.detail') as StubNode).querySelector(
                    'dl',
                ) as StubNode;
                const fields: Array<[string, string]> = [];
                for (let i = 0; i < list.children.length; i += 2) {
                    fields.push([
                        list.children[i].textContent,
                        list.children[i + 1]?.textContent ?? '',
                    ]);
                }
                return { open: row.classList.contains('open'), headText: visibleText(head), fields };
            });
        },
    };
}

const SECRET = 'sk-live-51H9x';

function payload(overrides: Partial<TestPayload> = {}): TestPayload {
    return {
        heading: 'KV · project · production',
        subtitle: 'Context: dev',
        command: 'versori kv list --scope project',
        controls: [],
        controlValues: {},
        entries: [
            {
                key: 'auth/apiKey',
                value: SECRET,
                createdAt: '2026-08-05 09:15:00',
                rawCreatedAt: '2026-08-05T09:15:00Z',
                expiresAt: '2026-08-12 09:15:00',
                versionstamp: '00000000000000010000',
                searchText: `auth/apiKey ${SECRET}`,
            },
            {
                key: 'orders/cursor',
                value: '{"since":"2026-08-01"}',
                createdAt: '2026-08-05 10:00:00',
                rawCreatedAt: '2026-08-05T10:00:00Z',
                expiresAt: '',
                versionstamp: '00000000000000020000',
                searchText: 'orders/cursor {"since":"2026-08-01"}',
            },
        ],
        page: 1,
        hasNext: false,
        hasPrev: false,
        rawJson: '{}',
        ...overrides,
    };
}

describe('collapsed rows', () => {
    it('shows the key and the createdAt timestamp', () => {
        const view = harness();
        view.send(payload());

        expect(view.rows()[0].headText).toContain('auth/apiKey');
        expect(view.rows()[0].headText).toContain('2026-08-05 09:15:00');
    });

    it('never puts the stored value on screen — revealing one has to be deliberate', () => {
        const view = harness();
        view.send(payload());

        for (const row of view.rows()) {
            expect(row.headText).not.toContain(SECRET);
            expect(row.headText).not.toContain('2026-08-01');
        }
    });

    it('starts collapsed', () => {
        const view = harness();
        view.send(payload());

        expect(view.rows().map((r) => r.open)).toEqual([false, false]);
    });
});

describe('expanded detail', () => {
    it('reveals the value, the TTL and the versionstamp', () => {
        const view = harness();
        view.send(payload());

        expect(view.rows()[0].fields).toEqual([
            ['value', SECRET],
            ['expires', '2026-08-12 09:15:00'],
            ['created', '2026-08-05T09:15:00Z'],
            ['versionstamp', '00000000000000010000'],
        ]);
    });

    it('says an entry never expires rather than leaving the TTL blank', () => {
        const view = harness();
        view.send(payload());

        expect(view.rows()[1].fields).toContainEqual(['expires', 'never']);
    });

    it('shows the value verbatim, with no masking applied to it', () => {
        const view = harness();
        view.send(payload());

        expect(view.rows()[0].fields[0][1]).toBe(SECRET);
    });

    it('opens a row on click and closes it again', () => {
        const view = harness();
        view.send(payload());

        view.clickRow(0);
        expect(view.rows().map((r) => r.open)).toEqual([true, false]);

        view.clickRow(0);
        expect(view.rows().map((r) => r.open)).toEqual([false, false]);
    });
});

describe('expand all', () => {
    it('is one control that opens every row, then closes them again', () => {
        const view = harness();
        view.send(payload());

        view.click('expandAll');
        expect(view.rows().map((r) => r.open)).toEqual([true, true]);
        expect(view.node('expandAll').textContent).toBe('Collapse all');

        view.click('expandAll');
        expect(view.rows().map((r) => r.open)).toEqual([false, false]);
        expect(view.node('expandAll').textContent).toBe('Expand all');
    });

    it('only ever opens the rows the filter left on screen', () => {
        const view = harness();
        view.send(payload());
        view.type('orders');
        view.click('expandAll');

        const rows = view.rows();
        expect(rows).toHaveLength(1);
        expect(rows[0].headText).toContain('orders/cursor');
        // Without this the test passes even if expandAll does nothing at all.
        expect(rows[0].open).toBe(true);
    });

    it('resets to collapsed when a new page arrives, so nothing is exposed by a refresh', () => {
        const view = harness();
        view.send(payload());
        view.click('expandAll');

        view.send(payload());

        expect(view.rows().map((r) => r.open)).toEqual([false, false]);
        expect(view.node('expandAll').textContent).toBe('Expand all');
    });
});

describe('search', () => {
    it('matches on the key', () => {
        const view = harness();
        view.send(payload());
        view.type('auth/');

        expect(view.rows().map((r) => r.headText)).toHaveLength(1);
        expect(view.rows()[0].headText).toContain('auth/apiKey');
    });

    it('matches on the value, case-insensitively', () => {
        const view = harness();
        view.send(payload());
        view.type('SINCE');

        expect(view.rows()).toHaveLength(1);
        expect(view.rows()[0].headText).toContain('orders/cursor');
    });

    it('says how many of the loaded entries matched', () => {
        const view = harness();
        view.send(payload());
        view.type('auth/');

        expect(view.node('count').textContent).toBe('1 of 2 on this page');
    });

    it('counts the whole page when nothing is typed', () => {
        const view = harness();
        view.send(payload());

        expect(view.node('count').textContent).toBe('2 entries on this page');
    });

    it('never asks the host to re-run the CLI — it only filters what is loaded', () => {
        const view = harness();
        view.send(payload());
        view.type('auth/');

        expect(view.posted).toEqual([]);
    });

    it('says so when a filter hides everything, instead of looking like an empty store', () => {
        const view = harness();
        view.send(payload());
        view.type('nothing-matches-this');

        expect(view.rows()).toHaveLength(0);
        expect(visibleText(view.node('body'))).toMatch(/no entries on this page match/i);
    });
});

describe('paging', () => {
    it('asks the host for the next page by direction only, never by cursor', () => {
        const view = harness();
        view.send(payload({ hasNext: true }));
        view.click('nextPage');

        expect(view.posted.at(-1)).toEqual({ type: 'page', direction: 'next' });
    });

    it('asks the host for the previous page by direction only', () => {
        const view = harness();
        view.send(payload({ hasPrev: true, page: 2 }));
        view.click('prevPage');

        expect(view.posted.at(-1)).toEqual({ type: 'page', direction: 'prev' });
    });

    it('disables Next when the response carried no nextCursor, which means the end', () => {
        const view = harness();
        view.send(payload({ hasNext: false }));

        expect(view.node('nextPage').disabled).toBe(true);
        view.click('nextPage');
        expect(view.posted).toEqual([]);
    });

    it('disables Previous on the first page', () => {
        const view = harness();
        view.send(payload({ page: 1, hasPrev: false }));

        expect(view.node('prevPage').disabled).toBe(true);
        view.click('prevPage');
        expect(view.posted).toEqual([]);
    });

    it('enables both when the response offered both cursors', () => {
        const view = harness();
        view.send(payload({ page: 3, hasNext: true, hasPrev: true }));

        expect(view.node('nextPage').disabled).toBe(false);
        expect(view.node('prevPage').disabled).toBe(false);
    });

    it('names the page, and says how to get back to the first one', () => {
        const view = harness();
        view.send(payload({ page: 3, hasPrev: true }));

        expect(view.node('pageInfo').textContent).toMatch(/page 3/i);
        expect(view.node('pageInfo').textContent).toMatch(/refresh/i);
    });

    it('drops the hint on the first page, where it would be noise', () => {
        const view = harness();
        view.send(payload({ page: 1 }));

        expect(view.node('pageInfo').textContent).toMatch(/page 1/i);
        expect(view.node('pageInfo').textContent).not.toMatch(/refresh/i);
    });
});

describe('the raw JSON pane', () => {
    it('shows on demand, hiding the entry list behind it', () => {
        const view = harness();
        view.send(payload());
        view.click('toggleRaw');

        expect(view.node('raw').className).toContain('show');
        expect(view.node('toggleRaw').className).toContain('active');
        expect(view.node('body').style.display).toBe('none');
    });

    it('does not survive a re-render — otherwise every later page arrives with every value already on screen', () => {
        const view = harness();
        view.send(payload());
        view.click('toggleRaw');

        // A refresh, an Apply, or a page turn all land here.
        view.send(payload());

        expect(view.node('raw').className).not.toContain('show');
        expect(view.node('toggleRaw').className).not.toContain('active');
        expect(view.node('body').style.display).toBe('');
    });

    it('can be reopened after a re-render, so the reset is not a lockout', () => {
        const view = harness();
        view.send(payload());
        view.click('toggleRaw');
        view.send(payload());
        view.click('toggleRaw');

        expect(view.node('raw').className).toContain('show');
    });

    it('is labelled for what it dumps, not for the response shape', () => {
        expect(renderKvHtml('abc123')).toContain('Raw JSON (all values)');
    });
});

describe('count', () => {
    it('runs only when asked — never on load', () => {
        const view = harness();
        view.send(payload());

        expect(view.posted).toEqual([]);

        view.click('runCount');
        expect(view.posted).toEqual([{ type: 'count' }]);
    });

    it('does not piggyback on a refresh or a page turn, which is the point of on-demand', () => {
        const view = harness();
        view.send(payload({ hasNext: true, hasPrev: true, page: 2 }));

        view.click('refresh');
        view.click('nextPage');
        view.click('prevPage');

        expect(view.posted.map((m) => m.type)).toEqual(['refresh', 'page', 'page']);
    });

    it('says it is working while the count is in flight', () => {
        const view = harness();
        view.send(payload());
        view.click('runCount');

        expect(view.node('total').textContent).toMatch(/counting/i);
    });

    it('shows the total, and warns that it was counted separately from the page', () => {
        const view = harness();
        view.send(payload());
        view.sendCount({ total: 4210 });

        expect(view.node('total').textContent).toContain('4210');
        expect(view.node('total').textContent).toMatch(/separate/i);
    });

    it('reports a failure rather than showing a number it does not have', () => {
        const view = harness();
        view.send(payload());
        view.sendCount({ error: 'no organisation in the active context' });

        expect(view.node('total').textContent).toMatch(/could not count/i);
        expect(view.node('total').textContent).not.toMatch(/\d/);
    });

    it('clears on the next render, so a total can never be read against a different query', () => {
        const view = harness();
        view.send(payload());
        view.sendCount({ total: 4210 });

        view.send(payload());

        expect(view.node('total').textContent).toBe('');
    });
});

describe('controls', () => {
    it('only stores a changed control value, leaving renderControls to re-render', () => {
        // renderControls owns its own re-render; calling back into the panel here
        // would destroy the focused input mid-edit.
        expect(KV_SCRIPT).toContain('(id, value) => { controlValues[id] = value; }');
    });

    it('sends the control values with a refresh', () => {
        const view = harness();
        view.send(payload());
        view.click('refresh');

        expect(view.posted.at(-1)).toMatchObject({ type: 'refresh' });
    });
});

describe('renderKvHtml', () => {
    it('locks the page down to the per-render nonce with no external origins', () => {
        const html = renderKvHtml('abc123');

        expect(html).toContain(
            "default-src 'none'; style-src 'nonce-abc123'; script-src 'nonce-abc123';",
        );
        expect(html).not.toMatch(/https?:\/\//);
    });

    it('tells the user the search box only covers the page in front of them', () => {
        const html = renderKvHtml('abc123');

        expect(html).toMatch(/only the entries loaded on this page/i);
    });

    it('offers no way to write, delete or wipe anything', () => {
        const html = renderKvHtml('abc123').toLowerCase();

        for (const word of ['kv set', 'delete', 'wipe', 'confirm']) {
            expect(html).not.toContain(word);
        }
    });
});
