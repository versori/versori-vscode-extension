import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalContextResolver } from './local';

/**
 * Precedence cases ported from pkg/cmd/config/config_test.go in the cli repo.
 * These exist to catch drift between this TypeScript resolver and the Go one.
 */

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'versori-vscode-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function writeVersori(dir: string, contents: Record<string, unknown> | string): string {
    fs.mkdirSync(dir, { recursive: true });
    const body = typeof contents === 'string' ? contents : JSON.stringify(contents);
    fs.writeFileSync(path.join(dir, '.versori'), body);
    return dir;
}

function writeConfig(activeContext?: string): string {
    const configPath = path.join(root, 'config.yaml');
    fs.writeFileSync(
        configPath,
        activeContext === undefined ? 'contexts: []\n' : `active_context: ${activeContext}\n`,
    );
    return configPath;
}

function resolverFor(configPath: string) {
    return new LocalContextResolver({ configPath });
}

describe('context precedence', () => {
    it('pinned .versori context wins over the active context', () => {
        const dir = writeVersori(path.join(root, 'proj'), {
            project_id: '01PROJ',
            context: 'project-ctx',
        });

        const state = resolverFor(writeConfig('active-ctx')).resolve(dir);

        expect(state.source).toBe('versori-file');
        expect(state.contextName).toBe('project-ctx');
        expect(state.activeContextName).toBe('active-ctx');
        expect(state.projectId).toBe('01PROJ');
        expect(state.overridesActive).toBe(true);
    });

    it('does not flag an override when .versori matches the active context', () => {
        const dir = writeVersori(path.join(root, 'proj'), {
            project_id: '01PROJ',
            context: 'same-ctx',
        });

        const state = resolverFor(writeConfig('same-ctx')).resolve(dir);

        expect(state.source).toBe('versori-file');
        expect(state.overridesActive).toBe(false);
    });

    it('falls back to the active context outside any project', () => {
        const dir = path.join(root, 'not-a-project');
        fs.mkdirSync(dir, { recursive: true });

        const state = resolverFor(writeConfig('active-ctx')).resolve(dir);

        expect(state.source).toBe('active');
        expect(state.contextName).toBe('active-ctx');
        expect(state.projectId).toBeUndefined();
        expect(state.overridesActive).toBe(false);
    });

    it('keeps the project id but falls through when .versori pins no context', () => {
        // config.go:253 requires BOTH fields before the override applies.
        const dir = writeVersori(path.join(root, 'proj'), { project_id: '01PROJ' });

        const state = resolverFor(writeConfig('active-ctx')).resolve(dir);

        expect(state.source).toBe('active');
        expect(state.contextName).toBe('active-ctx');
        expect(state.projectId).toBe('01PROJ');
        expect(state.overridesActive).toBe(false);
    });

    it('ignores a .versori that pins a context but no project id', () => {
        const dir = writeVersori(path.join(root, 'proj'), { context: 'project-ctx' });

        const state = resolverFor(writeConfig('active-ctx')).resolve(dir);

        expect(state.source).toBe('active');
        expect(state.contextName).toBe('active-ctx');
        expect(state.projectId).toBeUndefined();
    });

    it('reports none when there is no project and no active context', () => {
        const dir = path.join(root, 'bare');
        fs.mkdirSync(dir, { recursive: true });

        const state = resolverFor(writeConfig(undefined)).resolve(dir);

        expect(state.source).toBe('none');
        expect(state.contextName).toBeUndefined();
    });

    it('treats a missing CLI config as no active context', () => {
        const dir = path.join(root, 'bare');
        fs.mkdirSync(dir, { recursive: true });

        const state = resolverFor(path.join(root, 'does-not-exist.yaml')).resolve(dir);

        expect(state.source).toBe('none');
    });
});

describe('walk-up', () => {
    it('finds .versori from a nested file directory', () => {
        const proj = writeVersori(path.join(root, 'proj'), {
            project_id: '01PROJ',
            context: 'ctx',
        });
        const nested = path.join(proj, 'src', 'workflows');
        fs.mkdirSync(nested, { recursive: true });

        const state = resolverFor(writeConfig('active')).resolve(nested);

        expect(state.projectId).toBe('01PROJ');
        expect(state.projectDir).toBe(proj);
    });

    it('picks the nearest .versori when projects are nested', () => {
        const outer = writeVersori(path.join(root, 'outer'), {
            project_id: '01OUTER',
            context: 'outer-ctx',
        });
        const inner = writeVersori(path.join(outer, 'inner'), {
            project_id: '01INNER',
            context: 'inner-ctx',
        });

        const state = resolverFor(writeConfig('active')).resolve(inner);

        expect(state.projectId).toBe('01INNER');
        expect(state.contextName).toBe('inner-ctx');
    });

    it('stops at the workspace folder boundary', () => {
        const projRoot = writeVersori(path.join(root, 'ws'), {
            project_id: '01PROJ',
            context: 'ctx',
        });
        const folder = path.join(projRoot, 'sub');
        fs.mkdirSync(folder, { recursive: true });

        // Boundary at `sub` means the .versori one level up is out of scope.
        const state = resolverFor(writeConfig('active-ctx')).resolve(folder, folder);

        expect(state.projectId).toBeUndefined();
        expect(state.source).toBe('active');
    });

    it('resolves separate sibling projects independently', () => {
        const a = writeVersori(path.join(root, 'a'), { project_id: '01A', context: 'ctx-a' });
        const b = writeVersori(path.join(root, 'b'), { project_id: '01B', context: 'ctx-b' });
        const resolver = resolverFor(writeConfig('active'));

        expect(resolver.resolve(a).projectId).toBe('01A');
        expect(resolver.resolve(b).projectId).toBe('01B');
    });

    it('returns the active context when no start directory is given', () => {
        const state = resolverFor(writeConfig('active-ctx')).resolve(undefined);

        expect(state.source).toBe('active');
        expect(state.contextName).toBe('active-ctx');
    });
});

describe('resilience', () => {
    it('treats a malformed .versori as no project instead of throwing', () => {
        const dir = writeVersori(path.join(root, 'proj'), '{ not json');
        const messages: string[] = [];

        const state = new LocalContextResolver({
            configPath: writeConfig('active-ctx'),
            log: (m) => messages.push(m),
        }).resolve(dir);

        expect(state.source).toBe('active');
        expect(state.projectId).toBeUndefined();
        expect(messages.some((m) => m.includes('malformed'))).toBe(true);
    });

    it('does not log anything for an absent CLI config', () => {
        const messages: string[] = [];

        new LocalContextResolver({
            configPath: path.join(root, 'nope.yaml'),
            log: (m) => messages.push(m),
        }).resolve(root);

        expect(messages).toEqual([]);
    });
});

describe('caching', () => {
    it('serves repeat lookups from cache and refreshes after invalidate', () => {
        const dir = writeVersori(path.join(root, 'proj'), {
            project_id: '01FIRST',
            context: 'ctx',
        });
        const resolver = resolverFor(writeConfig('active'));

        expect(resolver.resolve(dir).projectId).toBe('01FIRST');

        writeVersori(dir, { project_id: '01SECOND', context: 'ctx' });
        expect(resolver.resolve(dir).projectId).toBe('01FIRST'); // still cached

        resolver.invalidate();
        expect(resolver.resolve(dir).projectId).toBe('01SECOND');
    });
});
