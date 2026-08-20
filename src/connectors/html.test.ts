import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { CONNECTORS_SCRIPT } from './html';

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
    querySelectorAll(selector: string): StubNode[];
    querySelector(selector: string): StubNode | null;
    lastChild: StubNode | null;
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
    'body',
    'connectorList',
    'connectorDetail',
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
    return tagged ? node.tag === tagged[1] : false;
}

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
        appendChild(child) {
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
        querySelector(selector: string) {
            return self.querySelectorAll(selector)[0] ?? null;
        },
        get lastChild() {
            return self.children[self.children.length - 1] ?? null;
        },
    };
    return self;
}

function findByText(node: StubNode, value: string): boolean {
    if (node.textContent === value) {
        return true;
    }
    return node.children.some((child) => findByText(child, value));
}

function sampleConnector() {
    return {
        id: '01GCS',
        connectionTemplateId: '01TPL',
        name: 'google_cloud_storage',
        domain: 'googleapis.com',
        dynamic: false,
        templateBaseUrl: 'https://storage.googleapis.com',
        schemes: [
            { type: 'none', name: 'n1', label: 'None', grant: '' },
            { type: 'oauth2', name: 'oauth-main', label: 'OAuth 2', grant: 'authorizationCode' },
        ],
        status: 'bypassed' as const,
        activeConnectionId: '01CONN',
        activeConnectionName: 'No Authentication - c-y3',
        activeBaseUrl: 'https://storage.googleapis.com',
    };
}

function runScript() {
    const posts: Array<Record<string, unknown>> = [];
    const nodes = new Map<string, StubNode>();
    for (const id of ELEMENT_IDS) {
        const node = makeNode(id === 'filter' ? 'input' : 'div');
        node.id = id;
        nodes.set(id, node);
    }
    const listeners: Array<(event: { data: unknown }) => void> = [];
    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        'renderControls',
        `${RAW_PANE_SCRIPT}\n${CONNECTORS_SCRIPT}`,
    )(
        {
            getElementById(id: string) {
                return nodes.get(id) ?? null;
            },
            createElement(tag: string) {
                return makeNode(tag);
            },
        },
        {
            addEventListener(name: string, fn: (event: { data: unknown }) => void) {
                if (name === 'message') {
                    listeners.push(fn);
                }
            },
        },
        () => ({
            postMessage(message: Record<string, unknown>) {
                posts.push(message);
            },
        }),
        () => {},
    );

    function send(data: unknown) {
        for (const listener of listeners) {
            listener({ data });
        }
    }

    send({
        type: 'connectors',
        payload: {
            heading: 'Connectors · production',
            subtitle: 'Context: demo',
            command: 'versori projects systems list',
            controls: [],
            controlValues: { environment: 'production' },
            connectors: [sampleConnector()],
            rawJson: '{}',
        },
    });

    return {
        posts,
        list: nodes.get('connectorList') as StubNode,
        detail: nodes.get('connectorDetail') as StubNode,
        send,
    };
}

describe('CONNECTORS_SCRIPT', () => {
    it('lists connectors with status badges and posts select', () => {
        const { posts, list } = runScript();
        expect(findByText(list, 'google_cloud_storage')).toBe(true);
        expect(findByText(list, 'Bypassed')).toBe(true);
        posts.length = 0;
        const row = list.querySelectorAll('button')[0];
        row?.fire('click');
        expect(posts).toEqual([{ type: 'select', id: '01GCS' }]);
    });

    it('shows active and existing connections without a standalone scheme editor', () => {
        const { detail, send } = runScript();
        send({
            type: 'detail',
            connector: sampleConnector(),
            existing: [{ id: '01CONN', name: 'No Authentication - c-y3', baseUrl: 'https://storage.googleapis.com' }],
        });

        expect(findByText(detail, 'Config schemes')).toBe(false);
        expect(findByText(detail, 'Add scheme')).toBe(false);
        expect(findByText(detail, 'New Connection')).toBe(true);
        expect(findByText(detail, 'Active Connection')).toBe(true);
        expect(findByText(detail, 'Remove Connection')).toBe(true);
        expect(findByText(detail, 'Remove')).toBe(false);
        expect(findByText(detail, 'Connection In Use')).toBe(true);
        expect(findByText(detail, 'https://storage.googleapis.com')).toBe(true);
    });

    it('opens an inline new-connection form with new and existing auth options', () => {
        const { posts, detail, send } = runScript();
        send({
            type: 'detail',
            connector: sampleConnector(),
            existing: [{ id: '01CONN', name: 'No Authentication - c-y3', baseUrl: 'https://storage.googleapis.com' }],
        });

        posts.length = 0;
        const create = detail.querySelectorAll('button').find((node) => node.dataset.action === 'new-connection');
        create?.fire('click');
        expect(posts).toEqual([]);
        expect(findByText(detail, 'Select Authentication')).toBe(true);
        expect(findByText(detail, 'API Key')).toBe(true);
        expect(findByText(detail, 'OAuth2')).toBe(true);
        expect(findByText(detail, 'n1')).toBe(true);
        expect(findByText(detail, 'oauth-main')).toBe(true);
        expect(findByText(detail, 'Connect')).toBe(true);
        expect(findByText(detail, 'Cancel')).toBe(true);
    });

    it('posts create-connection from the inline form and remove-connection from the overview', () => {
        const { posts, detail, send } = runScript();
        send({
            type: 'detail',
            connector: sampleConnector(),
            existing: [
                { id: '01CONN', name: 'No Authentication - c-y3', baseUrl: 'https://storage.googleapis.com' },
                { id: '01OTHER', name: 'Spare key', baseUrl: 'https://storage.googleapis.com' },
            ],
        });

        posts.length = 0;
        const remove = detail.querySelectorAll('button').find((node) => node.dataset.action === 'remove-connection');
        remove?.fire('click');
        const use = detail.querySelectorAll('button').find((node) => node.dataset.action === 'use-connection');
        use?.fire('click');
        expect(posts).toEqual([
            { type: 'remove-connection', id: '01CONN' },
            { type: 'use-connection', id: '01OTHER' },
        ]);
        expect(detail.querySelectorAll('button').some((node) => node.dataset.action === 'delete-connection')).toBe(
            false,
        );

        posts.length = 0;
        const start = detail.querySelectorAll('button').find((node) => node.dataset.action === 'new-connection');
        start?.fire('click');
        const auth = detail.querySelector('select');
        if (auth) {
            auth.value = 'existing:n1';
            auth.fire('change');
        }
        const name = detail.querySelectorAll('input').find((node) => node.dataset.field === 'connectionName');
        if (name) {
            name.value = 'gcs-static';
        }
        const connect = detail.querySelectorAll('button').find((node) => node.dataset.action === 'connect');
        connect?.fire('click');
        expect(posts).toEqual([
            {
                type: 'create-connection',
                schemeMode: 'existing',
                schemeType: 'none',
                schemeName: 'n1',
                connectionName: 'gcs-static',
                baseUrl: 'https://storage.googleapis.com',
                bypass: true,
            },
        ]);
    });
});
