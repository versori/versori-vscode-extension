import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, run, runJson } from '../cli';
import { parseContextList } from '../contexts';
import { resolveEnvironmentNames } from '../environments';
import { openDeployForm, openSaveVersionForm } from '../forms/panel';
import { showIssuesPanel } from '../issues/panel';
import { showKvPanel } from '../kv/panel';
import { showLogPanel } from '../logs/panel';
import { ResolvedState } from '../resolver/types';
import { openResourcesForm } from '../resources/panel';
import { ENVIRONMENT_ID, environmentArgs, environmentControl } from '../results/controls';
import { showResults } from '../results/panel';
import { openSyncForm } from '../sync/panel';
import { projectArgs } from './target';

export interface MenuDeps {
    /** Absolute path to the versori binary. */
    bin: string;
    /** State for the file the user is looking at. */
    state: ResolvedState;
    output: vscode.OutputChannel;
    /** Called after the active context changes, so the status bar can refresh. */
    onContextChanged: () => void;
}

interface ActionItem extends vscode.QuickPickItem {
    run?: (deps: MenuDeps) => Promise<void>;
}

const SEPARATOR: ActionItem = {
    label: '',
    kind: vscode.QuickPickItemKind.Separator,
};

export async function showMenu(deps: MenuDeps): Promise<void> {
    const picked = await vscode.window.showQuickPick(buildItems(deps), {
        title: menuTitle(deps.state),
        placeHolder: 'Versori',
        matchOnDescription: true,
    });

    if (!picked?.run) {
        return;
    }

    try {
        await picked.run(deps);
    } catch (err) {
        await reportError(deps, err);
    }
}

function menuTitle(state: ResolvedState): string {
    if (!state.contextName) {
        return 'Versori — no context configured';
    }
    const project = state.projectDir ? ` · ${path.basename(state.projectDir)}` : '';
    return `Versori — ${state.contextName}${project}`;
}

function buildItems(deps: MenuDeps): ActionItem[] {
    const inProject = Boolean(deps.state.projectId && deps.state.projectDir);
    const items: ActionItem[] = [];

    if (inProject) {
        items.push(
            {
                label: '$(rocket) Deploy...',
                description: 'dry run by default',
                run: (deps) => openDeployForm(deps),
            },
            {
                label: '$(save) Save version...',
                description: 'checkpoint only — does not deploy',
                run: async (deps) => openSaveVersionForm(deps),
            },
            {
                label: '$(dashboard) Resources...',
                description: 'CPU, memory, replicas, static IP',
                run: (deps) => openResourcesForm(deps),
            },
            SEPARATOR,
            { label: '$(output) Logs', run: showLogs },
            { label: '$(warning) Issues', run: showIssues },
            { label: '$(plug) Connectors', run: showConnectors },
            {
                label: '$(key) Static connections',
                description: 'connections bound to an environment',
                run: showStaticConnections,
            },
            {
                label: '$(database) KV entries',
                description: 'read-only',
                run: showKvEntries,
            },
            { label: '$(history) Versions', run: showVersions },
        );
    } else {
        items.push(
            {
                label: '$(info) No synced project for this file',
                detail: 'Open a file inside a directory containing a .versori to enable project actions.',
            },
            SEPARATOR,
        );
    }

    items.push({
        label: '$(cloud-download) Sync...',
        description: 'pull remote files — dry run by default',
        run: openSyncForm,
    });
    items.push(SEPARATOR);
    items.push({
        label: '$(plug) Connections',
        description: 'organisation-wide',
        run: showConnections,
    });
    items.push({
        label: '$(database) KV stores',
        description: 'organisation-wide',
        run: showKvStores,
    });
    items.push(SEPARATOR);
    items.push({
        label: '$(gear) Switch context...',
        description: deps.state.activeContextName ?? 'none active',
        run: switchContext,
    });
    items.push({ label: '$(list-flat) Show output log', run: async (d) => d.output.show(true) });

    return items;
}

/* ------------------------------------------------------------------ views */

async function showLogs(deps: MenuDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    await showLogPanel(deps, environments);
}

async function showIssues(deps: MenuDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    await showIssuesPanel(deps, environments);
}

/**
 * Connectors for an environment.
 *
 * "Connector" is the platform's name for what the CLI and API call a system, so
 * the argv stays `projects systems` while the label matches the web app. Do not
 * "fix" the mismatch — the CLI has no `connectors` command.
 */
