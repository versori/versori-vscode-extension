import { describe, expect, it } from 'vitest';

import {
    buildKvCountArgs,
    buildKvDeleteArgs,
    buildKvListArgs,
    buildKvScopeArgs,
    buildKvSetArgs,
    buildKvTargetArgs,
    buildKvWipeArgs,
    encodeKvValue,
    effectiveKvLimit,
    isKvMessageTooLarge,
    KV_SCOPES,
    kvControls,
    kvPrefixSegments,
    shouldRetryKvListWithLimitOne,
    validateKvKey,
    validateKvScope,
    validateKvWipePrefix,
} from './args';

const base = {
    environment: 'production',
    scope: 'project',
    prefix: '',
    limit: 50,
    keys: 'stripped',
    values: 'unwrapped',
    externalId: '',
    executionId: '',
};

describe('KV_SCOPES', () => {
    it('offers exactly the scopes the CLI accepts', () => {
        expect(KV_SCOPES.map((s) => s.value)).toEqual([
            'organization',
            'workspace',
            'project',
            'user',
            'execution',
        ]);
    });
});

describe('isKvMessageTooLarge', () => {
    it('matches the platform gRPC size rejection', () => {
        expect(
            isKvMessageTooLarge(
                'API Message: grpc: received message larger than max (11825726 vs. 4194304)',
            ),
        ).toBe(true);
    });

    it('ignores unrelated list failures', () => {
        expect(isKvMessageTooLarge('failed to list KV entries\nstore not found')).toBe(false);
    });
});

describe('effectiveKvLimit', () => {
    it('returns 0 when the flag would be omitted', () => {
        expect(effectiveKvLimit({ ...base, limit: 0 })).toBe(0);
    });

    it('caps at the server maximum of 100', () => {
        expect(effectiveKvLimit({ ...base, limit: 500 })).toBe(100);
    });
});

describe('shouldRetryKvListWithLimitOne', () => {
    const oversized =
        'Message:\n  failed to list KV entries\nReason:\n  API Message: grpc: received message larger than max (11825726 vs. 4194304)';

    it('retries when a larger page hit the size ceiling', () => {
        expect(shouldRetryKvListWithLimitOne({ ...base, limit: 50 }, oversized)).toBe(true);
    });

    it('retries when the server default (no --limit) hit the ceiling', () => {
        expect(shouldRetryKvListWithLimitOne({ ...base, limit: 0 }, oversized)).toBe(true);
    });

    it('does not retry when already at --limit 1', () => {
        expect(shouldRetryKvListWithLimitOne({ ...base, limit: 1 }, oversized)).toBe(false);
    });

    it('does not retry for other errors', () => {
        expect(shouldRetryKvListWithLimitOne({ ...base, limit: 50 }, 'permission denied')).toBe(
            false,
        );
    });
});

describe('kvControls', () => {
    it('reveals --external-id only for the user scope', () => {
        const control = kvControls(['production']).find((c) => c.id === 'externalId');
        expect(control && 'showWhen' in control && control.showWhen).toEqual({
            field: 'scope',
            equals: 'user',
        });
    });

    it('reveals --execution-id only for the execution scope', () => {
        const control = kvControls(['production']).find((c) => c.id === 'executionId');
        expect(control && 'showWhen' in control && control.showWhen).toEqual({
            field: 'scope',
            equals: 'execution',
        });
    });

    it('offers no mutating control — this browser is read-only', () => {
        const ids = kvControls(['production']).map((c) => c.id);
        expect(ids).not.toContain('value');
        expect(ids).not.toContain('key');
    });
});

describe('buildKvListArgs', () => {
    it('targets a scope in friendly mode, with the environment', () => {
        expect(buildKvListArgs(base)).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--limit',
            '50',
        ]);
    });

    it('splits a slash-delimited prefix into repeated --prefix segments', () => {
        expect(buildKvListArgs({ ...base, prefix: 'orders/cursor' })).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
            '--prefix',
            'cursor',
            '--limit',
            '50',
        ]);
    });

    it('ignores empty prefix segments from a stray slash', () => {
        expect(buildKvListArgs({ ...base, prefix: '/orders//' })).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
            '--limit',
            '50',
        ]);
    });

    it('passes --external-id for the user scope', () => {
        expect(buildKvListArgs({ ...base, scope: 'user', externalId: 'cust-1' })).toContain(
            '--external-id',
        );
    });

    it('passes --execution-id for the execution scope', () => {
        expect(buildKvListArgs({ ...base, scope: 'execution', executionId: '01JEXEC' })).toContain(
            '--execution-id',
        );
    });

    it('does not leak a user id into another scope', () => {
        expect(buildKvListArgs({ ...base, scope: 'project', externalId: 'cust-1' })).not.toContain(
            '--external-id',
        );
    });

    it('asks for full keys when chosen', () => {
        expect(buildKvListArgs({ ...base, keys: 'full' })).toContain('--full-keys');
    });

    it('asks for raw values when chosen', () => {
        expect(buildKvListArgs({ ...base, values: 'raw' })).toContain('--raw-values');
    });

    it('caps the limit at 100, which is the server maximum', () => {
        const args = buildKvListArgs({ ...base, limit: 500 });
        expect(args[args.indexOf('--limit') + 1]).toBe('100');
    });

    it('omits --limit when zero, letting the server default apply', () => {
        expect(buildKvListArgs({ ...base, limit: 0 })).not.toContain('--limit');
    });

    it('never emits a mutating flag', () => {
        const args = buildKvListArgs({ ...base, prefix: 'orders' });
        expect(args).not.toContain('--value');
        expect(args).not.toContain('--confirm');
    });
});

