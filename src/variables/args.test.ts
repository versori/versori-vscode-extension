import { describe, expect, it } from 'vitest';

import {
    buildVariableAddArgs,
    buildVariableRemoveArgs,
    buildVariablesListArgs,
    buildVariableUpdateArgs,
    parseFieldList,
    VARIABLE_TYPES,
} from './args';

describe('VARIABLE_TYPES', () => {
    it('lists the JSON Schema types the CLI accepts', () => {
        expect(VARIABLE_TYPES).toEqual([
            'string',
            'number',
            'integer',
            'boolean',
            'object',
            'array',
        ]);
    });
});

describe('buildVariablesListArgs', () => {
    it('lists the project schema', () => {
        expect(buildVariablesListArgs()).toEqual(['projects', 'variables', 'list']);
    });
});

describe('buildVariableAddArgs', () => {
    it('adds a required string variable', () => {
        expect(
            buildVariableAddArgs({
                name: 'tenant_org_id',
                type: 'string',
                description: 'Tenant org',
                required: true,
            }),
        ).toEqual([
            'projects',
            'variables',
            'add',
            '--name',
            'tenant_org_id',
            '--type',
            'string',
            '--description',
            'Tenant org',
            '--required',
        ]);
    });

    it('requires --items-type for arrays and supports fields/strict', () => {
        expect(() => buildVariableAddArgs({ name: 'tags', type: 'array' })).toThrow(/items-type/);

        expect(
            buildVariableAddArgs({
                name: 'addresses',
                type: 'array',
                itemsType: 'object',
                strict: true,
                fields: ['street:string:required', 'zip:string'],
            }),
        ).toEqual([
            'projects',
            'variables',
            'add',
            '--name',
            'addresses',
            '--type',
            'array',
            '--items-type',
            'object',
            '--strict',
            '--field',
            'street:string:required',
            '--field',
            'zip:string',
        ]);
    });
});

describe('buildVariableUpdateArgs', () => {
    it('emits only the flags that changed', () => {
        expect(
            buildVariableUpdateArgs({
                name: 'tenant_org_id',
                description: '',
                required: false,
            }),
        ).toEqual([
            'projects',
            'variables',
            'update',
            '--name',
            'tenant_org_id',
            '--description',
            '',
            '--required=false',
        ]);
    });

    it('rejects an empty update', () => {
        expect(() => buildVariableUpdateArgs({ name: 'tenant_org_id' })).toThrow(/nothing to change/);
    });
});

describe('buildVariableRemoveArgs', () => {
    it('passes --yes after host-side confirmation', () => {
        expect(buildVariableRemoveArgs('tenant_org_id')).toEqual([
            'projects',
            'variables',
            'remove',
            '--name',
            'tenant_org_id',
            '--yes',
        ]);
    });
});

describe('parseFieldList', () => {
    it('splits comma-separated field declarations', () => {
        expect(parseFieldList(' street:string:required , zip:string ')).toEqual([
            'street:string:required',
            'zip:string',
        ]);
    });
});
