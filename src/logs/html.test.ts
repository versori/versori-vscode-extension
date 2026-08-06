import { describe, expect, it } from 'vitest';

import { LOGS_SCRIPT } from './html';

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
    addEventListener(name: string, fn: () => void): void;
    fire(name: string): void;
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
        timestamp: string;
        rawTimestamp: string;
        severity: string;
        level?: string;
        message: string;
        fields: Array<{ key: string; value: string }>;
    }>;
    fieldKeys: string[];
    severities: string[];
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
    'fieldPicker',
    'sevs',
    'count',
    'body',
    'include',
    'exclude',
    'caseSensitive',
    'refresh',
    'expandAll',
    'collapseAll',
    'toggleRaw',
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
        querySelector(selector) {
            const want = selector.replace('.', '');
            return self.children.find((child) => child.classList.contains(want));
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
        'renderFieldPicker',
        LOGS_SCRIPT,
    )(
        documentStub,
        windowStub,
        () => ({ postMessage: (m: Record<string, unknown>) => void posted.push(m) }),
        // The shared shell scripts are exercised by shell.test.ts; here they only
        // need to exist, so the script under test can call them.
        () => {},
        () => {},
    );

    return {
        posted,
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
                timestamp: '2026-08-06 10:00:00',
                rawTimestamp: '2026-08-06T10:00:00Z',
                severity: severities[0] ?? 'info',
                level: 'info',
                message: 'workflow started',
                fields: [{ key: 'fields.triggerName', value: 'get-pricing' }],
            },
        ],
        fieldKeys: ['fields.triggerName'],
        severities,
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
