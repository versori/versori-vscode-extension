import * as vscode from 'vscode';

import { CliError, runJson } from './cli';
import { contextFor } from './commands/target';
import { ResolvedState } from './resolver/types';

interface ProjectDetails {
    environments?: Array<{ name?: string; Name?: string } | string>;
}

/**
 * Environment names for a project.
 *
 * There is no `projects environments list` subcommand, so this comes from
 * `projects details`. That command takes the project id as a **positional
 * argument** — it has no `--project` flag and does not read `.versori`. Called
 * without one it opens an interactive TUI picker, which fails outright when
 * spawned without a TTY ("could not open a new TTY"). Always pass the id.
 */
export async function loadEnvironments(
    bin: string,
    state: ResolvedState,
    output: vscode.OutputChannel,
): Promise<string[]> {
    if (!state.projectId) {
        return [];
    }

    try {
        const details = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: loading environments' },
            () =>
                runJson<ProjectDetails>(bin, {
                    args: ['projects', 'details', state.projectId as string],
                    cwd: state.projectDir,
                    context: contextFor(state),
                }),
        );

        return (details?.environments ?? [])
            .map((env) => (typeof env === 'string' ? env : (env?.name ?? env?.Name)))
            .filter((name): name is string => Boolean(name));
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        output.appendLine(`could not load environments: ${message}`);
        return [];
    }
}

/**
 * Resolve the environment to act on: chosen automatically when the project has
 * exactly one, otherwise picked by the user.
 */
export async function pickEnvironment(
    bin: string,
    state: ResolvedState,
    output: vscode.OutputChannel,
): Promise<string | undefined> {
    const names = await loadEnvironments(bin, state, output);

    if (names.length === 1) {
        return names[0];
    }

    if (names.length === 0) {
        return vscode.window.showInputBox({
            title: 'Environment',
            prompt: 'Could not read the project’s environments — enter one',
            placeHolder: 'production',
            ignoreFocusOut: true,
        });
    }

    return vscode.window.showQuickPick(names, { title: 'Select environment' });
}
