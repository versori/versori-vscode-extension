import { describe, expect, it } from 'vitest';

import { ResourceEditorState } from './config';
import { renderResourcesHtml, RESOURCES_SCRIPT, ResourcesPayload } from './html';

/**
 * Executes `RESOURCES_SCRIPT` against a stubbed DOM, driven by a `resources`
 * message — same seam as `src/kv/html.test.ts` / `src/issues/html.test.ts`.
 */

interface StubNode {
    id: string;
    tag: string;
    className: string;
    value: string;
    checked: boolean;
    disabled: boolean;
    type: string;
    min: string;
    max: string;
    step: string;
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
    setAttribute(name: string, value: string): void;
    addEventListener(name: string, fn: (...args: unknown[]) => void): void;
    fire(name: string, event?: unknown): void;
}

const ELEMENT_IDS = [
    'heading',
    'subtitle',
    'resources',
    'scaling',
    'networking',
    'advanced',
    'advancedFields',
    'discard',
    'apply',
    'status',
];

function makeNode(tag: string, all: StubNode[]): StubNode {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
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
        disabled: false,
        type: '',
        min: '',
        max: '',
        step: '',
        get textContent() {
            return text;
        },
        set textContent(value: string) {
            text = value ?? '';
            self.children.length = 0;
        },
        dataset: {},
        style: {},
        children: [],
        classList: {
            toggle(name: string, force?: boolean) {
                const on = force === undefined ? !classes.has(name) : force;
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
            all.push(child);
        },
        setAttribute() {},
        addEventListener(name: string, fn: (...args: unknown[]) => void) {
            (listeners[name] ??= []).push(fn);
        },
        fire(name: string, event?: unknown) {
            for (const fn of listeners[name] ?? []) {
                fn(event);
            }
        },
    };
    return self;
}

function collectText(node: StubNode): string {
    const own = node.textContent || '';
    const kids = node.children.map(collectText).join('');
    return own + kids;
}

function findByText(nodes: StubNode[], text: string): StubNode | undefined {
    return nodes.find((node) => collectText(node).includes(text));
}

function walk(node: StubNode): StubNode[] {
    return [node, ...node.children.flatMap(walk)];
}

function valueInput(root: StubNode, key: string): StubNode | undefined {
    return walk(root).find((node) => node.tag === 'input' && node.dataset.key === key);
}

function findLiveInput(root: StubNode, type: string): StubNode | undefined {
    return walk(root).find((node) => node.tag === 'input' && node.type === type);
}

function mount(payload: ResourcesPayload): {
    messages: unknown[];
    nodes: StubNode[];
    byId: Record<string, StubNode>;
    post(message: unknown): void;
    click(id: string): void;
} {
    const messages: unknown[] = [];
    const nodes: StubNode[] = [];
    const byId: Record<string, StubNode> = {};

    for (const id of ELEMENT_IDS) {
        const node = makeNode(id === 'advanced' ? 'details' : 'div', nodes);
        node.id = id;
        byId[id] = node;
        nodes.push(node);
    }

    const documentStub = {
        getElementById(id: string) {
            return byId[id];
        },
        createElement(tag: string) {
            const node = makeNode(tag, nodes);
            nodes.push(node);
            return node;
        },
        createTextNode(value: string) {
            const node = makeNode('#text', nodes);
            node.textContent = value;
            nodes.push(node);
            return node;
        },
    };

    const listeners: Record<string, Array<(event: { data: unknown }) => void>> = {};
    const windowStub = {
        addEventListener(name: string, fn: (event: { data: unknown }) => void) {
            (listeners[name] ??= []).push(fn);
        },
    };

    const acquireVsCodeApi = () => ({
        postMessage(message: unknown) {
            messages.push(message);
        },
    });

    const fn = new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        `${RESOURCES_SCRIPT}\n//# sourceURL=resources-html-test.js`,
    );
    fn(documentStub, windowStub, acquireVsCodeApi);

    function post(message: unknown): void {
        for (const fn of listeners.message ?? []) {
            fn({ data: message });
        }
    }

    post({ type: 'resources', payload });

    return {
        messages,
        nodes,
        byId,
        post,
        click(id: string) {
            byId[id].fire('click');
        },
    };
}

const baseEditor: ResourceEditorState = {
    cpu: { mode: 'slider', value: 170 },
    memory: { mode: 'slider', value: 200 },
    storage: { mode: 'unset' },
    replicas: { mode: 'slider', value: 1 },
    maxReplicas: { mode: 'custom', raw: '5' },
    staticIP: false,
    serviceAccount: 'sync-sa',
    requests: { cpu: '100m', memory: '200Mi', storage: '' },
};

function payload(over: Partial<ResourcesPayload> = {}): ResourcesPayload {
    return {
        heading: 'Environment Config',
        subtitle: 'Context: demo',
        environment: 'production',
        editor: baseEditor,
        ...over,
    };
}

