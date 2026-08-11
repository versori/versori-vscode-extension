import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, run, runJson } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues, ENVIRONMENT_ID, retargetValues } from '../results/controls';
import { redact } from '../results/rows';
import {
    buildKvCountArgs,
    buildKvDeleteArgs,
    buildKvListArgs,
    buildKvSetArgs,
    buildKvWipeArgs,
    KvCursor,
    kvControls,
    kvPrefixSegments,
    shouldRetryKvListWithLimitOne,
    validateKvKey,
    validateKvScope,
    validateKvWipePrefix,
} from './args';
import { parseKvCount, toKvPage } from './entries';
import { KvCountMessage, KvPayload, renderKvHtml } from './html';
import { handleNavMessage } from '../webview/nav';

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
     * These are the only cursors that can ever reach the CLI. The webview asks
     * to move by *direction* and `turnPage` resolves it from here, ignoring any
     * value a message carries — so no cursor is ever reconstructed from a key,
     * which the CLI documents as opaque and warns against.
     *
     * They are not secret: `rawJson` carries the response's own `pagination`
     * block into the webview. The guarantee is that they are inert there.
     */
    nextCursor: string;
    prevCursor: string;
    /** 1-based position in the cursor walk, for the page label. */
    page: number;
}

interface WebviewMessage {
    type?: string;
    controls?: ControlValues;
    direction?: string;
    key?: string;
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

/**
 * KV entry browser with host-confirmed set / delete / wipe.
 *
 * Mutations use the existing CLI surface (`kv set --yes`, `kv delete --yes`,
 * `kv wipe --confirm`) after VS Code modals — never the CLI's interactive
 * prompts, which have no TTY when spawned from the extension.
 */
export async function showKvPanel(deps: KvDeps, environments: string[]): Promise<void> {
    const controls = kvControls(environments);

    if (open) {
        open.panel.reveal();
        // Retarget before loading: the panel may have been opened from another
        // project, and the message handler reads these on every action.
        open.deps = deps;
        open.controls = controls;
        // ...and reconcile the held values against the new controls, or an
        // environment from the previous project would be queried while the
        // select displays this one's.
        open.values = retargetValues(controls, open.values);
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

    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (handleNavMessage(message, panel)) {
            return;
        }
        if (message?.controls) {
            entry.values = { ...entry.values, ...message.controls };
        }

        if (message?.type === 'refresh') {
            // The query changed, so the held cursors describe a different
            // result set. Reusing one would return a page of the old query.
            rewind(entry);
            void load(entry);
            return;
        }

        if (message?.type === 'page') {
            void turnPage(entry, message.direction);
            return;
        }

        // Reached only from the Count button. Nothing on the load, refresh
        // or paging paths calls this — a total is worth a second spawn only
        // when it was asked for.
        if (message?.type === 'count') {
            void countEntries(entry);
            return;
        }

        if (message?.type === 'set') {
            void setEntry(entry);
            return;
        }

        if (message?.type === 'edit') {
            void editEntry(entry, String(message.key ?? ''));
            return;
        }

        if (message?.type === 'delete') {
            void deleteEntry(entry, String(message.key ?? ''));
            return;
        }

        if (message?.type === 'wipe') {
            void wipePrefix(entry);
        }
    });

    // Size-limit → --limit 1 fallback is only for this opening fetch, not for
    // later Refresh / Next / Previous (those keep the user's chosen page size).
    await load(entry, { allowMessageSizeRetry: true });
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

/**
 * The authoritative total under the current prefix, on demand.
 *
 * `kv list` returns a capped page and no total, so the panel cannot honestly
 * claim one — this is the command that can. Read-only, and targeted with the
 * *same* `targetArgs` the list query uses, so the number answers for the slice
 * of the store on screen and not some other one.
 */
async function countEntries(entry: OpenPanel): Promise<void> {
    const { deps, values } = entry;

    const controlError = validateKvScope(values);
    if (controlError) {
        await postCount(entry, { error: controlError });
        return;
    }

    const spec: CommandSpec = {
        args: ['kv', 'count', ...projectArgs(deps.state), ...buildKvCountArgs(values)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: counting KV entries' },
            () => runJson<unknown>(deps.bin, spec),
        );

        const total = parseKvCount(raw);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(total === undefined ? 'no count in the response' : `${total}`);

        await postCount(
            entry,
            total === undefined
                ? { error: 'the CLI returned no count' }
                : { total },
        );
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);

        await postCount(entry, { error: message });
    }
}

async function setEntry(entry: OpenPanel): Promise<void> {
    const scopeError = validateKvScope(entry.values);
    if (scopeError) {
        void vscode.window.showWarningMessage(`Versori: ${scopeError}`);
        return;
    }

    const key = await vscode.window.showInputBox({
        title: 'KV key',
        prompt: 'Slash-delimited key relative to the selected scope',
        placeHolder: 'e.g. orders/cursor',
        ignoreFocusOut: true,
        validateInput: (value) => validateKvKey(value),
    });
    if (key === undefined) {
        return;
    }

    await writeEntry(entry, key.trim(), 'Set KV entry');
}

