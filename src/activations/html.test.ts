import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { ACTIVATIONS_SCRIPT } from './html';

interface StubNode {
    id: string;
    tag: string;
    type: string;
    className: string;
    value: string;
    textContent: string;
    hidden: boolean;
    selected: boolean;
    checked: boolean;
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
    'filter',
    'refresh',
    'toggleRaw',
    'createUser',
    'redeploy',
    'body',
    'userList',
    'userDetail',
    'newUser',
    'newDisplayName',
    'newExternalId',
    'newUserCancel',
    'newUserAdd',
];

function matchesSelector(node: StubNode, selector: string): boolean {
    const data = /^(\w+)?\[data-([a-z]+)\]$/.exec(selector);
    if (data) {
        const tag = data[1];
        const key = data[2];
        if (tag && node.tag !== tag) {
            return false;
        }
        return Boolean(node.dataset[key]);
    }
    const tagged = /^(\w+)$/.exec(selector);
    if (tagged) {
        return node.tag === tagged[1];
    }
    return false;
}

function makeNode(tag: string): StubNode {
    const listeners: Record<string, Array<(event?: { stopPropagation(): void }) => void>> = {};
    const classes = new Set<string>();
    let text = '';
    let storedValue = '';

    const self: StubNode = {
        id: '',
        tag,
        type: '',
        get className() {
            return [...classes].join(' ');
        },
        set className(value: string) {
            classes.clear();
            for (const name of value.split(' ').filter(Boolean)) {
                classes.add(name);
            }
        },
        get value() {
            if (tag === 'select') {
                const picked = self.children.find((child) => child.selected) ?? self.children[0];
                return picked?.value ?? storedValue;
            }
            return storedValue;
        },
        set value(next: string) {
            storedValue = next;
            if (tag === 'select') {
                for (const child of self.children) {
                    child.selected = child.value === next;
                }
            }
        },
        get textContent() {
            return text;
        },
        set textContent(value: string) {
            text = value;
            self.children = [];
        },
        hidden: false,
        selected: false,
        checked: false,
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
            const found: StubNode[] = [];
            const walk = (node: StubNode) => {
                if (matchesSelector(node, selector)) {
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
    userList: StubNode;
    userDetail: StubNode;
    count: StubNode;
    nodes: Map<string, StubNode>;
    send(data: unknown): void;
} {
    const posts: Array<Record<string, unknown>> = [];
    const nodes = new Map<string, StubNode>();
    for (const id of ELEMENT_IDS) {
        const node = makeNode(
            id === 'filter' || id === 'newDisplayName' || id === 'newExternalId' ? 'input' : 'div',
        );
        node.id = id;
        if (id === 'createUser' || id === 'redeploy' || id === 'newUserCancel' || id === 'newUserAdd') {
            node.tag = 'button';
        }
        nodes.set(id, node);
    }

    const documentStub = {
        getElementById(id: string) {
            return nodes.get(id) ?? null;
        },
        querySelectorAll(selector: string) {
            return nodes.get('userDetail')?.querySelectorAll(selector) ?? [];
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
        'renderControls',
        `${RAW_PANE_SCRIPT}\n${ACTIVATIONS_SCRIPT}`,
    )(documentStub, windowStub, acquireVsCodeApi, () => {});

    for (const listener of listeners) {
        listener({ data: { type: 'activations', payload } });
    }

    return {
        posts,
        userList: nodes.get('userList') as StubNode,
        userDetail: nodes.get('userDetail') as StubNode,
        count: nodes.get('count') as StubNode,
        nodes,
        send(data: unknown) {
            for (const listener of listeners) {
                listener({ data });
            }
        },
    };
}

function findUserRow(node: StubNode, externalId: string): StubNode | undefined {
    let found: StubNode | undefined;
    const walk = (current: StubNode) => {
        if (current.tag === 'button' && current.dataset.id === externalId) {
            found = current;
        }
        for (const child of current.children) {
            walk(child);
        }
    };
    walk(node);
    return found;
}

function findByText(node: StubNode, text: string): boolean {
    if (node.textContent === text) {
        return true;
    }
    return node.children.some((child) => findByText(child, text));
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

function samplePayload(): TestPayload {
    return {
        heading: 'Activations · production',
        subtitle: 'Context: demo',
        command: 'versori projects activations list',
        controls: [],
        controlValues: { environment: 'production' },
        active: [
            {
                externalId: 'george',
                displayName: 'George Test Seller',
                status: 'active',
                activationId: '01ACT',
                userId: '01USER',
                createdAt: '',
                variableSummary: 'dryMode',
            },
        ],
        inactive: [
            {
                externalId: 'testtest',
                displayName: 'testtest',
                status: 'inactive',
                activationId: '',
                userId: '01USER2',
                createdAt: '',
                variableSummary: '',
            },
        ],
        rawJson: '',
    };
}

describe('ACTIVATIONS_SCRIPT', () => {
    it('shows an empty detail pane until a user is selected', () => {
        const { userDetail, count } = runScript({
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
        expect(userDetail.children.some((child) => child.className === 'empty')).toBe(true);
    });

    it('lists pending users above activated users', () => {
        const { userList } = runScript(samplePayload());
        const headings = userList.children
            .filter((child) => child.className === 'user-group')
            .map((group) => group.children[0]?.textContent);
        expect(headings).toEqual(['Pending activation (1)', 'Activated (1)']);
    });

    it('posts select when a pending user is clicked, not activate', () => {
        const { userList, posts } = runScript(samplePayload());
        expect(posts).toEqual([]);

        const row = findUserRow(userList, 'testtest');
        row?.fire('click');

        expect(posts).toEqual([
            {
                type: 'select',
                externalId: 'testtest',
                label: 'testtest',
                userId: '01USER2',
                status: 'inactive',
            },
        ]);
    });

    it('renders a connection dropdown per system and activates with the chosen ids', () => {
        const { userDetail, posts, send } = runScript(samplePayload());

        send({
            type: 'workspace',
            externalId: 'testtest',
            displayName: 'testtest',
            userId: '01USER2',
            status: 'inactive',
            activationId: '',
            systems: [
                {
                    name: 'ebay',
                    systemId: '01EBAY',
                    templateId: '01TPL_EBAY',
                    dynamic: true,
                    options: [
                        { id: '01CONN_EBAY', name: 'George', baseUrl: 'https://api.sandbox.ebay.com' },
                    ],
                },
                {
                    name: 'Walmart_seller_onboarding',
                    systemId: '01WAL',
                    templateId: '01TPL_WAL',
                    dynamic: true,
                    options: [
                        {
                            id: '01CONN_WAL',
                            name: 'Walmart-conn',
                            baseUrl: 'https://marketplace.walmartapis.com',
                        },
                    ],
                },
            ],
            schema: [{ name: 'DryMode', type: 'boolean', required: false, description: '' }],
            variableNames: [],
        });

        expect(userDetail.querySelectorAll('select[data-template]')).toHaveLength(2);
        expect(findButtons(userDetail, 'Delete user')).toHaveLength(1);

        posts.length = 0;
        findButtons(userDetail, 'Activate user')[0]?.fire('click');

        expect(posts).toEqual([
            {
                type: 'activate',
                externalId: 'testtest',
                label: 'testtest',
                connections: [
                    { templateId: '01TPL_EBAY', connectionId: '01CONN_EBAY' },
                    { templateId: '01TPL_WAL', connectionId: '01CONN_WAL' },
                ],
                variables: [{ name: 'DryMode', value: 'false' }],
            },
        ]);
    });

    it('posts deleteUser from the detail pane', () => {
        const { userDetail, posts, send } = runScript(samplePayload());
        send({
            type: 'workspace',
            externalId: 'testtest',
            displayName: 'testtest',
            userId: '01USER2',
            status: 'inactive',
            activationId: '',
            systems: [],
            schema: [],
            variableNames: [],
        });

        posts.length = 0;
        findButtons(userDetail, 'Delete user')[0]?.fire('click');
        expect(posts).toEqual([
            {
                type: 'deleteUser',
                externalId: 'testtest',
                userId: '01USER2',
                label: 'testtest',
            },
        ]);
    });

    it('opens New User with both fields and posts them together', () => {
        const { posts, nodes } = runScript(samplePayload());
        expect(posts).toEqual([]);
        nodes.get('createUser')?.fire('click');
        expect(posts).toEqual([]);
        expect(nodes.get('newUser')?.hidden).toBe(false);

        nodes.get('newDisplayName')!.value = 'Paddy Test Seller';
        nodes.get('newExternalId')!.value = 'paddy';
        nodes.get('newUserAdd')?.fire('click');

        expect(posts).toEqual([
            {
                type: 'createUser',
                displayName: 'Paddy Test Seller',
                externalId: 'paddy',
            },
        ]);
        expect(nodes.get('newUser')?.hidden).toBe(true);
    });

    it('shows current variable values for an activated user and posts Update variables', () => {
        const { userDetail, posts, send } = runScript(samplePayload());
        send({
            type: 'workspace',
            externalId: 'george',
            displayName: 'George Test Seller',
            userId: '01USER',
            status: 'active',
            activationId: '01ACT',
            systems: [
                {
                    name: 'ebay',
                    systemId: '01EBAY',
                    templateId: '01TPL_EBAY',
                    dynamic: true,
                    options: [],
                    boundName: 'George',
                },
            ],
            schema: [
                { name: 'DryMode', type: 'boolean', required: false, description: '' },
                { name: 'batchFlushRows', type: 'integer', required: false, description: '' },
            ],
            variableNames: ['DryMode', 'batchFlushRows'],
            variableValues: { DryMode: 'true', batchFlushRows: '600' },
        });

        expect(findByText(userDetail, 'Activated')).toBe(true);
        expect(findByText(userDetail, 'Connected - George · Authorization Code')).toBe(true);
        expect(findByText(userDetail, 'External ID: george')).toBe(true);
        expect(findByText(userDetail, 'Activation ID: 01ACT')).toBe(true);
        const boxes = userDetail.querySelectorAll('[data-var]');
        expect(boxes).toHaveLength(2);
        expect(boxes.find((node) => node.dataset.var === 'DryMode')?.checked).toBe(true);
        expect(boxes.find((node) => node.dataset.var === 'batchFlushRows')?.value).toBe('600');

        posts.length = 0;
        findButtons(userDetail, 'Update Activation Variables')[0]?.fire('click');
        expect(posts).toEqual([
            {
                type: 'updateVariables',
                externalId: 'george',
                label: 'George Test Seller',
                variables: [
                    { name: 'DryMode', value: 'true' },
                    { name: 'batchFlushRows', value: '600' },
                ],
            },
        ]);
    });

    it('posts redeploy from the toolbar', () => {
        const { posts, nodes } = runScript(samplePayload());
        nodes.get('redeploy')?.fire('click');
        expect(posts).toEqual([{ type: 'redeploy' }]);
    });
});