describe('buildKvListArgs cursors', () => {
    it('sends no cursor flag for the first page', () => {
        const args = buildKvListArgs(base);
        expect(args).not.toContain('--after');
        expect(args).not.toContain('--before');
    });

    it('passes a nextCursor verbatim to --after', () => {
        const args = buildKvListArgs(base, { after: 'opaque//cursor==' });
        expect(args.slice(-2)).toEqual(['--after', 'opaque//cursor==']);
    });

    it('passes a prevCursor verbatim to --before', () => {
        const args = buildKvListArgs(base, { before: 'opaque//prev==' });
        expect(args.slice(-2)).toEqual(['--before', 'opaque//prev==']);
    });

    it('does not trim or rewrite a cursor, which is opaque to us', () => {
        const args = buildKvListArgs(base, { after: '  padded  ' });
        expect(args.at(-1)).toBe('  padded  ');
    });

    it('ignores an empty cursor, which the CLI documents as "no more entries"', () => {
        expect(buildKvListArgs(base, { after: '' })).not.toContain('--after');
        expect(buildKvListArgs(base, { before: '' })).not.toContain('--before');
    });

    it('sends only --after when both are somehow set, since they are exclusive', () => {
        const args = buildKvListArgs(base, { after: 'a', before: 'b' });
        expect(args).toContain('--after');
        expect(args).not.toContain('--before');
    });
});

describe('buildKvCountArgs', () => {
    it('targets exactly what the list query targets, so the total matches the view', () => {
        expect(buildKvCountArgs({ ...base, prefix: 'orders/cursor' })).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
            '--prefix',
            'cursor',
        ]);
    });

    it('sends no --limit: kv count returns a total, not a capped page', () => {
        expect(buildKvCountArgs({ ...base, limit: 50 })).not.toContain('--limit');
    });

    it('sends no cursor, because kv count does not paginate', () => {
        const args = buildKvCountArgs(base);
        expect(args).not.toContain('--after');
        expect(args).not.toContain('--before');
    });

    it('sends no --raw-values, which `kv count` does not register at all', () => {
        expect(buildKvCountArgs({ ...base, values: 'raw' })).not.toContain('--raw-values');
    });

    it('sends no --full-keys, which cannot change a total', () => {
        expect(buildKvCountArgs({ ...base, keys: 'full' })).not.toContain('--full-keys');
    });

    it('passes --external-id for the user scope', () => {
        expect(buildKvCountArgs({ ...base, scope: 'user', externalId: 'cust-1' })).toContain(
            '--external-id',
        );
    });

    it('passes --execution-id for the execution scope', () => {
        expect(buildKvCountArgs({ ...base, scope: 'execution', executionId: '01JEXEC' })).toContain(
            '--execution-id',
        );
    });

    it('does not leak a user id into another scope', () => {
        expect(buildKvCountArgs({ ...base, scope: 'project', externalId: 'cust-1' })).not.toContain(
            '--external-id',
        );
    });

    it('ignores empty prefix segments from a stray slash', () => {
        expect(buildKvCountArgs({ ...base, prefix: '/orders//' })).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
        ]);
    });

    it('shares its targeting with the list query rather than restating it', () => {
        // The prefix of the list args, up to where paging and display flags start.
        const list = buildKvListArgs({ ...base, prefix: 'orders' });
        const count = buildKvCountArgs({ ...base, prefix: 'orders' });
        expect(list.slice(0, count.length)).toEqual(count);
    });
});

describe('validateKvScope', () => {
    it('accepts a project scope with no extra identifier', () => {
        expect(validateKvScope(base)).toBeUndefined();
    });

    it('requires an external id for the user scope', () => {
        expect(validateKvScope({ ...base, scope: 'user' })).toMatch(/external id/i);
        expect(validateKvScope({ ...base, scope: 'user', externalId: 'cust-1' })).toBeUndefined();
    });

    it('requires an execution id for the execution scope', () => {
        expect(validateKvScope({ ...base, scope: 'execution' })).toMatch(/execution id/i);
        expect(
            validateKvScope({ ...base, scope: 'execution', executionId: '01JEXEC' }),
        ).toBeUndefined();
    });
});

