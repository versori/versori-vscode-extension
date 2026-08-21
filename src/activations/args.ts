import { Control, ControlValues, environmentArgs, environmentControl } from '../results/controls';

export interface UserCreateInput {
    displayName: string;
    externalId: string;
}

export interface UserDeleteInput {
    userId?: string;
    externalId?: string;
}

export interface ConnectionAssignment {
    /** Environment system / connection-template ID (LHS of `--connection`). */
    templateId: string;
    /** Existing connection ID (RHS of `--connection`). */
    connectionId: string;
}

export interface VariableAssignment {
    name: string;
    /** Raw CLI `--value` / `--variable` payload (already stringified). */
    value: string;
}

export interface ActivationCreateInput {
    environment: string;
    externalId: string;
    connections: ConnectionAssignment[];
    variables: VariableAssignment[];
}

export interface SetVariableInput {
    environment: string;
    externalId: string;
    name: string;
    value: string;
}

export function activationControls(environments: string[]): Control[] {
    return [environmentControl(environments)];
}

export function buildActivationListArgs(values: ControlValues): string[] {
    return ['projects', 'activations', 'list', ...environmentArgs(values)];
}

export function buildActivationDetailsArgs(environment: string, externalId: string): string[] {
    const env = environment.trim();
    const id = externalId.trim();
    if (!env) {
        throw new Error('environment is required');
    }
    if (!id) {
        throw new Error('external id is required');
    }
    return [
        'projects',
        'activations',
        'details',
        '--environment',
        env,
        '--external-id',
        id,
    ];
}

export function buildActivationDeleteArgs(environment: string, externalId: string): string[] {
    const env = environment.trim();
    const id = externalId.trim();
    if (!env) {
        throw new Error('environment is required');
    }
    if (!id) {
        throw new Error('external id is required');
    }
    return [
        'projects',
        'activations',
        'delete',
        '--environment',
        env,
        '--external-id',
        id,
    ];
}

export function buildUserCreateArgs(input: UserCreateInput): string[] {
    const displayName = input.displayName.trim();
    const externalId = input.externalId.trim();
    if (!displayName) {
        throw new Error('display name is required');
    }
    if (!externalId) {
        throw new Error('external id is required');
    }
    return [
        'users',
        'create',
        '--display-name',
        displayName,
        '--external-id',
        externalId,
    ];
}

export function buildUserDeleteArgs(input: UserDeleteInput): string[] {
    const userId = input.userId?.trim() ?? '';
    const externalId = input.externalId?.trim() ?? '';
    if (!userId && !externalId) {
        throw new Error('user id or external id is required');
    }

    const args = ['users', 'delete'];
    if (userId) {
        args.push('--id', userId);
    } else {
        args.push('--external-id', externalId);
    }
    // The CLI confirms on a TTY; execFile has none, so --yes is required.
    // The extension shows its own modal before spawning this. --confirm is accepted too.
    args.push('--yes');
    return args;
}

/**
 * Argv for non-interactive activation create.
 *
 * Every environment system must have a `--connection` flag, and every required
 * schema variable must be supplied via `--variable`. Omitting either causes the
 * CLI to drop into a TUI picker — which hangs under `execFile` with no TTY.
 */
export function buildActivationCreateArgs(input: ActivationCreateInput): string[] {
    const environment = input.environment.trim();
    const externalId = input.externalId.trim();
    if (!environment) {
        throw new Error('environment is required');
    }
    if (!externalId) {
        throw new Error('external id is required');
    }
    if (input.connections.length === 0) {
        throw new Error('at least one --connection flag is required (CLI would otherwise open a TUI)');
    }

    const args = [
        'projects',
        'activations',
        'create',
        '--environment',
        environment,
        '--external-id',
        externalId,
    ];

    for (const connection of input.connections) {
        args.push('--connection', formatConnectionFlag(connection.templateId, connection.connectionId));
    }

    for (const variable of input.variables) {
        const name = variable.name.trim();
        if (!name) {
            throw new Error('variable name is required');
        }
        args.push('--variable', formatVariableFlag(name, variable.value));
    }

    return args;
}

