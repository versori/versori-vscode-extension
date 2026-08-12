import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
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
        const payload = payloadWith(['info']);
        payload.live = { enabled: false, disabledReason: 'Live logs needs a relative time range.' };
        view.sendLogs(payload);

        expect(view.node('live').checked).toBe(false);
        expect(view.node('liveStatus').textContent).toContain('relative time range');
    });

    it('reports a poll failure without replacing the entries', () => {
        const view = harness();
        const payload = payloadWith(['info']);
        payload.live = { enabled: true, error: 'context deadline exceeded' };
        view.sendLogs(payload);

        expect(view.node('liveStatus').className).toContain('err');
        expect(view.node('body').children.length).toBeGreaterThan(0);
    });

    it('has no Fields picker left to render', () => {
        const view = harness();
        view.sendLogs(payloadWith(['info']));
        expect(view.node('fieldPicker')).toBeUndefined();
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
