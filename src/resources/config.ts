import { Field, FormValues } from '../forms/types';

export interface ResourceLimits {
    cpu: string;
    memory: string;
    storage: string;
}

/**
 * An environment's deployment config, as strings throughout.
 *
 * Kubernetes quantities ("500m", "512Mi") are strings anyway, and using `''` for
 * "unset" keeps the round-trip through a form honest — a number would have to
 * invent a sentinel.
 */
export interface ResourceConfig {
    replicas: string;
    /** Autoscaling maximum. `''` means autoscaling is off. */
    maxReplicas: string;
    staticIP: boolean;
    serviceAccount: string;
    limits: ResourceLimits;
    requests: ResourceLimits;
}

const EMPTY_LIMITS: ResourceLimits = { cpu: '', memory: '', storage: '' };

export const EMPTY_CONFIG: ResourceConfig = {
    replicas: '',
    maxReplicas: '',
    staticIP: false,
    serviceAccount: '',
    limits: { ...EMPTY_LIMITS },
    requests: { ...EMPTY_LIMITS },
};

/**
 * Read one environment's config out of a `projects details` response.
 *
 * `projects details` prints a bare object, not the `{type,items}` envelope the
 * list commands use, and nests this at `environments[].config.deploymentSpec`
 * (EnvironmentConfig in versori-api.yaml).
 */
export function readResourceConfig(
    details: unknown,
    environment: string,
): ResourceConfig | undefined {
    const environments = (details as { environments?: unknown[] } | undefined)?.environments;
    if (!Array.isArray(environments)) {
        return undefined;
    }

    const found = environments.find(
        (env) => (env as { name?: unknown })?.name === environment,
    ) as { config?: { deploymentSpec?: Record<string, unknown> } } | undefined;

    if (!found) {
        return undefined;
    }

    const spec = found.config?.deploymentSpec;
    if (!spec) {
        return { ...EMPTY_CONFIG, limits: { ...EMPTY_LIMITS }, requests: { ...EMPTY_LIMITS } };
    }

    const resources = (spec.resources ?? {}) as {
        limits?: Record<string, unknown>;
        requests?: Record<string, unknown>;
    };
    const autoscaling = (spec.autoscaling ?? {}) as { maxReplicas?: unknown };

    return {
        replicas: num(spec.replicas),
        maxReplicas: num(autoscaling.maxReplicas),
        staticIP: spec.staticIP === true,
        serviceAccount: str(spec.serviceAccountName),
        limits: limits(resources.limits),
        requests: limits(resources.requests),
    };
}

