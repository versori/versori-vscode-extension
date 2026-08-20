import { describe, expect, it } from 'vitest';

import { connectorStatus, schemeLabel, toAuthSchemes, toConnectorRows } from './rows';

describe('schemeLabel', () => {
    it('names the scheme family, not a specific OAuth2 grant', () => {
        expect(schemeLabel('oauth2', 'authorization_code')).toBe('OAuth 2');
        expect(schemeLabel('oauth2', 'client_credentials')).toBe('OAuth 2');
        expect(schemeLabel('oauth2')).toBe('OAuth 2');
        expect(schemeLabel('api-key')).toBe('API Key');
        expect(schemeLabel('none')).toBe('None');
    });
});

describe('connectorStatus', () => {
    it('treats dynamic systems as Embedded', () => {
        expect(connectorStatus(true, true, ['oauth2'])).toBe('embedded');
    });

    it('treats a none-auth static connection as Bypassed', () => {
        expect(connectorStatus(false, true, ['none'])).toBe('bypassed');
    });

    it('treats a credentialed static connection as Connected', () => {
        expect(connectorStatus(false, true, ['oauth2'])).toBe('connected');
    });

    it('is none when a static system has no environment connection', () => {
        expect(connectorStatus(false, false, ['oauth2'])).toBe('none');
    });
});

describe('toConnectorRows', () => {
    it('parses systems list JSON and joins the environment static connection', () => {
        const rows = toConnectorRows(
            {
                items: [
                    {
                        id: '01GCS',
                        connectionTemplateId: '01TPL',
                        name: 'google_cloud_storage',
                        dynamic: false,
                        templateBaseUrl: 'https://storage.googleapis.com',
                        authSchemeConfigs: [{ type: 'none', none: { id: 'n1' } }],
                    },
                    {
                        id: '01WAL',
                        name: 'Walmart_seller_onboarding',
                        dynamic: true,
                        authSchemeConfigs: [
                            {
                                type: 'oauth2',
                                oauth2: { grant: { type: 'authorization_code' } },
                            },
                        ],
                    },
                ],
            },
            [
                {
                    id: '01CONN',
                    name: 'No Authentication - c-y3',
                    systemId: '01GCS',
                    baseUrl: 'https://storage.googleapis.com',
                },
            ],
        );

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            id: '01GCS',
            name: 'google_cloud_storage',
            status: 'bypassed',
            activeConnectionName: 'No Authentication - c-y3',
            schemes: [{ type: 'none', name: 'n1', label: 'None', grant: '' }],
        });
        expect(rows[1]).toMatchObject({
            name: 'Walmart_seller_onboarding',
            status: 'embedded',
            schemes: [
                {
                    type: 'oauth2',
                    name: '',
                    label: 'OAuth 2',
                    grant: 'authorization_code',
                },
            ],
        });
    });
});

describe('toAuthSchemes', () => {
    it('skips untyped entries', () => {
        expect(toAuthSchemes([{ type: 'api-key' }, { name: 'nope' }])).toEqual([
            {
                type: 'api-key',
                name: '',
                label: 'API Key',
                grant: '',
                tokenUrl: '',
                authorizeUrl: '',
            },
        ]);
    });

    it('keeps the scheme id and OAuth2 grant for add/edit, not for display', () => {
        expect(
            toAuthSchemes([
                {
                    type: 'oauth2',
                    oauth2: {
                        id: 'oauth-main',
                        tokenUrl: 'https://example.test/token',
                        authorizeUrl: 'https://example.test/auth',
                        grant: { type: 'clientCredentials' },
                    },
                },
            ]),
        ).toEqual([
            {
                type: 'oauth2',
                name: 'oauth-main',
                label: 'OAuth 2',
                grant: 'clientCredentials',
                tokenUrl: 'https://example.test/token',
                authorizeUrl: 'https://example.test/auth',
            },
        ]);
    });
});