async function editEntry(entry: OpenPanel, key: string): Promise<void> {
    const keyError = validateKvKey(key);
    if (keyError) {
        void vscode.window.showWarningMessage(`Versori: ${keyError}`);
        return;
    }

    const scopeError = validateKvScope(entry.values);
    if (scopeError) {
        void vscode.window.showWarningMessage(`Versori: ${scopeError}`);
        return;
    }

    if (!ensureRelativeKeyMode(entry)) {
        return;
    }

    await writeEntry(entry, key.trim(), `Edit KV entry ${key.trim()}`);
}

async function writeEntry(entry: OpenPanel, key: string, title: string): Promise<void> {
    const value = await vscode.window.showInputBox({
        title,
        prompt: 'Value to store (JSON when valid, otherwise a string). Never logged.',
        placeHolder: 'value',
        ignoreFocusOut: true,
    });
    // Blank is a valid value; only dismissal aborts.
    if (value === undefined) {
        return;
    }

    const ttlRaw = await vscode.window.showInputBox({
        title: 'TTL (optional)',
        prompt: 'Expire-in milliseconds. Leave blank for no expiry.',
        placeHolder: 'e.g. 60000',
        ignoreFocusOut: true,
        validateInput: (text) => {
            if (!text.trim()) {
                return undefined;
            }
            const n = Number(text);
            if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                return 'Enter a non-negative integer, or leave blank.';
            }
            return undefined;
        },
    });
    if (ttlRaw === undefined) {
        return;
    }

    const ifNotExistsPick = await vscode.window.showQuickPick(
        [
            { label: 'Overwrite if the key already exists', value: false },
            { label: 'Only set if the key does not exist (--if-not-exists)', value: true },
        ],
        { title: 'If the key already exists', ignoreFocusOut: true },
    );
    if (!ifNotExistsPick) {
        return;
    }

    const expireInMs = ttlRaw.trim() ? Number(ttlRaw.trim()) : undefined;
    const confirmed = await vscode.window.showWarningMessage(
        `Set key "${key}" in ${describeTarget(entry.values)}?`,
        {
            modal: true,
            detail: 'This mutates live workflow state (cursors, dedupe keys, batch progress).',
        },
        'Set',
    );
    if (confirmed !== 'Set') {
        return;
    }

    let flags: string[];
    try {
        flags = buildKvSetArgs(entry.values, {
            key,
            value,
            expireInMs,
            ifNotExists: ifNotExistsPick.value,
        });
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
    }

    await mutate(entry, 'setting KV entry', ['kv', 'set', ...projectArgs(entry.deps.state), ...flags], {
        success: `Set "${key}".`,
        // Never log the raw value — displayCommand would include --value.
        logLine: `kv set --key ${key} --yes (value omitted)`,
    });
}

async function deleteEntry(entry: OpenPanel, key: string): Promise<void> {
    const keyError = validateKvKey(key);
    if (keyError) {
        void vscode.window.showWarningMessage(`Versori: ${keyError}`);
        return;
    }

    const scopeError = validateKvScope(entry.values);
    if (scopeError) {
        void vscode.window.showWarningMessage(`Versori: ${scopeError}`);
        return;
    }

    if (!ensureRelativeKeyMode(entry)) {
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `Delete key "${key.trim()}" from ${describeTarget(entry.values)}?`,
        {
            modal: true,
            detail: 'This removes a single key. Use Wipe prefix to delete everything under a prefix.',
        },
        'Delete',
    );
    if (confirmed !== 'Delete') {
        return;
    }

    let flags: string[];
    try {
        flags = buildKvDeleteArgs(entry.values, key);
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
    }

    await mutate(
        entry,
        'deleting KV entry',
        ['kv', 'delete', ...projectArgs(entry.deps.state), ...flags],
        { success: `Deleted "${key.trim()}".` },
    );
}

/**
 * Dry-run `kv wipe` first (no `--confirm`), show the CLI preview in a modal,
 * then re-run with `--confirm` only if the user accepts.
 */
