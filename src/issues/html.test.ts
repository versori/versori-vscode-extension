import { describe, expect, it } from 'vitest';

import { RAW_PANE_SCRIPT } from '../webview/shell';
import { ISSUE_SEVERITIES } from './args';
import { ISSUES_SCRIPT } from './html';

/**
 * Executes `ISSUES_SCRIPT` against a stubbed DOM, driving it through its real
 * entry point — an `issues` message on the window.
 *
 * Execution is the only way to check the two things that matter most here: that
 * the panel posts an `update` **only** in response to an explicit click or
 * dropdown change, and that the offered transitions depend on the issue's
 * current status.
 */
interface StubNode {
    id: string;
    tag: string;
    className: string;
    value: string;
    selected: boolean;
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

interface TestIssue {
    id: string;
    title: string;
    message: string;
    severity: string;
    severityLevel?: string;
    status: string;
    lastSeen: string;
    seenCount: string;
    fields: Array<{ key: string; value: string }>;
}

interface TestBinding {
    id: string;
    name: string;
    channelName: string;
    email: string;
}

interface TestPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: unknown[];
    controlValues: Record<string, unknown>;
    issues: TestIssue[];
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
    'count',
    'body',
    'filter',
    'refresh',
    'toggleRaw',
    'notifications',
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
        selected: false,
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
        addEventListener(name, fn) {
            (listeners[name] ??= []).push(fn);
        },
        fire(name) {
            (listeners[name] ?? []).forEach((fn) => fn());
        },
    };

    return self;
}

