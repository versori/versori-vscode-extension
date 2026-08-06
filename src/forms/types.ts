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
    required?: boolean;
}

export interface SelectField extends FieldBase {
    kind: 'select';
    value: string;
    options: string[];
}

export interface CheckboxField extends FieldBase {
    kind: 'checkbox';
    value: boolean;
}

export type Field = TextField | SelectField | CheckboxField;

export type FormValues = Record<string, string | boolean>;

export interface FormSpec {
    /** Webview view type; also the singleton key. */
    viewType: string;
    title: string;
    heading: string;
    /** Context and project, shown under the heading. */
    subtitle: string;
    fields: Field[];
    /**
     * Argv for this form's command. Throws with a user-facing message when invalid.
     *
     * Dropped by `JSON.stringify` when the spec is embedded in the webview, so it
     * stays on the extension side where the values can be validated.
     */
    buildArgs: (values: FormValues) => string[];
    /** Notification text after a successful non-dry run. */
    successMessage: (values: FormValues) => string;
    /**
     * Checkbox whose unticked state means "this will really run". `''` when the
     * command has no dry run.
     */
    dryRunFieldId: string;
    /** Submit label while dry run is ticked. */
    dryRunLabel: string;
    /** Submit label once dry run is unticked. `{fieldId}` is interpolated. */
    liveLabel: string;
    /** Show the confirm bar before a live run. */
    confirmWhenLive: boolean;
    /**
     * Setting id that `confirmWhenLive` was read from, so the confirm bar's
     * "Don't ask again" persists to the right place.
     *
     * `''` when this form always confirms. The checkbox is then hidden rather
     * than left inert — writing another command's setting from here would
     * silently disable a confirmation the user never saw.
     */
    confirmSettingId: string;
    /** Warning shown in the confirm bar. `{fieldId}` is interpolated. */
    confirmMessage: string;
}

/** Payload posted by the webview when the user commits. */
export interface SubmitMessage {
    type: 'submit';
    values: FormValues;
    dontAskAgain: boolean;
}
