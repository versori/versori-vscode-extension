import * as path from 'node:path';
import * as vscode from 'vscode';

import { showActivationsPanel } from '../activations/panel';
import { showConnectorsPanel } from '../connectors/panel';
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
import { openCompareVersion, swapCompareSides } from '../compare/panel';
import { showVariablesPanel } from '../variables/panel';
import { POPUP_BACK, PopupSession } from '../forms/popup';
import { appendChord } from '../keybindings/format';
import { MenuRow, menuLayout } from './layout';
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
    /** Chord the user bound to a command, already pretty-printed. */
    chordFor: (command: string) => string | undefined;
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
                await reportError(menuDeps.output, err);
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

/**
 * One menu action: a QuickPick row *and* a bindable command.
 *
 * The registry is the single source of truth. `buildItems` renders it into the
 * popup and `extension.ts` registers a command per entry from the same list,
 * so keyboard, Command Palette, and popup always run identical code.
 */
export interface MenuAction {
    /** Command id, stable forever — users bind these. */
    command: string;
    /** Human name; the Palette shows `Versori: <title>`. */
    title: string;
    /** QuickPick label, including its `$(icon)`. */
    label: string;
    description?: string | ((state: ResolvedState) => string | undefined);
    /** Needs a resolved project; without one the command reports it and stops. */
    needsProject: boolean;
    run: (deps: MenuDeps, popup: PopupSession) => Promise<'menu' | 'close'>;
}

export const MENU_ACTIONS: MenuAction[] = [
    {
        command: 'versori.deployProject',
        title: 'Deploy Project',
        label: '$(rocket) Deploy...',
        description: 'dry run by default',
        needsProject: true,
        run: (deps, popup) => openDeployForm(deps, popup),
    },
    {
        command: 'versori.saveVersion',
        title: 'Save Version',
        label: '$(save) Save version...',
        description: 'checkpoint only — does not deploy',
        needsProject: true,
        run: (deps, popup) => openSaveVersionForm(deps, popup),
    },
    {
        command: 'versori.syncProjectHere',
        title: 'Sync',
        label: '$(cloud-download) Sync...',
        description: 'pull remote files — dry run by default',
        needsProject: false,
        run: openSyncForm,
    },
    {
        command: 'versori.compareVersion',
        title: 'Compare Version',
        label: '$(diff) Compare version…',
        description: 'diff this folder against a saved version',
        needsProject: true,
        run: (deps, popup) => openCompareVersion(deps, popup),
    },
    {
        command: 'versori.compareSwapSides',
        title: 'Swap Compare Sides',
        label: '$(arrow-swap) Swap compare sides',
        description: 'flip the last compare without re-running the CLI',
        needsProject: false,
        run: async (deps, popup) => {
            popup.close();
            await swapCompareSides(deps);
            return 'close';
        },
    },
    {
        command: 'versori.showVersions',
        title: 'Versions',
        label: '$(history) Versions',
        needsProject: true,
        run: showVersions,
    },
    {
        command: 'versori.resources',
        title: 'Resources',
        label: '$(dashboard) Resources...',
        description: 'CPU/memory/storage sliders, scaling, static IP',
        needsProject: true,
        run: (deps, popup) => openResourcesForm(deps, popup),
    },
    {
        command: 'versori.kvEntries',
        title: 'KV Entries',
        label: '$(database) KV entries',
        description: 'read, set, edit, delete, and wipe with confirmation',
        needsProject: true,
        run: showKvEntries,
    },
    {
        command: 'versori.kvStores',
        title: 'KV Stores',
        label: '$(database) KV stores',
        description: 'organisation-wide, grouped by project when possible',
        needsProject: false,
        run: showKvStores,
    },
    {
        command: 'versori.connectors',
        title: 'Connectors',
        label: '$(plug) Connectors',
        needsProject: true,
        run: showConnectors,
    },
    {
        command: 'versori.staticConnections',
        title: 'Static Connections',
        label: '$(key) Static connections',
        description: 'connections bound to an environment',
        needsProject: true,
        run: showStaticConnections,
    },
    {
        command: 'versori.connections',
        title: 'Connections',
        label: '$(plug) Connections',
        description: 'organisation-wide',
        needsProject: false,
        run: showConnections,
    },
    {
        command: 'versori.activations',
        title: 'Activations',
        label: '$(organization) Activations',
        description: 'users, activation connections, and runtime variables',
        needsProject: true,
        run: showActivations,
    },
    {
        command: 'versori.variables',
        title: 'Variables',
        label: '$(symbol-variable) Variables',
        description: 'project activation-variable schema',
        needsProject: true,
        run: showVariables,
    },
    {
        command: 'versori.logs',
        title: 'Logs',
        label: '$(output) Logs',
        needsProject: true,
        run: showLogs,
    },
    {
        command: 'versori.issues',
        title: 'Issues',
        label: '$(warning) Issues',
        needsProject: true,
        run: showIssues,
    },
    {
        command: 'versori.switchContext',
        title: 'Switch Context',
        label: '$(gear) Switch context...',
        description: (state) => state.activeContextName ?? 'none active',
        needsProject: false,
        run: switchContext,
    },
    {
        command: 'versori.showOutput',
        title: 'Show Output',
        label: '$(list-flat) Show output log',
        needsProject: false,
        run: async (deps, popup) => {
            popup.close();
            deps.output.show(true);
            return 'close';
        },
    },
    {
        command: 'versori.configureKeybindings',
        title: 'Configure Keyboard Shortcuts',
        label: '$(keyboard) Configure keyboard shortcuts',
        needsProject: false,
        run: configureKeybindings,
    },
];

