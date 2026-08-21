import { describe, expect, it } from 'vitest';

import {
    buildEditArgs,
    configFromEditor,
    cpuControl,
    countControl,
    editorFromConfig,
    EMPTY_CONFIG,
    formatCpu,
    formatSizeDisplay,
    formatSizePayload,
    hasResourceChange,
    parseCpuMillicores,
    parseSizeToMb,
    readResourceConfig,
    readResourceForm,
    ResourceConfig,
    sizeControl,
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

/** The id `.versori` holds, passed explicitly rather than left to the CLI's cwd lookup. */
const PROJECT = '01JPROJECT';

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
        const args = buildEditArgs('production', current, next, PROJECT);

        expect(args).toContain('--max-replicas');
        expect(args[args.indexOf('--max-replicas') + 1]).toBe('5');
        expect(args).toContain('--resource.cpu.limits');
        expect(args[args.indexOf('--resource.cpu.limits') + 1]).toBe('1');
    });

    it('omits --max-replicas only when autoscaling is meant to be off', () => {
        const args = buildEditArgs('production', current, { ...current, maxReplicas: '' }, PROJECT);
        expect(args).not.toContain('--max-replicas');
    });

    it('re-sends --replicas so a config write does not reset the count', () => {
        const next = { ...current, limits: { ...current.limits, memory: '1Gi' } };
        const args = buildEditArgs('production', current, next, PROJECT);
        expect(args[args.indexOf('--replicas') + 1]).toBe('2');
    });

    it('sends --service-account only when it changed, since empty removes it', () => {
        const unchanged = buildEditArgs(
            'production',
            current,
            { ...current, limits: { ...current.limits, cpu: '1' } },
            PROJECT,
        );
        expect(unchanged).not.toContain('--service-account');

        const cleared = buildEditArgs(
            'production',
            current,
            { ...current, serviceAccount: '' },
            PROJECT,
        );
        expect(cleared).toContain('--service-account');
        expect(cleared[cleared.indexOf('--service-account') + 1]).toBe('');
    });

    it('spells static IP with the only two literals the CLI accepts', () => {
        expect(
            buildEditArgs('production', current, { ...current, staticIP: false }, PROJECT),
        ).toContain('disabled');
        expect(
            buildEditArgs('production', { ...current, staticIP: false }, current, PROJECT),
        ).toContain('enabled');
    });

    it('names the project, the environment and the command', () => {
        // `--project` is not optional politeness: without it `projects edit`
        // resolves the project from cwd's .versori, so a file edited while the
        // panel was open would send this write to a different project than the
        // one the panel read its current values from.
        const args = buildEditArgs('production', current, { ...current, staticIP: false }, PROJECT);
        expect(args.slice(0, 6)).toEqual([
            'projects',
            'edit',
            '--project',
            '01JPROJECT',
            '--environment',
            'production',
        ]);
    });

    it('omits --project when the id is unknown, as the other builders do', () => {
        const args = buildEditArgs(
            'production',
            current,
            { ...current, staticIP: false },
            undefined,
        );
        expect(args).not.toContain('--project');
        expect(args.slice(0, 4)).toEqual(['projects', 'edit', '--environment', 'production']);
    });

    it('refuses an unchanged form rather than writing the config back', () => {
        expect(() => buildEditArgs('production', current, { ...current }, PROJECT)).toThrow(
            /nothing to change/i,
        );
    });

    it('refuses a non-numeric replica count before the CLI sees it', () => {
        expect(() =>
            buildEditArgs('production', current, { ...current, replicas: 'two' }, PROJECT),
        ).toThrow(/replicas/i);
    });

    it('skips a resource value the user left blank, which the CLI ignores anyway', () => {
        const next = { ...current, requests: { ...current.requests, storage: '' } };
        expect(() => buildEditArgs('production', current, next, PROJECT)).toThrow(
            /nothing to change/i,
        );
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

describe('quantity conversion', () => {
    it('parses millicores and whole cores', () => {
        expect(parseCpuMillicores('170m')).toBe(170);
        expect(parseCpuMillicores('1')).toBe(1000);
        expect(parseCpuMillicores('nope')).toBeUndefined();
    });

    it('parses binary and decimal size suffixes to megabytes', () => {
        expect(parseSizeToMb('200M')).toBe(200);
        expect(parseSizeToMb('1G')).toBe(1000);
        expect(parseSizeToMb('1Gi')).toBeCloseTo(1073.741824, 5);
        expect(parseSizeToMb('not-a-size')).toBeUndefined();
    });

    it('keeps in-range stepped CPU on the slider', () => {
        expect(cpuControl('170m')).toEqual({ mode: 'slider', value: 170 });
        expect(cpuControl('500m')).toEqual({ mode: 'slider', value: 500 });
    });

    it('does not clamp out-of-range or off-step CPU into the slider', () => {
        expect(cpuControl('600m')).toEqual({ mode: 'custom', raw: '600m' });
        expect(cpuControl('175m')).toEqual({ mode: 'custom', raw: '175m' });
        expect(cpuControl('')).toEqual({ mode: 'unset' });
        expect(cpuControl('lots')).toEqual({ mode: 'custom', raw: 'lots' });
    });

    it('keeps Mi quantities custom when they are not an exact MB step', () => {
        // 512Mi ≈ 536.87 MB — inside 200–2000, but not on a 50 MB step.
        expect(sizeControl('512Mi', 200, 2000, 50)).toEqual({ mode: 'custom', raw: '512Mi' });
        expect(sizeControl('200M', 200, 2000, 50)).toEqual({ mode: 'slider', value: 200 });
        expect(sizeControl('3G', 200, 2000, 50)).toEqual({ mode: 'custom', raw: '3G' });
    });

    it('keeps replica counts outside 1–3 as custom, and blank as unset', () => {
        expect(countControl('2', 1, 3)).toEqual({ mode: 'slider', value: 2 });
        expect(countControl('5', 1, 3)).toEqual({ mode: 'custom', raw: '5' });
        expect(countControl('', 1, 3)).toEqual({ mode: 'unset' });
    });

    it('formats slider values the way the web Environment Config does', () => {
        expect(formatCpu(170)).toBe('170m');
        expect(formatSizePayload(200)).toBe('200M');
        expect(formatSizeDisplay(200)).toBe('200 MiB');
        expect(formatSizeDisplay(2000)).toBe('2 GiB');
    });
});

describe('editorFromConfig / configFromEditor', () => {
    it('round-trips slider-friendly values without inventing blanks', () => {
        const friendly: ResourceConfig = {
            replicas: '2',
            maxReplicas: '3',
            staticIP: false,
            serviceAccount: 'sa',
            limits: { cpu: '170m', memory: '200M', storage: '100M' },
            requests: { cpu: '50m', memory: '100Mi', storage: '' },
        };
        const editor = editorFromConfig(friendly);
        expect(editor.cpu).toEqual({ mode: 'slider', value: 170 });
        expect(editor.memory).toEqual({ mode: 'slider', value: 200 });
        expect(editor.storage).toEqual({ mode: 'slider', value: 100 });
        expect(editor.replicas).toEqual({ mode: 'slider', value: 2 });
        expect(editor.maxReplicas).toEqual({ mode: 'slider', value: 3 });
        expect(editor.requests).toEqual(friendly.requests);
        expect(configFromEditor(editor)).toEqual(friendly);
    });

    it('preserves out-of-range limits, requests, and service account on Apply', () => {
        const editor = editorFromConfig(current);
        expect(editor.cpu).toEqual({ mode: 'slider', value: 500 });
        expect(editor.memory).toEqual({ mode: 'custom', raw: '512Mi' });
        expect(editor.storage).toEqual({ mode: 'custom', raw: '1Gi' });
        expect(editor.maxReplicas).toEqual({ mode: 'custom', raw: '5' });
        expect(editor.serviceAccount).toBe('sync-sa');
        expect(editor.requests).toEqual(current.requests);

        const next = configFromEditor({
            ...editor,
            cpu: { mode: 'slider', value: 200 },
        });
        expect(next.limits.cpu).toBe('200m');
        expect(next.limits.memory).toBe('512Mi');
        expect(next.limits.storage).toBe('1Gi');
        expect(next.maxReplicas).toBe('5');
        expect(next.serviceAccount).toBe('sync-sa');
        expect(next.requests).toEqual(current.requests);

        const args = buildEditArgs('production', current, next, PROJECT);
        expect(args[args.indexOf('--resource.cpu.limits') + 1]).toBe('200m');
        expect(args[args.indexOf('--max-replicas') + 1]).toBe('5');
        expect(args).not.toContain('--service-account');
    });

    it('leaves unset quantities blank instead of substituting defaults', () => {
        const editor = editorFromConfig(EMPTY_CONFIG);
        expect(editor.cpu).toEqual({ mode: 'unset' });
        expect(editor.maxReplicas).toEqual({ mode: 'unset' });
        expect(configFromEditor(editor)).toEqual(EMPTY_CONFIG);
    });
});
