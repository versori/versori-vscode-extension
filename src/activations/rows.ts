import { formatCell, isSecretKey, redact, Row, unwrapRows } from '../results/rows';

export type ActivationStatus = 'active' | 'inactive';

export interface ActivationRow {
    externalId: string;
    displayName: string;
    status: ActivationStatus;
    activationId: string;
    userId: string;
    createdAt: string;
    /** Compact summary of declared dynamic variables (values never shown raw). */
    variableSummary: string;
}

export interface ActivationGroups {
    active: ActivationRow[];
    inactive: ActivationRow[];
}

export interface SystemRow {
    /** Org-level system ID — used with `connections list --system`. */
    systemId: string;
    /** Connection-template / environment-system ID — LHS of `--connection`. */
    templateId: string;
    name: string;
    dynamic: boolean;
}

export interface ConnectionRow {
    id: string;
    name: string;
    systemId: string;
    templateId: string;
    baseUrl: string;
}

export interface RedactedConnection {
    id: string;
    name: string;
    systemId: string;
    templateId: string;
    baseUrl: string;
}

export interface ActivationDetail {
    id: string;
    externalId: string;
    displayName: string;
    connections: RedactedConnection[];
    /** Keys only — values are never surfaced (may contain secrets). */
    variableNames: string[];
    /** Fully redacted JSON for the raw pane. */
    redacted: unknown;
}

export interface SchemaVariable {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

/**
 * Parse CLI JSON stdout, treating blank / whitespace / `(no items)` as empty.
 *
 * Empty list commands print the non-JSON token `(no items)` rather than `[]`.
 * Callers must not treat that as a parse error.
 */
export function parseSuccessfulJson(stdout: string): unknown | undefined {
    const text = stdout.trim();
    if (!text || text === '(no items)') {
        return undefined;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error('could not parse JSON from CLI output');
    }
}

export function toActivationRows(raw: unknown): ActivationRow[] {
    return unwrapRows(raw)
        .map(toActivationRow)
        .filter((row): row is ActivationRow => row !== undefined);
}

export function groupActivations(rows: ActivationRow[]): ActivationGroups {
    const active: ActivationRow[] = [];
    const inactive: ActivationRow[] = [];
    for (const row of rows) {
        if (row.status === 'active') {
            active.push(row);
        } else {
            inactive.push(row);
        }
    }
    return { active, inactive };
}

function toActivationRow(row: Row): ActivationRow | undefined {
    const externalId =
        stringField(row, 'externalId') ||
        stringField(row, 'ExternalId') ||
        stringField(row, 'external_id');
    if (!externalId) {
        return undefined;
    }

    const statusRaw = (stringField(row, 'status') || stringField(row, 'Status')).toLowerCase();
    const status: ActivationStatus = statusRaw === 'active' ? 'active' : 'inactive';

    return {
        externalId,
        displayName:
            stringField(row, 'displayName') ||
            stringField(row, 'DisplayName') ||
            externalId,
        status,
        activationId: stringField(row, 'activationId') || stringField(row, 'ActivationId'),
        userId: stringField(row, 'userId') || stringField(row, 'UserId'),
        createdAt: row.createdAt || row.CreatedAt ? formatCell(row.createdAt ?? row.CreatedAt) : '',
        variableSummary: summariseVariables(row.dynamicVariables ?? row.DynamicVariables),
    };
}

function summariseVariables(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    if (keys.length === 0) {
        return '';
    }
    // Keys only — never echo values into the list view.
    return keys.join(', ');
}

export function toSystemRows(raw: unknown): SystemRow[] {
    return unwrapRows(raw)
        .map(toSystemRow)
        .filter((row): row is SystemRow => row !== undefined);
}

function toSystemRow(row: Row): SystemRow | undefined {
    const systemId = stringField(row, 'id') || stringField(row, 'Id');
    const templateId =
        stringField(row, 'connectionTemplateId') ||
        stringField(row, 'ConnectionTemplateId') ||
        systemId;
    if (!systemId || !templateId) {
        return undefined;
    }
    return {
        systemId,
        templateId,
        name: stringField(row, 'name') || stringField(row, 'Name') || systemId,
        dynamic: Boolean(row.dynamic ?? row.Dynamic),
    };
}

export function toConnectionRows(raw: unknown): ConnectionRow[] {
    return unwrapRows(raw)
        .map(toConnectionRow)
        .filter((row): row is ConnectionRow => row !== undefined);
}

function toConnectionRow(row: Row): ConnectionRow | undefined {
    const id =
        stringField(row, 'connectionId') ||
        stringField(row, 'ConnectionId') ||
        stringField(row, 'id') ||
        stringField(row, 'Id');
    if (!id) {
        return undefined;
    }
    return {
        id,
        name:
            stringField(row, 'connectionName') ||
            stringField(row, 'ConnectionName') ||
            stringField(row, 'name') ||
            stringField(row, 'Name') ||
            id,
        systemId: stringField(row, 'systemId') || stringField(row, 'SystemId'),
        templateId:
            stringField(row, 'connectionTemplateId') ||
            stringField(row, 'ConnectionTemplateId'),
        baseUrl:
            stringField(row, 'baseUrl') ||
            stringField(row, 'BaseUrl') ||
            stringField(row, 'BaseURL'),
    };
}

export function toSchemaVariables(raw: unknown): SchemaVariable[] {
    return unwrapRows(raw)
        .map(toSchemaVariable)
        .filter((row): row is SchemaVariable => row !== undefined);
}

function toSchemaVariable(row: Row): SchemaVariable | undefined {
    const name = stringField(row, 'name') || stringField(row, 'Name');
    if (!name) {
        return undefined;
    }
    return {
        name,
        type: stringField(row, 'type') || stringField(row, 'Type') || 'string',
        required: Boolean(row.required ?? row.Required),
        description: stringField(row, 'description') || stringField(row, 'Description'),
    };
}

/**
 * Build a safe activation-detail view.
 *
 * Connection payloads from `activations details` can embed credentials. Only
 * identity fields are kept; everything else is dropped before display and the
 * raw JSON view is run through {@link redact}.
 */
export function toActivationDetail(raw: unknown): ActivationDetail | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const record = raw as Row;
    const user =
        record.user && typeof record.user === 'object' && !Array.isArray(record.user)
            ? (record.user as Row)
            : undefined;

