import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, runJson } from '../cli';
import { contextFor } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues } from './controls';
import { renderResultsHtml, ResultsPayload } from './html';
import {
    deriveColumns,
    flattenRow,
    formatCell,
    levelClass,
    redact,
    Row,
    unwrapRows,
} from './rows';

export interface ResultsRequest {
    /** Stable id, so re-running the same view reuses its panel. */
    id: string;
    /** Heading; receives current control values so it can name the window. */
    heading: (values: ControlValues) => string;
    /** Fixed part of the command. */
    baseArgs: string[];
    /** Query controls rendered above the results. */
    controls?: Control[];
    /** Flags derived from the control values. */
    controlArgs?: (values: ControlValues) => string[];
    /** Problem with the current selection, blocking the run. */
    validate?: (values: ControlValues) => string | undefined;
    /** Column names to show first, when present in the data. */
    preferred?: string[];
    /** Column to render as a coloured chip. */
    levelColumn?: string;
}

export interface ResultsDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
}

/** Beyond this the table stops being readable; the rest stay in Raw JSON. */
const MAX_COLUMNS = 12;

const panels = new Map<string, OpenPanel>();

function defaultValues(controls: Control[] = []): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

export async function showResults(deps: ResultsDeps, request: ResultsRequest): Promise<void> {
    const existing = panels.get(request.id);

    if (existing) {
        existing.panel.reveal();
        await load(deps, request, existing);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        `versori.results.${request.id}`,
        `${request.heading(defaultValues(request.controls))} · Versori`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, values: defaultValues(request.controls) };
    panels.set(request.id, entry);

    panel.onDidDispose(() => panels.delete(request.id));
    panel.webview.html = renderResultsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: { type?: string; controls?: ControlValues }) => {
            if (message?.type !== 'refresh') {
                return;
            }
            if (message.controls) {
                entry.values = { ...entry.values, ...message.controls };
            }
            void load(deps, request, entry);
        },
    );

    await load(deps, request, entry);
}

async function load(
    deps: ResultsDeps,
    request: ResultsRequest,
    entry: OpenPanel,
): Promise<void> {
    const values = entry.values;
    const args = [...request.baseArgs, ...(request.controlArgs?.(values) ?? [])];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);

    const base: ResultsPayload = {
        heading: request.heading(values),
        subtitle: subtitle(deps.state),
        command,
        columns: [],
        rows: [],
        levels: [],
        rawJson: '',
        controls: request.controls,
        controlValues: values,
    };

    // Never send an invalid combination to the CLI — e.g. a custom range with no
    // start, which would silently widen the query.
    const controlError = request.validate?.(values);
    if (controlError) {
        await entry.panel.webview.postMessage({
            type: 'results',
            payload: { ...base, controlError, error: controlError },
        });
        return;
    }

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${base.heading}` },
            () => runJson<unknown>(deps.bin, spec),
        );

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(`${unwrapRows(raw).length} row(s)`);

        await entry.panel.webview.postMessage({
            type: 'results',
            payload: toPayload(base, raw, request),
        });
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);

        await entry.panel.webview.postMessage({
            type: 'results',
            payload: { ...base, error: message },
        });
    }
}

function toPayload(base: ResultsPayload, raw: unknown, request: ResultsRequest): ResultsPayload {
    const rows: Row[] = unwrapRows(raw).map(flattenRow);

    // Cap the table: real log pages can derive 40+ heterogeneous columns.
    // deriveColumns puts preferred and most-populated first, and the hidden
    // count is reported so nothing disappears silently — Raw JSON has it all.
    const allColumns = deriveColumns(rows, request.preferred);
    const columns = allColumns.slice(0, MAX_COLUMNS);
    const hiddenColumns = allColumns.length - columns.length;

    // Match case-insensitively — the CLI mixes `Name` and `name` across commands.
    const levelColumn = request.levelColumn
        ? columns.find((c) => c.toLowerCase() === request.levelColumn?.toLowerCase())
        : undefined;

    return {
        ...base,
        columns,
        hiddenColumns,
        levelColumn,
        rows: rows.map((row) =>
            Object.fromEntries(columns.map((column) => [column, formatCell(row[column])])),
        ),
        levels: rows.map((row) => (levelColumn ? levelClass(row[levelColumn]) : undefined)),
        // Redacted: `context list` embeds JWTs, and this view is user-visible.
        rawJson: JSON.stringify(redact(raw), null, 2),
    };
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