export function buildSetVariableArgs(input: SetVariableInput): string[] {
    const environment = input.environment.trim();
    const externalId = input.externalId.trim();
    const name = input.name.trim();
    if (!environment) {
        throw new Error('environment is required');
    }
    if (!externalId) {
        throw new Error('external id is required');
    }
    if (!name) {
        throw new Error('variable name is required');
    }
    // Blank values are allowed: the CLI treats them as empty strings. Callers
    // must distinguish InputBox dismissal (`undefined`) from a deliberate blank.
    return [
        'projects',
        'activations',
        'set-variable',
        '--environment',
        environment,
        '--external-id',
        externalId,
        '--name',
        name,
        '--value',
        input.value,
    ];
}

export function buildSystemsListArgs(environment: string): string[] {
    const env = environment.trim();
    if (!env) {
        throw new Error('environment is required');
    }
    return ['projects', 'systems', 'list', '--environment', env];
}

export function buildConnectionsListArgs(systemId: string, endUserId?: string): string[] {
    const id = systemId.trim();
    if (!id) {
        throw new Error('system id is required');
    }
    const args = ['connections', 'list', '--system', id];
    const endUser = endUserId?.trim();
    if (endUser) {
        args.push('--end-user', endUser);
    }
    return args;
}

/** Org-wide embedded connections for one end-user (no system filter). */
export function buildEndUserConnectionsListArgs(endUserId: string): string[] {
    const id = endUserId.trim();
    if (!id) {
        throw new Error('end user is required');
    }
    return ['connections', 'list', '--end-user', id];
}

export function buildSchemaListArgs(): string[] {
    return ['projects', 'variables', 'list'];
}

export function buildVersionsDeployArgs(environment: string, versionId: string): string[] {
    const env = environment.trim();
    const id = versionId.trim();
    if (!env) {
        throw new Error('environment is required');
    }
    if (!id) {
        throw new Error('version id is required');
    }
    return [
        'projects',
        'versions',
        'deploy',
        '--environment',
        env,
        '--version-id',
        id,
    ];
}

export function formatConnectionFlag(templateId: string, connectionId: string): string {
    const template = templateId.trim();
    const connection = connectionId.trim();
    if (!template || !connection) {
        throw new Error('connection flag needs <system-template-id>=<connection-id>');
    }
    if (template.includes('=') || connection.includes('=')) {
        throw new Error('connection ids must not contain "="');
    }
    return `${template}=${connection}`;
}

/**
 * `key=value` for `--variable`. Values that are not already JSON-looking stay as
 * raw strings; the CLI re-parses JSON when valid.
 */
export function formatVariableFlag(name: string, value: string): string {
    const key = name.trim();
    if (!key) {
        throw new Error('variable name is required');
    }
    if (key.includes('=')) {
        throw new Error('variable names must not contain "="');
    }
    return `${key}=${value}`;
}

export interface StaticConnectionSource {
    templateId: string;
    dynamic: boolean;
    connectionId?: string;
}

/** Static systems are hidden in the Users pane; still required on `activations create`. */
export function mergePickedWithStaticConnections(
    picked: ConnectionAssignment[],
    systems: StaticConnectionSource[],
): ConnectionAssignment[] {
    const out: ConnectionAssignment[] = [...picked];
    const seen = new Set(picked.map((item) => item.templateId));
    for (const system of systems) {
        if (system.dynamic || seen.has(system.templateId)) {
            continue;
        }
        const connectionId = system.connectionId?.trim() ?? '';
        if (!connectionId) {
            continue;
        }
        out.push({ templateId: system.templateId, connectionId });
        seen.add(system.templateId);
    }
    return out;
}
