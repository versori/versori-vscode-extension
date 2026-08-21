import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, runJson } from '../cli';
import { contextFor } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { renderResultsHtml, ResultsPayload } from '../results/html';
import { redact } from '../results/rows';
import {
    enrichKvStores,
    groupKvStores,
    kvStoreTableRows,
    parseKvStoresList,
    parseProjectRefs,
} from './stores';
import { handleNavMessage } from '../webview/nav';

export interface KvStoresDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.kvStores';
const PREFERRED = ['group', 'storeType', 'name', 'id'];

interface OpenPanel {
    panel: vscode.WebviewPanel;
    deps: KvStoresDeps;
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

/**
 * Organisation-wide KV stores, grouped by project name when a join is possible.
 *
 * Loads `kv stores list` and best-effort `projects list`, then renders through
 * the shared results webview shell. Parent menu wiring is intentionally left to
 * the integrator — this module only exposes the panel entry point.
 */
export async function showKvStoresPanel(deps: KvStoresDeps): Promise<void> {
    if (open) {
        open.panel.reveal();
        open.deps = deps;
        await load(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'KV stores · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, deps };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderResultsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage((message: { type?: string }) => {
        if (handleNavMessage(message, panel)) {
            return;
        }
        if (message?.type === 'refresh') {
            void load(entry);
        }
    });

    await load(entry);
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps } = entry;
    const storesSpec: CommandSpec = {
        args: ['kv', 'stores', 'list'],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const projectsSpec: CommandSpec = {
        args: ['projects', 'list'],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(storesSpec);

    const base: ResultsPayload = {
        heading: 'KV stores',
        subtitle: subtitle(deps.state),
        command,
        columns: PREFERRED,
        rows: [],
        levels: [],
        rawJson: '',
        allColumns: PREFERRED,
    };

    try {
        const storesRaw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: KV stores' },
            () => runJson<unknown>(deps.bin, storesSpec),
        );

        // Best-effort join: a projects list failure still shows stores grouped
        // by project id / store type rather than failing the whole panel.
        let projectsRaw: unknown = [];
        try {
            projectsRaw = await runJson<unknown>(deps.bin, projectsSpec);
        } catch (err) {
            const message = err instanceof CliError ? err.stderr || err.message : String(err);
            deps.output.appendLine(`$ ${displayCommand(projectsSpec)}`);
            deps.output.appendLine(`projects list unavailable for store grouping: ${message}`);
        }

        const stores = parseKvStoresList(storesRaw);
        const projects = parseProjectRefs(projectsRaw);
        const enriched = enrichKvStores(stores, projects);
        const groups = groupKvStores(enriched);
        const rows = kvStoreTableRows(groups);

        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(
            `${stores.length} store${stores.length === 1 ? '' : 's'} · ${groups.length} group${
                groups.length === 1 ? '' : 's'
            }`,
        );

        await post(entry, {
            ...base,
            rows,
            levels: rows.map(() => undefined),
            allColumns: preferredColumns(rows),
            columns: preferredColumns(rows).slice(0, PREFERRED.length),
            // Stores list has no secret-shaped fields; redact is still applied
            // for consistency with every other raw pane.
            rawJson: JSON.stringify(
                redact({ stores: enriched, groups: groups.map((g) => g.label) }),
                null,
                2,
            ),
        });
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);
        await post(entry, { ...base, error: message });
    }
}

function preferredColumns(rows: Array<Record<string, string>>): string[] {
    if (rows.length === 0) {
        return PREFERRED;
    }
    const present = new Set(Object.keys(rows[0]));
    const preferred = PREFERRED.filter((column) => present.has(column));
    const rest = [...present].filter((column) => !preferred.includes(column)).sort();
    return [...preferred, ...rest];
}

function post(entry: OpenPanel, payload: ResultsPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'results', payload });
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
