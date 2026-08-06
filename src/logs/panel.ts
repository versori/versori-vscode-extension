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
    searchControl,
    validateLogRange,
} from '../results/controls';
import { redact } from '../results/rows';
import { fieldKeys, LogEntry, severitiesOf, toLogEntries } from './entries';
import { EMPTY_FILTER, LogFilter, visibleIndices } from './filter';
import { LogsPayload, renderLogsHtml } from './html';

export interface LogsDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.logs';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
    /** The fetched page. Filtering runs over this, never over another CLI call. */
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
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

export async function showLogPanel(deps: LogsDeps, environments: string[]): Promise<void> {
    const controls = [environmentControl(environments), ...logControls(), searchControl()];

    if (open) {
        open.panel.reveal();
        // Retarget before loading: the panel may have been opened from another
        // project, and the message handler reads these on every Refresh.
        open.deps = deps;
        open.controls = controls;
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
        values: defaultValues(controls),
        entries: [],
        deps,
        controls,
    };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderLogsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: { type?: string; controls?: ControlValues; filter?: LogFilter }) => {
            if (message?.type === 'refresh') {
                if (message.controls) {
                    entry.values = { ...entry.values, ...message.controls };
                }
                void load(entry);
                return;
            }

            if (message?.type === 'filter') {
                void postVisible(entry, message.filter ?? EMPTY_FILTER);
            }
        },
    );

    await load(entry);
}

function defaultValues(controls: Control[]): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps, values, controls } = entry;
    const args = [
        'projects',
        'logs',
        ...projectArgs(deps.state),
        ...environmentArgs(values),
        ...buildLogArgs(values),
    ];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);
    const heading = `Logs · ${values.environment} · ${describeRange(values)}`;

    const base: LogsPayload = {
        heading,
        subtitle: subtitle(deps.state),
        command,
        controls,
        controlValues: values,
        entries: [],
        fieldKeys: [],
        severities: [],
        rawJson: '',
    };

    // Never send an invalid combination to the CLI — e.g. a custom range with no
    // start, which would silently widen the query.
    const controlError = validateLogRange(values);
    if (controlError) {
        entry.entries = [];
        await post(entry, { ...base, controlError, error: controlError });
        return;
    }

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runJson<unknown>(deps.bin, spec),
        );

        const entries = toLogEntries(raw);
        entry.entries = entries;

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);

        await post(entry, {
            ...base,
            entries,
            fieldKeys: fieldKeys(entries),
            severities: severitiesOf(entries),
            // Redacted: this view is user-visible and log fields are workflow-authored.
            rawJson: JSON.stringify(redact(raw), null, 2),
        });
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);

        entry.entries = [];
        await post(entry, { ...base, error: message });
    }
}

function post(entry: OpenPanel, payload: LogsPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'logs', payload });
}

function postVisible(entry: OpenPanel, filter: LogFilter): Thenable<boolean> {
    return entry.panel.webview.postMessage({
        type: 'visible',
        indices: visibleIndices(entry.entries, filter),
        total: entry.entries.length,
    });
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
