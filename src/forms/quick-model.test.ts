import { describe, expect, it } from 'vitest';

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
    stepFor,
    totalSteps,
} from './quick-model';
import { interpolate } from './build';
import { FormSpec, FormValues } from './types';

const spec: FormSpec = {
    title: 'Deploy',
    heading: 'Deploy project',
    subtitle: 'Context: dev',
    fields: [
        { kind: 'text', id: 'name', label: 'Name', value: 'v1' },
        { kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true },
    ],
    buildArgs: () => [],
    successMessage: () => '',
    dryRunFieldId: 'dryRun',
    dryRunLabel: 'Run dry run',
    liveLabel: 'Deploy {name}',
    confirmWhenLive: true,
    confirmSettingId: 'versori.confirmDeploy',
    confirmMessage: 'Deploy {name} for real?',
};

describe('quick form state model', () => {
    it('copies initial field values and starts on the review screen', () => {
        const state = createQuickFormState(spec);

        expect(state.values).toEqual({ name: 'v1', dryRun: true });
        expect(state.screen).toEqual({ kind: 'review' });
        expect(state.history).toEqual([]);
    });

    it('enters a field and Back returns to review without losing edits', () => {
        const entered = enterField(createQuickFormState(spec), 'name');
        const edited = setFormValue(entered, 'name', 'v2');

        expect(goBack(edited)?.screen).toEqual({ kind: 'review' });
        expect(goBack(edited)?.values.name).toBe('v2');
    });

    it('records an entered screen so Back can return to the previous screen', () => {
        const entered = enterScreen(createQuickFormState(spec), { kind: 'confirm' });

        expect(goBack(entered)?.screen).toEqual({ kind: 'review' });
    });

    it('requires confirmation only for live forms whose gate is enabled', () => {
        expect(requiresConfirmation(spec, { dryRun: true })).toBe(false);
        expect(requiresConfirmation(spec, { dryRun: false })).toBe(true);
        expect(
            requiresConfirmation({ ...spec, confirmWhenLive: false }, { dryRun: false }),
        ).toBe(false);
    });

    it('formats empty, boolean, and text field values for the review list', () => {
        expect(
            fieldSummary(
                { kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true },
                true,
            ),
        ).toBe('On');
        expect(
            fieldSummary({ kind: 'text', id: 'name', label: 'Name', value: '' }, ''),
        ).toBe('(blank)');
    });

    it('puts the current choice first while preserving the other choices', () => {
        expect(currentFirst(['development', 'production'], 'production')).toEqual([
            'production',
            'development',
        ]);
        expect(currentFirst([true, false], false)).toEqual([false, true]);
        expect(currentFirst(['development', 'production'], 'missing')).toEqual([
            'development',
            'production',
        ]);
    });

    it('builds review rows with each field label and current value', () => {
        const values: FormValues = { name: 'v2', dryRun: false };
        const reviewRows = spec.fields.map((field) => ({
            label: field.label,
            description: fieldSummary(field, values[field.id]),
        }));

        expect(reviewRows).toEqual([
            { label: 'Name', description: 'v2' },
            { label: 'Dry run', description: 'Off' },
        ]);
    });

    it('uses the dry-run label or interpolated live label for the form action', () => {
        expect(formActionLabel(spec, { name: 'v2', dryRun: true })).toBe('Run dry run');
        expect(formActionLabel(spec, { name: 'v2', dryRun: false })).toBe('Deploy v2');
    });

    it('interpolates confirmation text from current values', () => {
        expect(interpolate(spec.confirmMessage, { name: 'v2', dryRun: false })).toBe(
            'Deploy v2 for real?',
        );
    });

    it('numbers each screen and reserves a step for live confirmation', () => {
        const dryRun = createQuickFormState(spec);
        const live = setFormValue(dryRun, 'dryRun', false);

        expect(totalSteps(spec, dryRun)).toBe(4);
        expect(totalSteps(spec, live)).toBe(5);
        expect(stepFor(spec, { kind: 'review' }, live)).toBe(1);
        expect(stepFor(spec, { kind: 'field', fieldId: 'name' }, live)).toBe(2);
        expect(stepFor(spec, { kind: 'field', fieldId: 'dryRun' }, live)).toBe(3);
        expect(stepFor(spec, { kind: 'confirm' }, live)).toBe(4);
        expect(
            stepFor(spec, { kind: 'result', ok: true, text: 'done' }, live),
        ).toBe(5);
        expect(
            stepFor(spec, { kind: 'result', ok: true, text: 'preview' }, dryRun),
        ).toBe(4);
    });
});
