import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, runJson } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues, ENVIRONMENT_ID } from '../results/controls';
import { redact } from '../results/rows';
import { buildKvListArgs, KvCursor, kvControls, validateKvScope } from './args';
import { toKvPage } from './entries';
import { KvPayload, renderKvHtml } from './html';

export interface KvDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.kv';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
    /**
     * Target and control set for the project the panel is currently showing.
     *
     * These live on the record rather than being captured by the message
     * handler's closure: `deps.state` is a snapshot, and reopening the panel from
     * a different project replaces it. Closing over the creating call's
     * parameters made an in-panel Refresh re-query the project the panel was
     * first opened from.
     */
    deps: KvDeps;
    controls: Control[];
    /** Cursor for the request about to be made. Empty means the first page. */
    cursor: KvCursor;
    /**
     * Cursors from the last successful response, held verbatim.
     *
     * Deliberately never sent to the webview: it asks to move by *direction* and
     * these are resolved here, so no cursor is ever reconstructed from a key —
     * the CLI documents them as opaque and warns against exactly that.
     */
    nextCursor: string;
    prevCursor: string;
    /** 1-based position in the cursor walk, for the page label. */
    page: number;
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

/**
 * KV entry browser. Read-only.
 *
 * `kv set`, `kv delete` and `kv wipe` are permanently out of scope: they mutate
 * live workflow state — cursors, dedupe keys, batch progress — and stay in the
 * terminal where their confirmation prompts live. See README.md.
 */
export async function showKvPanel(deps: KvDeps, environments: string[]): Promise<void> {
    const controls = kvControls(environments);

    if (open) {
        open.panel.reveal();
        // Retarget before loading: the panel may have been opened from another
        // project, and the message handler reads these on every action.
        open.deps = deps;
        open.controls = controls;
        rewind(open);
        await load(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'KV · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = {
        panel,
        values: defaultValues(controls),
        deps,
        controls,
        cursor: {},
        nextCursor: '',
        prevCursor: '',
        page: 1,
    };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderKvHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: { type?: string; controls?: ControlValues; direction?: string }) => {
            if (message?.type === 'refresh') {
                if (message.controls) {
                    entry.values = { ...entry.values, ...message.controls };
                }
                // The query changed, so the held cursors describe a different
                // result set. Reusing one would return a page of the old query.
                rewind(entry);
                void load(entry);
                return;
            }

            if (message?.type === 'page') {
                void turnPage(entry, message.direction);
            }
        },
    );

    await load(entry);
}

function defaultValues(controls: Control[]): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

/** Back to the first page, with no cursor. */
function rewind(entry: OpenPanel): void {
    entry.cursor = {};
    entry.nextCursor = '';
    entry.prevCursor = '';
    entry.page = 1;
}

/**
 * Move one page, using the cursor the last response supplied.
 *
 * An absent cursor is the CLI's own end-of-results signal, so the move is simply
 * refused — the webview already disables the button, and this is the guard that
 * makes that more than a styling choice.
 */
async function turnPage(entry: OpenPanel, direction: string | undefined): Promise<void> {
    if (direction === 'next') {
        if (!entry.nextCursor) {
            return;
        }
        entry.cursor = { after: entry.nextCursor };
        entry.page += 1;
    } else if (direction === 'prev') {
        if (!entry.prevCursor || entry.page <= 1) {
            return;
        }
        entry.cursor = { before: entry.prevCursor };
        entry.page -= 1;
    } else {
        return;
    }

    await load(entry);
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps, values, controls } = entry;
    const args = [
        'kv',
        'list',
        ...projectArgs(deps.state),
        ...buildKvListArgs(values, entry.cursor),
    ];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);
    const heading = `KV · ${values.scope} · ${values[ENVIRONMENT_ID]}`;

    const base: KvPayload = {
        heading,
        subtitle: subtitle(deps.state),
        command,
        controls,
        controlValues: values,
        entries: [],
        page: entry.page,
        hasNext: false,
        hasPrev: false,
        rawJson: '',
    };

    // Never send a combination the CLI will reject — e.g. the user scope with no
    // external id, which exits non-zero and reads as a broken panel.
    const controlError = validateKvScope(values);
    if (controlError) {
        await post(entry, { ...base, controlError, error: controlError });
        return;
    }

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runJson<unknown>(deps.bin, spec),
        );

        const page = toKvPage(raw);
        entry.nextCursor = page.nextCursor;
        entry.prevCursor = page.prevCursor;

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(
            `${page.entries.length} entr${page.entries.length === 1 ? 'y' : 'ies'} (page ${entry.page})`,
        );

        await post(entry, {
            ...base,
            entries: page.entries,
            // An empty nextCursor is the end of the store, not a hidden page.
            hasNext: page.nextCursor !== '',
            // Both conditions matter: page 1 has nowhere to go back to, and a
            // response without a prevCursor cannot be walked backwards at all.
            hasPrev: entry.page > 1 && page.prevCursor !== '',
            // Redacted, like every other raw view on this branch. The entry list
            // above is not: a KV value is the data the user came to read, and the
            // expand affordance is what keeps it off screen until asked for.
            rawJson: JSON.stringify(redact(raw), null, 2),
        });
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);

        // Drop the cursors: they belong to a page that is no longer on screen, so
        // paging on from here would move relative to something the user cannot
        // see. Both controls go dead, and Refresh returns to the first page.
        entry.nextCursor = '';
        entry.prevCursor = '';

        await post(entry, { ...base, error: message });
    }
}

function post(entry: OpenPanel, payload: KvPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'kv', payload });
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
