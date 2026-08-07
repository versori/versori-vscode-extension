import * as path from 'node:path';
import * as vscode from 'vscode';

import { CliError, displayCommand, run } from '../cli';
import { contextFor } from '../commands/target';
import { resolveEnvironmentNames } from '../environments';
import { ResolvedState } from '../resolver/types';
import {
    buildDeployArgs,
    buildVersionArgs,
    missingRequired,
    readBoolean,
    readString,
    resolveFormMessage,
    splitConfirmDialog,
} from './build';
import {
    actionHeading,
    actionIcon,
    groupDryRunChanges,
    parseDryRunOutput,
    summarizeDryRun,
} from './dry-run';
import { POPUP_BACK, PopupSession } from './popup';
import {
    checkboxRowLabel,
    createQuickFormState,
    currentFirst,
    enterField,
    fieldSummary,
    formActionLabel,
    goBack,
    requiresConfirmation,
    setFormValue,
    QuickFormState,
    FormScreen,
    stepFor,
    totalSteps,
    toggleCheckbox,
    visibleReviewFields,
} from './quick-model';
import { Field, FormSpec, FormValues } from './types';

const CONFIRM_SETTING = 'versori.confirmDeploy';
const CONFIRM_YES = 'YES — Proceed';
const CONFIRM_YES_DONT_ASK = "YES — Proceed and don't ask again";
const CONFIRM_NO = 'NO — Cancel';

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
                label: '$(eye) Dry run',
                value: true,
                hint: 'Preview the files that would upload; deploy nothing.',
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
                label: '$(eye) Dry run',
                value: true,
                hint: 'Preview the files that would upload; save nothing.',
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
                const field = spec.fields.find(({ id }) => id === picked.id);
                if (field?.kind === 'checkbox') {
                    state = toggleCheckbox(state, picked.id);
                    continue;
                }
                state = enterField(state, picked.id);
                continue;
            }

            const missing = missingRequired(spec.fields, state.values);
            if (missing.length > 0) {
                state = enterField(state, missing[0]);
                continue;
            }

            if (requiresConfirmation(spec, state.values)) {
                const decision = await confirmLiveAction(popup, spec, state.values);
                if (decision === 'cancel') {
                    continue;
                }
                if (decision === 'dontAsk' && spec.confirmSettingId) {
                    await vscode.workspace
                        .getConfiguration()
                        .update(spec.confirmSettingId, false, vscode.ConfigurationTarget.Global);
                }
            }

            const finished = await finishRun(deps, popup, spec, state.values);
            if (finished.kind === 'done') {
                return finished.next;
            }
            state = resultState(state, finished.result);
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

        const result = state.screen;
        const picked = await popup.choose<ResultChoice>({
            title: formTitle(
                spec,
                result.ok ? (result.dryRun ? 'Preview' : 'Finished') : 'Failed',
            ),
            placeholder: result.ok && result.dryRun
                ? summarizeDryRun(parseDryRunOutput(result.text))
                : spec.subtitle,
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

type ResultChoice = { kind: 'detail' } | { kind: 'back' } | { kind: 'close' };

type ExecutionResult =
    | { kind: 'result'; ok: boolean; text: string; dryRun?: boolean }
    | { kind: 'hidden' };

function reviewItems(
    spec: FormSpec,
    state: QuickFormState,
): Array<{ label: string; description: string; detail?: string; value: ReviewChoice }> {
    const fields = visibleReviewFields(spec, state.values).map((field) => {
        if (field.kind === 'checkbox') {
            const checked = state.values[field.id] === true;
            return {
                label: checkboxRowLabel(field, checked),
                description: checked ? 'On — select to turn off' : 'Off — select to turn on',
                detail: field.hint,
                value: { kind: 'field' as const, id: field.id },
            };
        }
        return {
            label: field.label,
            description: fieldSummary(field, state.values[field.id]),
            detail: field.hint,
            value: { kind: 'field' as const, id: field.id },
        };
    });

    return [
        ...fields,
        {
            label: formActionLabel(spec, state.values),
            description: requiresConfirmation(spec, state.values)
                ? 'Shows a warning dialog before running'
                : 'Run now',
            value: { kind: 'submit' as const },
        },
    ];
}

/**
 * Native modal confirmation — QuickPick rows truncate multi-line warnings.
 * Hides the popup first so the dialog is the only thing on screen.
 */
async function confirmLiveAction(
    popup: PopupSession,
    spec: FormSpec,
    values: FormValues,
): Promise<'confirm' | 'dontAsk' | 'cancel'> {
    popup.close();

    const warning = resolveFormMessage(spec.confirmMessage, values);
    const { message, detail } = splitConfirmDialog(warning);
    const buttons = spec.confirmSettingId
        ? [CONFIRM_NO, CONFIRM_YES, CONFIRM_YES_DONT_ASK]
        : [CONFIRM_NO, CONFIRM_YES];

    const picked = await vscode.window.showWarningMessage(
        message,
        { modal: true, detail: detail || undefined },
        ...buttons,
    );

    if (picked === CONFIRM_YES_DONT_ASK) {
        return 'dontAsk';
    }
    if (picked === CONFIRM_YES) {
        return 'confirm';
    }
    return 'cancel';
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
): Array<{ label: string; description?: string; detail?: string; value: ResultChoice }> {
    const actions: Array<{
        label: string;
        description?: string;
        detail?: string;
        value: ResultChoice;
    }> = [
        { label: '$(arrow-left) Back to form', value: { kind: 'back' } },
        { label: '$(close) Close', value: { kind: 'close' } },
    ];

    if (!result.ok) {
        return [
            {
                label: '$(error) Failed',
                description: conciseOutput(result.text),
                detail: result.text,
                value: { kind: 'detail' },
            },
            ...actions,
        ];
    }

    if (!result.dryRun) {
        return [
            {
                label: '$(check) Finished',
                description: conciseOutput(result.text),
                detail: result.text,
                value: { kind: 'detail' },
            },
            ...actions,
        ];
    }

    const preview = parseDryRunOutput(result.text);
    const items: Array<{
        label: string;
        description?: string;
        detail?: string;
        value: ResultChoice;
    }> = [
        {
            label: '$(eye) Dry-run preview',
            description: summarizeDryRun(preview),
            detail: 'No files were changed. Untick Dry run and confirm to apply.',
            value: { kind: 'detail' },
        },
    ];

    if (preview.changes.length === 0) {
        items.push({
            label: '$(check) No file changes',
            description: 'Nothing would be created, updated, or deleted',
            value: { kind: 'detail' },
        });
    } else {
        for (const group of groupDryRunChanges(preview.changes)) {
            items.push({
                label: `${actionIcon(group.action)} ${actionHeading(group.action)}`,
                description: `${group.paths.length}`,
                value: { kind: 'detail' },
            });
            for (const path of group.paths) {
                items.push({
                    label: `$(file) ${path}`,
                    description: actionHeading(group.action),
                    value: { kind: 'detail' },
                });
            }
        }
    }

    for (const note of preview.notes) {
        items.push({
            label: '$(info) Note',
            description: conciseOutput(note),
            detail: note,
            value: { kind: 'detail' },
        });
    }

    return [...items, ...actions];
}

type FinishRunResult =
    | { kind: 'done'; next: 'menu' | 'close' }
    | { kind: 'continue'; result: Extract<ExecutionResult, { kind: 'result' }> };

async function finishRun(
    deps: FormDeps,
    popup: PopupSession,
    spec: FormSpec,
    values: FormValues,
): Promise<FinishRunResult> {
    const dryRun = Boolean(spec.dryRunFieldId && readBoolean(values, spec.dryRunFieldId));
    const result = await execute(deps, popup, spec, values);
    if (result.kind === 'hidden') {
        return { kind: 'done', next: 'menu' };
    }

    // Dry runs always stay open so the structured preview is visible.
    // Live runs may close immediately when the form opts into that.
    if (!spec.closeAfterRun || dryRun || !result.ok) {
        return {
            kind: 'continue',
            result: { ...result, dryRun },
        };
    }

    popup.close();
    void vscode.window.showInformationMessage(spec.successMessage(values));
    return { kind: 'done', next: 'close' };
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
            spec.onLiveSuccess?.();
            const message = spec.successMessage(values);
            if (popup.isVisible()) {
                // Let runForm render the result screen and clear QuickPick.busy
                // before opening the toast. The notification is deliberately
                // fire-and-forget so it cannot hold the spinner open.
                setTimeout(() => {
                    if (popup.isVisible()) {
                        void vscode.window.showInformationMessage(message);
                    }
                }, 0);
            }
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
        screen: {
            kind: 'result',
            ok: result.ok,
            text: result.text,
            dryRun: result.dryRun,
        },
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