describe('renderResourcesHtml', () => {
    it('embeds the Resources / Scaling / Networking chrome and Apply', () => {
        const html = renderResourcesHtml('test-nonce');
        expect(html).toContain('Resources');
        expect(html).toContain('Scaling');
        expect(html).toContain('Networking');
        expect(html).toContain('Advanced');
        expect(html).toContain('>Apply<');
        expect(html).toContain('id="navBack"');
        expect(html).toContain('id="navClose"');
        expect(html).toContain("script-src 'nonce-test-nonce'");
    });
});

describe('RESOURCES_SCRIPT', () => {
    it('renders value boxes with bounds and keeps out-of-range values as text', () => {
        const { nodes, byId } = mount(payload());

        expect(byId.heading.textContent).toBe('Environment Config');
        expect(collectText(byId.subtitle)).toContain('production');

        expect(nodes.some((node) => node.tag === 'input' && node.type === 'range')).toBe(false);
        expect(valueInput(byId.resources, 'cpu')?.value).toBe('170');
        expect(findByText(nodes, 'Min 50m · Max 500m · Live 170m')).toBeTruthy();

        expect(findByText(nodes, 'outside the allowed range')).toBeTruthy();
        const customInputs = nodes.filter(
            (node) => node.tag === 'input' && node.type === 'text' && node.value === '5',
        );
        expect(customInputs.length).toBeGreaterThanOrEqual(1);

        expect(findByText(nodes, 'Not set')).toBeTruthy();
        expect(byId.advancedFields.children.some((child) => collectText(child).includes('Service account'))).toBe(
            true,
        );
    });

    it('posts the current editor on Apply', () => {
        const ui = mount(payload());
        ui.click('apply');

        expect(ui.messages).toEqual([
            {
                type: 'apply',
                editor: baseEditor,
            },
        ]);
        expect(ui.byId.status.textContent).toBe('Updating…');
        expect(ui.byId.apply.disabled).toBe(true);
    });

    it('clamps and snaps typed values on change, without re-rendering', () => {
        const ui = mount(payload());
        const field = valueInput(ui.byId.resources, 'cpu')!;

        field.value = '9999';
        field.fire('change');
        expect(field.value).toBe('500');

        field.value = '12';
        field.fire('change');
        expect(field.value).toBe('50');

        field.value = '233';
        field.fire('change');
        expect(field.value).toBe('230');

        field.value = 'abc';
        field.fire('change');
        expect(field.value).toBe('230');

        expect(valueInput(ui.byId.resources, 'cpu')).toBe(field);
        ui.click('apply');
        expect((ui.messages[0] as { editor: ResourceEditorState }).editor.cpu).toEqual({
            mode: 'slider',
            value: 230,
        });
    });

    it('converts through the unit box and reset restores the live value', () => {
        const ui = mount(payload());
        const select = walk(ui.byId.resources).find(
            (node) => node.tag === 'select' && node.dataset.unitFor === 'memory',
        )!;
        select.value = 'GiB';
        select.fire('change');

        let field = valueInput(ui.byId.resources, 'memory')!;
        expect(field.value).toBe('0.2');
        field.value = '1.5';
        field.fire('change');
        expect(field.value).toBe('1.5');

        const reset = walk(ui.byId.resources).filter(
            (node) => node.tag === 'button' && node.textContent === 'Reset',
        );
        // cpu, memory, storage rows render in order.
        reset[1].fire('click');
        field = valueInput(ui.byId.resources, 'memory')!;
        expect(field.value).toBe('0.2');
        ui.click('apply');
        expect((ui.messages[0] as { editor: ResourceEditorState }).editor.memory).toEqual({
            mode: 'slider',
            value: 200,
        });
    });

    it('discards edits back to the baseline payload', () => {
        const ui = mount(payload());
        const checkbox = findLiveInput(ui.byId.networking, 'checkbox');
        expect(checkbox).toBeTruthy();
        checkbox!.checked = true;
        checkbox!.fire('change');

        ui.click('discard');

        const after = findLiveInput(ui.byId.networking, 'checkbox');
        expect(after?.checked).toBe(false);
        expect(ui.byId.status.textContent).toBe('');
    });

    it('applies a success status by refreshing the baseline editor', () => {
        const ui = mount(payload());
        ui.click('apply');

        const updated: ResourceEditorState = {
            ...baseEditor,
            staticIP: true,
            cpu: { mode: 'slider', value: 200 },
        };
        ui.post({
            type: 'status',
            busy: false,
            success: 'Updated resources for production.',
            editor: updated,
        });

        expect(ui.byId.status.textContent).toBe('Updated resources for production.');
        expect(ui.byId.apply.disabled).toBe(false);

        expect(valueInput(ui.byId.resources, 'cpu')?.value).toBe('200');
        expect(findLiveInput(ui.byId.networking, 'checkbox')?.checked).toBe(true);
    });
});
