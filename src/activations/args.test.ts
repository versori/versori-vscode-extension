import { describe, expect, it } from 'vitest';

import {
    activationControls,
    buildActivationCreateArgs,
    buildActivationDeleteArgs,
    buildActivationDetailsArgs,
    buildActivationListArgs,
    buildConnectionsListArgs,
    buildSchemaListArgs,
    buildSetVariableArgs,
    buildSystemsListArgs,
    buildUserCreateArgs,
    formatConnectionFlag,
    formatVariableFlag,
} from './args';

describe('activationControls', () => {
    it('offers an environment picker', () => {
        expect(activationControls(['production', 'staging']).map((c) => c.id)).toEqual([
            'environment',
        ]);
    });
});

describe('list / details / delete args', () => {
    it('lists activations for the selected environment', () => {
        expect(buildActivationListArgs({ environment: 'production' })).toEqual([
            'projects',
            'activations',
            'list',
            '--environment',
            'production',
        ]);
    });

    it('builds details and delete argv with external id', () => {
        expect(buildActivationDetailsArgs('production', 'acme')).toEqual([
            'projects',
            'activations',
            'details',
            '--environment',
            'production',
            '--external-id',
            'acme',
        ]);
        expect(buildActivationDeleteArgs('production', 'acme')).toEqual([
            'projects',
            'activations',
            'delete',
            '--environment',
            'production',
            '--external-id',
            'acme',
        ]);
    });

    it('rejects blank environment or external id', () => {
        expect(() => buildActivationDetailsArgs('', 'acme')).toThrow(/environment/);
        expect(() => buildActivationDeleteArgs('production', '  ')).toThrow(/external id/);
    });
});

describe('user create args', () => {
    it('passes display name and external id', () => {
        expect(
            buildUserCreateArgs({ displayName: 'Acme', externalId: 'acme' }),
        ).toEqual([
            'users',
            'create',
            '--display-name',
            'Acme',
            '--external-id',
            'acme',
        ]);
    });

    it('rejects blank identity fields', () => {
        expect(() => buildUserCreateArgs({ displayName: '', externalId: 'acme' })).toThrow(
            /display name/,
        );
        expect(() => buildUserCreateArgs({ displayName: 'Acme', externalId: '' })).toThrow(
            /external id/,
        );
    });
});

describe('activation create args', () => {
    it('emits every --connection and --variable flag so the CLI stays non-interactive', () => {
        expect(
            buildActivationCreateArgs({
                environment: 'production',
                externalId: 'acme',
                connections: [
                    { templateId: '01TPL', connectionId: '01CONN' },
                    { templateId: '01TPL2', connectionId: '01CONN2' },
                ],
                variables: [
                    { name: 'tenant', value: '"acme"' },
                    { name: 'enabled', value: 'true' },
                ],
            }),
        ).toEqual([
            'projects',
            'activations',
            'create',
            '--environment',
            'production',
            '--external-id',
            'acme',
            '--connection',
            '01TPL=01CONN',
            '--connection',
            '01TPL2=01CONN2',
            '--variable',
            'tenant="acme"',
            '--variable',
            'enabled=true',
        ]);
    });

    it('refuses to create without connections — that path would open a TUI', () => {
        expect(() =>
            buildActivationCreateArgs({
                environment: 'production',
                externalId: 'acme',
                connections: [],
                variables: [],
            }),
        ).toThrow(/connection/);
    });
});

describe('set-variable args', () => {
    it('allows a blank value so dismissal stays distinct from empty string', () => {
        expect(
            buildSetVariableArgs({
                environment: 'production',
                externalId: 'acme',
                name: 'note',
                value: '',
            }),
        ).toEqual([
            'projects',
            'activations',
            'set-variable',
            '--environment',
            'production',
            '--external-id',
            'acme',
            '--name',
            'note',
            '--value',
            '',
        ]);
    });
});

describe('enumeration helpers', () => {
    it('lists systems for an environment', () => {
        expect(buildSystemsListArgs('production')).toEqual([
            'projects',
            'systems',
            'list',
            '--environment',
            'production',
        ]);
    });

    it('lists connections, optionally scoped to an end-user for dynamic systems', () => {
        expect(buildConnectionsListArgs('01SYS')).toEqual([
            'connections',
            'list',
            '--system',
            '01SYS',
        ]);
        expect(buildConnectionsListArgs('01SYS', 'acme')).toEqual([
            'connections',
            'list',
            '--system',
            '01SYS',
            '--end-user',
            'acme',
        ]);
    });

    it('lists the project variable schema', () => {
        expect(buildSchemaListArgs()).toEqual(['projects', 'variables', 'list']);
    });
});

describe('flag formatters', () => {
    it('formats connection and variable pairs', () => {
        expect(formatConnectionFlag('01TPL', '01CONN')).toBe('01TPL=01CONN');
        expect(formatVariableFlag('tenant', 'acme')).toBe('tenant=acme');
    });

    it('rejects malformed pairs', () => {
        expect(() => formatConnectionFlag('', '01CONN')).toThrow();
        expect(() => formatVariableFlag('bad=name', 'x')).toThrow(/=/);
    });
});