function descendants(node: StubNode): StubNode[] {
    return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** Only the shape the script asks for: `dl[data-for="<id>"]`. */
const DL_FOR = /^dl\[data-for="(.*)"\]$/;

function harness() {
    const byId = new Map<string, StubNode>();
    for (const id of ELEMENT_IDS) {
        const element = makeNode('div');
        element.id = id;
        byId.set(id, element);
    }

    const documentStub = {
        getElementById: (id: string) => byId.get(id),
        createElement: (tag: string) => makeNode(tag),
        // Searches the live tree, so nodes discarded by a re-render are not
        // found — the behaviour a detail message arriving after a refresh relies on.
        querySelector(selector: string) {
            const match = DL_FOR.exec(selector);
            if (!match) {
                throw new Error(`unsupported selector: ${selector}`);
            }
            return [...byId.values()]
                .flatMap(descendants)
                .find((node) => node.tag === 'dl' && node.dataset.for === match[1]);
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

    // `RAW_PANE_SCRIPT` is concatenated rather than stubbed, exactly as
    // `htmlDocument` assembles a real panel — the raw pane's per-payload reset is
    // the behaviour under test below.
    new Function(
        'document',
        'window',
        'acquireVsCodeApi',
        'renderControls',
        RAW_PANE_SCRIPT + ISSUES_SCRIPT,
    )(
        documentStub,
        windowStub,
        () => ({ postMessage: (m: Record<string, unknown>) => void posted.push(m) }),
        // Exercised by shell.test.ts; here it only needs to exist.
        () => {},
    );

    function rows(): StubNode[] {
        return (byId.get('body') as StubNode).children.filter((child) =>
            child.classList.contains('entry'),
        );
    }

    function rowFor(id: string): StubNode {
        const row = rows().find((candidate) => candidate.dataset.id === id);
        if (!row) {
            throw new Error(`no row for issue "${id}"`);
        }
        return row;
    }

    function actions(id: string): StubNode {
        const detail = rowFor(id).children[1];
        const host = detail.children.find((child) => child.classList.contains('actions'));
        if (!host) {
            throw new Error(`no action row for issue "${id}"`);
        }
        return host;
    }

    function notificationChildren(): StubNode[] {
        return (byId.get('notifications') as StubNode).children;
    }

    function bindingRows(): StubNode[] {
        return notificationChildren().filter((child) => child.classList.contains('entry'));
    }

    /** The trailing action row: link and create. */
    function notificationActions(): StubNode {
        const host = notificationChildren().find((child) => child.classList.contains('actions'));
        if (!host) {
            throw new Error('no notification action row');
        }
        return host;
    }

    return {
        posted,
        rows,
        rowFor,
        send(payload: TestPayload) {
            if (!onMessage) {
                throw new Error('the script never registered a message listener');
            }
            onMessage({ data: { type: 'issues', payload } });
        },
        sendDetail(message: Record<string, unknown>) {
            (onMessage as (event: { data: unknown }) => void)({
                data: { type: 'detail', ...message },
            });
        },
        sendNotifications(bindings: TestBinding[], error?: string) {
            (onMessage as (event: { data: unknown }) => void)({
                data: { type: 'notifications', bindings, error },
            });
        },
        /** Direct children of the notifications host, in render order. */
        notificationChildren,
        bindingRows,
        notificationActions,
        clickNotificationAction(label: string) {
            const button = notificationActions().children.find(
                (child) => child.textContent === label,
            );
            if (!button) {
                throw new Error(`no "${label}" button in the notifications section`);
            }
            button.fire('click');
        },
        clickUnlink(index: number) {
            const button = bindingRows()[index].children[0].children.find(
                (child) => child.tag === 'button',
            );
            if (!button) {
                throw new Error(`no unlink button on binding row ${index}`);
            }
            button.fire('click');
        },
        text(id: string): string {
            return (byId.get(id) as StubNode).textContent;
        },
        node: (id: string) => byId.get(id) as StubNode,
        /** Fires a toolbar button by element id — `click` is issue-scoped. */
        clickToolbar(id: string) {
            (byId.get(id) as StubNode).fire('click');
        },
        headText(id: string): string[] {
            return rowFor(id).children[0].children.map((child) => child.textContent);
        },
        headClasses(id: string): string[] {
            return rowFor(id).children[0].children.map((child) => child.className);
        },
        /** The dt/dd pairs currently in the expanded row's field list. */
        fields(id: string): Array<[string, string]> {
            const list = rowFor(id).children[1].children[0];
            const pairs: Array<[string, string]> = [];
            for (let i = 0; i < list.children.length; i += 2) {
                pairs.push([list.children[i].textContent, list.children[i + 1].textContent]);
            }
            return pairs;
        },
        buttons(id: string): string[] {
            return actions(id)
                .children.filter((child) => child.tag === 'button')
                .map((child) => child.textContent);
        },
        click(id: string, label: string) {
            const button = actions(id).children.find((child) => child.textContent === label);
            if (!button) {
                throw new Error(`no "${label}" button on issue "${id}"`);
            }
            button.fire('click');
        },
        severitySelect(id: string): StubNode {
            const select = actions(id).children.find((child) => child.tag === 'select');
            if (!select) {
                throw new Error(`no severity select on issue "${id}"`);
            }
            return select;
        },
        expand(id: string) {
            rowFor(id).children[0].fire('click');
        },
        filter(needle: string) {
            const input = byId.get('filter') as StubNode;
            input.value = needle;
            input.fire('input');
        },
    };
}

function issue(overrides: Partial<TestIssue> = {}): TestIssue {
    return {
        id: '01JISSUE',
        title: 'get-pricing failed',
        message: 'connect ECONNREFUSED',
        severity: 'critical',
        severityLevel: 'error',
        status: 'open',
        lastSeen: '2026-04-08 11:15:02',
        seenCount: '12',
        fields: [{ key: 'reason', value: 'workflow_error' }],
        ...overrides,
    };
}

function payloadWith(issues: TestIssue[], error?: string): TestPayload {
    return {
        heading: 'Issues · production',
        subtitle: 'Context: dev',
        command: 'versori projects issues list',
        controls: [],
        controlValues: {},
        issues,
        rawJson: '[]',
        error,
    };
}

describe('issues view (executed)', () => {
    it('renders the headline as lastSeen, severity, status, title and seen count', () => {
        const view = harness();
        view.send(payloadWith([issue()]));

        expect(view.headText('01JISSUE')).toEqual([
            '▸',
            '2026-04-08 11:15:02',
            'critical',
            'open',
            'get-pricing failed',
            '',
        ]);
        expect(view.headClasses('01JISSUE')).toEqual([
            'twist',
            'ts',
            'sev chip error',
            'st chip muted',
            'msg',
            'inline',
        ]);
        expect(view.text('count')).toBe('1 issue');
    });

    it('shows the message and remaining fields in the collapsed detail', () => {
        const view = harness();
        view.send(payloadWith([issue()]));

        expect(view.fields('01JISSUE')).toEqual([
            ['message', 'connect ECONNREFUSED'],
            ['reason', 'workflow_error'],
        ]);
    });

    it('filters on title, message, status and severity', () => {
        const view = harness();
        view.send(payloadWith([issue(), issue({ id: '01JOTHER', title: 'sync-orders failed' })]));

        view.filter('sync');

        expect(view.rows().map((row) => row.dataset.id)).toEqual(['01JOTHER']);
        expect(view.text('count')).toBe('1 of 2');
    });

    it('offers only the transitions that make sense from the current status', () => {
        const view = harness();
        view.send(
            payloadWith([
                issue(),
                issue({ id: '01JACKED', status: 'acked' }),
                issue({ id: '01JCLOSED', status: 'closed' }),
                issue({ id: '01JRESOLVED', status: 'resolved' }),
            ]),
        );

        expect(view.buttons('01JISSUE')).toEqual(['Acknowledge', 'Resolve', 'Close']);
        expect(view.buttons('01JACKED')).toEqual(['Resolve', 'Close', 'Reopen']);
        expect(view.buttons('01JCLOSED')).toEqual(['Reopen']);
        expect(view.buttons('01JRESOLVED')).toEqual(['Reopen']);
    });

    it('posts an update only when a transition button is clicked', () => {
        const view = harness();
        view.send(payloadWith([issue()]));

        view.click('01JISSUE', 'Acknowledge');

        expect(view.posted).toEqual([
            { type: 'update', id: '01JISSUE', change: { status: 'acked' } },
        ]);
    });

    it('posts a severity update only when the dropdown changes', () => {
        const view = harness();
        view.send(payloadWith([issue()]));

        const select = view.severitySelect('01JISSUE');
        // Exactly the values the API accepts — the same list the arg builder
        // validates against, so the dropdown can never offer a rejected one.
        expect(select.children.map((option) => option.value)).toEqual(ISSUE_SEVERITIES);
        // The current severity is preselected, so the dropdown reads the issue.
        expect(select.children.filter((option) => option.selected).map((o) => o.value)).toEqual([
            'critical',
        ]);

        select.value = 'low';
        select.fire('change');

        expect(view.posted).toEqual([
            { type: 'update', id: '01JISSUE', change: { severity: 'low' } },
        ]);
    });

    it('never mutates as a side effect of rendering, filtering or expanding', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.filter('pricing');
        view.expand('01JISSUE');
        view.send(payloadWith([issue()]));

        expect(view.posted.filter((message) => message.type === 'update')).toEqual([]);
    });

    it('requests the authoritative detail once, on first expand', () => {
        const view = harness();
        view.send(payloadWith([issue()]));

        view.expand('01JISSUE');
        view.expand('01JISSUE'); // collapse
        view.expand('01JISSUE'); // expand again

        expect(view.posted).toEqual([{ type: 'detail', id: '01JISSUE' }]);
    });

    it('replaces the field list with the fetched detail', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.expand('01JISSUE');

        view.sendDetail({
            id: '01JISSUE',
            fields: [
                { key: 'reason', value: 'workflow_error' },
                { key: 'labels.trigger', value: 'get-pricing' },
            ],
        });

        expect(view.fields('01JISSUE')).toEqual([
            ['reason', 'workflow_error'],
            ['labels.trigger', 'get-pricing'],
        ]);
    });

    it('reports a detail fetch that failed, in place of the fields', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.expand('01JISSUE');

        view.sendDetail({ id: '01JISSUE', fields: [], error: 'issue not found' });

        expect(view.fields('01JISSUE')).toEqual([['could not load detail', 'issue not found']]);
    });

    it('shows the error instead of rows when the list command failed', () => {
        const view = harness();
        view.send(payloadWith([], 'context deadline exceeded'));

        const body = view.rows();
        expect(body).toEqual([]);
        expect(view.text('count')).toBe('');
    });
});