async function showConnectors(deps: MenuDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    await showResults(deps, {
        id: 'connectors',
        heading: (values) => `Connectors · ${values[ENVIRONMENT_ID]}`,
        baseArgs: ['projects', 'systems', 'list', ...projectArgs(deps.state)],
        controls: [environmentControl(environments)],
        controlArgs: environmentArgs,
        preferred: ['name', 'id', 'templateBaseUrl'],
    });
}

/** Static (non-dynamic) connections bound to a project environment. */
async function showStaticConnections(deps: MenuDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    await showResults(deps, {
        id: 'staticConnections',
        heading: (values) => `Static connections · ${values[ENVIRONMENT_ID]}`,
        baseArgs: ['projects', 'systems', 'list-connections', ...projectArgs(deps.state)],
        controls: [environmentControl(environments)],
        controlArgs: environmentArgs,
        preferred: ['name', 'id', 'system', 'connectionTemplateId'],
    });
}

async function showVersions(deps: MenuDeps): Promise<void> {
    await showResults(deps, {
        id: 'versions',
        heading: () => 'Versions',
        baseArgs: ['projects', 'versions', 'list', ...projectArgs(deps.state)],
        preferred: ['name', 'createdAt', 'created', 'description', 'id'],
    });
}

/**
 * KV entries for a scope. Read-only.
 *
 * `kv set` / `delete` / `wipe` are deliberately absent: they mutate live
 * workflow state and belong in the terminal, where their confirmation prompts
 * are. See README.md.
 */
async function showKvEntries(deps: MenuDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    await showKvPanel(deps, environments);
}

/** KV stores in the organisation. Store ids feed the CLI's raw `--store` mode. */
async function showKvStores(deps: MenuDeps): Promise<void> {
    await showResults(deps, {
        id: 'kvStores',
        heading: () => 'KV stores',
        baseArgs: ['kv', 'stores', 'list'],
        preferred: ['name', 'id', 'createdAt'],
    });
}

async function showConnections(deps: MenuDeps): Promise<void> {
    // Org-scoped: `connections list` has no --project flag.
    await showResults(deps, {
        id: 'connections',
        heading: () => 'Connections',
        baseArgs: ['connections', 'list'],
        preferred: ['name', 'system', 'id'],
    });
}

/* ---------------------------------------------------------------- actions */

async function switchContext(deps: MenuDeps): Promise<void> {
    // The raw response contains full JWTs — only names are ever extracted from
    // it, and it is never written to the output channel.
    const contexts = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Versori: loading contexts' },
        () => runJson<unknown>(deps.bin, { args: ['context', 'list'] }),
    );

    const entries = parseContextList(contexts);
    if (entries.length === 0) {
        vscode.window.showWarningMessage('Versori: no contexts configured.');
        return;
    }

    const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
            label: entry.name,
            description: entry.active ? 'active' : undefined,
        })),
        { title: 'Switch active Versori context' },
    );
    if (!picked) {
        return;
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Versori: selecting ${picked.label}` },
        () => run(deps.bin, { args: ['context', 'select', picked.label], json: false }),
    );

    deps.onContextChanged();

    if (deps.state.source === 'versori-file') {
        // Honest warning: inside a project that pins a context, switching the
        // active one changes nothing for commands run here.
        vscode.window.showInformationMessage(
            `Active context is now "${picked.label}", but this project pins "${deps.state.contextName}" in .versori, which still wins here.`,
        );
    }
}

async function reportError(deps: MenuDeps, err: unknown): Promise<void> {
    const message = err instanceof CliError ? err.stderr || err.message : String(err);

    if (err instanceof CliError) {
        deps.output.appendLine(`$ versori ${err.argv.join(' ')}`);
    }
    deps.output.appendLine(message);
    deps.output.appendLine('');

    const action = await vscode.window.showErrorMessage(
        `Versori: ${firstLine(message)}`,
        'Show output',
    );
    if (action === 'Show output') {
        deps.output.show(true);
    }
}

function firstLine(text: string): string {
    const line = text.split('\n').find((l) => l.trim()) ?? 'command failed';
    return line.length > 200 ? `${line.slice(0, 200)}...` : line;
}
