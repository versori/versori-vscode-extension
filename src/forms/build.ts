import { Field, FormValues } from './types';

export interface DeployValues {
    /** Resolved from `.versori`; passed explicitly rather than relying on cwd. */
    projectId?: string;
    name?: string;
    description?: string;
    environment: string;
    dryRun: boolean;
}

export interface VersionValues {
    projectId?: string;
    name: string;
    description: string;
    dryRun: boolean;
}

/**
 * `--project` when known.
 *
 * The id comes from the same `.versori` the CLI would read, so passing it
 * explicitly is equivalent — but it removes the dependency on cwd resolution,
 * which not every command honours.
 */
function projectFlag(projectId?: string): string[] {
    return projectId ? ['--project', projectId] : [];
}

/**
 * Flags for `versori projects deploy`.
 *
 * Name and description are genuinely optional here: deploy.go omits the
 * description when empty and `--version` defaults to a UTC timestamp, with no
 * interactive prompt anywhere.
 */
export function buildDeployArgs(values: DeployValues): string[] {
    const args = [
        'projects',
        'deploy',
        ...projectFlag(values.projectId),
        '--environment',
        values.environment,
    ];

    const name = values.name?.trim();
    if (name) {
        args.push('--version', name);
    }

    const description = values.description?.trim();
    if (description) {
        args.push('--description', description);
    }

    if (values.dryRun) {
        args.push('--dry-run');
    }

    return args;
}

/**
 * Flags for `versori projects versions create`.
 *
 * Unlike deploy, both name and description must be non-empty: create.go opens
 * an editor for either missing value, which hangs a process with no TTY. The
 * form enforces this by keeping submit disabled, and this guard is the backstop.
 */
export function buildVersionArgs(values: VersionValues): string[] {
    const name = values.name.trim();
    const description = values.description.trim();

    if (!name || !description) {
        throw new Error('version name and description are both required');
    }

    const args = [
        'projects',
        'versions',
        'create',
        ...projectFlag(values.projectId),
        '--name',
        name,
        '--description',
        description,
    ];

    if (values.dryRun) {
        args.push('--dry-run');
    }

    return args;
}

/** Ids of required fields left blank. Empty means the form may be submitted. */
export function missingRequired(fields: Field[], values: FormValues): string[] {
    return fields
        .filter((field) => (field.kind === 'text' || field.kind === 'textarea') && field.required)
        .filter((field) => !String(values[field.id] ?? '').trim())
        .map((field) => field.id);
}

/** Replace `{fieldId}` placeholders with current form values. */
export function interpolate(template: string, values: FormValues): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => {
        const value = values[key];
        return value === undefined ? match : String(value);
    });
}

export function readString(values: FormValues, id: string): string {
    const value = values[id];
    return typeof value === 'string' ? value : '';
}

export function readBoolean(values: FormValues, id: string): boolean {
    return values[id] === true;
}
