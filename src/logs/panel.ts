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
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

export async function showLogPanel(deps: LogsDeps, environments: string[]): Promise<void> {
    const controls = [environmentControl(environments), ...logControls(), searchControl()];

    if (open) {
        open.panel.reveal();
        await load(deps, open, controls);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Logs · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, values: defaultValues(controls), entries: [] };
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
                void load(deps, entry, controls);
                return;
            }

            if (message?.type === 'filter') {
                void postVisible(entry, message.filter ?? EMPTY_FILTER);
            }
        },
    );

    await load(deps, entry, controls);
}

function defaultValues(controls: Control[]): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

async function load(deps: LogsDeps, entry: OpenPanel, controls: Control[]): Promise<void> {
    const values = entry.values;
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
