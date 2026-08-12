import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { fieldExpression, fieldPrefixExpression, messageExpression } from './filter';
import { LOGS_SCRIPT, renderLogsHtml } from './html';

/**
 * Executes `LOGS_SCRIPT` against a stubbed DOM, driving it through its real
 * entry point — a `logs` message on the window — rather than pattern-matching
 * the template literal. The severity chips hold state that outlives a payload,
 * so only execution can show what happens when the next payload disagrees with
 * it.
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
    querySelector(selector: string): StubNode | undefined;
    setAttribute(name: string, value: string): void;
    addEventListener(name: string, fn: (event?: unknown) => void): void;
    fire(name: string, event?: unknown): void;
}

interface Chip {
    label: string;
    active: boolean;
}

/** Payload fields the script reads. Mirrors `LogsPayload`. */
interface TestPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: unknown[];
    controlValues: Record<string, unknown>;
    entries: Array<{
        id: string;
        timestamp: string;
        rawTimestamp: string;
        severity: string;
        level?: string;
        message: string;
        fields: Array<{ key: string; value: string }>;
        raw: Record<string, unknown>;
    }>;
    severities: string[];
    live: {
        enabled: boolean;
        updatedAt?: string;
        error?: string;
        warning?: string;
        disabledReason?: string;
    };
    merged?: boolean;
    added?: number;
    rawJson: string;
    error?: string;
}

/** Ids the script looks up at load time and during a render. */
const ELEMENT_IDS = [
    'heading',
    'subtitle',
    'command',
    'raw',
    'controls',
    'sevs',
    'count',
    'body',
    'include',
    'exclude',
    'caseSensitive',
    'live',
    'group',
    'liveStatus',
    'status',
    'backTop',
    'refresh',
    'expandAll',
    'collapseAll',
    'toggleRaw',
];

function makeNode(tag: string, all: StubNode[]): StubNode {
    const listeners: Record<string, Array<(event?: unknown) => void>> = {};
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
        querySelector(selector) {
            const want = selector.replace('.', '');
            return self.children.find((child) => child.classList.contains(want));
        },
        setAttribute(_name, _value) {
            // aria-* and similar; the stub only needs the call not to throw.
        },
        addEventListener(name, fn) {
            (listeners[name] ??= []).push(fn as (event?: unknown) => void);
        },
        fire(name, event) {
            (listeners[name] ?? []).forEach((fn) =>
                fn(event ?? { stopPropagation() {}, preventDefault() {} }),
            );
        },
    };

    all.push(self);
    return self;
}

