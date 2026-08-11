import { Row, unwrapRows } from '../results/rows';

export interface ChannelRow {
    id: string;
    name: string;
    email: string;
}

export interface BindingRow {
    id: string;
    /** The binding's own label; defaults to the channel name server-side. */
    name: string;
    channelName: string;
    email: string;
}

/**
 * Organisation-wide notification channels.
 *
 * Prefer the CLI's printable JSON (`versori notifications channels list -o json`):
 * `{ type: "printableChannel", items: [{ id, name, type, to }] }`. Also accept
 * the raw API `NotificationChannel` shape (`config.email.to`) so a future
 * printer change does not blank the QuickPick descriptions again.
 */
export function toChannelRows(raw: unknown): ChannelRow[] {
    return unwrapRows(raw)
        .map((row) => {
            const id = text(row.id);
            if (!id) {
                return undefined;
            }
            return { id, name: text(row.name) || id, email: emailOf(row) };
        })
        .filter((row): row is ChannelRow => row !== undefined);
}

/**
 * Project + environment bindings.
 *
 * CLI printable rows (`notifications project list -o json`) carry
 * `channelName` / `channelId` but **not** the recipient — that lives on the
 * channel. Pass `channels` from `toChannelRows` so the panel can show the
 * address; without it, email stays blank even though unlink still works.
 */
export function toBindingRows(raw: unknown, channels: ChannelRow[] = []): BindingRow[] {
    const emailByChannelId = new Map(
        channels.filter((channel) => channel.email).map((channel) => [channel.id, channel.email]),
    );
    const emailByChannelName = new Map(
        channels.filter((channel) => channel.email).map((channel) => [channel.name, channel.email]),
    );

    return unwrapRows(raw)
        .map((row) => {
            const id = text(row.id);
            if (!id) {
                return undefined;
            }
            const channelName = text(row.channelName);
            const channelId = text(row.channelId) || text(row.channel_id);
            return {
                id,
                name: text(row.name) || channelName || id,
                channelName,
                email:
                    emailOf(row) ||
                    emailByChannelId.get(channelId) ||
                    emailByChannelName.get(channelName) ||
                    '',
            };
        })
        .filter((row): row is BindingRow => row !== undefined);
}

/**
 * Recipient address from either CLI printable (`to`) or API nested config.
 *
 * The extension used to read only `config.email.to`. List commands print a
 * flattened `printableChannel` / `printableProjectNotification`, so that path
 * always returned `''` and the Issues panel looked like notifications were
 * empty / unlinkable-by-eye.
 */
function emailOf(row: Row): string {
    const flat = text(row.to);
    if (flat) {
        return flat;
    }
    const config = row.config as { email?: { to?: unknown } } | undefined;
    return text(config?.email?.to);
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function buildChannelListArgs(): string[] {
    // Organisation-scoped: no --project flag exists on this command.
    return ['notifications', 'channels', 'list'];
}

export interface ChannelInput {
    name: string;
    email: string;
    cc: string[];
}

/**
 * Argv for a new email channel.
 *
 * Both `--name` and `--email` are required here rather than left to the CLI: it
 * would prompt for them, and a process spawned without a TTY cannot answer.
 * The CLI deliberately does not derive the address from the active context —
 * service-key tokens carry no user identity.
 */
export function buildChannelCreateArgs(input: ChannelInput): string[] {
    if (!input.name.trim()) {
        throw new Error('a channel name is required');
    }
    if (!input.email.trim()) {
        throw new Error('a primary email address is required');
    }

    const args = [
        'notifications',
        'channels',
        'create',
        '--name',
        input.name.trim(),
        '--email',
        input.email.trim(),
    ];

    for (const cc of input.cc.map((address) => address.trim()).filter(Boolean)) {
        args.push('--cc', cc);
    }

    return args;
}

export function buildBindingListArgs(environment: string): string[] {
    const args = ['notifications', 'project', 'list'];
    return environment ? [...args, '--environment', environment] : args;
}

export interface LinkInput {
    channelId: string;
    environment: string;
    /** Display label for the binding. Defaults to the channel name server-side. */
    name?: string;
    /** Only email for these severities. Empty means all. */
    severities: string[];
    filterTitle?: string;
    filterMessage?: string;
}

export function buildLinkArgs(input: LinkInput): string[] {
    if (!input.channelId) {
        throw new Error('a channel is required');
    }
    if (!input.environment) {
        throw new Error('an environment is required');
    }

    const args = [
        'notifications',
        'project',
        'link',
        '--channel-id',
        input.channelId,
        '--environment',
        input.environment,
    ];

    if (input.name?.trim()) {
        args.push('--name', input.name.trim());
    }
    if (input.severities.length > 0) {
        // The flag is repeatable or comma-separated; one value keeps argv short.
        args.push('--severity', input.severities.join(','));
    }
    if (input.filterTitle?.trim()) {
        args.push('--filter-title', input.filterTitle.trim());
    }
    if (input.filterMessage?.trim()) {
        args.push('--filter-message', input.filterMessage.trim());
    }

    return args;
}

/**
 * Argv for removing a binding.
 *
 * `--yes` is mandatory here: without it the CLI opens a confirmation prompt that
 * a spawned process cannot answer, so it would hang until the 60s timeout. The
 * user-facing confirmation is a VS Code modal instead. The channel itself
 * survives — only the binding goes.
 */
export function buildUnlinkArgs(notificationId: string, environment: string): string[] {
    if (!notificationId) {
        throw new Error('a notification binding id is required');
    }
    if (!environment) {
        throw new Error('an environment is required');
    }

    return [
        'notifications',
        'project',
        'unlink',
        '--notification-id',
        notificationId,
        '--environment',
        environment,
        '--yes',
    ];
}
