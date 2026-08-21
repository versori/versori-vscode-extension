import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, runJson } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import {
    buildLogArgs,
    Control,
    ControlValues,
    describeRange,
    environmentArgs,
    environmentControl,
    logControls,
    retargetValues,
    searchControl,
    validateLogRange,
} from '../results/controls';
import { redact } from '../results/rows';
import { handleNavMessage } from '../webview/nav';
import { LogEntry, severitiesOf, toLogEntries } from './entries';
import { EMPTY_FILTER, LogFilter, visibleIndices } from './filter';
import { groupByTitle } from './groups';
import { LogsPayload, renderLogsHtml, toWebviewEntries } from './html';
import {
    LiveState,
    LiveStatus,
    liveUnavailableReason,
    MAX_POLL_PAGES,
    nextPollCursor,
    normaliseLogLimit,
    normaliseLogValues,
    POLL_INTERVAL_MS,
    pollValues,
    pollWindow,
    shouldPoll,
    timerShouldRun,
    truncationWarning,
} from './live';
import { mergeEntries } from './merge';
import { RequestGate, RequestToken } from './requests';

export interface LogsDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.logs';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
    /** The retained page. Filtering runs over this, never over another CLI call. */
    entries: LogEntry[];
    /**
     * Target and control set for the project the panel is currently showing.
     *
     * These live on the record rather than being captured by the message
     * handler's closure: `deps.state` is a snapshot, and reopening the panel
     * from a different project replaces it. Closing over the creating call's
     * parameters made an in-panel Refresh re-query the project the panel was
     * first opened from, silently flipping the subtitle back to it.
     */
    deps: LogsDeps;
    controls: Control[];
    /**
     * Everything the poll schedule depends on. Held here rather than in module
     * scope so it dies with the panel record, and read through src/logs/live.ts
     * so the schedule can be tested without vscode.
     */
    live: LiveState;
    liveStatus: LiveStatus;
    timer?: ReturnType<typeof setInterval>;
    /** Generation gate and abort ownership for every load/poll child process. */
    requests: RequestGate;
    /**
     * Redacted JSON of the last full load, for the Raw JSON pane. A live merge
     * has no untouched response of its own to show, and re-sending '' would empty
     * the pane every ten seconds.
     */
    rawJson: string;
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

export async function showLogPanel(deps: LogsDeps, environments: string[]): Promise<void> {
    const controls = [environmentControl(environments), ...logControls(), searchControl()];

    if (open) {
        // Invalidate before mutating the target. Even if abort races with child
        // completion, the old continuation can no longer commit to this record.
        invalidateRequests(open);
        // Retarget before loading: the panel may have been opened from another
        // project, and the message handler reads these on every Refresh.
        open.deps = deps;
        open.controls = controls;
        // ...and reconcile the held values against the new controls, or an
        // environment from the previous project would be queried while the
        // select displays this one's.
        open.values = normaliseLogValues(retargetValues(controls, open.values));
        // A different project's page: the retained entries, its raw JSON and the
        // poll baseline all belong to the old target.
        open.entries = [];
        open.rawJson = '';
        open.live.lastPollMs = undefined;
        open.live.catchUpFromMs = undefined;
        if (open.live.enabled && liveUnavailableReason(open.values)) {
            open.live.enabled = false;
            open.liveStatus = { enabled: false, disabledReason: liveUnavailableReason(open.values) };
        }
        syncTimer(open);
        open.panel.reveal();
        await load(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Logs · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = {
        panel,
        values: normaliseLogValues(defaultValues(controls)),
        entries: [],
        deps,
        controls,
        live: { enabled: false, visible: true, inFlight: false },
        liveStatus: { enabled: false },
        requests: new RequestGate(),
        rawJson: '',
    };
    open = entry;

    panel.onDidDispose(() => {
        // The timer outlives the webview otherwise, spawning a CLI process every
        // ten seconds for a panel nobody can see.
        if (entry.timer) {
            clearInterval(entry.timer);
            entry.timer = undefined;
        }
        entry.live.enabled = false;
        entry.live.inFlight = false;
        entry.requests.dispose();
        if (open === entry) {
            open = undefined;
        }
    });

    panel.onDidChangeViewState(() => {
        const wasVisible = entry.live.visible;
        entry.live.visible = panel.visible;
        syncTimer(entry);

        // One catch-up fetch on the way back, so a panel that was hidden for a
        // minute is not missing a minute of logs. The moving window already
        // starts from the last successful poll, so this closes the whole gap in
        // one request rather than waiting for the next tick.
        if (entry.live.enabled && panel.visible && !wasVisible) {
            void poll(entry);
        }
    });

    panel.webview.html = renderLogsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: {
            type?: string;
            controls?: ControlValues;
            filter?: LogFilter;
            group?: boolean;
            enabled?: boolean;
            text?: string;
            label?: string;
        }) => {
            if (handleNavMessage(message, panel)) {
                return;
            }
            if (message?.type === 'refresh') {
                if (message.controls) {
                    entry.values = normaliseLogValues({ ...entry.values, ...message.controls });
                }
                // A control change can invalidate live mode — switching to a
                // custom range is the case the design calls out.
                const reason = liveUnavailableReason(entry.values);
                if (reason && entry.live.enabled) {
                    entry.live.enabled = false;
                    entry.liveStatus = { enabled: false, disabledReason: reason };
                    syncTimer(entry);
                }
                void load(entry);
                return;
            }

            if (message?.type === 'filter') {
                void postVisible(entry, message.filter ?? EMPTY_FILTER, Boolean(message.group));
                return;
            }

            if (message?.type === 'live') {
                void setLive(entry, Boolean(message.enabled));
                return;
            }

            if (message?.type === 'copy') {
                void copyToClipboard(entry, message.text ?? '', message.label ?? 'Value');
            }
        },
    );

    await load(entry);
}