function harness() {
    const all: StubNode[] = [];
    const byId = new Map<string, StubNode>();
    const documentListeners: Record<string, Array<(event: unknown) => void>> = {};

    for (const id of ELEMENT_IDS) {
        const element = makeNode('div', all);
        element.id = id;
        byId.set(id, element);
    }

    const documentStub = {
        getElementById: (id: string) => byId.get(id),
        createElement: (tag: string) => makeNode(tag, all),
        querySelectorAll: (selector: string) =>
            all.filter((n) => n.classList.contains(selector.replace('.', ''))),
        addEventListener(name: string, fn: (event: unknown) => void) {
            (documentListeners[name] ??= []).push(fn);
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

    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        'renderControls',
        // `RAW_PANE_SCRIPT` is concatenated rather than stubbed, exactly as
        // `htmlDocument` assembles a real panel — the raw pane's per-payload
        // reset is the behaviour under test below.
        RAW_PANE_SCRIPT + LOGS_SCRIPT,
    )(
        documentStub,
        windowStub,
        () => ({ postMessage: (m: Record<string, unknown>) => void posted.push(m) }),
        // The shared shell scripts are exercised by shell.test.ts; here they only
        // need to exist, so the script under test can call them.
        () => {},
    );

    /** The action button inside the `dt` for `path`, or inside the `dd` that follows it. */
    function fieldNode(rowIndex: number, path: string, which: 'dt' | 'dd'): StubNode {
        const row = (byId.get('body') as StubNode).children[rowIndex];
        const detail = row.children.find((child) => child.classList.contains('detail'));
        const list = detail?.children[0];
        const cells = list?.children ?? [];

        const at = cells.findIndex(
            (cell) => cell.tag === 'dt' && cell.children[0]?.textContent === path,
        );
        if (at === -1) {
            throw new Error(`no field row for "${path}"`);
        }

        const cell = which === 'dt' ? cells[at] : cells[at + 1];
        return cell.children[0];
    }

    return {
        posted,
        node: (id: string) => byId.get(id) as StubNode,
        click(id: string) {
            (byId.get(id) as StubNode).fire('click');
        },
        sendLogs(payload: TestPayload) {
            if (!onMessage) {
                throw new Error('the script never registered a message listener');
            }
            onMessage({ data: { type: 'logs', payload } });
        },
        receive(data: unknown) {
            if (!onMessage) {
                throw new Error('the script never registered a message listener');
            }
            onMessage({ data });
        },
        pressEscape() {
            (documentListeners.keydown ?? []).forEach((fn) => fn({ key: 'Escape' }));
        },
        documentClick() {
            (documentListeners.click ?? []).forEach((fn) => fn({}));
        },
        fieldNameButton(row: number, path: string) {
            return fieldNode(row, path, 'dt');
        },
        fieldValueButton(row: number, path: string) {
            return fieldNode(row, path, 'dd');
        },
        /** The row-title button of row `n`. */
        titleButton(n: number) {
            const row = (byId.get('body') as StubNode).children[n];
            const head = row.children.find((c) => c.classList.contains('head')) as StubNode;
            return head.children.find((c) => c.classList.contains('msg')) as StubNode;
        },
        /** Labels of the currently open popover, in order. */
        popoverLabels(): string[] {
            return all
                .filter((node) => node.classList.contains('pop'))
                .flatMap((pop) => pop.children.map((item) => item.textContent));
        },
        clickPopover(label: string) {
            const item = all
                .filter((node) => node.classList.contains('pop'))
                .flatMap((pop) => pop.children)
                .find((child) => child.textContent === label);
            if (!item) {
                throw new Error(`no popover item labelled "${label}"`);
            }
            item.fire('click');
        },
        chips(): Chip[] {
            return (byId.get('sevs') as StubNode).children.map((chip) => ({
                label: chip.textContent,
                active: chip.classList.contains('active'),
            }));
        },
        clickChip(label: string) {
            const chip = (byId.get('sevs') as StubNode).children.find(
                (c) => c.textContent === label,
            );
            if (!chip) {
                throw new Error(`no chip labelled "${label}"`);
            }
            chip.fire('click');
        },
    };
}

function payloadWith(severities: string[]): TestPayload {
    return {
        heading: 'Logs',
        subtitle: 'Context: dev',
        command: 'versori projects logs',
        controls: [],
        controlValues: {},
        entries: [
            {
                id: 'aaaaaaaa#0',
                timestamp: '2026-08-06 10:00:00',
                rawTimestamp: '2026-08-06T10:00:00Z',
                severity: severities[0] ?? 'info',
                level: 'info',
                message: 'workflow started',
                fields: [{ key: 'fields.triggerName', value: 'get-pricing' }],
                raw: { message: 'workflow started' },
            },
        ],
        severities,
        live: { enabled: false },
        rawJson: '[]',
    };
}

describe('log severity chips (executed)', () => {
    it('renders a chip per severity in the payload, in payload order', () => {
        const view = harness();
        view.sendLogs(payloadWith(['error', 'warn', 'info']));

        expect(view.chips()).toEqual([
            { label: 'error', active: false },
            { label: 'warn', active: false },
            { label: 'info', active: false },
        ]);
    });

    it('marks a chip active when clicked and sends the selection to the host', () => {
        const view = harness();
        view.sendLogs(payloadWith(['error', 'info']));
        view.clickChip('error');

        expect(view.chips()).toEqual([
            { label: 'error', active: true },
            { label: 'info', active: false },
        ]);
        expect(view.posted.at(-1)).toMatchObject({
            type: 'filter',
            filter: { severities: ['error'] },
        });
    });

    it('regression: keeps a chip for a selected severity the refreshed page no longer contains, so the user is not stranded at "0 of N" with nothing to click', () => {
        const view = harness();
        view.sendLogs(payloadWith(['error', 'info']));
        view.clickChip('error');

        // Refresh into a quiet window with no errors at all.
        view.sendLogs(payloadWith(['info']));

        // The selection survives — an "errors only" view is not silently widened.
        expect(view.posted.at(-1)).toMatchObject({
            type: 'filter',
            filter: { severities: ['error'] },
        });
        // ...and it is still visible and still active, so it can be undone.
        expect(view.chips()).toEqual([
            { label: 'info', active: false },
            { label: 'error', active: true },
        ]);
    });

    it('regression: clicking the stranded chip deselects it and drops it from the row', () => {
        const view = harness();
        view.sendLogs(payloadWith(['error', 'info']));
        view.clickChip('error');
        view.sendLogs(payloadWith(['info']));

        view.clickChip('error');

        expect(view.chips()).toEqual([{ label: 'info', active: false }]);
        expect(view.posted.at(-1)).toMatchObject({
            type: 'filter',
            filter: { severities: [] },
        });
    });
});

/**
 * The raw pane matters more here than in any sibling panel: log fields are
 * arbitrary workflow-authored data, which is the one class `redact()` cannot
 * touch — it matches field *names*, not values. So the per-field expand is the
 * real protection, and a raw pane that outlives its render would bypass it for
 * every later window.
 */
describe('the raw JSON pane (executed)', () => {
    it('shows on demand, hiding the entry list behind it', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.click('toggleRaw');

        expect(view.node('raw').className).toContain('show');
        expect(view.node('toggleRaw').className).toContain('active');
        expect(view.node('body').style.display).toBe('none');
    });

    it('does not survive a re-render — otherwise one click exposes every later window', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.click('toggleRaw');

        // A Refresh or an Apply lands here.
        view.sendLogs(payloadWith(['info']));

        expect(view.node('raw').className).not.toContain('show');
        expect(view.node('toggleRaw').className).not.toContain('active');
        expect(view.node('body').style.display).toBe('');
    });

    it('can be reopened after a re-render, so the reset is not a lockout', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.click('toggleRaw');
        view.sendLogs(payloadWith(['info']));
        view.click('toggleRaw');

        expect(view.node('raw').className).toContain('show');
    });
});

