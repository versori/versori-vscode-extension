import * as path from 'node:path';
import * as vscode from 'vscode';

import { showActivationsPanel } from '../activations/panel';
import { CliError, run, runJson } from '../cli';
import { parseContextList } from '../contexts';
import { resolveEnvironmentNames } from '../environments';
import { openDeployForm, openSaveVersionForm } from '../forms/panel';
import { showIssuesPanel } from '../issues/panel';
import { showKvPanel } from '../kv/panel';
import { showKvStoresPanel } from '../kv/stores-panel';
import { showLogPanel } from '../logs/panel';
import { ResolvedState } from '../resolver/types';
import { openResourcesForm } from '../resources/panel';
import { ENVIRONMENT_ID, environmentArgs, environmentControl } from '../results/controls';
import { showResults } from '../results/panel';
import { openSyncForm } from '../sync/panel';
import { showVariablesPanel } from '../variables/panel';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { projectArgs } from './target';

export interface MenuDeps {
    /** Absolute path to the versori binary. */
    bin: string;
    /** State for the file the user is looking at. */
    state: ResolvedState;
    output: vscode.OutputChannel;
    /** Called after the active context changes, so the status bar can refresh. */
    onContextChanged: () => void;
    /** Reads the latest resolver state before the root menu is rendered. */
    getState: () => ResolvedState;
}

interface ActionItem extends vscode.QuickPickItem {
    run?: (deps: MenuDeps, popup: PopupSession) => Promise<'menu' | 'close'>;
}

function section(label: string): ActionItem {
    return { label, kind: vscode.QuickPickItemKind.Separator };
}

export async function showMenu(deps: MenuDeps): Promise<void> {
    const popup = new PopupSession();
    try {
        while (true) {
            const menuDeps: MenuDeps = { ...deps, state: deps.getState() };
            const picked = await popup.choose<ActionItem>({
                title: menuTitle(menuDeps.state),
                placeholder: 'Versori',
                matchOnDescription: true,
                items: buildItems(menuDeps).map((item) => ({ ...item, value: item })),
            });

            if (picked === undefined || picked === POPUP_BACK || !picked.run) {
                return;
            }

            try {
                const result = await picked.run(menuDeps, popup);
                if (result === 'close') {
                    return;
                }
            } catch (err) {
                popup.close();
                await reportError(menuDeps, err);
                return;
            }
        }
    } finally {
        popup.dispose();
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
            section('Project management'),
            {
                label: '$(rocket) Deploy...',
                description: 'dry run by default',
                run: (deps, popup) => openDeployForm(deps, popup),
            },
            {
                label: '$(save) Save version...',
                description: 'checkpoint only — does not deploy',
                run: (deps, popup) => openSaveVersionForm(deps, popup),
            },
            {
                label: '$(cloud-download) Sync...',
                description: 'pull remote files — dry run by default',
                run: openSyncForm,
            },
            { label: '$(history) Versions', run: showVersions },
            {
                label: '$(dashboard) Resources...',
                description: 'CPU/memory/storage sliders, scaling, static IP',
                run: (deps, popup) => openResourcesForm(deps, popup),
            },
            section('KV'),
            {
                label: '$(database) KV entries',
                description: 'read, set, edit, delete, and wipe with confirmation',
                run: showKvEntries,
            },
            {
                label: '$(database) KV stores',
                description: 'organisation-wide, grouped by project when possible',
                run: showKvStores,
            },
            section('Connectors and connections'),
            { label: '$(plug) Connectors', run: showConnectors },
            {
                label: '$(key) Static connections',
                description: 'connections bound to an environment',
                run: showStaticConnections,
            },
            {
                label: '$(plug) Connections',
                description: 'organisation-wide',
                run: showConnections,
            },
            section('Users and variables'),
            {
                label: '$(organization) Activations',
                description: 'users, activation connections, and runtime variables',
                run: showActivations,
            },
            {
                label: '$(symbol-variable) Variables',
                description: 'project activation-variable schema',
                run: showVariables,
            },
            section('Observe'),
            { label: '$(output) Logs', run: showLogs },
            { label: '$(warning) Issues', run: showIssues },
        );
    } else {
        items.push(
            {
                label: '$(info) No synced project for this file',
                detail: 'Open a file inside a directory containing a .versori to enable project actions.',
            },
            section('Project management'),
            {
                label: '$(cloud-download) Sync...',
                description: 'pull remote files — dry run by default',
                run: openSyncForm,
            },
            section('KV'),
            {
                label: '$(database) KV stores',
                description: 'organisation-wide, grouped by project when possible',
                run: showKvStores,
            },
            section('Connections'),
            {
                label: '$(plug) Connections',
                description: 'organisation-wide',
                run: showConnections,
            },
        );
    }

    items.push(section('Context'));
    items.push({
        label: '$(gear) Switch context...',
        description: deps.state.activeContextName ?? 'none active',
        run: switchContext,
    });
    items.push({
        label: '$(list-flat) Show output log',
        run: async (d, popup) => {
            popup.close();
            d.output.show(true);
            return 'close';
        },
    });

    return items;
}