function binding(overrides: Partial<TestBinding> = {}): TestBinding {
    return {
        id: '01JBINDING',
        name: 'production critical only',
        channelName: 'Ops on-call',
        email: 'ops@acme.test',
        ...overrides,
    };
}

describe('notifications section (executed)', () => {
    it('labels which scope is which, because a channel is not project-scoped', () => {
        const view = harness();
        view.sendNotifications([binding()]);

        const [title, note] = view.notificationChildren();
        expect(title.tag).toBe('h2');
        expect(title.textContent).toBe('Email notifications');
        // Both scopes named: the bindings are per project + environment, but the
        // channels they point at are organisation-wide.
        expect(note.textContent).toContain('this project and environment');
        expect(note.textContent).toContain('organisation-wide');
    });

    it('renders a row per binding with its label and recipient', () => {
        const view = harness();
        view.sendNotifications([
            binding(),
            binding({ id: '01JOTHER', name: 'all severities', email: 'sre@acme.test' }),
        ]);

        expect(
            view
                .bindingRows()
                .map((row) => row.children[0].children.map((child) => child.textContent)),
        ).toEqual([
            ['production critical only', 'ops@acme.test', 'Unlink'],
            ['all severities', 'sre@acme.test', 'Unlink'],
        ]);
    });

    it('omits the recipient chip when the channel exposes no address', () => {
        const view = harness();
        view.sendNotifications([binding({ email: '' })]);

        expect(
            view.bindingRows()[0].children[0].children.map((child) => child.textContent),
        ).toEqual(['production critical only', 'Unlink']);
    });

    it('says issues still raise when nothing is linked', () => {
        const view = harness();
        view.sendNotifications([]);

        expect(view.bindingRows()).toEqual([]);
        const empty = view.notificationChildren().find((child) =>
            child.classList.contains('empty'),
        );
        expect(empty?.textContent).toBe(
            'No channels linked to this environment — issues raise but do not email.',
        );
    });

    it('reports a failed binding list in the section, still offering the actions', () => {
        const view = harness();
        view.sendNotifications([], 'context deadline exceeded');

        expect(view.bindingRows()).toEqual([]);
        const box = view.notificationChildren().find((child) => child.classList.contains('error'));
        expect(box?.textContent).toBe('context deadline exceeded');
        // The section stays usable: a link/create is how you recover from having none.
        expect(view.notificationActions().children.map((child) => child.textContent)).toEqual([
            'Link a channel...',
            'Create email channel...',
        ]);
    });

    it('posts unlink with the binding id and label, only on click', () => {
        const view = harness();
        view.sendNotifications([binding(), binding({ id: '01JOTHER', name: 'all severities' })]);

        expect(view.posted).toEqual([]);
        view.clickUnlink(1);

        expect(view.posted).toEqual([
            { type: 'unlink', id: '01JOTHER', label: 'all severities' },
        ]);
    });

    it('posts link and createChannel only on their button clicks', () => {
        const view = harness();
        view.sendNotifications([]);

        view.clickNotificationAction('Link a channel...');
        view.clickNotificationAction('Create email channel...');

        expect(view.posted).toEqual([{ type: 'link' }, { type: 'createChannel' }]);
    });

    it('never mutates as a side effect of rendering or re-rendering', () => {
        const view = harness();
        view.sendNotifications([binding()]);
        view.sendNotifications([binding()]);
        view.send(payloadWith([issue()]));

        expect(view.posted).toEqual([]);
    });

    it('replaces the previous bindings rather than appending to them', () => {
        const view = harness();
        view.sendNotifications([binding(), binding({ id: '01JOTHER' })]);
        view.sendNotifications([binding()]);

        expect(view.bindingRows()).toHaveLength(1);
        // One heading, one note, one row, one action row — nothing left over.
        expect(view.notificationChildren()).toHaveLength(4);
    });

    it('leaves the issue list untouched, so a binding failure cannot blank the issues', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.sendNotifications([], 'could not list bindings');

        expect(view.rows().map((row) => row.dataset.id)).toEqual(['01JISSUE']);
        expect(view.text('count')).toBe('1 issue');
    });
});

/**
 * Same shape as the KV panel's raw pane, for the same reason: leaving the pane
 * open across renders means one click keeps every *subsequent* payload on
 * screen, so the deliberate act stops being per-payload.
 */
describe('the raw JSON pane (executed)', () => {
    it('shows on demand, hiding the issue list behind it', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.clickToolbar('toggleRaw');

        expect(view.node('raw').className).toContain('show');
        expect(view.node('toggleRaw').className).toContain('active');
        expect(view.node('body').style.display).toBe('none');
    });

    it('does not survive a re-render — otherwise one click exposes every later payload', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.clickToolbar('toggleRaw');

        // A Refresh, an Apply or a status change all land here.
        view.send(payloadWith([issue()]));

        expect(view.node('raw').className).not.toContain('show');
        expect(view.node('toggleRaw').className).not.toContain('active');
        expect(view.node('body').style.display).toBe('');
    });

    it('can be reopened after a re-render, so the reset is not a lockout', () => {
        const view = harness();
        view.send(payloadWith([issue()]));
        view.clickToolbar('toggleRaw');
        view.send(payloadWith([issue()]));
        view.clickToolbar('toggleRaw');

        expect(view.node('raw').className).toContain('show');
    });
});
