import { describe, expect, it } from 'vitest';

import {
    buildKvCountArgs,
    buildKvListArgs,
    KV_SCOPES,
    kvControls,
    validateKvScope,
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
