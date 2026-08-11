import { describe, expect, it } from 'vitest';

import { formatVariableLabel, parseSuccessfulJson, toVariableRows } from './rows';

describe('parseSuccessfulJson', () => {
    it('treats blank and (no items) as empty results', () => {
        expect(parseSuccessfulJson('')).toBeUndefined();
        expect(parseSuccessfulJson('(no items)')).toBeUndefined();
    });
});

describe('toVariableRows', () => {
    it('reads schema rows from the CLI envelope', () => {
        const [row] = toVariableRows({
            type: 'variableRow',
            items: [
                {
                    name: 'tenant_org_id',
                    type: 'string',
                    required: true,
                    description: 'Tenant org',
                    shape: '',
                },
            ],
        });

        expect(row).toEqual({
            name: 'tenant_org_id',
            type: 'string',
            required: true,
            description: 'Tenant org',
            shape: '',
        });
    });

    it('returns an empty list for blank successful JSON', () => {
        expect(toVariableRows(undefined)).toEqual([]);
        expect(toVariableRows(parseSuccessfulJson('   '))).toEqual([]);
    });

    it('skips rows without a name', () => {
        expect(toVariableRows([{ name: '', type: 'string' }])).toEqual([]);
    });
});

describe('formatVariableLabel', () => {
    it('summarises type and required for QuickPicks', () => {
        expect(
            formatVariableLabel({
                name: 'flags',
                type: 'object',
                required: false,
                description: '',
                shape: '{enabled:boolean}',
            }),
        ).toBe('object · optional · {enabled:boolean}');
    });
});
