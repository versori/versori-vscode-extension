import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, runJson } from '../cli';
import { contextFor } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues, retargetValues } from './controls';
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
    /**
     * Target and request for the project the panel is currently showing.
     *
     * These live on the record rather than being captured by the message
     * handler's closure: `deps.state` is a snapshot and `request.baseArgs` bakes
     * in `--project <id>`, so closing over the creating call's copies made an
     * in-panel Refresh after a menu reopen from another project silently revert
     * the whole panel — subtitle included — to the project it was first opened
     * from. Same shape already applied in logs/panel.ts, issues/panel.ts and the
     * resources form.
     */
    deps: ResultsDeps;
    request: ResultsRequest;
}

const panels = new Map<string, OpenPanel>();

function defaultValues(controls: Control[] = []): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

export async function showResults(deps: ResultsDeps, request: ResultsRequest): Promise<void> {
    const existing = panels.get(request.id);

    if (existing) {
        existing.panel.reveal();
        // Retarget before loading: the panel may have been opened from another
        // project, and the message handler reads these on every Refresh.
        existing.deps = deps;
        existing.request = request;
        // Reconcile the held values against the new controls, or an environment
        // from the previous project would be queried while the select displays
        // this one's. Connectors and Static connections are project-scoped and
        // carry an environment select, so both hit this.
        existing.values = retargetValues(request.controls ?? [], existing.values);
        await load(existing);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        `versori.results.${request.id}`,
        `${request.heading(defaultValues(request.controls))} · Versori`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, values: defaultValues(request.controls), deps, request };
    panels.set(request.id, entry);

    // The id, not the request: a request object captured here would be a second
    // copy of the very thing that has to be retargeted on reuse. The id is the
    // map key, so it is the same for every reopen of this view by construction.
    const id = request.id;
    panel.onDidDispose(() => panels.delete(id));
    panel.webview.html = renderResultsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: { type?: string; controls?: ControlValues }) => {
            if (message?.type !== 'refresh') {
                return;
            }
            if (message.controls) {
                entry.values = { ...entry.values, ...message.controls };
            }
            void load(entry);
        },
    );

    await load(entry);
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps, request, values } = entry;
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
        allColumns: [],
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

    // Every derived column is sent; which ones to render is the webview's
    // decision, driven by the user's column picker. deriveColumns still puts
    // preferred and most-populated first, so the default selection is sensible.
    const columns = deriveColumns(rows, request.preferred);

    // Match case-insensitively — the CLI mixes `Name` and `name` across commands.
    const levelColumn = request.levelColumn
        ? columns.find((c) => c.toLowerCase() === request.levelColumn?.toLowerCase())
        : undefined;

    return {
        ...base,
        columns,
        allColumns: columns,
        levelColumn,
        rows: rows.map((row) =>
            Object.fromEntries(columns.map((column) => [column, formatCell(row[column])])),
        ),
        levels: rows.map((row) => (levelColumn ? levelClass(row[levelColumn]) : undefined)),
        // redact() runs here, but not for the reason this comment used to give:
        // `context list` never reaches this panel — switchContext calls runJson
        // directly and only ever extracts names from the response. The commands
        // that could carry credential material are `connections list` and
        // `systems list-connections`, and the Platform API redacts that
        // **server-side**, so the protection there rests on a server guarantee
        // rather than on anything this function does.
        //
        // redact() is still worth running: it matches secret-sounding key names
        // (rows.ts:8), which is a cheap backstop if a future command returns one.
        // It is not a guarantee — it never inspects values. The raw pane being
        // closed on every payload (hideRawPane, webview/shell.ts) is the other
        // half.
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
