import { interpolate } from './build';
import { Field, FormSpec, FormValues } from './types';

export type FormScreen =
    | { kind: 'review' }
    | { kind: 'field'; fieldId: string }
    | { kind: 'confirm' }
    | { kind: 'result'; ok: boolean; text: string };

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

export function fieldSummary(field: Field, value: string | boolean | undefined): string {
    if (field.kind === 'checkbox') {
        return value === true ? 'On' : 'Off';
    }
    return String(value ?? '').trim() || '(blank)';
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

export function totalSteps(spec: FormSpec, state: QuickFormState): number {
    const confirmation = requiresConfirmation(spec, state.values) ? 1 : 0;
    return Math.max(1, spec.fields.length + 2 + confirmation);
}

export function stepFor(
    spec: FormSpec,
    screen: FormScreen,
    state: QuickFormState,
): number {
    switch (screen.kind) {
        case 'review':
            return 1;
        case 'field': {
            const index = spec.fields.findIndex(({ id }) => id === screen.fieldId);
            return index >= 0 ? index + 2 : 1;
        }
        case 'confirm':
            return spec.fields.length + 2;
        case 'result':
            return totalSteps(spec, state);
    }
}
