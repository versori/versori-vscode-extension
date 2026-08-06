import { describe, expect, it } from 'vitest';

import { renderFormHtml } from './html';
import { FormSpec, FormValues } from './types';

/**
 * Executes the form panel's inline script against a stubbed DOM.
 *
 * The script is pulled out of the rendered document rather than stubbed, so the
 * JSON embedding is exercised too. What matters here is the gate in front of a
 * real run: which label the submit button carries, whether the confirm bar is
 * shown before anything is posted, and that a blank required field cannot be
 * submitted at all (the CLI opens an editor for one, which hangs a spawned
 * process).
 *
 * `dryRunFieldId: ''` is the shape used by commands with no dry run, where every
 * submit is live — the case the resources form introduced.
 */
interface StubNode {
    id: string;
    tag: string;
    value: string;
    checked: boolean;
    disabled: boolean;
    textContent: string;
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

const ELEMENT_IDS = [
    'spec',
    'heading',
    'subtitle',
    'fields',
    'submit',
    'cancel',
    'status',
    'confirm',
    'confirmMsg',
    'dontAsk',
    'dontAskWrap',
    'confirmCancel',
    'confirmGo',
    'output',
];

function makeNode(tag: string): StubNode {
    const listeners: Record<string, Array<() => void>> = {};
    const classes = new Set<string>();

    const self: StubNode = {
        id: '',
        tag,
        value: '',
        checked: false,
        disabled: false,
        textContent: '',
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
        addEventListener(name, fn) {
            (listeners[name] ??= []).push(fn);
        },
        fire(name) {
            (listeners[name] ?? []).forEach((fn) => fn());
        },
    };

    return self;
}

/** The behaviour script, as the webview would run it. */
function scriptOf(html: string): string {
    const match = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
    if (!match) {
        throw new Error('no behaviour script in the rendered document');
    }
    return match[1];
}

/** The embedded spec JSON, as the script itself reads it. */
function specJsonOf(html: string): string {
    const match = /id="spec" nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
    if (!match) {
        throw new Error('no spec payload in the rendered document');
    }
    return match[1];
}

interface Posted {
    type: string;
    values?: FormValues;
    dontAskAgain?: boolean;
}

function harness(spec: FormSpec) {
    const html = renderFormHtml(spec, 'test-nonce');

    const byId = new Map<string, StubNode>();
    for (const id of ELEMENT_IDS) {
        const element = makeNode('div');
        element.id = id;
        byId.set(id, element);
    }
    (byId.get('spec') as StubNode).textContent = specJsonOf(html);

    const documentStub = {
        getElementById: (id: string) => byId.get(id),
        createElement: (tag: string) => makeNode(tag),
    };
    const windowStub = { addEventListener: () => {} };
    const posted: Posted[] = [];

    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        scriptOf(html),
    )(documentStub, windowStub, () => ({
        postMessage: (message: Posted) => void posted.push(message),
    }));

    const container = byId.get('fields') as StubNode;

    /** The control for `spec.fields[index]`, appended in spec order. */
    function control(index: number): StubNode {
        const wrap = container.children[index];
        const field = spec.fields[index];
        return field.kind === 'checkbox' ? wrap.children[0].children[0] : wrap.children[1];
    }

    return {
        posted,
        submitLabel: () => (byId.get('submit') as StubNode).textContent,
        submitDisabled: () => (byId.get('submit') as StubNode).disabled,
        confirmShown: () => (byId.get('confirm') as StubNode).classList.contains('show'),
        dontAskOffered: () => (byId.get('dontAskWrap') as StubNode).style.display !== 'none',
        confirmMessage: () => (byId.get('confirmMsg') as StubNode).textContent,
        clickSubmit: () => (byId.get('submit') as StubNode).fire('click'),
        clickConfirmGo: () => (byId.get('confirmGo') as StubNode).fire('click'),
        type(index: number, value: string) {
            const node = control(index);
            node.value = value;
            node.fire('input');
        },
        untick(index: number) {
            const node = control(index);
            node.checked = false;
            node.fire('change');
        },
    };
}

/** The deploy form's shape: a dry-run checkbox, ticked, and a live confirm. */
function deployLikeSpec(): FormSpec {
    return {
        viewType: 'versori.deployForm',
        title: 'Deploy',
        heading: 'Deploy project',
        subtitle: 'Context: dev',
        dryRunFieldId: 'dryRun',
        dryRunLabel: 'Run dry run',
        liveLabel: 'Deploy to {environment}',
        refreshOnReopen: false,
        confirmWhenLive: true,
        confirmSettingId: 'versori.confirmDeploy',
        confirmMessage: 'This will deploy for real to {environment}.',
        buildArgs: () => [],
        successMessage: () => '',
        fields: [
            { kind: 'select', id: 'environment', label: 'Environment', value: 'production', options: ['production', 'staging'] },
            { kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true },
        ],
    };
}

