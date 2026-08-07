import * as vscode from 'vscode';

import { CliError, runJson } from './cli';
import { contextFor } from './commands/target';
import { ResolvedState } from './resolver/types';

interface ProjectDetails {
    environments?: Array<{ name?: string; Name?: string } | string>;
}

export interface EnvironmentLookup {
    names: string[];
    /**
     * Present when the CLI call failed. Distinguishes "could not ask" from
     * "asked, and the project genuinely has none" — the two used to be
     * indistinguishable, which is how a failed lookup became a text prompt.
     */
    error?: string;
}

/**
 * Environment names for a project.
 *
 * There is no `projects environments list` subcommand, so this comes from
 * `projects details`. That command takes the project id as a **positional
 * argument** — it has no `--project` flag and does not read `.versori`. Called
 * without one it opens an interactive TUI picker, which fails outright when
 * spawned without a TTY ("could not open a new TTY"). Always pass the id, and
 * always pass `--context` (see contextFor): the command resolves its
 * organisation from the active context, not from `.versori`.
 */
export async function loadEnvironments(
    bin: string,
    state: ResolvedState,
    output: vscode.OutputChannel,
): Promise<EnvironmentLookup> {
    if (!state.projectId) {
        return { names: [] };
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

        const names = (details?.environments ?? [])
            .map((env) => (typeof env === 'string' ? env : (env?.name ?? env?.Name)))
            .filter((name): name is string => Boolean(name));

        return { names };
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        output.appendLine(`could not load environments: ${message}`);
        return { names: [], error: message };
    }
}

/**
 * Tell the user why a panel could not open. Never silently degrades to asking
 * them to type an environment name — a wrong guess there produces an empty
 * result set that looks like a real answer.
 */
export async function reportEnvironmentProblem(
    lookup: EnvironmentLookup,
    output: vscode.OutputChannel,
): Promise<void> {
    if (lookup.error) {
        await reportEnvironmentError(lookup.error, output);
        return;
    }

    await vscode.window.showWarningMessage(
        'Versori: this project has no environments yet. Create one with `versori projects environments create`.',
    );
}

async function reportEnvironmentError(
    error: string,
    output: vscode.OutputChannel,
): Promise<void> {
    const action = await vscode.window.showErrorMessage(
        `Versori: could not read this project's environments — ${firstLine(error)}`,
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

export interface EnvironmentTarget {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

/**
 * Environment names for a project, or undefined when there are none to offer.
 *
 * Reports the problem itself, so callers cannot accidentally continue past a
 * failed lookup — the defect this module exists to prevent.
 */
export async function resolveEnvironmentNames(
    target: EnvironmentTarget,
): Promise<string[] | undefined> {
    const lookup = await loadEnvironments(target.bin, target.state, target.output);

    if (lookup.names.length === 0) {
        await reportEnvironmentProblem(lookup, target.output);
        return undefined;
    }

    return lookup.names;
}
