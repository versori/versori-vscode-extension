import { Control, ControlValues, environmentArgs, environmentControl } from '../results/controls';

export type ConnectionCreateKind =
    | 'bypass'
    | 'api-key'
    | 'basic'
    | 'oauth2-client'
    | 'oauth2-password'
    | 'oauth2-code'
    | 'unsupported';

export interface AddAuthSchemeInput {
    systemId: string;
    type: string;
    name: string;
    description?: string;
    apiKeyName?: string;
    apiKeyIn?: string;
    oauth2TokenUrl?: string;
    oauth2AuthorizeUrl?: string;
    oauth2GrantType?: string;
    oauth2ClientId?: string;
    oauth2ClientSecret?: string;
    hmacName?: string;
    hmacIn?: string;
    hmacAlgorithm?: string;
    hmacEncoding?: string;
}

export interface ConnectionCreateInput {
    environment: string;
    name: string;
    templateId: string;
    baseUrl?: string;
    bypass?: boolean;
    apiKey?: string;
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
}

export interface SystemConnectInput {
    environment: string;
    templateId: string;
    connectionId: string;
}

const SECRET_FLAGS = new Set([
    '--api-key',
    '--password',
    '--client-secret',
    '--oauth2.client-secret',
]);

export function connectorControls(environments: string[]): Control[] {
    return [environmentControl(environments)];
}

export function buildConnectorListArgs(values: ControlValues): string[] {
    return ['projects', 'systems', 'list', ...environmentArgs(values)];
}

export function buildStaticConnectionsArgs(environment: string): string[] {
    const env = environment.trim();
    if (!env) {
        throw new Error('environment is required');
    }
    return ['projects', 'systems', 'list-connections', '--environment', env];
}

/** CLI `--oauth2.grant-type` values: authorizationCode | clientCredentials | password. */
export function normalizeOAuth2Grant(grant: string): string {
    const raw = grant.trim().toLowerCase().replace(/-/g, '_');
    if (raw === 'authorization_code' || raw === 'authorizationcode') {
        return 'authorizationCode';
    }
    if (raw === 'client_credentials' || raw === 'clientcredentials') {
        return 'clientCredentials';
    }
    if (raw === 'password') {
        return 'password';
    }
    return grant.trim();
}

export function connectionCreateKind(scheme: { type: string; grant: string }): ConnectionCreateKind {
    const type = scheme.type.trim().toLowerCase();
    if (type === 'none') {
        return 'bypass';
    }
    if (type === 'api-key') {
        return 'api-key';
    }
    if (type === 'basic-auth') {
        return 'basic';
    }
    if (type === 'oauth2') {
        const grant = normalizeOAuth2Grant(scheme.grant);
        if (grant === 'clientCredentials') {
            return 'oauth2-client';
        }
        if (grant === 'password') {
            return 'oauth2-password';
        }
        if (grant === 'authorizationCode') {
            return 'oauth2-code';
        }
        return 'oauth2-code';
    }
    return 'unsupported';
}

export function buildAddAuthSchemeArgs(input: AddAuthSchemeInput): string[] {
    const systemId = input.systemId.trim();
    const type = input.type.trim();
    const name = input.name.trim();
    if (!systemId) {
        throw new Error('system id is required');
    }
    if (!type) {
        throw new Error('auth scheme type is required');
    }
    if (!name) {
        throw new Error('auth scheme name is required');
    }

    const args = [
        'systems',
        'add-auth-scheme',
        '--system-id',
        systemId,
        '--type',
        type,
        '--name',
        name,
    ];
    const description = input.description?.trim() ?? '';
    if (description) {
        args.push('--description', description);
    }

    if (type === 'api-key') {
        const keyName = input.apiKeyName?.trim() ?? '';
        const keyIn = input.apiKeyIn?.trim() ?? '';
        if (!keyName || !keyIn) {
            throw new Error('--api-key.name and --api-key.in are required when type=api-key');
        }
        args.push('--api-key.name', keyName, '--api-key.in', keyIn);
        return args;
    }

    if (type === 'oauth2') {
        const tokenUrl = input.oauth2TokenUrl?.trim() ?? '';
        if (!tokenUrl) {
            throw new Error('--oauth2.token-url is required when type=oauth2');
        }
        args.push('--oauth2.token-url', tokenUrl);
        const authorizeUrl = input.oauth2AuthorizeUrl?.trim() ?? '';
        if (authorizeUrl) {
            args.push('--oauth2.authorize-url', authorizeUrl);
        }
        const grant = normalizeOAuth2Grant(input.oauth2GrantType ?? '');
        if (grant) {
            args.push('--oauth2.grant-type', grant);
        }
        const clientId = input.oauth2ClientId?.trim() ?? '';
        if (clientId) {
            args.push('--oauth2.client-id', clientId);
        }
        const clientSecret = input.oauth2ClientSecret?.trim() ?? '';
        if (clientSecret) {
            args.push('--oauth2.client-secret', clientSecret);
        }
        return args;
    }

    if (type === 'hmac') {
        const hmacName = input.hmacName?.trim() ?? '';
        const hmacIn = input.hmacIn?.trim() ?? '';
        const algorithm = input.hmacAlgorithm?.trim() ?? '';
        if (!hmacName || !hmacIn || !algorithm) {
            throw new Error('--hmac.name, --hmac.in and --hmac.algorithm are required when type=hmac');
        }
        args.push('--hmac.name', hmacName, '--hmac.in', hmacIn, '--hmac.algorithm', algorithm);
        const encoding = input.hmacEncoding?.trim() ?? '';
        if (encoding) {
            args.push('--hmac.encoding', encoding);
        }
        return args;
    }

    return args;
}