function defaultValues(controls: Control[]): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

function requestTarget(entry: OpenPanel): string {
    const { state } = entry.deps;
    return JSON.stringify([
        entry.deps.bin,
        state.projectDir,
        state.projectId,
        state.contextName,
        entry.values.environment,
        entry.values.range,
        entry.values.from,
        entry.values.to,
        entry.values.limit,
        entry.values.search,
    ]);
}

function isCurrent(entry: OpenPanel, request: RequestToken): boolean {
    return entry.requests.isCurrent(request, requestTarget(entry), entry.live.enabled);
}

function invalidateRequests(entry: OpenPanel): void {
    entry.requests.invalidate();
    // A stale poll's finally block is generation-gated, so it cannot clear a
    // newer poll. Reset here because every active request has just been aborted.
    entry.live.inFlight = false;
}

function syncTimer(entry: OpenPanel): void {
    const wanted = timerShouldRun(entry.live);

    if (!wanted && entry.timer) {
        clearInterval(entry.timer);
        entry.timer = undefined;
        return;
    }
    if (wanted && !entry.timer) {
        entry.timer = setInterval(() => void poll(entry), POLL_INTERVAL_MS);
    }
}

async function setLive(entry: OpenPanel, enabled: boolean): Promise<void> {
    const reason = enabled ? liveUnavailableReason(entry.values) : undefined;

    entry.live.enabled = enabled && !reason;
    entry.liveStatus = { enabled: entry.live.enabled, disabledReason: reason };
    if (!entry.live.enabled) {
        invalidateRequests(entry);
        entry.live.catchUpFromMs = undefined;
    }
    syncTimer(entry);

    if (entry.live.enabled) {
        // Immediate feedback: waiting up to ten seconds for the first tick reads
        // as the checkbox having done nothing.
        await load(entry);
    } else {
        await postStatusOnly(entry);
    }
}

/**
 * The argv for one `projects logs` call.
 *
 * Takes `values` rather than reading `entry.values`, because a poll passes the
 * same values with an absolute window substituted (src/logs/live.ts) — one
 * builder means a poll can never drift from a load in target or flags.
 */
function specFor(entry: OpenPanel, values: ControlValues, signal?: AbortSignal): CommandSpec {
    const { deps } = entry;

    return {
        args: [
            'projects',
            'logs',
            ...projectArgs(deps.state),
            ...environmentArgs(values),
            ...buildLogArgs(values),
        ],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
        signal,
    };
}