describe('validateKvKey', () => {
    it('rejects a blank key', () => {
        expect(validateKvKey('')).toMatch(/blank/i);
        expect(validateKvKey('   ')).toMatch(/blank/i);
    });

    it('accepts a non-empty key', () => {
        expect(validateKvKey('orders/cursor')).toBeUndefined();
    });
});

describe('validateKvWipePrefix', () => {
    it('rejects an empty prefix so a wipe cannot target an entire scope', () => {
        expect(validateKvWipePrefix({ ...base, prefix: '' })).toMatch(/non-empty/i);
        expect(validateKvWipePrefix({ ...base, prefix: '///' })).toMatch(/non-empty/i);
    });

    it('accepts a real prefix', () => {
        expect(validateKvWipePrefix({ ...base, prefix: 'orders/cursor' })).toBeUndefined();
    });
});

describe('kvPrefixSegments / buildKvScopeArgs / buildKvTargetArgs', () => {
    it('drops empty prefix segments', () => {
        expect(kvPrefixSegments({ ...base, prefix: '/orders//' })).toEqual(['orders']);
    });

    it('keeps scope targeting without prefix for set/delete', () => {
        expect(buildKvScopeArgs({ ...base, prefix: 'orders' })).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
        ]);
    });

    it('adds prefix segments for list/count/wipe targeting', () => {
        expect(buildKvTargetArgs({ ...base, prefix: 'orders/cursor' })).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
            '--prefix',
            'cursor',
        ]);
    });
});

describe('buildKvSetArgs', () => {
    it('targets the scope, passes key/value, and always includes --yes', () => {
        expect(
            buildKvSetArgs(base, { key: 'orders/cursor', value: '{"n":1}' }),
        ).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--key',
            'orders/cursor',
            '--value',
            '{"n":1}',
            '--yes',
        ]);
    });

    it('stores a plain string value the same way the CLI would', () => {
        expect(buildKvSetArgs(base, { key: 'flag', value: 'hello' })).toContain('hello');
    });

    it('encodes an intentional blank string so the CLI accepts it', () => {
        expect(encodeKvValue('')).toBe('""');
        expect(buildKvSetArgs(base, { key: 'blank', value: '' })).toContain('""');
    });

    it('adds --expire-in only for a positive TTL', () => {
        const withTtl = buildKvSetArgs(base, { key: 'k', value: 'v', expireInMs: 60_000 });
        expect(withTtl).toEqual(expect.arrayContaining(['--expire-in', '60000']));
        expect(buildKvSetArgs(base, { key: 'k', value: 'v', expireInMs: 0 })).not.toContain(
            '--expire-in',
        );
    });

    it('adds --if-not-exists when requested', () => {
        expect(
            buildKvSetArgs(base, { key: 'k', value: 'v', ifNotExists: true }),
        ).toContain('--if-not-exists');
    });

    it('does not leak the list prefix into set', () => {
        expect(buildKvSetArgs({ ...base, prefix: 'orders' }, { key: 'k', value: 'v' })).not.toContain(
            '--prefix',
        );
    });

    it('rejects a blank key', () => {
        expect(() => buildKvSetArgs(base, { key: '  ', value: 'v' })).toThrow(/blank/i);
    });

    it('passes --external-id for the user scope', () => {
        expect(
            buildKvSetArgs(
                { ...base, scope: 'user', externalId: 'cust-1' },
                { key: 'k', value: 'v' },
            ),
        ).toEqual(expect.arrayContaining(['--external-id', 'cust-1']));
    });
});

describe('buildKvDeleteArgs', () => {
    it('targets the scope, passes the key, and always includes --yes', () => {
        expect(buildKvDeleteArgs(base, 'orders/cursor')).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--key',
            'orders/cursor',
            '--yes',
        ]);
    });

    it('does not leak the list prefix into delete', () => {
        expect(buildKvDeleteArgs({ ...base, prefix: 'orders' }, 'k')).not.toContain('--prefix');
    });

    it('rejects a blank key', () => {
        expect(() => buildKvDeleteArgs(base, '')).toThrow(/blank/i);
    });
});

describe('buildKvWipeArgs', () => {
    it('builds a dry-run without --confirm', () => {
        expect(buildKvWipeArgs({ ...base, prefix: 'orders' }, false)).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
        ]);
    });

    it('adds --confirm only when asked', () => {
        expect(buildKvWipeArgs({ ...base, prefix: 'orders' }, true)).toEqual([
            '--scope',
            'project',
            '--environment',
            'production',
            '--prefix',
            'orders',
            '--confirm',
        ]);
    });

    it('rejects an empty wipe prefix before the CLI is spawned', () => {
        expect(() => buildKvWipeArgs({ ...base, prefix: '' }, true)).toThrow(/non-empty/i);
    });
});
