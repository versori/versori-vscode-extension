import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, displayCommand, run } from '../cli';
import { contextFor } from '../commands/target';
import { resolveEnvironmentNames } from '../environments';
import { ResolvedState } from '../resolver/types';
import {
    buildDeployArgs,
    buildVersionArgs,
    interpolate,
    missingRequired,
    readBoolean,
    readString,
} from './build';
import { POPUP_BACK, PopupSession } from './popup';
import {
    createQuickFormState,
    currentFirst,
    enterField,
    enterScreen,
    fieldSummary,
    formActionLabel,
    goBack,
    requiresConfirmation,
    setFormValue,
    QuickFormState,
    FormScreen,
    stepFor,
    totalSteps,
} from './quick-model';
import { Field, FormSpec, FormValues } from './types';

const CONFIRM_SETTING = 'versori.confirmDeploy';

export interface FormDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

export async function openDeployForm(
    deps: FormDeps,
    popup?: PopupSession,
): Promise<'menu' | 'close'> {
    popup?.close();
    const environments = await resolveEnvironmentNames(deps);
    if (!environments) {
        return 'menu';
    }

    const confirmWhenLive = vscode.workspace
        .getConfiguration()
        .get<boolean>(CONFIRM_SETTING, true);

    return runOwnedForm(deps, popup, {
        title: `Deploy · ${projectName(deps.state)}`,
        heading: 'Deploy project',
        subtitle: subtitle(deps.state),
        dryRunFieldId: 'dryRun',
        dryRunLabel: 'Run dry run',
        liveLabel: 'Deploy to {environment}',
        confirmWhenLive,
        confirmSettingId: CONFIRM_SETTING,
        // Names the project as well as the environment: the last gate should
        // surface the thing that would be wrong. An environment name alone reads
        // as correct even when the panel is pointed at another project.
        confirmMessage: `This will deploy ${deployTarget(deps.state)} for real to {environment}.`,
        buildArgs: (values) =>
            buildDeployArgs({
                projectId: deps.state.projectId,
                name: readString(values, 'name'),
                description: readString(values, 'description'),
                environment: readString(values, 'environment'),
                dryRun: readBoolean(values, 'dryRun'),
            }),
        successMessage: (values) => `Deployed to ${readString(values, 'environment')}.`,
        fields: [
            {
                kind: 'text',
                id: 'name',
                label: 'Version name',
                placeholder: 'leave blank for a UTC timestamp',
                value: '',
                hint: 'Optional. The CLI names the version after the current time when blank.',
            },
            {
                kind: 'textarea',
                id: 'description',
                label: 'Description',
                placeholder: 'what changed in this version',
                value: '',
                hint: 'Optional, but it becomes the changelog entry for this version.',
            },
            {
                kind: 'select',
                id: 'environment',
                label: 'Environment',
                value: environments[0],
                options: environments,
            },
            {
                kind: 'checkbox',
                id: 'dryRun',
                label: 'Dry run — list the files that would upload, deploy nothing',
                value: true,
                hint: 'Untick to deploy for real.',
            },
        ],
    });
}

export async function openSaveVersionForm(
    deps: FormDeps,
    popup?: PopupSession,
): Promise<'menu' | 'close'> {
    return runOwnedForm(deps, popup, {
        title: `Save version · ${projectName(deps.state)}`,
        heading: 'Save version',
        subtitle: subtitle(deps.state),
        dryRunFieldId: 'dryRun',
        dryRunLabel: 'Run dry run',
        liveLabel: 'Save version',
        confirmWhenLive: false,
        confirmSettingId: '',
        confirmMessage: '',
        buildArgs: (values) =>
            buildVersionArgs({
                projectId: deps.state.projectId,
                name: readString(values, 'name'),
                description: readString(values, 'description'),
                dryRun: readBoolean(values, 'dryRun'),
            }),
        successMessage: (values) =>
            `Saved version "${readString(values, 'name')}" — a checkpoint only, not deployed.`,
        fields: [
            {
                kind: 'text',
                id: 'name',
                label: 'Version name',
                placeholder: 'e.g. order-webhook',
                value: defaultVersionName(),
                required: true,
                hint: 'Required — the CLI opens an editor when this is blank, which would hang.',
            },
            {
                kind: 'textarea',
                id: 'description',
                label: 'Description',
                placeholder: 'what changed',
                value: '',
                required: true,
                hint: 'Required, for the same reason. Reads as the changelog entry.',
            },
            {
                kind: 'checkbox',
                id: 'dryRun',
                label: 'Dry run — list the files that would upload, save nothing',
                value: true,
                hint: 'Untick to save the checkpoint. Saving never deploys.',
            },
        ],
    });
}

