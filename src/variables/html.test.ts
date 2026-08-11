import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { VARIABLES_SCRIPT } from './html';

interface StubNode {
    id: string;
    tag: string;
    className: string;
    value: string;
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

interface TestRow {
    name: string;
    type: string;
    required: boolean;
    description: string;
    shape: string;
}

interface TestPayload {
    heading: string;
    subtitle: string;
    command: string;
    variables: TestRow[];
    rawJson: string;
    error?: string;
}

const ELEMENT_IDS = [
    'heading',
    'subtitle',
    'command',
    'raw',
    'count',
    'body',
    'filter',
    'refresh',
    'toggleRaw',
    'add',
];

function makeNode(tag: string): StubNode {
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
        get textContent() {
            return text;
        },
        set textContent(value: string) {
            text = value;
            self.children = [];
        },
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
                fn();
            }
        },
    };

    return self;
}

function runScript(payload: TestPayload): {
    posts: Array<Record<string, unknown>>;
    body: StubNode;
    count: StubNode;
    add: StubNode;
} {
    const posts: Array<Record<string, unknown>> = [];
    const nodes = new Map<string, StubNode>();
    for (const id of ELEMENT_IDS) {
        const node = makeNode(id === 'filter' ? 'input' : id === 'add' ? 'button' : 'div');
        node.id = id;
        nodes.set(id, node);
    }

    const documentStub = {
        getElementById(id: string) {
            return nodes.get(id) ?? null;
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

    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        `${RAW_PANE_SCRIPT}\n${VARIABLES_SCRIPT}`,
    )(documentStub, windowStub, acquireVsCodeApi);

    for (const listener of listeners) {
        listener({ data: { type: 'variables', payload } });
    }

    return {
        posts,
        body: nodes.get('body') as StubNode,
        count: nodes.get('count') as StubNode,
        add: nodes.get('add') as StubNode,
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

describe('VARIABLES_SCRIPT', () => {
    it('shows No results for an empty successful payload', () => {
        const { body, count } = runScript({
            heading: 'Activation variable schema',
            subtitle: 'Context: demo',
            command: 'versori projects variables list',
            variables: [],
            rawJson: '',
        });

        expect(count.textContent).toBe('0 variables');
        expect(body.children.find((child) => child.className === 'empty')?.textContent).toBe(
            'No results.',
        );
    });

    it('posts add / update / remove only from explicit clicks', () => {
        const { body, add, posts } = runScript({
            heading: 'Activation variable schema',
            subtitle: 'Context: demo',
            command: 'versori projects variables list',
            variables: [
                {
                    name: 'tenant_org_id',
                    type: 'string',
                    required: true,
                    description: 'Tenant org',
                    shape: '',
                },
            ],
            rawJson: '',
        });

        expect(posts).toEqual([]);

        add.fire('click');
        findButtons(body, 'Update')[0]?.fire('click');
        findButtons(body, 'Remove')[0]?.fire('click');

        expect(posts).toEqual([
            { type: 'add' },
            { type: 'update', name: 'tenant_org_id' },
            { type: 'remove', name: 'tenant_org_id' },
        ]);
    });
});