function basePayload(entry: OpenPanel): LogsPayload {
    const { deps, values, controls } = entry;

    return {
        heading: `Logs · ${values.environment} · ${describeRange(values)}`,
        subtitle: subtitle(deps.state),
        // Always the *selected* window, never the poll's moving interval: the
        // poll's --start/--end are an implementation detail of following, and
        // showing them would make the panel look like it had silently changed the
        // range the user chose.
        command: displayCommand(specFor(entry, values)),
        controls,
        controlValues: values,
        entries: toWebviewEntries(entry.entries),
        severities: severitiesOf(entry.entries),
        // Held on the record rather than rebuilt: only load() has an untouched
        // response to redact, and sending '' here would empty the Raw JSON pane
        // on every live tick — one deliberate click landing on a blank pane.
        // What it shows during a live session is therefore the last full load,
        // which is what the displayed command describes too.
        rawJson: entry.rawJson,
        live: entry.liveStatus,
    };
}

/** Refresh the live indicator without touching entries or expansion state. */
function postStatusOnly(entry: OpenPanel): Thenable<boolean> {
    return post(entry, { ...basePayload(entry), merged: true, added: 0 });
}

async function load(entry: OpenPanel): Promise<void> {
    // A replacement load owns a new control generation. Older loads and polls
    // are cancelled and, independently, barred from committing if abort races.
    invalidateRequests(entry);
    const request = entry.requests.begin(requestTarget(entry), false);
    const startedMs = Date.now();
    const deps = entry.deps;
    const values = { ...entry.values };
    const spec = specFor(entry, values, request.signal);
    const command = displayCommand(spec);
    const heading = `Logs · ${values.environment} · ${describeRange(values)}`;

    entry.live.inFlight = true;

    // Never send an invalid combination to the CLI — e.g. a custom range with no
    // start, which would silently widen the query.
    const controlError = validateLogRange(values);
    if (controlError) {
        if (isCurrent(entry, request)) {
            entry.entries = [];
            entry.rawJson = '';
            await post(entry, { ...basePayload(entry), controlError, error: controlError });
        }
        if (entry.requests.finish(request)) {
            entry.live.inFlight = false;
        }
        return;
    }

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runJson<unknown>(deps.bin, spec),
        );
        if (!isCurrent(entry, request)) {
            return;
        }

        const entries = toLogEntries(raw);
        entry.entries = entries;
        // A replacement load is the new comparison baseline: a poll that reached
        // back before it would re-add everything this page already shows.
        // Capture before starting the CLI so logs written while it runs are
        // included by the next overlapped poll rather than falling in a gap.
        entry.live.lastPollMs = startedMs;
        entry.live.catchUpFromMs = undefined;
        entry.liveStatus = { ...entry.liveStatus, error: undefined, warning: undefined };
        // redact() runs for consistency with every other raw view on the
        // branch, but it is close to a **no-op on log data**: it matches
        // secret-sounding *key names* (results/rows.ts:8), and log fields are
        // arbitrary workflow-authored data whose names nobody here chose. A
        // workflow logging `{ headers: { 'x-api-key': ... } }` is caught only
        // if the name happens to match; `{ h: '<credential>' }` is not caught
        // at all, because the value is never inspected.
        //
        // So what protects this view is the same thing that protects KV: the
        // per-field expand keeps values off screen, and the raw pane is closed
        // on every render (hideRawPane, webview/shell.ts) so revealing a
        // payload is a deliberate act each time rather than one click that
        // keeps paying out.
        entry.rawJson = JSON.stringify(redact(raw), null, 2);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);

        await post(entry, basePayload(entry));
    } catch (err) {
        if (!isCurrent(entry, request)) {
            return;
        }

        const message = err instanceof CliError ? err.stderr || err.message : String(err);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);

        entry.entries = [];
        entry.rawJson = '';
        await post(entry, { ...basePayload(entry), error: message });
    } finally {
        if (entry.requests.finish(request)) {
            entry.live.inFlight = false;
        }
    }
}