export async function runForm(
    deps: FormDeps,
    popup: PopupSession,
    spec: FormSpec,
): Promise<'menu' | 'close'> {
    let state = createQuickFormState(spec);
    let dontAskAgain = false;

    while (true) {
        if (state.screen.kind === 'review') {
            const picked = await popup.choose<ReviewChoice>({
                title: formTitle(spec),
                placeholder: spec.subtitle,
                items: reviewItems(spec, state),
                step: stepFor(spec, state.screen, state),
                totalSteps: totalSteps(spec, state),
                back: true,
            });

            if (picked === undefined) {
                const previous = goBack(state);
                if (!previous) {
                    return 'menu';
                }
                state = previous;
                continue;
            }
            if (picked === POPUP_BACK) {
                const previous = goBack(state);
                if (!previous) {
                    return 'menu';
                }
                state = previous;
                continue;
            }
            if (picked.kind === 'field') {
                state = enterField(state, picked.id);
                continue;
            }

            const missing = missingRequired(spec.fields, state.values);
            if (missing.length > 0) {
                state = enterField(state, missing[0]);
                continue;
            }

            if (requiresConfirmation(spec, state.values)) {
                state = enterScreen(state, { kind: 'confirm' });
                continue;
            }

            const result = await execute(deps, popup, spec, state.values);
            if (result.kind === 'hidden') {
                return 'menu';
            }
            state = resultState(state, result);
            continue;
        }

        if (state.screen.kind === 'field') {
            const fieldScreen = state.screen;
            const field = spec.fields.find(({ id }) => id === fieldScreen.fieldId);
            if (!field) {
                state = reviewState(state);
                continue;
            }

            const value = await editField(popup, spec, state, field);
            if (value === undefined) {
                state = goBack(state) ?? reviewState(state);
                continue;
            }
            if (value === POPUP_BACK) {
                const previous = goBack(state);
                if (!previous) {
                    return 'menu';
                }
                state = previous;
                continue;
            }

            const edited = setFormValue(state, field.id, value);
            state = goBack(edited) ?? reviewState(edited);
            continue;
        }

        if (state.screen.kind === 'confirm') {
            const picked: ConfirmChoice | typeof POPUP_BACK | undefined =
                await popup.choose<ConfirmChoice>({
                    title: formTitle(spec, 'Confirm'),
                    placeholder: spec.subtitle,
                    items: confirmationItems(spec, state, dontAskAgain),
                    step: stepFor(spec, state.screen, state),
                    totalSteps: totalSteps(spec, state),
                    back: true,
                });

            if (picked === undefined) {
                state = goBack(state) ?? reviewState(state);
                continue;
            }
            if (picked === POPUP_BACK) {
                const previous = goBack(state);
                if (!previous) {
                    return 'menu';
                }
                state = previous;
                continue;
            }
            if (picked.kind === 'dontAsk') {
                const setting = await chooseDontAskAgain(popup, spec, state, dontAskAgain);
                if (setting === POPUP_BACK) {
                    continue;
                }
                dontAskAgain = setting;
                continue;
            }
            if (picked.kind === 'confirm') {
                if (dontAskAgain && spec.confirmSettingId) {
                    await vscode.workspace
                        .getConfiguration()
                        .update(spec.confirmSettingId, false, vscode.ConfigurationTarget.Global);
                }
                const result = await execute(deps, popup, spec, state.values);
                if (result.kind === 'hidden') {
                    return 'menu';
                }
                state = resultState(state, result);
                continue;
            }

            continue;
        }

        const result = state.screen;
        const picked = await popup.choose<ResultChoice>({
            title: formTitle(spec, result.ok ? 'Finished' : 'Failed'),
            placeholder: spec.subtitle,
            items: resultItems(result),
            step: stepFor(spec, result, state),
            totalSteps: totalSteps(spec, state),
            back: true,
        });

        if (picked === undefined) {
            state = goBack(state) ?? reviewState(state);
            continue;
        }
        if (picked === POPUP_BACK || picked.kind === 'back') {
            const previous = goBack(state);
            if (!previous) {
                return 'menu';
            }
            state = previous;
            continue;
        }
        if (picked.kind === 'close') {
            popup.close();
            return 'close';
        }
    }
}

