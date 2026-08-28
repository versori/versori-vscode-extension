export type FormValues = Record<string, string | boolean>;

export type RequiredCondition = boolean | ((values: FormValues) => boolean);

export type FormMessage = string | ((values: FormValues) => string);

interface FieldBase {
    id: string;
    label: string;
    /** Short explanatory line under the control. */
    hint?: string;
}

export interface TextField extends FieldBase {
    kind: 'text' | 'textarea';
    value: string;
    placeholder?: string;
    /**
     * Blocks submission while empty. Used where the CLI would otherwise open an
     * interactive editor and deadlock a spawned process.
     */
    required?: RequiredCondition;
}

/** One row of a select whose stored value differs from its display label. */
export interface SelectChoice {
    label: string;
    description?: string;
    value: string;
}

export interface SelectField extends FieldBase {
    kind: 'select';
    value: string;
    /**
     * Plain options, where the label *is* the value — environment names.
     * Exactly one of `options` or `choices` is set.
     */
    options?: string[];
    /**
     * Labeled choices, where the stored value is an opaque id the user should
     * never have to read — version ids.
     */
    choices?: SelectChoice[];
}

export interface CheckboxField extends FieldBase {
    kind: 'checkbox';
    value: boolean;
}

export type Field = TextField | SelectField | CheckboxField;

export interface FormSpec {
    title: string;
    heading: string;
    /** Context and project, shown under the heading. */
    subtitle: string;
    fields: Field[];
    /**
     * Argv for this form's command. Throws with a user-facing message when invalid.
     */
    buildArgs: (values: FormValues) => string[];
    /** Notification text after a successful non-dry run. */
    successMessage: (values: FormValues) => string;
    /** Optional hook after a successful non-dry run. */
    onLiveSuccess?: () => void;
    /**
     * Checkbox whose unticked state means "this will really run". `''` when the
     * command has no dry run.
     */
    dryRunFieldId: string;
    /** Submit label while dry run is ticked. */
    dryRunLabel: string;
    /** Submit label once dry run is unticked. `{fieldId}` is interpolated. */
    liveLabel: string;
    /** Show the confirmation screen before a live run. */
    confirmWhenLive: boolean;
    /**
     * Setting id that `confirmWhenLive` was read from, so the confirmation screen's
     * "Don't ask again" persists to the right place.
     *
     * `''` when this form always confirms. The setting control is then hidden rather
     * than left inert — writing another command's setting from here would
     * silently disable a confirmation the user never saw.
     */
    confirmSettingId: string;
    /**
     * Warning shown on the confirmation screen. String messages interpolate
     * `{fieldId}` placeholders; callbacks can derive text from current values.
     */
    confirmMessage: FormMessage;
    /**
     * Working directory for the command. Omitted uses the resolved project
     * directory; `null` spawns without a cwd so the CLI can create a new target.
     */
    commandCwd?: string | null;
    /**
     * Close the popup after a successful live run. Dry runs always keep the
     * popup open so the structured preview can be reviewed in place.
     */
    closeAfterRun?: boolean;
}
