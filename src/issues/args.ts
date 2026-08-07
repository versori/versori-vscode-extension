import { Control, ControlValues, environmentArgs, environmentControl } from '../results/controls';

/**
 * The API's accepted values — IssueStatusEnum and IssueSeverityEnum in
 * versori-api.yaml. Anything else is rejected server-side, so the extension
 * never offers a value the user cannot use.
 */
export const ISSUE_STATUSES = ['open', 'acked', 'resolved', 'closed'];
export const ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Sentinel for "do not filter". Not a value the CLI ever sees. */
export const ANY = 'any';

export function issueControls(environments: string[]): Control[] {
    return [
        environmentControl(environments),
        {
            kind: 'select',
            id: 'status',
            label: 'Status',
            value: ANY,
            options: [
                { value: ANY, label: 'Any status' },
                ...ISSUE_STATUSES.map((value) => ({ value, label: value })),
            ],
        },
        {
            kind: 'select',
            id: 'severity',
            label: 'Severity',
            value: ANY,
            options: [
                { value: ANY, label: 'Any severity' },
                ...ISSUE_SEVERITIES.map((value) => ({ value, label: value })),
            ],
        },
        { kind: 'number', id: 'first', label: 'Max issues', value: 50, min: 0 },
    ];
}

export function buildIssueListArgs(values: ControlValues): string[] {
    const args = [...environmentArgs(values)];

    const status = String(values.status ?? ANY);
    if (status !== ANY) {
        args.push('--status', status);
    }

    const severity = String(values.severity ?? ANY);
    if (severity !== ANY) {
        args.push('--severity', severity);
    }

    // 0 lets the server default apply, so send nothing rather than `--first 0`.
    const first = Number(values.first ?? 0);
    if (Number.isFinite(first) && first > 0) {
        args.push('--first', String(Math.floor(first)));
    }

    return args;
}

export interface IssueChange {
    status?: string;
    severity?: string;
}

/**
 * Argv for a status/severity change.
 *
 * `issues update` mirrors the platform: only the fields you pass are sent. An
 * empty change is therefore a silent no-op, which would look like a failed
 * action, so it throws instead.
 */
export function buildIssueUpdateArgs(issueId: string, change: IssueChange): string[] {
    if (!change.status && !change.severity) {
        throw new Error('nothing to change on this issue');
    }
    if (change.status && !ISSUE_STATUSES.includes(change.status)) {
        throw new Error(`unknown status "${change.status}"`);
    }
    if (change.severity && !ISSUE_SEVERITIES.includes(change.severity)) {
        throw new Error(`unknown severity "${change.severity}"`);
    }

    const args = ['projects', 'issues', 'update', issueId];
    if (change.status) {
        args.push('--status', change.status);
    }
    if (change.severity) {
        args.push('--severity', change.severity);
    }

    return args;
}

/**
 * Argv for one issue's full detail.
 *
 * `--environment` is auto-selected by the CLI when the project has exactly one,
 * but naming it keeps the lookup deterministic on multi-environment projects.
 */
export function buildIssueGetArgs(issueId: string, environment: string): string[] {
    const args = ['projects', 'issues', 'get', issueId];
    return environment ? [...args, '--environment', environment] : args;
}