describe('live and group controls (executed)', () => {
    it('tells the host to start live mode when the checkbox is ticked', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.node('live').checked = true;
        view.node('live').fire('change');

        expect(view.posted.at(-1)).toEqual({ type: 'live', enabled: true });
    });

    it('re-requests the filter with the grouping flag when Group by title is ticked', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.node('group').checked = true;
        view.node('group').fire('change');

        expect(view.posted.at(-1)).toMatchObject({ type: 'filter', group: true });
    });

    it('shows the last update time while live', () => {
        const view = harness();
        const payload = payloadWith(['info']);
        payload.live = { enabled: true, updatedAt: '10:31:02' };
        view.sendLogs(payload);

        expect(view.node('liveStatus').textContent).toContain('10:31:02');
        expect(view.node('live').checked).toBe(true);
    });

    it('unticks the box and explains itself when the host reports live mode unavailable', () => {
        const view = harness();
        // Checkbox must start checked — otherwise expect(false) passes even when
        // liveStatus() never syncs el('live').checked from the payload.
        view.node('live').checked = true;
        const payload = payloadWith(['info']);
        payload.live = { enabled: false, disabledReason: 'Live logs needs a relative time range.' };
        view.sendLogs(payload);

        expect(view.node('live').checked).toBe(false);
        expect(view.node('liveStatus').textContent).toContain('relative time range');
    });

    it('reports a poll failure without replacing the entries', () => {
        const view = harness();
        // Establish rows first — a single error-bearing payload cannot prove
        // that a failed poll left previously rendered entries on screen.
        // Two rows so a replace-with-one-placeholder bug cannot fake the count.
        const first = payloadWith(['info']);
        first.entries = [
            first.entries[0]!,
            { ...first.entries[0]!, id: 'bbbbbbbb#1', message: 'second line' },
        ];
        view.sendLogs(first);
        const rowsBefore = view.node('body').children.length;
        expect(rowsBefore).toBeGreaterThan(0);

        const payload = payloadWith(['info']);
        payload.entries = first.entries;
        payload.live = { enabled: true, error: 'context deadline exceeded' };
        view.sendLogs(payload);

        expect(view.node('liveStatus').className).toContain('err');
        expect(view.node('body').children.length).toBeGreaterThan(0);
        expect(view.node('body').children.length).toBe(rowsBefore);
    });

    it('has no Fields picker left to render', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        expect(view.node('fieldPicker')).toBeUndefined();
        // Harness ids alone cannot prove markup removal — pin the real HTML.
        expect(renderLogsHtml('test-nonce')).not.toContain('id="fieldPicker"');
    });
});

/**
 * The stub DOM cannot model the HTML value sanitization algorithm, so the one
 * thing that guarantees a multi-line filter survives is the element type itself.
 */
describe('the filter boxes', () => {
    it('are textareas, because a text input strips the newlines the action menus append', () => {
        const html = renderLogsHtml('test-nonce');

        expect(html).toContain('<textarea id="include"');
        expect(html).toContain('<textarea id="exclude"');
        expect(html).not.toContain('id="include" placeholder');
    });
});

