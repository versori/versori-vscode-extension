import { describe, expect, it } from 'vitest';

import {
    buildAddAuthSchemeArgs,
    buildConnectionCreateArgs,
    buildConnectionDeleteArgs,
    buildConnectionUnlinkArgs,
    buildConnectorListArgs,
    buildStaticConnectionsArgs,
    buildSystemConnectArgs,
    buildUpdateAuthSchemeTemplateArgs,
    connectionCreateKind,
    connectorControls,
    normalizeOAuth2Grant,
    redactSecretArgs,
    versoriProjectUrl,
} from './args';

describe('connector args', () => {
    it('offers an environment picker', () => {
        expect(connectorControls(['production', 'staging']).map((c) => c.id)).toEqual([
            'environment',
        ]);
    });

    it('lists project systems for the selected environment', () => {
        expect(buildConnectorListArgs({ environment: 'production' })).toEqual([
            'projects',
            'systems',
            'list',
            '--environment',
            'production',
        ]);
    });

    it('lists static environment connections', () => {
        expect(buildStaticConnectionsArgs('production')).toEqual([
            'projects',
            'systems',
            'list-connections',
            '--environment',
            'production',
        ]);
        expect(() => buildStaticConnectionsArgs('  ')).toThrow(/environment/);
    });
});

describe('normalizeOAuth2Grant', () => {
    it('emits the CLI grant-type flag values', () => {
        expect(normalizeOAuth2Grant('authorization_code')).toBe('authorizationCode');
        expect(normalizeOAuth2Grant('client-credentials')).toBe('clientCredentials');
        expect(normalizeOAuth2Grant('password')).toBe('password');
    });
});

describe('connectionCreateKind', () => {
    it('routes none to bypass and oauth2 grants to the matching CLI path', () => {
        expect(connectionCreateKind({ type: 'none', grant: '' })).toBe('bypass');
        expect(connectionCreateKind({ type: 'api-key', grant: '' })).toBe('api-key');
        expect(connectionCreateKind({ type: 'basic-auth', grant: '' })).toBe('basic');
        expect(connectionCreateKind({ type: 'oauth2', grant: 'clientCredentials' })).toBe(
            'oauth2-client',
        );
        expect(connectionCreateKind({ type: 'oauth2', grant: 'password' })).toBe(
            'oauth2-password',
        );
        expect(connectionCreateKind({ type: 'oauth2', grant: 'authorization_code' })).toBe(
            'oauth2-code',
        );
        expect(connectionCreateKind({ type: 'hmac', grant: '' })).toBe('unsupported');
    });
});

describe('buildAddAuthSchemeArgs', () => {
    it('upserts an oauth2 scheme without baking a grant into the type flag', () => {
        expect(
            buildAddAuthSchemeArgs({
                systemId: '01SYS',
                type: 'oauth2',
                name: 'oauth-main',
                oauth2TokenUrl: 'https://example.test/token',
                oauth2AuthorizeUrl: 'https://example.test/auth',
                oauth2GrantType: 'authorization_code',
            }),
        ).toEqual([
            'systems',
            'add-auth-scheme',
            '--system-id',
            '01SYS',
            '--type',
            'oauth2',
            '--name',
            'oauth-main',
            '--oauth2.token-url',
            'https://example.test/token',
            '--oauth2.authorize-url',
            'https://example.test/auth',
            '--oauth2.grant-type',
            'authorizationCode',
        ]);
    });

    it('requires api-key placement flags', () => {
        expect(() =>
            buildAddAuthSchemeArgs({
                systemId: '01SYS',
                type: 'api-key',
                name: 'key',
            }),
        ).toThrow(/api-key/);
        expect(
            buildAddAuthSchemeArgs({
                systemId: '01SYS',
                type: 'api-key',
                name: 'key',
                apiKeyName: 'X-API-Key',
                apiKeyIn: 'header',
            }),
        ).toEqual([
            'systems',
            'add-auth-scheme',
            '--system-id',
            '01SYS',
            '--type',
            'api-key',
            '--name',
            'key',
            '--api-key.name',
            'X-API-Key',
            '--api-key.in',
            'header',
        ]);
    });
});

describe('buildConnectionCreateArgs', () => {
    it('creates a static api-key connection with all required flags', () => {
        expect(
            buildConnectionCreateArgs({
                environment: 'production',
                name: 'gcs-prod',
                templateId: '01TPL',
                apiKey: '$GCS_API_KEY',
            }),
        ).toEqual([
            'connections',
            'create',
            '--environment',
            'production',
            '--name',
            'gcs-prod',
            '--template-id',
            '01TPL',
            '--api-key',
            '$GCS_API_KEY',
        ]);
    });

    it('does not combine --bypass with credential flags', () => {
        expect(
            buildConnectionCreateArgs({
                environment: 'production',
                name: 'open',
                templateId: '01TPL',
                bypass: true,
                apiKey: 'secret',
            }),
        ).toEqual([
            'connections',
            'create',
            '--environment',
            'production',
            '--name',
            'open',
            '--template-id',
            '01TPL',
            '--bypass',
        ]);
    });
});

describe('buildSystemConnectArgs', () => {
    it('binds an existing connection to the environment template', () => {
        expect(
            buildSystemConnectArgs({
                environment: 'production',
                templateId: '01TPL',
                connectionId: '01CONN',
            }),
        ).toEqual([
            'projects',
            'systems',
            'connect',
            '--environment',
            'production',
            '--template-id',
            '01TPL',
            '--connection-id',
            '01CONN',
        ]);
        expect(() =>
            buildSystemConnectArgs({
                environment: 'production',
                templateId: '01TPL',
                connectionId: '',
            }),
        ).toThrow(/connection-id/);
    });
});

describe('buildConnectionUnlinkArgs', () => {
    it('unlinks a connection from the environment template', () => {
        expect(
            buildConnectionUnlinkArgs({
                connectionId: '01CONN',
                templateId: '01TPL',
            }),
        ).toEqual([
            'connections',
            'unlink',
            '--id',
            '01CONN',
            '--template-id',
            '01TPL',
            '--yes',
        ]);
    });
});

describe('buildConnectionDeleteArgs', () => {
    it('deletes a connection with --yes so execFile never waits on a TTY', () => {
        expect(buildConnectionDeleteArgs('01CONN')).toEqual([
            'connections',
            'delete',
            '--id',
            '01CONN',
            '--yes',
        ]);
        expect(() => buildConnectionDeleteArgs('  ')).toThrow(/id/);
    });
});

describe('buildUpdateAuthSchemeTemplateArgs', () => {
    it('pins the selected auth scheme on the connection template', () => {
        expect(buildUpdateAuthSchemeTemplateArgs('01TPL', 'oauth-main')).toEqual([
            'projects',
            'systems',
            'update-connection-template',
            '--template',
            '01TPL',
            '--auth-scheme-config-id',
            'oauth-main',
        ]);
    });
});

describe('redactSecretArgs', () => {
    it('scrubs credential flag values before they hit the output channel', () => {
        expect(
            redactSecretArgs([
                'connections',
                'create',
                '--api-key',
                'live-secret',
                '--password',
                'pw',
                '--name',
                'ok',
            ]),
        ).toEqual([
            'connections',
            'create',
            '--api-key',
            '***',
            '--password',
            '***',
            '--name',
            'ok',
        ]);
    });
});

describe('versoriProjectUrl', () => {
    it('points authorization-code setup at the platform project', () => {
        expect(versoriProjectUrl('01PROJ')).toBe('https://ai.versori.com/integrations/01PROJ');
    });
});
