import { describe, expect, it } from 'vitest';

import {
    buildBindingListArgs,
    buildChannelCreateArgs,
    buildChannelListArgs,
    buildLinkArgs,
    buildUnlinkArgs,
    toBindingRows,
    toChannelRows,
} from './notifications';

// Field names from NotificationChannel / ProjectNotification in
// versori-api.yaml: snake_case throughout, except `channelName`.
const channel = {
    id: '01JCHANNEL',
    organisation_id: '01JORG',
    name: 'Ops on-call',
    type: 'email',
    config: { email: { to: 'ops@acme.test', cc: ['sre@acme.test'] } },
    created_at: '2026-04-01T09:00:00Z',
    updated_at: '2026-04-01T09:00:00Z',
};

const binding = {
    id: '01JBINDING',
    project_id: '01JPROJECT',
    environment_id: '01JENV',
    channel_id: '01JCHANNEL',
    name: 'production critical only',
    channelName: 'Ops on-call',
    type: 'email',
    config: { email: { to: 'ops@acme.test' } },
    created_at: '2026-04-01T09:00:00Z',
};

describe('toChannelRows', () => {
    it('reads the id, name and recipient out of the nested email config', () => {
        expect(toChannelRows({ items: [channel] })).toEqual([
            { id: '01JCHANNEL', name: 'Ops on-call', email: 'ops@acme.test' },
        ]);
    });

    it('falls back to the id when a channel has no name', () => {
        expect(toChannelRows([{ ...channel, name: '' }])[0].name).toBe('01JCHANNEL');
    });

    it('tolerates a channel with no email config', () => {
        expect(toChannelRows([{ id: '01JC', name: 'Slack', type: 'slack' }])[0].email).toBe('');
    });

    it('skips entries with no id, which cannot be linked', () => {
        expect(toChannelRows([{ name: 'orphan' }])).toEqual([]);
    });

    it('returns an empty list when there are no channels', () => {
        expect(toChannelRows(undefined)).toEqual([]);
    });
});

describe('toBindingRows', () => {
    it('reads the binding id, its label, the channel name and the recipient', () => {
        expect(toBindingRows({ items: [binding] })).toEqual([
            {
                id: '01JBINDING',
                name: 'production critical only',
                channelName: 'Ops on-call',
                email: 'ops@acme.test',
            },
        ]);
    });

    it('falls back to the channel name when the binding has no label of its own', () => {
        // `--name` defaults to the channel name, so this is the common case.
        expect(toBindingRows([{ ...binding, name: '' }])[0].name).toBe('Ops on-call');
    });

    it('skips entries with no id, which cannot be unlinked', () => {
        expect(toBindingRows([{ ...binding, id: '' }])).toEqual([]);
    });
});

describe('buildChannelListArgs', () => {
    it('is organisation-scoped, with no project flag', () => {
        expect(buildChannelListArgs()).toEqual(['notifications', 'channels', 'list']);
    });
});

describe('buildChannelCreateArgs', () => {
    it('names the channel and its primary recipient', () => {
        expect(
            buildChannelCreateArgs({ name: 'Ops on-call', email: 'ops@acme.test', cc: [] }),
        ).toEqual([
            'notifications',
            'channels',
            'create',
            '--name',
            'Ops on-call',
            '--email',
            'ops@acme.test',
        ]);
    });

    it('repeats --cc once per additional address', () => {
        expect(
            buildChannelCreateArgs({
                name: 'Ops',
                email: 'ops@acme.test',
                cc: ['sre@acme.test', 'lead@acme.test'],
            }),
        ).toEqual([
            'notifications',
            'channels',
            'create',
            '--name',
            'Ops',
            '--email',
            'ops@acme.test',
            '--cc',
            'sre@acme.test',
            '--cc',
            'lead@acme.test',
        ]);
    });

    it('requires a name, since the CLI would prompt and a spawned process would hang', () => {
        expect(() => buildChannelCreateArgs({ name: '', email: 'a@b.test', cc: [] })).toThrow(
            /name/i,
        );
    });

    it('requires an email — the CLI cannot derive one from a service-key token', () => {
        expect(() => buildChannelCreateArgs({ name: 'Ops', email: '', cc: [] })).toThrow(/email/i);
    });
});

describe('buildBindingListArgs', () => {
    it('filters bindings to one environment', () => {
        expect(buildBindingListArgs('production')).toEqual([
            'notifications',
            'project',
            'list',
            '--environment',
            'production',
        ]);
    });

    it('lists every environment when none is given', () => {
        expect(buildBindingListArgs('')).toEqual(['notifications', 'project', 'list']);
    });
});

describe('buildLinkArgs', () => {
    it('links a channel to a project environment', () => {
        expect(
            buildLinkArgs({ channelId: '01JCHANNEL', environment: 'production', severities: [] }),
        ).toEqual([
            'notifications',
            'project',
            'link',
            '--channel-id',
            '01JCHANNEL',
            '--environment',
            'production',
        ]);
    });

    it('passes severities as one comma-separated value', () => {
        expect(
            buildLinkArgs({
                channelId: '01JCHANNEL',
                environment: 'production',
                severities: ['critical', 'high'],
            }),
        ).toEqual([
            'notifications',
            'project',
            'link',
            '--channel-id',
            '01JCHANNEL',
            '--environment',
            'production',
            '--severity',
            'critical,high',
        ]);
    });

    it('passes the optional label and substring filters', () => {
        expect(
            buildLinkArgs({
                channelId: '01JCHANNEL',
                environment: 'production',
                name: 'crit only',
                severities: [],
                filterTitle: 'get-pricing',
                filterMessage: 'ECONNREFUSED',
            }),
        ).toEqual([
            'notifications',
            'project',
            'link',
            '--channel-id',
            '01JCHANNEL',
            '--environment',
            'production',
            '--name',
            'crit only',
            '--filter-title',
            'get-pricing',
            '--filter-message',
            'ECONNREFUSED',
        ]);
    });

    it('requires a channel and an environment, both of which the CLI would otherwise prompt for', () => {
        expect(() =>
            buildLinkArgs({ channelId: '', environment: 'production', severities: [] }),
        ).toThrow(/channel/i);
        expect(() => buildLinkArgs({ channelId: '01JC', environment: '', severities: [] })).toThrow(
            /environment/i,
        );
    });
});

describe('buildUnlinkArgs', () => {
    it('names the binding and its environment, and skips the terminal prompt', () => {
        expect(buildUnlinkArgs('01JBINDING', 'production')).toEqual([
            'notifications',
            'project',
            'unlink',
            '--notification-id',
            '01JBINDING',
            '--environment',
            'production',
            '--yes',
        ]);
    });

    it('requires both, since a spawned CLI cannot answer a picker', () => {
        expect(() => buildUnlinkArgs('', 'production')).toThrow(/notification/i);
        expect(() => buildUnlinkArgs('01JB', '')).toThrow(/environment/i);
    });
});