/* ------------------------------------------------------------------ views */

async function showLogs(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    await showLogPanel(deps, environments);
    return 'close';
}

async function showIssues(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    await showIssuesPanel(deps, environments);
    return 'close';
}

async function showActivations(
    deps: MenuDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    await showActivationsPanel(deps, environments);
    return 'close';
}

async function showVariables(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    await showVariablesPanel(deps);
    return 'close';
}

/**
 * Connectors for an environment.
 *
 * "Connector" is the platform's name for what the CLI and API call a system, so
 * the argv stays `projects systems` while the label matches the web app. Do not
 * "fix" the mismatch — the CLI has no `connectors` command.
 */
async function showConnectors(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    await showResults(deps, {
        id: 'connectors',
        heading: (values) => `Connectors · ${values[ENVIRONMENT_ID]}`,
        baseArgs: ['projects', 'systems', 'list', ...projectArgs(deps.state)],
        controls: [environmentControl(environments)],
        controlArgs: environmentArgs,
        preferred: ['name', 'id', 'templateBaseUrl'],
    });
    return 'close';
}

/** Static (non-dynamic) connections bound to a project environment. */
async function showStaticConnections(
    deps: MenuDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    await showResults(deps, {
        id: 'staticConnections',
        heading: (values) => `Static connections · ${values[ENVIRONMENT_ID]}`,
        baseArgs: ['projects', 'systems', 'list-connections', ...projectArgs(deps.state)],
        controls: [environmentControl(environments)],
        controlArgs: environmentArgs,
        preferred: ['name', 'id', 'system', 'connectionTemplateId'],
    });
    return 'close';
}

async function showVersions(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    await showResults(deps, {
        id: 'versions',
        heading: () => 'Versions',
        baseArgs: ['projects', 'versions', 'list', ...projectArgs(deps.state)],
        preferred: ['name', 'createdAt', 'created', 'description', 'id'],
    });
    return 'close';
}

/**
 * KV entries for a scope, including host-confirmed mutations.
 */
async function showKvEntries(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    await showKvPanel(deps, environments);
    return 'close';
}

/** KV stores in the organisation, grouped by project name when possible. */
async function showKvStores(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    popup.close();
    await showKvStoresPanel(deps);
    return 'close';
}

async function showConnections(deps: MenuDeps, popup: PopupSession): Promise<'menu' | 'close'> {
    // Org-scoped: `connections list` has no --project flag.
    popup.close();
    await showResults(deps, {
        id: 'connections',
        heading: () => 'Connections',
        baseArgs: ['connections', 'list'],
        preferred: ['name', 'system', 'id'],
    });
    return 'close';
}

/* ---------------------------------------------------------------- actions */

async function switchContext(
    deps: MenuDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    // The raw response contains full JWTs — only names are ever extracted from
    // it, and it is never written to the output channel.
    popup.loading('Switch context', 'Loading contexts…');
    const contexts = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Versori: loading contexts' },
        () => runJson<unknown>(deps.bin, { args: ['context', 'list'] }),
    );
    if (!popup.isVisible()) {
        return 'menu';
    }

    const entries = parseContextList(contexts);
    if (entries.length === 0) {
        popup.close();
        await vscode.window.showWarningMessage('Versori: no contexts configured.');
        return 'menu';
    }

    const picked = await popup.choose({
        title: 'Switch active Versori context',
        back: true,
        items: entries.map((entry) => ({
            label: entry.name,
            description: entry.active ? 'active' : undefined,
            value: entry.name,
        })),
    });
    if (picked === undefined || picked === POPUP_BACK) {
        return 'menu';
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Versori: selecting ${picked}` },
        () => run(deps.bin, { args: ['context', 'select', picked], json: false }),
    );

    deps.onContextChanged();
    popup.close();

    if (deps.state.source === 'versori-file') {
        // Honest warning: inside a project that pins a context, switching the
        // active one changes nothing for commands run here.
        await vscode.window.showInformationMessage(
            `Active context is now "${picked}", but this project pins "${deps.state.contextName}" in .versori, which still wins here.`,
        );
    }
    return 'close';
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