function limits(source: Record<string, unknown> | undefined): ResourceLimits {
    return {
        cpu: str(source?.cpu),
        memory: str(source?.memory),
        storage: str(source?.storage),
    };
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function num(value: unknown): string {
    return typeof value === 'number' && value > 0 ? String(value) : '';
}

export function hasResourceChange(current: ResourceConfig, next: ResourceConfig): boolean {
    return (
        current.replicas !== next.replicas ||
        current.maxReplicas !== next.maxReplicas ||
        current.staticIP !== next.staticIP ||
        current.serviceAccount !== next.serviceAccount ||
        changedLimits(current.limits, next.limits) ||
        changedLimits(current.requests, next.requests)
    );
}

function changedLimits(current: ResourceLimits, next: ResourceLimits): boolean {
    // A blank value cannot be sent (the CLI ignores empty strings), so clearing a
    // quantity is not a change this command can express.
    return (['cpu', 'memory', 'storage'] as const).some(
        (key) => Boolean(next[key]) && next[key] !== current[key],
    );
}

/**
 * Argv for `projects edit`.
 *
 * Two rules come straight from edit.go and are the reason this is a tested
 * function rather than string concatenation at the call site:
 *
 *   - `--max-replicas` is **always** re-sent when autoscaling should stay on.
 *     buildPayload sets `Autoscaling = nil` whenever the flag is not > 0, on
 *     every invocation, so editing a CPU limit would otherwise disable it.
 *   - `--service-account` is sent **only** when it changed, because the command
 *     keys off cobra's `Changed` and an empty value removes the account.
 *
 * `projectId` is required rather than optional-by-omission: without `--project`,
 * edit.go resolves the project from cwd's `.versori` (`GetFlagOrDie(".")`), so a
 * `.versori` edited while the panel was open would send this write to a project
 * the panel never read. The same reason `projectArgs` exists for every other
 * command — passed as a value here to keep this module free of resolver types.
 */
export function buildEditArgs(
    environment: string,
    current: ResourceConfig,
    next: ResourceConfig,
    projectId: string | undefined,
): string[] {
    if (!hasResourceChange(current, next)) {
        throw new Error('nothing to change in this environment’s resources');
    }

    const replicas = count(next.replicas, 'replicas');
    const maxReplicas = count(next.maxReplicas, 'max replicas');

    const args = ['projects', 'edit'];
    if (projectId) {
        args.push('--project', projectId);
    }
    args.push('--environment', environment);

    if (replicas > 0) {
        // Re-sent unchanged: the config is written whole, so a stale value here
        // would be persisted as if the user had chosen it.
        args.push('--replicas', String(replicas));
    }
    if (maxReplicas > 0) {
        args.push('--max-replicas', String(maxReplicas));
    }

    pushLimits(args, 'limits', next.limits);
    pushLimits(args, 'requests', next.requests);

    if (current.staticIP !== next.staticIP) {
        args.push('--static-ip', next.staticIP ? 'enabled' : 'disabled');
    }
    if (current.serviceAccount !== next.serviceAccount) {
        args.push('--service-account', next.serviceAccount);
    }

    return args;
}

function pushLimits(args: string[], kind: 'limits' | 'requests', values: ResourceLimits): void {
    for (const key of ['cpu', 'memory', 'storage'] as const) {
        if (values[key]) {
            args.push(`--resource.${key}.${kind}`, values[key]);
        }
    }
}

function count(value: string, label: string): number {
    if (!value.trim()) {
        return 0;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${label} must be a whole number, or blank`);
    }

    return parsed;
}

/** Form fields, prefilled from the current config. */
export function resourceFields(current: ResourceConfig): Field[] {
    const quantity = (id: string, label: string, value: string, hint: string): Field => ({
        kind: 'text',
        id,
        label,
        value,
        placeholder: 'leave blank to keep',
        hint,
    });

    return [
        quantity('cpuLimit', 'CPU limit', current.limits.cpu, 'e.g. 500m'),
        quantity('memoryLimit', 'Memory limit', current.limits.memory, 'e.g. 512Mi'),
        quantity('storageLimit', 'Ephemeral storage limit', current.limits.storage, 'e.g. 1Gi'),
        quantity('cpuRequest', 'CPU request', current.requests.cpu, 'e.g. 100m'),
        quantity('memoryRequest', 'Memory request', current.requests.memory, 'e.g. 200Mi'),
        quantity(
            'storageRequest',
            'Ephemeral storage request',
            current.requests.storage,
            'e.g. 1Gi',
        ),
        {
            kind: 'text',
            id: 'replicas',
            label: 'Replicas',
            value: current.replicas,
            placeholder: 'whole number',
            hint: 'Blank leaves the current count. This command cannot clear a value back to unset.',
        },
        {
            kind: 'text',
            id: 'maxReplicas',
            label: 'Autoscaling maximum',
            value: current.maxReplicas,
            placeholder: 'blank disables autoscaling',
            hint: 'Clearing this turns autoscaling off. It is re-sent on every edit, because the CLI disables autoscaling whenever the flag is absent.',
        },
        {
            kind: 'text',
            id: 'serviceAccount',
            label: 'Service account',
            value: current.serviceAccount,
            placeholder: 'blank removes it',
            hint: 'Only sent when you change it — an empty value removes the account.',
        },
        {
            kind: 'checkbox',
            id: 'staticIP',
            label: 'Static IP',
            value: current.staticIP,
            hint: 'Uses the static IP of the environment’s execution pool.',
        },
    ];
}

export function readResourceForm(values: FormValues): ResourceConfig {
    const text = (id: string) => (typeof values[id] === 'string' ? (values[id] as string) : '');

    return {
        replicas: text('replicas'),
        maxReplicas: text('maxReplicas'),
        staticIP: values.staticIP === true,
        serviceAccount: text('serviceAccount'),
        limits: {
            cpu: text('cpuLimit'),
            memory: text('memoryLimit'),
            storage: text('storageLimit'),
        },
        requests: {
            cpu: text('cpuRequest'),
            memory: text('memoryRequest'),
            storage: text('storageRequest'),
        },
    };
}
