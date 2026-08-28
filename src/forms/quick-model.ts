import { interpolate } from './build';
import { CheckboxField, Field, FormSpec, FormValues, SelectChoice, SelectField } from './types';

export type FormScreen =
    | { kind: 'review' }
    | { kind: 'field'; fieldId: string }
    | { kind: 'result'; ok: boolean; text: string; dryRun?: boolean };

export interface QuickFormState {
    values: FormValues;
    screen: FormScreen;
    history: FormScreen[];
}

export function createQuickFormState(spec: FormSpec): QuickFormState {
    return {
        values: Object.fromEntries(spec.fields.map((field) => [field.id, field.value])),
        screen: { kind: 'review' },
        history: [],
    };
}

export function checkboxFields(spec: FormSpec): CheckboxField[] {
    return spec.fields.filter((field): field is CheckboxField => field.kind === 'checkbox');
}

/** Fields shown on the single review screen for the current values. */
export function visibleReviewFields(spec: FormSpec, values: FormValues): Field[] {
    return spec.fields.filter((field) => {
        // Subfolder name only applies when Create subfolder is on.
        if (field.id === 'subfolderName' && values.createSubfolder !== true) {
            return false;
        }
        return true;
    });
}

export function enterField(state: QuickFormState, fieldId: string): QuickFormState {
    return {
        ...state,
        screen: { kind: 'field', fieldId },
        history: [...state.history, state.screen],
    };
}

export function enterScreen(
    state: QuickFormState,
    screen: FormScreen,
): QuickFormState {
    return { ...state, screen, history: [...state.history, state.screen] };
}

export function setFormValue(
    state: QuickFormState,
    fieldId: string,
    value: string | boolean,
): QuickFormState {
    return { ...state, values: { ...state.values, [fieldId]: value } };
}

export function toggleCheckbox(state: QuickFormState, fieldId: string): QuickFormState {
    return setFormValue(state, fieldId, state.values[fieldId] !== true);
}

export function currentFirst<T>(options: readonly T[], current: T | undefined): T[] {
    const index = current === undefined ? -1 : options.indexOf(current);
    if (current === undefined || index <= 0) {
        return [...options];
    }
    return [current, ...options.slice(0, index), ...options.slice(index + 1)];
}

export function goBack(state: QuickFormState): QuickFormState | undefined {
    const previous = state.history.at(-1);
    if (!previous) {
        return undefined;
    }
    return { ...state, screen: previous, history: state.history.slice(0, -1) };
}

/**
 * One list of choices, whichever way the field declared them.
 *
 * `options` and `choices` are two spellings of the same thing; every consumer
 * goes through here so neither the renderer nor the review screen has to know
 * which one a field used.
 */
export function selectChoices(field: SelectField): SelectChoice[] {
    if (field.choices) {
        return field.choices;
    }
    return (field.options ?? []).map((option) => ({ label: option, value: option }));
}

export function fieldSummary(field: Field, value: string | boolean | undefined): string {
    if (field.kind === 'checkbox') {
        return value === true ? 'On' : 'Off';
    }

    if (field.kind === 'select') {
        // A select's value can be an opaque id, and the "no override" choice can
        // legitimately be the empty string. Show what the user picked, not the
        // id, and never fall through to "(blank)" for a real choice.
        const match = selectChoices(field).find((choice) => choice.value === String(value ?? ''));
        if (match) {
            return match.label;
        }
    }

    return String(value ?? '').trim() || '(blank)';
}

/** Strip a leading VS Code codicon so toggle rows can own the checked glyph. */
export function plainFieldLabel(label: string): string {
    return label.replace(/^\$\([^)]+\)\s*/, '');
}

export function checkboxRowLabel(field: CheckboxField, checked: boolean): string {
    const icon = checked ? '$(check)' : '$(circle-large-outline)';
    return `${icon} ${plainFieldLabel(field.label)}`;
}

export function formActionLabel(spec: FormSpec, values: FormValues): string {
    if (!spec.dryRunFieldId || values[spec.dryRunFieldId] !== true) {
        return interpolate(spec.liveLabel, values);
    }
    return spec.dryRunLabel;
}

export function requiresConfirmation(spec: FormSpec, values: FormValues): boolean {
    const isLive = !spec.dryRunFieldId || values[spec.dryRunFieldId] !== true;
    return isLive && spec.confirmWhenLive;
}

/**
 * One form screen, plus a confirmation step only when the live gate is on.
 * Field edits reuse the form step rather than inventing extra wizard pages.
 */
export function totalSteps(spec: FormSpec, state: QuickFormState): number {
    return requiresConfirmation(spec, state.values) ? 2 : 1;
}

export function stepFor(
    spec: FormSpec,
    screen: FormScreen,
    state: QuickFormState,
): number {
    switch (screen.kind) {
        case 'review':
        case 'field':
            return 1;
        case 'result':
            return totalSteps(spec, state);
    }
}