/**
 * One live poll.
 *
 * Deliberately not `load()`: this queries a moving interval, merges instead of
 * replacing, and shows no progress notification — a ten-second notification loop
 * would be intolerable. Failures are non-destructive and simply retried next
 * tick.
 */
async function poll(entry: OpenPanel): Promise<void> {
    if (!shouldPoll(entry.live)) {
        return;
    }

    const startedMs = Date.now();
    const { fromMs, toMs } = pollWindow(entry.live, startedMs);
    const deps = entry.deps;
    const values = { ...entry.values };
    const limit = normaliseLogLimit(values.limit);
    const request = entry.requests.begin(requestTarget(entry), true);

    entry.live.inFlight = true;
    try {
        let cursor = fromMs;
        let retained = entry.entries.map((item) => ({ ...item }));
        let added = 0;
        let lastReceived = 0;
        let complete = false;

        for (let page = 0; page < MAX_POLL_PAGES; page++) {
            const spec = specFor(entry, pollValues(values, cursor, toMs), request.signal);
            const raw = await runJson<unknown>(deps.bin, spec);
            if (!isCurrent(entry, request)) {
                return;
            }

            const incoming = toLogEntries(raw);
            const merged = mergeEntries(retained, incoming, limit);
            retained = merged.entries;
            added += merged.added;
            lastReceived = incoming.length;

            if (incoming.length < limit) {
                complete = true;
                break;
            }

            const nextCursor = nextPollCursor(incoming, cursor);
            if (nextCursor === undefined) {
                // The CLI has no secondary cursor for more than Limit records at
                // one timestamp. Staying here is safer than skipping them.
                break;
            }
            cursor = nextCursor;
        }

        if (!isCurrent(entry, request)) {
            return;
        }

        entry.entries = retained;
        if (complete) {
            entry.live.lastPollMs = startedMs;
            entry.live.catchUpFromMs = undefined;
        } else {
            // Continue next tick from only what this request proved consumed.
            // This avoids advancing to `startedMs` past unread newer records.
            entry.live.catchUpFromMs = cursor;
        }
        entry.liveStatus = {
            enabled: true,
            updatedAt: new Date(startedMs).toLocaleTimeString(),
            warning: complete ? undefined : truncationWarning(lastReceived, limit),
        };

        await post(entry, { ...basePayload(entry), merged: true, added });
    } catch (err) {
        if (!isCurrent(entry, request)) {
            return;
        }

        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        deps.output.appendLine(`live poll failed: ${message}`);

        // Entries and expansion state stay exactly as they are; only the status
        // line changes, and the next tick retries.
        entry.liveStatus = { enabled: true, error: message };
        await postStatusOnly(entry);
    } finally {
        if (entry.requests.finish(request)) {
            entry.live.inFlight = false;
        }
    }
}

function post(entry: OpenPanel, payload: LogsPayload): Thenable<boolean> {
    if (entry.requests.isDisposed) {
        return Promise.resolve(false);
    }
    return entry.panel.webview.postMessage({ type: 'logs', payload });
}

function postVisible(entry: OpenPanel, filter: LogFilter, group: boolean): Thenable<boolean> {
    const indices = visibleIndices(entry.entries, filter);

    if (entry.requests.isDisposed) {
        return Promise.resolve(false);
    }
    return entry.panel.webview.postMessage({
        type: 'visible',
        indices,
        total: entry.entries.length,
        // Grouping is derived from the same visible set, so a group can never
        // disagree with the rows underneath it.
        groups: group ? groupByTitle(entry.entries, indices) : undefined,
    });
}

async function copyToClipboard(entry: OpenPanel, text: string, label: string): Promise<void> {
    try {
        await vscode.env.clipboard.writeText(text);
        if (entry.requests.isDisposed) {
            return;
        }
        await entry.panel.webview.postMessage({ type: 'copied', label });
    } catch (err) {
        if (entry.requests.isDisposed) {
            return;
        }
        await entry.panel.webview.postMessage({
            type: 'copied',
            label,
            error: String(err),
        });
    }
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
