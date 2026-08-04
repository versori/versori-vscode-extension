import { describe, expect, it } from 'vitest';

import { ResolvedState } from '../resolver/types';
import { contextFor, projectArgs } from './target';

const pinned: ResolvedState = {
    projectId: '01JPROJECT',
    projectDir: '/w/shopify-sync',
    contextName: 'acme',
    activeContextName: 'other',
    source: 'versori-file',
    overridesActive: true,
};

const active: ResolvedState = {
    projectId: '01JPROJECT',
    projectDir: '/w/shopify-sync',
    contextName: 'acme',
    activeContextName: 'acme',
    source: 'active',
    overridesActive: false,
};

describe('projectArgs', () => {
    it('names the project explicitly when one is resolved', () => {
        expect(projectArgs(pinned)).toEqual(['--project', '01JPROJECT']);
    });

    it('emits nothing outside a project', () => {
        expect(projectArgs({ source: 'none', overridesActive: false })).toEqual([]);
    });
});

describe('contextFor', () => {
    it('states the pinned context, so positional-argument commands hit the right org', () => {
        expect(contextFor(pinned)).toBe('acme');
    });

    it('returns undefined when the context came from the active config', () => {
        // Passing --context here would be a no-op; leaving it off keeps the argv honest.
        expect(contextFor(active)).toBeUndefined();
    });

    it('returns undefined when no context is configured at all', () => {
        expect(contextFor({ source: 'none', overridesActive: false })).toBeUndefined();
    });
});