async function runOwnedForm(
    deps: FormDeps,
    popup: PopupSession | undefined,
    spec: FormSpec,
): Promise<'menu' | 'close'> {
    const session = popup ?? new PopupSession();
    try {
        return await runForm(deps, session, spec);
    } finally {
        if (!popup) {
            session.dispose();
        }
    }
}

type ReviewChoice =
    | { kind: 'field'; id: string }
    | { kind: 'submit' };

type ConfirmChoice =
    | { kind: 'warning' }
    | { kind: 'dontAsk' }
    | { kind: 'confirm' };

type ResultChoice = { kind: 'detail' } | { kind: 'back' } | { kind: 'close' };

type ExecutionResult =
    | { kind: 'result'; ok: boolean; text: string }
    | { kind: 'hidden' };

function reviewItems(
    spec: FormSpec,
    state: QuickFormState,
): Array<{ label: string; description: string; value: ReviewChoice }> {
    return [
        ...spec.fields.map((field) => ({
            label: field.label,
            description: fieldSummary(field, state.values[field.id]),
            value: { kind: 'field' as const, id: field.id },
        })),
        {
            label: formActionLabel(spec, state.values),
            description: requiresConfirmation(spec, state.values)
                ? 'Review warning before running'
                : 'Run now',
            value: { kind: 'submit' as const },
        },
    ];
}

function confirmationItems(
    spec: FormSpec,
    state: QuickFormState,
    dontAskAgain: boolean,
): Array<{
    label: string;
    description?: string;
    detail?: string;
    value: ConfirmChoice;
}> {
    const items: Array<{
        label: string;
        description?: string;
        detail?: string;
        value: ConfirmChoice;
    }> = [
        {
            label: 'Warning',
            description: 'Review before running',
            detail: interpolate(spec.confirmMessage, state.values),
            value: { kind: 'warning' },
        },
    ];

    if (spec.confirmSettingId) {
        items.push({
            label: "Don't ask again",
            description: dontAskAgain ? 'On' : 'Off',
            value: { kind: 'dontAsk' },
        });
    }

    items.push({
        label: 'Confirm',
        description: 'Run now',
        value: { kind: 'confirm' },
    });
    return items;
}

async function chooseDontAskAgain(
    popup: PopupSession,
    spec: FormSpec,
    state: QuickFormState,
    dontAskAgain: boolean,
): Promise<boolean | typeof POPUP_BACK> {
    const setting = await popup.choose({
        title: formTitle(spec, "Don't ask again"),
        placeholder: spec.subtitle,
        items: currentFirst([false, true], dontAskAgain).map((value) => ({
            label: value ? 'On' : 'Off',
            value,
        })),
        step: stepFor(spec, state.screen, state),
        totalSteps: totalSteps(spec, state),
        back: true,
    });
    return setting === undefined ? POPUP_BACK : setting;
}

async function editField(
    popup: PopupSession,
    spec: FormSpec,
    state: QuickFormState,
    field: Field,
): Promise<string | boolean | typeof POPUP_BACK | undefined> {
    const screen = {
        title: formTitle(spec, field.label),
        placeholder: fieldHint(spec, field),
        step: stepFor(spec, state.screen, state),
        totalSteps: totalSteps(spec, state),
        back: true,
    };

    if (field.kind === 'text' || field.kind === 'textarea') {
        return popup.input({
            ...screen,
            value: String(state.values[field.id] ?? ''),
        });
    }

    if (field.kind === 'select') {
        return popup.choose({
            ...screen,
            items: currentFirst(
                field.options,
                typeof state.values[field.id] === 'string'
                    ? (state.values[field.id] as string)
                    : undefined,
            ).map((option) => ({ label: option, value: option })),
        });
    }

    return popup.choose({
        ...screen,
        items: currentFirst([true, false], state.values[field.id] === true).map((value) => ({
            label: value ? 'On' : 'Off',
            value,
        })),
    });
}

