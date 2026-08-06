import { describe, expect, it } from 'vitest';

import {
    buildEditArgs,
    EMPTY_CONFIG,
    hasResourceChange,
    readResourceConfig,
    readResourceForm,
    ResourceConfig,
} from './config';

// Shape from `projects details -o json`: a bare object (not a {type,items}
// envelope), with config.deploymentSpec per EnvironmentConfig in versori-api.yaml.
const details = {
    id: '01JPROJECT',
    name: 'shopify-sync',
    environments: [
        {
            id: '01JENV',
            name: 'production',
            config: {
                deploymentSpec: {
                    replicas: 2,
                    autoscaling: { maxReplicas: 5 },
                    staticIP: true,
                    serviceAccountName: 'sync-sa',
                    resources: {
                        limits: { cpu: '500m', memory: '512Mi', storage: '1Gi' },
                        requests: { cpu: '100m', memory: '200Mi' },
                    },
                },
            },
        },
        { id: '01JENV2', name: 'staging', config: {} },
    ],
};

const current: ResourceConfig = {
    replicas: '2',
    maxReplicas: '5',
    staticIP: true,
    serviceAccount: 'sync-sa',
    limits: { cpu: '500m', memory: '512Mi', storage: '1Gi' },
    requests: { cpu: '100m', memory: '200Mi', storage: '' },
};

describe('readResourceConfig', () => {
    it('reads every field off the named environment', () => {
        expect(readResourceConfig(details, 'production')).toEqual(current);
    });

    it('returns the empty config for an environment with no deployment spec', () => {
        expect(readResourceConfig(details, 'staging')).toEqual(EMPTY_CONFIG);
    });

    it('returns undefined for an environment the project does not have', () => {
        expect(readResourceConfig(details, 'nope')).toBeUndefined();
    });

    it('treats absent autoscaling as off', () => {
        const off = { environments: [{ name: 'p', config: { deploymentSpec: { replicas: 1 } } }] };
        expect(readResourceConfig(off, 'p')?.maxReplicas).toBe('');
    });
});

describe('hasResourceChange', () => {
    it('is false when nothing was edited', () => {
        expect(hasResourceChange(current, { ...current })).toBe(false);
    });

    it('notices a changed limit', () => {
        expect(
            hasResourceChange(current, { ...current, limits: { ...current.limits, cpu: '1' } }),
        ).toBe(true);
    });

    it('notices static IP being turned off', () => {
        expect(hasResourceChange(current, { ...current, staticIP: false })).toBe(true);
    });

    it('notices autoscaling being cleared', () => {
        expect(hasResourceChange(current, { ...current, maxReplicas: '' })).toBe(true);
    });
});

describe('buildEditArgs', () => {
    it('always re-sends --max-replicas, because omitting it disables autoscaling', () => {
        // edit.go sets Autoscaling = nil whenever --max-replicas is not > 0, on
        // every invocation. Editing a CPU limit must not silently turn it off.
        const next = { ...current, limits: { ...current.limits, cpu: '1' } };
        const args = buildEditArgs('production', current, next);

        expect(args).toContain('--max-replicas');
        expect(args[args.indexOf('--max-replicas') + 1]).toBe('5');
        expect(args).toContain('--resource.cpu.limits');
        expect(args[args.indexOf('--resource.cpu.limits') + 1]).toBe('1');
    });

    it('omits --max-replicas only when autoscaling is meant to be off', () => {
        const args = buildEditArgs('production', current, { ...current, maxReplicas: '' });
        expect(args).not.toContain('--max-replicas');
    });

    it('re-sends --replicas so a config write does not reset the count', () => {
        const next = { ...current, limits: { ...current.limits, memory: '1Gi' } };
        const args = buildEditArgs('production', current, next);
        expect(args[args.indexOf('--replicas') + 1]).toBe('2');
    });

    it('sends --service-account only when it changed, since empty removes it', () => {
        const unchanged = buildEditArgs('production', current, {
            ...current,
            limits: { ...current.limits, cpu: '1' },
        });
        expect(unchanged).not.toContain('--service-account');

        const cleared = buildEditArgs('production', current, { ...current, serviceAccount: '' });
        expect(cleared).toContain('--service-account');
        expect(cleared[cleared.indexOf('--service-account') + 1]).toBe('');
    });

    it('spells static IP with the only two literals the CLI accepts', () => {
        expect(buildEditArgs('production', current, { ...current, staticIP: false })).toContain(
            'disabled',
        );
        expect(
            buildEditArgs('production', { ...current, staticIP: false }, current),
        ).toContain('enabled');
    });

    it('names the environment and the command', () => {
        const args = buildEditArgs('production', current, { ...current, staticIP: false });
        expect(args.slice(0, 4)).toEqual(['projects', 'edit', '--environment', 'production']);
    });

    it('refuses an unchanged form rather than writing the config back', () => {
        expect(() => buildEditArgs('production', current, { ...current })).toThrow(
            /nothing to change/i,
        );
    });

    it('refuses a non-numeric replica count before the CLI sees it', () => {
        expect(() =>
            buildEditArgs('production', current, { ...current, replicas: 'two' }),
        ).toThrow(/replicas/i);
    });

    it('skips a resource value the user left blank, which the CLI ignores anyway', () => {
        const next = { ...current, requests: { ...current.requests, storage: '' } };
        expect(() => buildEditArgs('production', current, next)).toThrow(/nothing to change/i);
    });
});

describe('readResourceForm', () => {
    it('reads the flat form values back into a config', () => {
        expect(
            readResourceForm({
                replicas: '2',
                maxReplicas: '5',
                staticIP: true,
                serviceAccount: 'sync-sa',
                cpuLimit: '500m',
                memoryLimit: '512Mi',
                storageLimit: '1Gi',
                cpuRequest: '100m',
                memoryRequest: '200Mi',
                storageRequest: '',
            }),
        ).toEqual(current);
    });
});