/** The save-version form's shape: both text fields required. */
function versionLikeSpec(): FormSpec {
    return {
        viewType: 'versori.saveVersionForm',
        title: 'Save version',
        heading: 'Save version',
        subtitle: 'Context: dev',
        dryRunFieldId: 'dryRun',
        dryRunLabel: 'Run dry run',
        liveLabel: 'Save version',
        refreshOnReopen: false,
        confirmWhenLive: false,
        confirmSettingId: '',
        confirmMessage: '',
        buildArgs: () => [],
        successMessage: () => '',
        fields: [
            { kind: 'text', id: 'name', label: 'Version name', value: 'v1', required: true },
            { kind: 'textarea', id: 'description', label: 'Description', value: '', required: true },
            { kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true },
        ],
    };
}

/** The resources form's shape: no dry run at all, so every submit is live. */
function resourcesLikeSpec(): FormSpec {
    return {
        viewType: 'versori.resourcesForm',
        title: 'Resources',
        heading: 'Resources · production',
        subtitle: 'Context: dev',
        dryRunFieldId: '',
        dryRunLabel: '',
        liveLabel: 'Update production',
        refreshOnReopen: true,
        confirmWhenLive: true,
        confirmSettingId: '',
        confirmMessage: 'This changes the live deployment config for production.',
        buildArgs: () => [],
        successMessage: () => '',
        fields: [
            { kind: 'text', id: 'cpuLimit', label: 'CPU limit', value: '500m' },
            { kind: 'checkbox', id: 'staticIP', label: 'Static IP', value: true },
        ],
    };
}

describe('form panel script — a command with no dry run', () => {
    it('offers only the live label, since there is nothing to dry run', () => {
        const view = harness(resourcesLikeSpec());

        expect(view.submitLabel()).toBe('Update production');
        expect(view.submitDisabled()).toBe(false);
    });

    it('confirms before posting, so a submit alone never mutates', () => {
        const view = harness(resourcesLikeSpec());

        view.clickSubmit();

        expect(view.confirmShown()).toBe(true);
        expect(view.confirmMessage()).toBe(
            'This changes the live deployment config for production.',
        );
        expect(view.posted).toEqual([]);
    });

    it('posts the edited values only once the confirmation is accepted', () => {
        const view = harness(resourcesLikeSpec());

        view.type(0, '1');
        view.clickSubmit();
        view.clickConfirmGo();

        expect(view.posted).toEqual([
            {
                type: 'submit',
                values: { cpuLimit: '1', staticIP: true },
                dontAskAgain: false,
            },
        ]);
        expect(view.confirmShown()).toBe(false);
    });

    it('hides "Don\'t ask again", which has no setting of its own to turn off', () => {
        // Offering it here would either do nothing or, worse, disable the deploy
        // confirmation — the only other setting the panel knows how to write.
        expect(harness(resourcesLikeSpec()).dontAskOffered()).toBe(false);
    });
});

describe('form panel script — the dry-run forms', () => {
    it('submits a deploy dry run without confirming', () => {
        const view = harness(deployLikeSpec());

        expect(view.submitLabel()).toBe('Run dry run');
        view.clickSubmit();

        expect(view.confirmShown()).toBe(false);
        expect(view.posted).toEqual([
            { type: 'submit', values: { environment: 'production', dryRun: true }, dontAskAgain: false },
        ]);
    });

    it('confirms once the deploy dry run is unticked', () => {
        const view = harness(deployLikeSpec());

        view.untick(1);

        expect(view.submitLabel()).toBe('Deploy to production');
        view.clickSubmit();

        expect(view.confirmShown()).toBe(true);
        expect(view.posted).toEqual([]);
        // Deploy owns versori.confirmDeploy, so it may offer to turn it off.
        expect(view.dontAskOffered()).toBe(true);
    });

    it('blocks a save-version submit while a required field is blank', () => {
        const view = harness(versionLikeSpec());

        expect(view.submitDisabled()).toBe(true);
        view.clickSubmit();
        expect(view.posted).toEqual([]);

        view.type(1, 'what changed');

        expect(view.submitDisabled()).toBe(false);
        view.clickSubmit();
        expect(view.posted).toHaveLength(1);
    });
});