function resultItems(
    result: Extract<FormScreen, { kind: 'result' }>,
): Array<{ label: string; description?: string; value: ResultChoice }> {
    return [
        {
            label: result.ok ? 'Finished' : 'Failed',
            description: conciseOutput(result.text),
            value: { kind: 'detail' },
        },
        { label: 'Back to form', value: { kind: 'back' } },
        { label: 'Close', value: { kind: 'close' } },
    ];
}

async function execute(
    deps: FormDeps,
    popup: PopupSession,
    spec: FormSpec,
    values: FormValues,
): Promise<ExecutionResult> {
    let args: string[];
    try {
        args = spec.buildArgs(values);
    } catch (err) {
        const text = errorText(err);
        deps.output.appendLine(`Versori: could not build ${spec.heading} command`);
        deps.output.appendLine(text);
        deps.output.appendLine('');
        return { kind: 'result', ok: false, text };
    }

    const cwd =
        spec.commandCwd === undefined
            ? deps.state.projectDir
            : spec.commandCwd ?? undefined;
    const command = {
        args,
        cwd,
        context: contextFor(deps.state),
        json: false as const,
    };
    const dryRun = readBoolean(values, spec.dryRunFieldId);

    try {
        popup.loading(spec.heading, 'Running command…');
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Versori: ${spec.heading}` },
            () => run(deps.bin, command),
        );
        const text = outputText(result.stdout, result.stderr);
        appendOutput(deps, command, text);

        if (!dryRun) {
            if (popup.isVisible()) {
                await vscode.window.showInformationMessage(spec.successMessage(values));
            }
            spec.onLiveSuccess?.();
        }
        return popup.isVisible()
            ? { kind: 'result', ok: true, text }
            : { kind: 'hidden' };
    } catch (err) {
        const text = errorText(err);
        appendOutput(deps, command, text);
        return popup.isVisible()
            ? { kind: 'result', ok: false, text }
            : { kind: 'hidden' };
    }
}

function appendOutput(
    deps: FormDeps,
    command: { args: string[]; cwd?: string; context?: string; json?: boolean },
    text: string,
): void {
    deps.output.appendLine(`$ ${displayCommand(command)}`);
    deps.output.appendLine(text);
    deps.output.appendLine('');
}

function outputText(stdout: string, stderr: string): string {
    const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');
    return output || '(no output)';
}

function reviewState(state: QuickFormState): QuickFormState {
    return { ...state, screen: { kind: 'review' }, history: [] };
}

function resultState(
    state: QuickFormState,
    result: Extract<ExecutionResult, { kind: 'result' }>,
): QuickFormState {
    return {
        ...state,
        screen: { kind: 'result', ok: result.ok, text: result.text },
        history: [{ kind: 'review' }],
    };
}

function formTitle(spec: FormSpec, suffix?: string): string {
    return suffix ? `${spec.heading} · ${suffix}` : spec.heading;
}

function fieldHint(spec: FormSpec, field: Field): string {
    const hint = field.hint ?? (field.kind === 'text' || field.kind === 'textarea'
        ? field.placeholder
        : undefined);
    return hint ? `${spec.subtitle} · ${hint}` : spec.subtitle;
}

function conciseOutput(text: string): string {
    const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '(no output)';
    return firstLine.length > 200 ? `${firstLine.slice(0, 200)}...` : firstLine;
}

function projectName(state: ResolvedState): string {
    return state.projectDir ? path.basename(state.projectDir) : 'project';
}

/**
 * The project a deploy would actually hit, for the confirmation bar.
 *
 * The folder name is what the user recognises; the id is what the CLI is sent,
 * so both are named. When there is no id the CLI resolves the project from the
 * spawn cwd, and saying so is more use than printing nothing.
 */
function deployTarget(state: ResolvedState): string {
    return state.projectId
        ? `${projectName(state)} (${state.projectId})`
        : `${projectName(state)} (resolved from the current folder)`;
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    if (state.overridesActive) {
        parts.push(`pinned by .versori, overriding ${state.activeContextName}`);
    }
    return parts.join('  ·  ');
}

function defaultVersionName(): string {
    // Mirrors the CLI's own default format: 2006-01-02-15-04-05, UTC.
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function errorText(err: unknown): string {
    if (err instanceof CliError) {
        return err.stderr || err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
