import { describe, expect, it } from 'vitest';

import { BASE_CSS, CONTROLS_SCRIPT, FIELD_PICKER_SCRIPT, htmlDocument } from './shell';

const parts = {
    nonce: 'TESTNONCE',
    title: 'Versori',
    styles: '.extra { color: red; }',
    body: '<div id="body"></div>',
    script: 'const x = 1;',
};

describe('htmlDocument', () => {
    it('locks the CSP to the nonce and forbids every default source', () => {
        const html = htmlDocument(parts);
        expect(html).toContain(
            "default-src 'none'; style-src 'nonce-TESTNONCE'; script-src 'nonce-TESTNONCE';",
        );
    });

    it('nonces both the style and script tags, or the CSP would block them', () => {
        const html = htmlDocument(parts);
        expect(html).toContain('<style nonce="TESTNONCE">');
        expect(html).toContain('<script nonce="TESTNONCE">');
    });

    it('includes the base CSS ahead of the caller styles, so callers can override', () => {
        const html = htmlDocument(parts);
        expect(html.indexOf(BASE_CSS)).toBeGreaterThan(-1);
        expect(html.indexOf(BASE_CSS)).toBeLessThan(html.indexOf('.extra { color: red; }'));
    });

    it('places the body and script where the caller supplied them', () => {
        const html = htmlDocument(parts);
        expect(html).toContain('<div id="body"></div>');
        expect(html).toContain('const x = 1;');
    });

    it('names no external origin anywhere — every resource is inline', () => {
        expect(htmlDocument(parts)).not.toMatch(/https?:\/\//);
    });
});

describe('shared scripts', () => {
    it('declare the functions panels call, so a panel cannot silently miss one', () => {
        expect(CONTROLS_SCRIPT).toContain('function renderControls(');
        expect(FIELD_PICKER_SCRIPT).toContain('function renderFieldPicker(');
    });
});

/**
 * Executes `CONTROLS_SCRIPT` against a stubbed DOM instead of just pattern-matching
 * its text, so a syntax error or unresolved identifier inside the template literal
 * — invisible to typecheck and to the tests above — actually fails a test.
 */
describe('renderControls (executed)', () => {
    interface StubNode {
        id: string;
        value: string;
        className: string;
        htmlFor: string;
        type: string;
        min?: string;
        placeholder: string;
        selected: boolean;
        textContent: string;
        style: Record<string, string>;
        children: StubNode[];
        appendChild(child: StubNode): void;
        addEventListener(name: string, fn: (...args: unknown[]) => void): void;
        fire(name: string, ...args: unknown[]): void;
    }

    interface StubHost {
        style: Record<string, string>;
        children: StubNode[];
        textContent: string;
        appendChild(child: StubNode): void;
    }

    interface DocumentStub {
        createElement(tag: string): StubNode;
    }

    type RenderControls = (
        host: StubHost,
        controls: unknown[],
        values: Record<string, unknown>,
        onChange: (id: string, value: unknown) => void,
        onApply: () => void,
        controlError: string | undefined,
    ) => void;

    function node(): StubNode {
        const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        const self: StubNode = {
            id: '',
            value: '',
            className: '',
            htmlFor: '',
            type: '',
            min: undefined,
            placeholder: '',
            selected: false,
            textContent: '',
            style: {},
            children: [],
            appendChild(child) {
                self.children.push(child);
            },
            addEventListener(name, fn) {
                (listeners[name] ??= []).push(fn);
            },
            fire(name, ...args) {
                (listeners[name] ?? []).forEach((fn) => fn(...args));
            },
        };
        return self;
    }

    // `renderControls` clears the host with `host.textContent = ''` on every call,
    // including the first — counting those assignments is how we detect a rebuild
    // without needing a real DOM.
    function makeHost(): { host: StubHost; rebuildCount: () => number } {
        let rebuilds = 0;
        let children: StubNode[] = [];
        const host: StubHost = {
            style: {},
            get children() {
                return children;
            },
            get textContent() {
                return '';
            },
            set textContent(v: string) {
                if (v === '') {
                    rebuilds += 1;
                    children = [];
                }
            },
            appendChild(child) {
                children.push(child);
            },
        };
        return { host, rebuildCount: () => rebuilds };
    }

    function findById(root: { children: StubNode[] }, id: string): StubNode | undefined {
        for (const child of root.children) {
            if (child.id === id) {
                return child;
            }
            const found = findById(child, id);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    const documentStub: DocumentStub = { createElement: () => node() };
    const factory = new Function('document', `${CONTROLS_SCRIPT}\nreturn renderControls;`) as (
        doc: DocumentStub,
    ) => RenderControls;
    const renderControls = factory(documentStub);

    // Mirrors the log panel's actual control row: a time-range select gating a
    // "Custom range..." datetime pair, plus a plain number control.
    const rangeControl = {
        kind: 'select',
        id: 'range',
        label: 'Time range',
        value: '1h',
        options: [
            { value: '1h', label: 'Last hour' },
            { value: 'custom', label: 'Custom range...' },
        ],
    };
    const fromControl = {
        kind: 'datetime',
        id: 'from',
        label: 'From',
        value: '',
        showWhen: { field: 'range', equals: 'custom' },
    };
    const limitControl = { kind: 'number', id: 'limit', label: 'Limit', value: 200, min: 1 };
    const controls = [rangeControl, fromControl, limitControl];

    it('hides a showWhen-gated control while its condition is unmet', () => {
        const { host } = makeHost();
        const values: Record<string, unknown> = { range: '1h', limit: 200 };
        renderControls(host, controls, values, () => {}, () => {}, undefined);

        expect(findById(host, 'c_from')).toBeUndefined();
    });

    it('reveals the gated control the instant the select fires change, proving showWhen survives the extraction', () => {
        const { host } = makeHost();
        const values: Record<string, unknown> = { range: '1h', limit: 200 };
        const onChange = (id: string, value: unknown) => {
            values[id] = value;
        };
        renderControls(host, controls, values, onChange, () => {}, undefined);

        const rangeInput = findById(host, 'c_range');
        if (!rangeInput) {
            throw new Error('c_range was not rendered');
        }
        rangeInput.value = 'custom';
        rangeInput.fire('change');

        expect(findById(host, 'c_from')).toBeDefined();
    });

    it('regression: a number control commits its value on change without rebuilding the row, while a select change still rebuilds — the fix for the focus-loss bug where a mid-edit number/datetime input lost focus on every keystroke commit', () => {
        const { host, rebuildCount } = makeHost();
        const values: Record<string, unknown> = { range: '1h', limit: 200 };
        const onChange = (id: string, value: unknown) => {
            values[id] = value;
        };
        renderControls(host, controls, values, onChange, () => {}, undefined);
        const baseline = rebuildCount();

        const limitInput = findById(host, 'c_limit');
        if (!limitInput) {
            throw new Error('c_limit was not rendered');
        }
        limitInput.value = '250';
        limitInput.fire('change');

        expect(rebuildCount()).toBe(baseline);
        expect(values.limit).toBe(250);

        const rangeInput = findById(host, 'c_range');
        if (!rangeInput) {
            throw new Error('c_range was not rendered');
        }
        rangeInput.value = 'custom';
        rangeInput.fire('change');

        expect(rebuildCount()).toBe(baseline + 1);
    });
});
