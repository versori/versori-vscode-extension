import { describe, expect, it } from 'vitest';

import {
    checkboxFields,
    checkboxRowLabel,
    createQuickFormState,
    currentFirst,
    enterField,
    enterScreen,
    fieldSummary,
    formActionLabel,
    goBack,
    requiresConfirmation,
    selectChoices,
    setFormValue,
    stepFor,
    totalSteps,
    toggleCheckbox,
    visibleReviewFields,
} from './quick-model';
import { resolveFormMessage } from './build';
import { CheckboxField, FormSpec, FormValues, SelectField } from './types';

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
    it('copies initial field values and starts on the single review screen', () => {
        const state = createQuickFormState(spec);

        expect(state.values).toEqual({ name: 'v1', dryRun: true });
        expect(state.screen).toEqual({ kind: 'review' });
        expect(state.history).toEqual([]);
    });

    it('keeps checkbox and text fields on one review screen', () => {
        const groupedSpec: FormSpec = {
            ...spec,
            fields: [
                ...spec.fields,
                { kind: 'checkbox', id: 'assets', label: 'Include assets', value: false },
            ],
        };
        const state = createQuickFormState(groupedSpec);

        expect(checkboxFields(groupedSpec).map(({ id }) => id)).toEqual(['dryRun', 'assets']);
        expect(state.screen).toEqual({ kind: 'review' });
        expect(totalSteps(groupedSpec, state)).toBe(1);
        expect(stepFor(groupedSpec, { kind: 'review' }, state)).toBe(1);
    });

    it('hides the subfolder name row until Create subfolder is on', () => {
        const syncSpec: FormSpec = {
            ...spec,
            fields: [
                { kind: 'checkbox', id: 'dryRun', label: 'Dry run', value: true },
                {
                    kind: 'checkbox',
                    id: 'createSubfolder',
                    label: 'Create subfolder',
                    value: true,
                },
                {
                    kind: 'text',
                    id: 'subfolderName',
                    label: 'Subfolder name',
                    value: 'Orders sync',
                },
                { kind: 'checkbox', id: 'assets', label: 'Include assets', value: false },
            ],
        };
        const state = createQuickFormState(syncSpec);

        expect(visibleReviewFields(syncSpec, state.values).map(({ id }) => id)).toEqual([
            'dryRun',
            'createSubfolder',
            'subfolderName',
            'assets',
        ]);
        expect(
            visibleReviewFields(syncSpec, { ...state.values, createSubfolder: false }).map(
                ({ id }) => id,
            ),
        ).toEqual(['dryRun', 'createSubfolder', 'assets']);
    });

    it('enters a field and Back returns to review without losing edits', () => {
        const reviewed = createQuickFormState(spec);
        const entered = enterField(reviewed, 'name');
        const edited = setFormValue(entered, 'name', 'v2');

        expect(goBack(edited)?.screen).toEqual({ kind: 'review' });
        expect(goBack(edited)?.values.name).toBe('v2');
    });

    it('toggles a checkbox in place without opening an extra screen', () => {
        const state = createQuickFormState(spec);
        const toggled = toggleCheckbox(state, 'dryRun');

        expect(toggled.values.dryRun).toBe(false);
        expect(toggled.screen).toEqual({ kind: 'review' });
        expect(toggled.history).toEqual([]);
        expect(
            checkboxRowLabel(
                { kind: 'checkbox', id: 'dryRun', label: '$(eye) Dry run', value: true },
                true,
            ),
        ).toBe('$(check) Dry run');
        expect(
            checkboxRowLabel(
                { kind: 'checkbox', id: 'dryRun', label: '$(eye) Dry run', value: true },
                false,
            ),
        ).toBe('$(circle-large-outline) Dry run');
    });

    it('records an entered screen so Back can return to the previous screen', () => {
        const reviewed = createQuickFormState(spec);
        const entered = enterScreen(reviewed, {
            kind: 'result',
            ok: true,
            text: 'done',
            dryRun: true,
        });

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
        expect(resolveFormMessage(spec.confirmMessage, { name: 'v2', dryRun: false })).toBe(
            'Deploy v2 for real?',
        );
    });

    it('numbers the form as one step and adds confirmation only for live runs', () => {
        const dryRun = createQuickFormState(spec);
        const live = setFormValue(dryRun, 'dryRun', false);

        expect(totalSteps(spec, dryRun)).toBe(1);
        expect(totalSteps(spec, live)).toBe(2);
        expect(stepFor(spec, { kind: 'review' }, live)).toBe(1);
        expect(stepFor(spec, { kind: 'field', fieldId: 'name' }, live)).toBe(1);
        expect(
            stepFor(spec, { kind: 'result', ok: true, text: 'done' }, live),
        ).toBe(2);
        expect(
            stepFor(spec, { kind: 'result', ok: true, text: 'preview' }, dryRun),
        ).toBe(1);
    });
});

describe('selectChoices', () => {
    it('reads plain options as choices whose label is their value', () => {
        expect(
            selectChoices({
                kind: 'select',
                id: 'environment',
                label: 'Environment',
                value: 'development',
                options: ['development', 'production'],
            }),
        ).toEqual([
            { label: 'development', value: 'development' },
            { label: 'production', value: 'production' },
        ]);
    });

    it('passes labeled choices through with their descriptions intact', () => {
        const choices = [
            {
                label: 'Latest (current files)',
                description: "the project's current files",
                value: '',
            },
            { label: 'v1.2', description: 'shipped Tuesday', value: '01VERSION' },
        ];

        expect(
            selectChoices({
                kind: 'select',
                id: 'versionId',
                label: 'Version',
                value: '',
                choices,
            }),
        ).toEqual(choices);
    });

    it('has no choices for a select that declared neither spelling', () => {
        expect(
            selectChoices({ kind: 'select', id: 'versionId', label: 'Version', value: '' }),
        ).toEqual([]);
    });
});

describe('fieldSummary', () => {
    const versionField: SelectField = {
        kind: 'select',
        id: 'versionId',
        label: 'Version',
        value: '',
        choices: [
            { label: 'Latest (current files)', value: '' },
            { label: 'v1.2', description: 'shipped Tuesday', value: '01VERSION' },
        ],
    };

    it('shows a labeled choice by its label, never its opaque id', () => {
        expect(fieldSummary(versionField, '01VERSION')).toBe('v1.2');
    });

    it("shows the empty-valued choice's label rather than treating it as blank", () => {
        expect(fieldSummary(versionField, '')).toBe('Latest (current files)');
        expect(fieldSummary(versionField, undefined)).toBe('Latest (current files)');
    });

    it('falls back to the raw value when it matches no choice', () => {
        const withoutLatest: SelectField = {
            ...versionField,
            choices: [{ label: 'v1.2', value: '01VERSION' }],
        };

        expect(fieldSummary(withoutLatest, '01GONE')).toBe('01GONE');
        expect(fieldSummary(withoutLatest, '')).toBe('(blank)');
    });

    it('shows a plain option select by its value, as before', () => {
        expect(
            fieldSummary(
                {
                    kind: 'select',
                    id: 'environment',
                    label: 'Environment',
                    value: 'development',
                    options: ['development', 'production'],
                },
                'production',
            ),
        ).toBe('production');
    });

    it('shows a checkbox as On or Off', () => {
        const checkbox: CheckboxField = {
            kind: 'checkbox',
            id: 'dryRun',
            label: 'Dry run',
            value: true,
        };

        expect(fieldSummary(checkbox, true)).toBe('On');
        expect(fieldSummary(checkbox, false)).toBe('Off');
    });
});
