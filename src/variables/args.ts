export const VARIABLE_TYPES = [
    'string',
    'number',
    'integer',
    'boolean',
    'object',
    'array',
] as const;

export type VariableType = (typeof VARIABLE_TYPES)[number];

export interface VariableAddInput {
    name: string;
    type: VariableType;
    description?: string;
    required?: boolean;
    itemsType?: VariableType;
    strict?: boolean;
    /** `path:type[:required]` entries for object / array-of-object variables. */
    fields?: string[];
}

export interface VariableUpdateInput {
    name: string;
    type?: VariableType;
    description?: string;
    /** `undefined` = leave unchanged; boolean = set explicitly (including false). */
    required?: boolean;
    itemsType?: VariableType;
    strict?: boolean;
    fields?: string[];
}

export function buildVariablesListArgs(): string[] {
    return ['projects', 'variables', 'list'];
}

export function buildVariableAddArgs(input: VariableAddInput): string[] {
    const name = input.name.trim();
    if (!name) {
        throw new Error('variable name is required');
    }
    if (!VARIABLE_TYPES.includes(input.type)) {
        throw new Error(`unknown variable type "${input.type}"`);
    }

    const args = ['projects', 'variables', 'add', '--name', name, '--type', input.type];

    if (input.description !== undefined && input.description !== '') {
        args.push('--description', input.description);
    }
    if (input.required) {
        args.push('--required');
    }
    if (input.type === 'array') {
        if (!input.itemsType) {
            throw new Error('array variables need --items-type');
        }
        if (!VARIABLE_TYPES.includes(input.itemsType)) {
            throw new Error(`unknown items type "${input.itemsType}"`);
        }
        args.push('--items-type', input.itemsType);
    }
    if (input.strict) {
        args.push('--strict');
    }
    for (const field of input.fields ?? []) {
        const trimmed = field.trim();
        if (!trimmed) {
            continue;
        }
        args.push('--field', trimmed);
    }

    return args;
}

/**
 * Only the flags the caller sets are emitted — matching the CLI's partial-update
 * semantics. Pass `required: false` to emit `--required=false`.
 */
export function buildVariableUpdateArgs(input: VariableUpdateInput): string[] {
    const name = input.name.trim();
    if (!name) {
        throw new Error('variable name is required');
    }

    const args = ['projects', 'variables', 'update', '--name', name];
    let touched = false;

    if (input.type !== undefined) {
        if (!VARIABLE_TYPES.includes(input.type)) {
            throw new Error(`unknown variable type "${input.type}"`);
        }
        args.push('--type', input.type);
        touched = true;
    }
    if (input.description !== undefined) {
        // Empty string clears the description — that is intentional CLI behaviour.
        args.push('--description', input.description);
        touched = true;
    }
    if (input.required !== undefined) {
        args.push(input.required ? '--required' : '--required=false');
        touched = true;
    }
    if (input.itemsType !== undefined) {
        if (!VARIABLE_TYPES.includes(input.itemsType)) {
            throw new Error(`unknown items type "${input.itemsType}"`);
        }
        args.push('--items-type', input.itemsType);
        touched = true;
    }
    if (input.strict) {
        args.push('--strict');
        touched = true;
    }
    for (const field of input.fields ?? []) {
        const trimmed = field.trim();
        if (!trimmed) {
            continue;
        }
        args.push('--field', trimmed);
        touched = true;
    }

    if (!touched) {
        throw new Error('nothing to change on this variable');
    }

    return args;
}

/** Host must confirm before calling; `--yes` skips the CLI's own prompt. */
export function buildVariableRemoveArgs(name: string): string[] {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('variable name is required');
    }
    return ['projects', 'variables', 'remove', '--name', trimmed, '--yes'];
}

/** Split a comma-separated `--field` list from a single input box. */
export function parseFieldList(raw: string): string[] {
    return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}
