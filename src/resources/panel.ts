import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, runJson } from '../cli';
import { contextFor } from '../commands/target';
import { resolveEnvironmentNames } from '../environments';
import { FormDeps, show } from '../forms/panel';
import { ResolvedState } from '../resolver/types';
import {
    buildEditArgs,
    readResourceConfig,
    readResourceForm,
    ResourceConfig,
    resourceFields,
} from './config';

/**
 * Resource editor for one project environment.
 *
 * Values are read from `projects details` and written with `projects edit`,
 * which PUTs the whole deployment config — so the form is prefilled with the
 * current state and `buildEditArgs` re-sends the fields that would otherwise be
 * dropped. See config.ts for the two flags that behave that way.
 */
export async function openResourcesForm(deps: FormDeps): Promise<void> {
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return;
    }

    const environment =
        environments.length === 1
            ? environments[0]
            : await vscode.window.showQuickPick(environments, {
                  title: 'Edit resources for which environment?',
              });
    if (!environment) {
        return;
    }

    let current: ResourceConfig | undefined;
    try {
        const details = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: reading resources' },
            () =>
                runJson<unknown>(deps.bin, {
                    args: ['projects', 'details', deps.state.projectId as string],
                    cwd: deps.state.projectDir,
                    context: contextFor(deps.state),
                }),
        );
        current = readResourceConfig(details, environment);
    } catch (err) {
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        deps.output.appendLine(`could not read resources: ${message}`);
        void vscode.window.showErrorMessage(`Versori: could not read resources — ${message}`);
        return;
    }

    if (!current) {
        void vscode.window.showErrorMessage(
            `Versori: no environment named "${environment}" in this project.`,
        );
        return;
    }

    const config = current;

    show(deps, {
        // Keyed by environment: `show` reveals rather than replaces an open
        // panel, so a single key would make the second environment unreachable.
        viewType: `versori.resourcesForm.${environment}`,
        title: `Resources · ${projectName(deps.state)}`,
        heading: `Resources · ${environment}`,
        subtitle: subtitle(deps.state),
        // `projects edit` has no --dry-run, so there is no dry-run field.
        dryRunFieldId: '',
        dryRunLabel: '',
        liveLabel: `Update ${environment}`,
        confirmWhenLive: true,
        // Always confirm: there is no dry run to fall back on, and no setting
        // that turning this off could belong to.
        confirmSettingId: '',
        confirmMessage: `This changes the live deployment config for ${environment}. A running environment may restart.`,
        fields: resourceFields(config),
        buildArgs: (values) => buildEditArgs(environment, config, readResourceForm(values)),
        successMessage: () => `Updated resources for ${environment}.`,
    });
}

function projectName(state: ResolvedState): string {
    return state.projectDir ? path.basename(state.projectDir) : 'project';
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}
