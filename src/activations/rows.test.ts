import { describe, expect, it } from 'vitest';

import {
    encodeVariableValue,
    groupActivations,
    parseSuccessfulJson,
    toActivationDetail,
    toActivationRows,
    toConnectionRows,
    toSchemaVariables,
    toSystemRows,
} from './rows';

const activeUser = {
    displayName: 'Acme',
    externalId: 'acme',
    status: 'active',
    activationId: '01ACT',
    userId: '01USER',
    createdAt: '2026-04-08T10:00:53Z',
    dynamicVariables: { tenant: 'secret-value', region: 'eu' },
};

const inactiveUser = {
    displayName: 'Beta',
    externalId: 'beta',
    status: 'inactive',
    userId: '01USER2',
    createdAt: '2026-04-08T11:00:53Z',
};

describe('parseSuccessfulJson', () => {
    it('treats blank, whitespace, and (no items) as empty results', () => {
        expect(parseSuccessfulJson('')).toBeUndefined();
        expect(parseSuccessfulJson('   \n')).toBeUndefined();
        expect(parseSuccessfulJson('(no items)')).toBeUndefined();
    });

    it('parses a normal JSON envelope', () => {
        expect(parseSuccessfulJson('{"type":"X","items":[]}')).toEqual({
            type: 'X',
            items: [],
        });
    });

    it('throws on malformed non-blank JSON', () => {
        expect(() => parseSuccessfulJson('{not-json')).toThrow(/parse/);
    });
});

describe('toActivationRows / groupActivations', () => {
    it('reads active and inactive rows from the CLI envelope', () => {
        const rows = toActivationRows({
            type: 'printableActivation',
            items: [activeUser, inactiveUser],
        });
        expect(rows).toHaveLength(2);
        expect(rows[0]?.status).toBe('active');
        expect(rows[0]?.variableSummary).toBe('region, tenant');
        expect(rows[1]?.status).toBe('inactive');
        expect(rows[1]?.activationId).toBe('');
    });

    it('never echoes dynamic variable values into the list summary', () => {
        const [row] = toActivationRows([activeUser]);
        expect(row.variableSummary).not.toContain('secret-value');
        expect(row.variableSummary).toContain('tenant');
    });

    it('groups active ahead of inactive for the panel sections', () => {
        const groups = groupActivations(toActivationRows([inactiveUser, activeUser]));
        expect(groups.active.map((r) => r.externalId)).toEqual(['acme']);
        expect(groups.inactive.map((r) => r.externalId)).toEqual(['beta']);
    });

    it('returns an empty list for blank successful JSON', () => {
        expect(toActivationRows(undefined)).toEqual([]);
        expect(toActivationRows(parseSuccessfulJson(''))).toEqual([]);
    });

    it('skips rows without an external id', () => {
        expect(toActivationRows([{ ...activeUser, externalId: '' }])).toEqual([]);
    });
});

describe('systems / connections / schema parsers', () => {
    it('maps systems list rows to template + system ids', () => {
        const [row] = toSystemRows([
            {
                id: '01SYS',
                connectionTemplateId: '01TPL',
                name: 'Mirakl',
                dynamic: true,
            },
        ]);
        expect(row).toEqual({
            systemId: '01SYS',
            templateId: '01TPL',
            name: 'Mirakl',
            dynamic: true,
        });
    });

    it('maps connections list identity fields', () => {
        const [row] = toConnectionRows([
            {
                connectionName: 'Acme Mirakl',
                connectionId: '01CONN',
                systemId: '01SYS',
                baseUrl: 'https://example.test',
            },
        ]);
        expect(row?.id).toBe('01CONN');
        expect(row?.name).toBe('Acme Mirakl');
    });

    it('maps variable schema rows', () => {
        const [row] = toSchemaVariables([
            { name: 'tenant', type: 'string', required: true, description: 'org id' },
        ]);
        expect(row).toEqual({
            name: 'tenant',
            type: 'string',
            required: true,
            description: 'org id',
        });
    });
});

describe('toActivationDetail', () => {
    it('keeps only redacted connection identity and variable key names', () => {
        const detail = toActivationDetail({
            id: '01ACT',
            user: { displayName: 'Acme', externalId: 'acme' },
            dynamicVariables: { tenant: 'secret-value' },
            connections: [
                {
                    id: '01CONN',
                    name: 'Acme Mirakl',
                    systemId: '01SYS',
                    baseUrl: 'https://example.test',
                    credentials: { apiKey: 'super-secret' },
                    authSchemeConfigs: [{ type: 'api-key', apiKey: 'also-secret' }],
                },
            ],
        });

        expect(detail?.connections).toEqual([
            {
                id: '01CONN',
                name: 'Acme Mirakl',
                systemId: '01SYS',
                templateId: '',
                baseUrl: 'https://example.test',
            },
        ]);
        expect(detail?.variableNames).toEqual(['tenant']);
        expect(JSON.stringify(detail?.redacted)).not.toContain('super-secret');
        expect(JSON.stringify(detail?.redacted)).not.toContain('also-secret');
        expect(JSON.stringify(detail?.redacted)).not.toContain('secret-value');
    });
});

describe('encodeVariableValue', () => {
    it('passes blank strings through for set-variable', () => {
        expect(encodeVariableValue('')).toBe('');
    });

    it('keeps booleans and numbers as JSON text when hinted', () => {
        expect(encodeVariableValue('true', 'boolean')).toBe('true');
        expect(encodeVariableValue('42', 'integer')).toBe('42');
    });

    it('rejects invalid object JSON', () => {
        expect(() => encodeVariableValue('{bad', 'object')).toThrow();
    });
});