    const id = stringField(record, 'id') || stringField(record, 'ID');
    const externalId =
        (user && (stringField(user, 'externalId') || stringField(user, 'externalID') || stringField(user, 'ExternalID'))) ||
        stringField(record, 'externalId');
    const displayName =
        (user && (stringField(user, 'displayName') || stringField(user, 'DisplayName'))) ||
        externalId;

    const connectionsRaw = Array.isArray(record.connections)
        ? record.connections
        : Array.isArray(record.Connections)
          ? record.Connections
          : [];

    const connections = connectionsRaw
        .filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map(redactConnection);

    const variables = record.dynamicVariables ?? record.DynamicVariables;
    const variableNames =
        variables && typeof variables === 'object' && !Array.isArray(variables)
            ? Object.keys(variables as Record<string, unknown>).sort()
            : [];

    return {
        id,
        externalId,
        displayName,
        connections,
        variableNames,
        redacted: redact(stripCredentialBags(record)),
    };
}

function redactConnection(row: Row): RedactedConnection {
    return {
        id: stringField(row, 'id') || stringField(row, 'ID'),
        name: stringField(row, 'name') || stringField(row, 'Name'),
        systemId: stringField(row, 'systemId') || stringField(row, 'systemID') || stringField(row, 'SystemID'),
        templateId:
            stringField(row, 'connectionTemplateId') ||
            stringField(row, 'environmentSystemId') ||
            stringField(row, 'EnvironmentSystemID'),
        baseUrl: stringField(row, 'baseUrl') || stringField(row, 'BaseURL'),
    };
}

/** Drop credential-shaped bags before redact, so the raw pane never carries them. */
function stripCredentialBags(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stripCredentialBags);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (isSecretKey(key) || /credential|authscheme|password|secret|token|jwt/i.test(key)) {
            out[key] = '[redacted]';
            continue;
        }
        // Dynamic variable *values* can hold secrets; keep keys only in the raw view.
        if (key === 'dynamicVariables' || key === 'DynamicVariables') {
            if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
                out[key] = Object.fromEntries(
                    Object.keys(inner as Record<string, unknown>).map((name) => [name, '[redacted]']),
                );
            } else {
                out[key] = '[redacted]';
            }
            continue;
        }
        out[key] = stripCredentialBags(inner);
    }
    return out;
}

/**
 * Encode a user-supplied value for `--variable` / `--value`.
 *
 * Numbers, booleans and JSON objects/arrays stay as JSON text; everything else
 * is passed through as a plain string (including an intentional blank).
 */
export function encodeVariableValue(raw: string, typeHint?: string): string {
    const text = raw;
    const hint = (typeHint ?? '').toLowerCase();

    if (hint === 'boolean') {
        const lowered = text.trim().toLowerCase();
        if (lowered === 'true' || lowered === 'false') {
            return lowered;
        }
    }
    if (hint === 'integer' || hint === 'number') {
        const trimmed = text.trim();
        if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
            return trimmed;
        }
    }
    if (hint === 'object' || hint === 'array') {
        const trimmed = text.trim();
        if (!trimmed) {
            return hint === 'array' ? '[]' : '{}';
        }
        JSON.parse(trimmed); // throw if invalid — caller surfaces the message
        return trimmed;
    }

    // Prefer leaving strings unquoted so the CLI stores them as strings; if the
    // user pasted valid JSON deliberately, pass it through unchanged.
    const trimmed = text.trim();
    if (trimmed !== '' && (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === 'true' || trimmed === 'false' || /^-?\d+(\.\d+)?$/.test(trimmed))) {
        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch {
            // fall through
        }
    }

    return text;
}

function stringField(row: Row, key: string): string {
    const value = row[key];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}
