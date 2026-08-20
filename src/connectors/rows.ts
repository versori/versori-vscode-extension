import { ConnectionRow, toConnectionRows } from '../activations/rows';
import { Row, unwrapRows } from '../results/rows';

export type ConnectorStatus = 'embedded' | 'bypassed' | 'connected' | 'none';

export interface AuthScheme {
    type: string;
    name: string;
    label: string;
    grant: string;
    tokenUrl: string;
    authorizeUrl: string;
}

export interface ConnectorRow {
    id: string;
    connectionTemplateId: string;
    name: string;
    domain: string;
    dynamic: boolean;
    templateBaseUrl: string;
    schemes: AuthScheme[];
    status: ConnectorStatus;
    activeConnectionId: string;
    activeConnectionName: string;
    activeBaseUrl: string;
}

const NESTED_SCHEME_KEYS: Record<string, string[]> = {
    none: ['none', 'None'],
    'api-key': ['apiKey', 'ApiKey'],
    'basic-auth': ['basicAuth', 'BasicAuth'],
    oauth2: ['oauth2', 'OAuth2', 'Oauth2'],
    hmac: ['hmac', 'Hmac'],
    certificate: ['certificate', 'Certificate'],
    oauth1: ['oauth1', 'OAuth1', 'Oauth1'],
};

export function toConnectorRows(raw: unknown, staticConnections: unknown): ConnectorRow[] {
    const bound = toConnectionRows(staticConnections);
    return unwrapRows(raw)
        .map((row) => toConnectorRow(row, bound))
        .filter((row): row is ConnectorRow => row !== undefined);
}

/** Family name for the scheme list. OAuth2 grants are chosen when adding or editing. */
export function schemeLabel(type: string, _grant = ''): string {
    const kind = type.trim().toLowerCase();
    if (kind === 'none') {
        return 'None';
    }
    if (kind === 'api-key') {
        return 'API Key';
    }
    if (kind === 'basic-auth') {
        return 'Basic Auth';
    }
    if (kind === 'hmac') {
        return 'HMAC';
    }
    if (kind === 'oauth2') {
        return 'OAuth 2';
    }
    if (kind === 'certificate') {
        return 'Certificate';
    }
    return type.trim() || 'Unknown';
}

export function connectorStatus(
    dynamic: boolean,
    hasConnection: boolean,
    schemeTypes: string[],
): ConnectorStatus {
    if (dynamic) {
        return 'embedded';
    }
    if (!hasConnection) {
        return 'none';
    }
    const first = (schemeTypes[0] ?? '').toLowerCase();
    if (first === 'none') {
        return 'bypassed';
    }
    return 'connected';
}

function toConnectorRow(row: Row, bound: ConnectionRow[]): ConnectorRow | undefined {
    const id = stringField(row, 'id') || stringField(row, 'Id');
    if (!id) {
        return undefined;
    }

    const schemes = toAuthSchemes(row.authSchemeConfigs ?? row.AuthSchemeConfigs);
    const active =
        bound.find((connection) => connection.systemId === id) ??
        bound.find((connection) => connection.templateId === stringField(row, 'connectionTemplateId'));

    return {
        id,
        connectionTemplateId:
            stringField(row, 'connectionTemplateId') || stringField(row, 'ConnectionTemplateId'),
        name: stringField(row, 'name') || stringField(row, 'Name') || id,
        domain: stringField(row, 'domain') || stringField(row, 'Domain'),
        dynamic: Boolean(row.dynamic ?? row.Dynamic),
        templateBaseUrl:
            stringField(row, 'templateBaseUrl') || stringField(row, 'TemplateBaseUrl'),
        schemes,
        status: connectorStatus(
            Boolean(row.dynamic ?? row.Dynamic),
            Boolean(active),
            schemes.map((scheme) => scheme.type),
        ),
        activeConnectionId: active?.id ?? '',
        activeConnectionName: active?.name ?? '',
        activeBaseUrl: active?.baseUrl ?? '',
    };
}

export function toAuthSchemes(raw: unknown): AuthScheme[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map(toAuthScheme)
        .filter((scheme): scheme is AuthScheme => scheme !== undefined);
}

function toAuthScheme(value: unknown): AuthScheme | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const row = value as Row;
    const type = stringField(row, 'type') || stringField(row, 'Type');
    if (!type) {
        return undefined;
    }
    const nested = nestedScheme(row, type);
    const grant = grantType(row);
    return {
        type,
        name: nested ? stringField(nested, 'id') || stringField(nested, 'ID') : '',
        label: schemeLabel(type, grant),
        grant,
        tokenUrl: nested
            ? stringField(nested, 'tokenUrl') ||
              stringField(nested, 'TokenURL') ||
              stringField(nested, 'token_url')
            : '',
        authorizeUrl: nested
            ? stringField(nested, 'authorizeUrl') ||
              stringField(nested, 'AuthorizeURL') ||
              stringField(nested, 'authorize_url')
            : '',
    };
}

function nestedScheme(row: Row, type: string): Row | undefined {
    const keys = NESTED_SCHEME_KEYS[type.trim().toLowerCase()] ?? [type];
    for (const key of keys) {
        const value = row[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as Row;
        }
    }
    return undefined;
}

function grantType(row: Row): string {
    const oauth = row.oauth2 ?? row.OAuth2;
    if (!oauth || typeof oauth !== 'object' || Array.isArray(oauth)) {
        return '';
    }
    const grant = (oauth as Row).grant ?? (oauth as Row).Grant;
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
        return '';
    }
    return stringField(grant as Row, 'type') || stringField(grant as Row, 'Type');
}

function stringField(row: Row, key: string): string {
    const value = row[key];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}
