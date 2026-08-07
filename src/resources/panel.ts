import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, runJson } from '../cli';
import { contextFor } from '../commands/target';
import { resolveEnvironmentNames } from '../environments';
import { FormDeps, runForm } from '../forms/panel';
import { POPUP_BACK, PopupSession } from '../forms/popup';
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
export async function openResourcesForm(
    deps: FormDeps,
    popup: PopupSession,
): Promise<'menu' | 'close'> {
    popup.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    const picked =
        environments.length === 1
            ? environments[0]
            : await popup.choose({
                  title: 'Edit resources for which environment?',
                  items: environments.map((environment) => ({
                      label: environment,
                      value: environment,
                  })),
                  back: true,
              });
    if (picked === undefined || picked === POPUP_BACK) {
        return 'menu';
    }
    const environment = picked;

    let current: ResourceConfig | undefined;
    try {
        popup.loading('Resources', 'Reading current resource configuration…');
        const details = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: reading resources' },
            () =>
                runJson<unknown>(deps.bin, {
                    args: ['projects', 'details', deps.state.projectId as string],
                    cwd: deps.state.projectDir,
                    context: contextFor(deps.state),
                }),
        );
        if (!popup.isVisible()) {
            return 'menu';
        }
        current = readResourceConfig(details, environment);
    } catch (err) {
        popup.close();
        const message = err instanceof CliError ? err.stderr || err.message : String(err);
        deps.output.appendLine(`could not read resources: ${message}`);
        await vscode.window.showErrorMessage(`Versori: could not read resources — ${message}`);
        return 'menu';
    }

    if (!current) {
        popup.close();
        await vscode.window.showErrorMessage(
            `Versori: no environment named "${environment}" in this project.`,
        );
        return 'menu';
    }

    const config = current;

    return runForm(deps, popup, {
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
        buildArgs: (values) =>
            buildEditArgs(environment, config, readResourceForm(values), deps.state.projectId),
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
