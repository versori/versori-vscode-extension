import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, run, runJson } from '../cli';
import { parseContextList } from '../contexts';
import { resolveEnvironmentNames } from '../environments';
import { openDeployForm, openSaveVersionForm } from '../forms/panel';
import { showLogPanel } from '../logs/panel';
import { ResolvedState } from '../resolver/types';
import { ENVIRONMENT_ID, environmentArgs, environmentControl } from '../results/controls';
import { showResults } from '../results/panel';
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
            SEPARATOR,
            { label: '$(output) Logs', run: showLogs },
            { label: '$(warning) Issues', run: showIssues },
            { label: '$(server) Systems', run: showSystems },
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

    items.push({ label: '$(plug) Connections', run: showConnections });
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
    await showResults(deps, {
        id: 'issues',
        heading: () => 'Issues',
        baseArgs: ['projects', 'issues', 'list', ...projectArgs(deps.state)],
        preferred: ['severity', 'status', 'title', 'summary', 'createdAt', 'created'],
        levelColumn: 'severity',
    });
}

async function showSystems(deps: MenuDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    await showResults(deps, {
        id: 'systems',
        heading: (values) => `Systems · ${values[ENVIRONMENT_ID]}`,
        // argv stays `projects systems` — Task 11 renames only what the user sees.
        baseArgs: ['projects', 'systems', 'list', ...projectArgs(deps.state)],
        controls: [environmentControl(environments)],
        controlArgs: environmentArgs,
        preferred: ['name', 'id', 'templateBaseUrl'],
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
