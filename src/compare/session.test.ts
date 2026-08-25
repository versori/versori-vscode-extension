import { describe, expect, it } from 'vitest';

import { CompareDirection } from './changes';
import { ComparePair } from './pairs';
import {
    COMPARE_SESSION_KEY,
    CompareSessionMemento,
    LastCompare,
    createCompareSessionStore,
    parseStoredCompareSession,
} from './session';

const session: LastCompare = {
    projectDir: '/work/shopify',
    sidecar: '/work/shopify/.versori-compare-v1',
    versionName: 'v1',
    versionTimestamp: '2026-08-24T12:00:00Z',
    pairs: [{ relativePath: 'src/app.ts', workingExists: true, sidecarExists: true }],
    direction: 'version-to-working',
};

function memoryMemento(initial?: unknown): CompareSessionMemento & { raw(): unknown } {
    let stored: unknown = initial;
    return {
        get(key: string): unknown {
            return key === COMPARE_SESSION_KEY ? stored : undefined;
        },
        update(key: string, value: LastCompare): void {
            if (key === COMPARE_SESSION_KEY) {
                stored = JSON.parse(JSON.stringify(value));
            }
        },
        raw: () => stored,
    };
}

function allExist(filePath: string): boolean {
    return filePath === session.projectDir || filePath === session.sidecar;
}

describe('createCompareSessionStore', () => {
    it('round-trips a session through a fake store', async () => {
        const memento = memoryMemento();
        const store = createCompareSessionStore(memento, allExist);

        await store.save(session);

        expect(store.get()).toEqual(session);
        expect(memento.raw()).toEqual(session);
    });

    it('rejects a stored session whose sidecar path no longer exists', async () => {
        const memento = memoryMemento();
        const store = createCompareSessionStore(memento, (filePath) => filePath === session.projectDir);

        await store.save(session);

        expect(store.get()).toBeUndefined();
    });

    it('rejects a malformed stored value without throwing', () => {
        const garbage = [
            'garbage',
            42,
            null,
            ['not', 'an', 'object'],
            { projectDir: '/work/shopify' },
            { ...session, pairs: [{ relativePath: 'src/app.ts' }] },
            { ...session, direction: 'sideways' },
            { ...session, projectDir: '' },
        ];

        for (const value of garbage) {
            const store = createCompareSessionStore(memoryMemento(value), allExist);
            expect(() => store.get()).not.toThrow();
            expect(store.get()).toBeUndefined();
        }
    });

    it('returns undefined when nothing is stored', () => {
        const store = createCompareSessionStore(memoryMemento(), allExist);

        expect(store.get()).toBeUndefined();
    });
});

describe('parseStoredCompareSession', () => {
    it('rebuilds a clean session and drops unknown fields', () => {
        const parsed = parseStoredCompareSession({
            ...session,
            extra: true,
            pairs: session.pairs.map((pair) => ({ ...pair, extra: 1 })),
        });

        expect(parsed).toEqual(session);
    });

    it('accepts an empty version timestamp', () => {
        expect(parseStoredCompareSession({ ...session, versionTimestamp: '' })).toEqual({
            ...session,
            versionTimestamp: '',
        });
    });

    it('rejects a pair list that is empty or not pairs', () => {
        expect(parseStoredCompareSession({ ...session, pairs: [] })).toBeUndefined();
        expect(parseStoredCompareSession({ ...session, pairs: 'src/app.ts' })).toBeUndefined();
    });
});

describe('LastCompare serialisable shape', () => {
    it('round-trips through JSON as plain strings, booleans, and pairs', () => {
        const revived = JSON.parse(JSON.stringify(session)) as LastCompare;
        const pair: ComparePair = revived.pairs[0];
        const direction: CompareDirection = revived.direction;

        expect(revived).toEqual(session);
        expect(typeof revived.projectDir).toBe('string');
        expect(typeof revived.sidecar).toBe('string');
        expect(typeof revived.versionName).toBe('string');
        expect(typeof revived.versionTimestamp).toBe('string');
        expect(typeof pair.relativePath).toBe('string');
        expect(typeof pair.workingExists).toBe('boolean');
        expect(typeof pair.sidecarExists).toBe('boolean');
        expect(direction).toBe('version-to-working');
    });
});