describe('row title actions (executed)', () => {
    it('opens a popover with copy and filter actions', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');

        expect(view.popoverLabels()).toEqual([
            'Copy',
            'Copy JSON',
            'Include',
            'Exclude',
            'Include prefix',
            'Exclude prefix',
        ]);
    });

    it('Include appends an exact quoted message expression and re-filters', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.clickPopover('Include');

        expect(view.node('include').value).toBe('message="workflow started"');
        expect(view.posted.at(-1)).toMatchObject({
            type: 'filter',
            filter: { include: 'message="workflow started"' },
        });
    });

    it('Exclude prefix appends the prefix form to the Exclude box, leaving Include alone', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.clickPopover('Exclude prefix');

        expect(view.node('exclude').value).toBe('message^="workflow started"');
        expect(view.node('include').value).toBe('');
    });

    it('appends on a new line, preserving what the user typed', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.node('include').value = 'orders';
        view.titleButton(0).fire('click');
        view.clickPopover('Include');

        expect(view.node('include').value).toBe('orders\nmessage="workflow started"');
    });

    it('ignores an exact duplicate, so clicking Include twice does not stack expressions', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.clickPopover('Include');
        view.titleButton(0).fire('click');
        view.clickPopover('Include');

        expect(view.node('include').value).toBe('message="workflow started"');
    });

    it('asks the host to copy the message text', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.clickPopover('Copy');

        expect(view.posted.at(-1)).toEqual({
            type: 'copy',
            text: 'workflow started',
            label: 'Message',
        });
    });

    it('asks the host to copy this entry as redacted, two-space-indented JSON', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.clickPopover('Copy JSON');

        const posted = view.posted.at(-1) as { type: string; text: string };
        expect(posted.type).toBe('copy');
        expect(posted.text).toContain('\n  "message"');
        expect(JSON.parse(posted.text)).toMatchObject({ message: 'workflow started' });
    });

    it('announces a completed copy in the polite status region', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.receive({ type: 'copied', label: 'Message' });

        expect(view.node('status').textContent).toContain('Message copied');
    });

    it('reports a failed copy without clearing the popover state', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.receive({ type: 'copied', label: 'Message', error: 'clipboard unavailable' });

        expect(view.node('status').textContent).toContain('clipboard unavailable');
    });

    it('closes the popover after an action, so the row is readable again', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.clickPopover('Include');

        expect(view.popoverLabels()).toEqual([]);
    });

    it('closes an open popover on Escape', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.titleButton(0).fire('click');
        view.pressEscape();

        expect(view.popoverLabels()).toEqual([]);
    });
});

describe('field actions (executed)', () => {
    it('offers path-scoped filters on a field value', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.fieldValueButton(0, 'fields.triggerName').fire('click');

        expect(view.popoverLabels()).toEqual([
            'Copy',
            'Include',
            'Exclude',
            'Include value prefix',
            'Exclude value prefix',
        ]);

        view.clickPopover('Include');
        expect(view.node('include').value).toBe('fields.triggerName="get-pricing"');
    });

    it('offers field-path prefix filters on a field name', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        view.fieldNameButton(0, 'fields.triggerName').fire('click');

        expect(view.popoverLabels()).toEqual([
            'Copy field path',
            'Include field prefix',
            'Exclude field prefix',
        ]);

        view.clickPopover('Include field prefix');
        expect(view.node('include').value).toBe('fields.triggerName.*');
    });
});

/**
 * The webview script is a template literal, not a module, so it re-implements
 * the two-line serialise shapes. These pins compare the executed inline output
 * to the host exports — not to a hardcoded expected string.
 */
describe('inline webview serialisers match filter.ts (executed)', () => {
    it('quotes a message with comma, quote and newline the same way', () => {
        const tricky = 'a, "b"\nc';
        const view = harness();
        const payload = payloadWith(['info']);
        payload.entries[0]!.message = tricky;
        view.sendLogs(payload);

        view.titleButton(0).fire('click');
        view.clickPopover('Include');
        expect(view.node('include').value).toBe(messageExpression(tricky));

        view.node('include').value = '';
        view.titleButton(0).fire('click');
        view.clickPopover('Include prefix');
        expect(view.node('include').value).toBe(messageExpression(tricky, true));
    });

    it('quotes a field value and path-prefix the same way', () => {
        const tricky = 'x, "y"\nz';
        const path = 'fields.triggerName';
        const view = harness();
        const payload = payloadWith(['info']);
        payload.entries[0]!.fields = [{ key: path, value: tricky }];
        view.sendLogs(payload);

        view.fieldValueButton(0, path).fire('click');
        view.clickPopover('Include');
        expect(view.node('include').value).toBe(fieldExpression(path, tricky));

        view.node('include').value = '';
        view.fieldValueButton(0, path).fire('click');
        view.clickPopover('Include value prefix');
        expect(view.node('include').value).toBe(fieldExpression(path, tricky, true));

        view.node('include').value = '';
        view.fieldNameButton(0, path).fire('click');
        view.clickPopover('Include field prefix');
        expect(view.node('include').value).toBe(fieldPrefixExpression(path));
    });
});