export function buildConnectionCreateArgs(input: ConnectionCreateInput): string[] {
    const environment = input.environment.trim();
    const name = input.name.trim();
    const templateId = input.templateId.trim();
    if (!environment) {
        throw new Error('environment is required');
    }
    if (!name) {
        throw new Error('connection name is required');
    }
    if (!templateId) {
        throw new Error('template id is required');
    }

    const args = [
        'connections',
        'create',
        '--environment',
        environment,
        '--name',
        name,
        '--template-id',
        templateId,
    ];
    const baseUrl = input.baseUrl?.trim() ?? '';
    if (baseUrl) {
        args.push('--base-url', baseUrl);
    }
    if (input.bypass) {
        args.push('--bypass');
        return args;
    }
    pushFlag(args, '--api-key', input.apiKey);
    pushFlag(args, '--username', input.username);
    pushFlag(args, '--password', input.password);
    pushFlag(args, '--client-id', input.clientId);
    pushFlag(args, '--client-secret', input.clientSecret);
    pushFlag(args, '--token-url', input.tokenUrl);
    return args;
}

export function buildSystemConnectArgs(input: SystemConnectInput): string[] {
    const environment = input.environment.trim();
    const templateId = input.templateId.trim();
    const connectionId = input.connectionId.trim();
    if (!environment) {
        throw new Error('environment is required');
    }
    if (!templateId) {
        throw new Error('template-id is required');
    }
    if (!connectionId) {
        throw new Error('connection-id is required');
    }
    return [
        'projects',
        'systems',
        'connect',
        '--environment',
        environment,
        '--template-id',
        templateId,
        '--connection-id',
        connectionId,
    ];
}

export function buildConnectionUnlinkArgs(input: { connectionId: string; templateId: string }): string[] {
    const connectionId = input.connectionId.trim();
    const templateId = input.templateId.trim();
    if (!connectionId) {
        throw new Error('connection id is required');
    }
    if (!templateId) {
        throw new Error('template-id is required');
    }
    return ['connections', 'unlink', '--id', connectionId, '--template-id', templateId, '--yes'];
}

export function buildConnectionDeleteArgs(connectionId: string): string[] {
    const id = connectionId.trim();
    if (!id) {
        throw new Error('connection id is required');
    }
    return ['connections', 'delete', '--id', id, '--yes'];
}

export function buildUpdateAuthSchemeTemplateArgs(templateId: string, schemeName: string): string[] {
    const template = templateId.trim();
    const scheme = schemeName.trim();
    if (!template) {
        throw new Error('template id is required');
    }
    if (!scheme) {
        throw new Error('auth scheme config id is required');
    }
    return [
        'projects',
        'systems',
        'update-connection-template',
        '--template',
        template,
        '--auth-scheme-config-id',
        scheme,
    ];
}

export function redactSecretArgs(args: string[]): string[] {
    const out = [...args];
    for (let i = 0; i < out.length - 1; i += 1) {
        if (SECRET_FLAGS.has(out[i] ?? '')) {
            out[i + 1] = '***';
        }
    }
    return out;
}

export function versoriProjectUrl(projectId: string): string {
    return `https://ai.versori.com/integrations/${projectId.trim()}`;
}

function pushFlag(args: string[], flag: string, value: string | undefined): void {
    const trimmed = value?.trim() ?? '';
    if (trimmed) {
        args.push(flag, trimmed);
    }
}
