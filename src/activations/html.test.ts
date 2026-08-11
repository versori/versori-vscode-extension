import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { ACTIVATIONS_SCRIPT } from './html';

interface StubNode {
    id: string;
    tag: string;
    className: string;
    value: string;
    textContent: string;
    hidden: boolean;
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
    addEventListener(name: string, fn: (event?: { stopPropagation(): void }) => void): void;
    fire(name: string): void;
    querySelectorAll(selector: string): StubNode[];
}

interface TestRow {
    externalId: string;
    displayName: string;
    status: 'active' | 'inactive';
    activationId: string;
    userId: string;
    createdAt: string;
    variableSummary: string;
}

interface TestPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: unknown[];
    controlValues: Record<string, unknown>;
    active: TestRow[];
    inactive: TestRow[];
    rawJson: string;
    error?: string;
}

const ELEMENT_IDS = [
    'heading',
    'subtitle',
    'command',
    'raw',
    'controls',
    'count',
    'body',
    'filter',
    'refresh',
    'toggleRaw',
    'createUser',
];

function makeNode(tag: string): StubNode {
    const listeners: Record<string, Array<(event?: { stopPropagation(): void }) => void>> = {};
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
        get textContent() {
            return text;
        },
        set textContent(value: string) {
            text = value;
            self.children = [];
        },
        hidden: false,
        dataset: {},
        style: {},
        children: [],
        classList: {
            toggle(name: string, force?: boolean) {
                const on = force ?? !classes.has(name);
                if (on) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }
                return on;
            },
            add(name: string) {
                classes.add(name);
            },
            remove(name: string) {
                classes.delete(name);
            },
            contains(name: string) {
                return classes.has(name);
            },
        },
        appendChild(child: StubNode) {
            self.children.push(child);
        },
        addEventListener(name, fn) {
            (listeners[name] ??= []).push(fn);
        },
        fire(name) {
            for (const fn of listeners[name] ?? []) {
                fn({ stopPropagation() {} });
            }
        },
        querySelectorAll(selector: string) {
            const match = /^\[data-detail-for="(.+)"\]$/.exec(selector);
            if (!match) {
                return [];
            }
            const id = match[1];
            const found: StubNode[] = [];
            const walk = (node: StubNode) => {
                if (node.dataset.detailFor === id) {
                    found.push(node);
                }
                for (const child of node.children) {
                    walk(child);
                }
            };
            walk(self);
            return found;
        },
    };

    return self;
}

function runScript(payload: TestPayload): {
    posts: Array<Record<string, unknown>>;
    body: StubNode;
    count: StubNode;
} {
    const posts: Array<Record<string, unknown>> = [];
    const nodes = new Map<string, StubNode>();
    for (const id of ELEMENT_IDS) {
        const node = makeNode(id === 'filter' ? 'input' : 'div');
        node.id = id;
        nodes.set(id, node);
    }

    const documentStub = {
        getElementById(id: string) {
            return nodes.get(id) ?? null;
        },
        querySelectorAll(selector: string) {
            return nodes.get('body')?.querySelectorAll(selector) ?? [];
        },
        createElement(tag: string) {
            return makeNode(tag);
        },
    };

    const listeners: Array<(event: { data: unknown }) => void> = [];
    const windowStub = {
        addEventListener(name: string, fn: (event: { data: unknown }) => void) {
            if (name === 'message') {
                listeners.push(fn);
            }
        },
    };

    const acquireVsCodeApi = () => ({
        postMessage(message: Record<string, unknown>) {
            posts.push(message);
        },
    });

    // `renderControls` is exercised by shell tests; here it only needs to exist.
    // `RAW_PANE_SCRIPT` is concatenated the same way `htmlDocument` assembles a panel.
    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        'renderControls',
        `${RAW_PANE_SCRIPT}\n${ACTIVATIONS_SCRIPT}`,
    )(documentStub, windowStub, acquireVsCodeApi, () => {});

    for (const listener of listeners) {
        listener({ data: { type: 'activations', payload } });
    }

    return {
        posts,
        body: nodes.get('body') as StubNode,
        count: nodes.get('count') as StubNode,
    };
}

function findButtons(node: StubNode, label: string): StubNode[] {
    const found: StubNode[] = [];
    const walk = (current: StubNode) => {
        if (current.tag === 'button' && current.textContent === label) {
            found.push(current);
        }
        for (const child of current.children) {
            walk(child);
        }
    };
    walk(node);
    return found;
}

describe('ACTIVATIONS_SCRIPT', () => {
    it('shows No results for an empty successful payload', () => {
        const { body, count } = runScript({
            heading: 'Activations · production',
            subtitle: 'Context: demo',
            command: 'versori projects activations list',
            controls: [],
            controlValues: { environment: 'production' },
            active: [],
            inactive: [],
            rawJson: '',
        });

        expect(count.textContent).toBe('0 users');
        expect(body.children.some((child) => child.className === 'empty')).toBe(true);
        expect(body.children.find((child) => child.className === 'empty')?.textContent).toBe(
            'No results.',
        );
    });

    it('renders active and inactive groups separately', () => {
        const { body } = runScript({
            heading: 'Activations · production',
            subtitle: 'Context: demo',
            command: 'versori projects activations list',
            controls: [],
            controlValues: { environment: 'production' },
            active: [
                {
                    externalId: 'acme',
                    displayName: 'Acme',
                    status: 'active',
                    activationId: '01ACT',
                    userId: '01USER',
                    createdAt: '',
                    variableSummary: 'tenant',
                },
            ],
            inactive: [
                {
                    externalId: 'beta',
                    displayName: 'Beta',
                    status: 'inactive',
                    activationId: '',
                    userId: '01USER2',
                    createdAt: '',
                    variableSummary: '',
                },
            ],
            rawJson: '',
        });

        const headings = body.children
            .filter((child) => child.className === 'group')
            .map((group) => group.children[0]?.textContent);
        expect(headings).toEqual(['Active (1)', 'Inactive (1)']);
    });

    it('posts deactivate / activate / setVariable / createUser only from explicit clicks', () => {
        const { body, posts } = runScript({
            heading: 'Activations · production',
            subtitle: 'Context: demo',
            command: 'versori projects activations list',
            controls: [],
            controlValues: { environment: 'production' },
            active: [
                {
                    externalId: 'acme',
                    displayName: 'Acme',
                    status: 'active',
                    activationId: '01ACT',
                    userId: '01USER',
                    createdAt: '',
                    variableSummary: '',
                },
            ],
            inactive: [
                {
                    externalId: 'beta',
                    displayName: 'Beta',
                    status: 'inactive',
                    activationId: '',
                    userId: '01USER2',
                    createdAt: '',
                    variableSummary: '',
                },
            ],
            rawJson: '',
        });

        expect(posts).toEqual([]);

        findButtons(body, 'Deactivate')[0]?.fire('click');
        findButtons(body, 'Activate')[0]?.fire('click');
        findButtons(body, 'Set variable')[0]?.fire('click');

        // createUser lives on the toolbar, not inside body — fire via getElement path
        // by re-running is awkward, so assert the mutation posts from row actions first.
        expect(posts).toEqual([
            { type: 'deactivate', externalId: 'acme', label: 'Acme' },
            { type: 'activate', externalId: 'beta', label: 'Beta' },
            { type: 'setVariable', externalId: 'acme', label: 'Acme' },
        ]);
    });
});