const ACTIONS_BY_COMMAND = new Map(MENU_ACTIONS.map((action) => [action.command, action]));

export function actionFor(command: string): MenuAction | undefined {
    return ACTIONS_BY_COMMAND.get(command);
}

function buildItems(deps: MenuDeps): ActionItem[] {
    const inProject = Boolean(deps.state.projectId && deps.state.projectDir);

    return menuLayout(inProject).flatMap((row) => {
        const item = rowItem(row, deps);
        return item ? [item] : [];
    });
}

function rowItem(row: MenuRow, deps: MenuDeps): ActionItem | undefined {
    if (row.kind === 'section') {
        return section(row.label);
    }

    if (row.kind === 'notice') {
        return {
            label: '$(info) No synced project for this file',
            detail: 'Open a file inside a directory containing a .versori to enable project actions.',
        };
    }

    const action = actionFor(row.command);
    if (!action) {
        return undefined;
    }

    const described =
        typeof action.description === 'function'
            ? action.description(deps.state)
            : action.description;

    return {
        label: action.label,
        description: appendChord(described, deps.chordFor(action.command)),
        run: action.run,
    };
}

/**
 * Open the Keybindings editor filtered to this extension's commands.
 *
 * Settings (`@ext:`) is deliberately not used: that page cannot assign keys.
 */
async function configureKeybindings(
    _deps: MenuDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    popup.close();
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'versori.');
    return 'close';
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

    await showConnectorsPanel(deps, environments);
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

export async function reportError(
    output: vscode.OutputChannel,
    err: unknown,
): Promise<void> {
    const message = err instanceof CliError ? err.stderr || err.message : String(err);

    if (err instanceof CliError) {
        output.appendLine(`$ versori ${err.argv.join(' ')}`);
    }
    output.appendLine(message);
    output.appendLine('');

    const action = await vscode.window.showErrorMessage(
        `Versori: ${firstLine(message)}`,
        'Show output',
    );
    if (action === 'Show output') {
        output.show(true);
    }
}

function firstLine(text: string): string {
    const line = text.split('\n').find((l) => l.trim()) ?? 'command failed';
    return line.length > 200 ? `${line.slice(0, 200)}...` : line;
}