async function wipePrefix(entry: OpenPanel): Promise<void> {
    const scopeError = validateKvScope(entry.values);
    if (scopeError) {
        void vscode.window.showWarningMessage(`Versori: ${scopeError}`);
        return;
    }

    const wipeError = validateKvWipePrefix(entry.values);
    if (wipeError) {
        void vscode.window.showWarningMessage(`Versori: ${wipeError}`);
        return;
    }

    const prefix = kvPrefixSegments(entry.values).join('/');
    const previewSpec: CommandSpec = {
        args: [
            'kv',
            'wipe',
            ...projectArgs(entry.deps.state),
            ...buildKvWipeArgs(entry.values, false),
        ],
        cwd: entry.deps.state.projectDir,
        context: contextFor(entry.deps.state),
        json: false,
    };

    let preview: string;
    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Versori: previewing KV wipe' },
            () => run(entry.deps.bin, previewSpec),
        );
        preview = [result.stdout, result.stderr].filter((part) => part.trim()).join('\n').trim();
        entry.deps.output.appendLine(`$ ${displayCommand(previewSpec)}`);
        entry.deps.output.appendLine(preview || '(empty preview)');
    } catch (err) {
        const message = errorText(err);
        entry.deps.output.appendLine(`$ ${displayCommand(previewSpec)}`);
        entry.deps.output.appendLine(message);
        void vscode.window.showErrorMessage(`Versori: wipe preview failed — ${message}`);
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `Wipe prefix "${prefix}" in ${describeTarget(entry.values)}?`,
        {
            modal: true,
            detail:
                (preview || 'No dry-run detail was returned.') +
                '\n\nThis is a bulk mutation of live workflow state.',
        },
        'Wipe',
    );
    if (confirmed !== 'Wipe') {
        return;
    }

    await mutate(
        entry,
        'wiping KV prefix',
        [
            'kv',
            'wipe',
            ...projectArgs(entry.deps.state),
            ...buildKvWipeArgs(entry.values, true),
        ],
        { success: `Wiped prefix "${prefix}".` },
    );
}

async function mutate(
    entry: OpenPanel,
    title: string,
    args: string[],
    outcome: { success: string; logLine?: string },
): Promise<void> {
    const deps = entry.deps;
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
        json: false,
    };

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Versori: ${title}` },
            () => run(deps.bin, spec),
        );

        deps.output.appendLine(`$ ${outcome.logLine ?? displayCommand(spec)}`);
        const stdout = result.stdout.trim();
        if (stdout && !outcome.logLine) {
            deps.output.appendLine(stdout);
        } else if (stdout && outcome.logLine) {
            // Set path: acknowledge success without echoing a value-bearing line.
            deps.output.appendLine(stdout.replace(/Set ".+"/, `Set (ok)`));
        }

        void vscode.window.showInformationMessage(outcome.success);
        rewind(entry);
        await load(entry);
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${outcome.logLine ?? displayCommand(spec)}`);
        deps.output.appendLine(message);
        void vscode.window.showErrorMessage(`Versori: ${title} failed — ${message}`);
    }
}

async function load(
    entry: OpenPanel,
    options: { allowMessageSizeRetry?: boolean } = {},
): Promise<void> {
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
            // redact() runs for consistency with every other raw view on this
            // branch, but be clear that it is a **no-op on KV data**: it matches
            // secret-sounding *key names*, and this envelope's names are data,
            // pagination, key, value, versionstamp, createdAt, expiresAt. None
            // match, so this pane holds every value on the page in full. What
            // keeps it honest is that the pane is closed by default and
            // re-closed on every render (hideRawPane, webview/shell.ts) — a deliberate
            // act each time, never one click that keeps paying out.
            rawJson: JSON.stringify(redact(raw), null, 2),
        });
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);

        // Only the panel's opening fetch may shrink to --limit 1. Refresh and
        // paging keep the user's page size and surface the error instead.
        if (
            options.allowMessageSizeRetry &&
            shouldRetryKvListWithLimitOne(values, message)
        ) {
            deps.output.appendLine('retrying with --limit 1 (response exceeded API message size)');
            entry.values = { ...entry.values, limit: 1 };
            void vscode.window.showWarningMessage(
                'Versori: KV page exceeded the API size limit; retrying with page size 1.',
            );
            await load(entry);
            return;
        }

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

function postCount(
    entry: OpenPanel,
    result: { total?: number; error?: string },
): Thenable<boolean> {
    const message: KvCountMessage = { type: 'count', ...result };
    return entry.panel.webview.postMessage(message);
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}

function describeTarget(values: ControlValues): string {
    const scope = String(values.scope ?? 'project');
    const environment = String(values[ENVIRONMENT_ID] ?? '');
    const parts = [scope];
    if (environment) {
        parts.push(environment);
    }
    if (scope === 'user') {
        const externalId = String(values.externalId ?? '').trim();
        if (externalId) {
            parts.push(`external-id ${externalId}`);
        }
    }
    if (scope === 'execution') {
        const executionId = String(values.executionId ?? '').trim();
        if (executionId) {
            parts.push(`execution ${executionId}`);
        }
    }
    return parts.join(' · ');
}

/**
 * Full keys include the scope prefix that the CLI resolves internally. Passing
 * one back to `kv set` or `kv delete` would prepend that scope a second time,
 * so mutations require the safer scope-relative display mode.
 */
function ensureRelativeKeyMode(entry: OpenPanel): boolean {
    if (String(entry.values.keys ?? 'stripped') !== 'full') {
        return true;
    }

    void vscode.window.showWarningMessage(
        'Switch Keys to “Scope prefix stripped” before editing or deleting an entry.',
    );
    return false;
}

function errorText(err: unknown): string {
    return err instanceof CliError ? err.stderr || err.message : String(err);
}
