import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BIN_NAME, buildArgs, CliError, displayCommand, findCli, runJson } from './cli';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'versori-cli-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function fakeBinary(dir: string, name = BIN_NAME, mode = 0o755): string {
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, '#!/bin/sh\n', { mode });
    fs.chmodSync(filePath, mode);
    return filePath;
}

describe('buildArgs', () => {
    it('appends --output json by default', () => {
        expect(buildArgs({ args: ['projects', 'list'] })).toEqual([
            'projects',
            'list',
            '--output',
            'json',
        ]);
    });

    it('leaves args alone when json is disabled', () => {
        expect(buildArgs({ args: ['context', 'select', 'acme'], json: false })).toEqual([
            'context',
            'select',
            'acme',
        ]);
    });

    it('does not mutate the caller’s array', () => {
        const args = ['projects', 'list'];
        buildArgs({ args });
        expect(args).toEqual(['projects', 'list']);
    });

    describe('buildArgs context flag', () => {
        it('emits --context before --output when a context is given', () => {
            expect(buildArgs({ args: ['projects', 'logs'], context: 'acme' })).toEqual([
                'projects',
                'logs',
                '--context',
                'acme',
                '--output',
                'json',
            ]);
        });

        it('omits --context when none is given', () => {
            expect(buildArgs({ args: ['projects', 'logs'] })).toEqual([
                'projects',
                'logs',
                '--output',
                'json',
            ]);
        });

        it('emits --context for plain-output commands too', () => {
            expect(buildArgs({ args: ['projects', 'deploy'], context: 'acme', json: false })).toEqual([
                'projects',
                'deploy',
                '--context',
                'acme',
            ]);
        });

        it('ignores an empty context rather than emitting a bare flag', () => {
            expect(buildArgs({ args: ['context', 'list'], context: '' })).toEqual([
                'context',
                'list',
                '--output',
                'json',
            ]);
        });
    });
});

describe('findCli', () => {
    it('prefers an explicitly configured path', () => {
        const configured = fakeBinary(path.join(root, 'custom'));
        const onPath = path.join(root, 'bin');
        fakeBinary(onPath);

        expect(findCli(configured, { PATH: onPath }, root)).toBe(configured);
    });

    it('returns undefined for a configured path that does not exist', () => {
        // A wrong setting should fail loudly rather than silently using another binary.
        const onPath = path.join(root, 'bin');
        fakeBinary(onPath);

        expect(findCli(path.join(root, 'nope'), { PATH: onPath }, root)).toBeUndefined();
    });

    it('finds the binary on PATH', () => {
        const dir = path.join(root, 'bin');
        const bin = fakeBinary(dir);

        expect(findCli(undefined, { PATH: dir }, root)).toBe(bin);
    });

    it('skips empty PATH segments and non-executable matches', () => {
        const bad = path.join(root, 'bad');
        fakeBinary(bad, BIN_NAME, 0o644); // present but not executable
        const good = path.join(root, 'good');
        const bin = fakeBinary(good);

        const PATH = ['', bad, good].join(path.delimiter);
        expect(findCli(undefined, { PATH }, root)).toBe(bin);
    });

    it('falls back to ~/go/bin when PATH misses it', () => {
        // The real-world case: `versori` is a shell alias, so PATH has nothing.
        const bin = fakeBinary(path.join(root, 'go', 'bin'));

        expect(findCli(undefined, { PATH: '/nonexistent' }, root)).toBe(bin);
    });

    it('returns undefined when the binary is nowhere', () => {
        expect(findCli(undefined, { PATH: '/nonexistent' }, root)).toBeUndefined();
    });

    it('handles a completely unset PATH', () => {
        const bin = fakeBinary(path.join(root, 'go', 'bin'));

        expect(findCli(undefined, {}, root)).toBe(bin);
    });
});

describe('displayCommand', () => {
    it('renders the argv the user would type', () => {
        expect(displayCommand({ args: ['projects', 'issues', 'list'] })).toBe(
            'versori projects issues list --output json',
        );
    });
});

/**
 * Executable stub that emits exactly `body` on stdout and exits `code`.
 *
 * The payload is written to a file and `cat`ed rather than passed to `printf`,
 * so newlines and backslashes reach stdout byte-for-byte.
 */
function stubBinary(body: string, code = 0): string {
    const id = Math.random().toString(36).slice(2);
    const dataPath = path.join(root, `data-${id}`);
    fs.writeFileSync(dataPath, body);

    const filePath = path.join(root, `stub-${id}`);
    fs.writeFileSync(filePath, `#!/bin/sh\ncat ${JSON.stringify(dataPath)}\nexit ${code}\n`);
    fs.chmodSync(filePath, 0o755);
    return filePath;
}

describe('runJson', () => {
    it('resolves to undefined when the command prints nothing', async () => {
        // `projects logs` with no matching entries exits 0 and prints zero bytes.
        await expect(runJson(stubBinary(''), { args: ['projects', 'logs'] })).resolves.toBeUndefined();
    });

    it('treats whitespace-only output as no results', async () => {
        await expect(runJson(stubBinary('\n  \n'), { args: ['x'] })).resolves.toBeUndefined();
    });

    it('parses real JSON output', async () => {
        await expect(
            runJson(stubBinary('{"type":"Log","items":[{"level":"info"}]}'), { args: ['x'] }),
        ).resolves.toEqual({ type: 'Log', items: [{ level: 'info' }] });
    });

    it('parses NDJSON, which is what projects logs returns', async () => {
        const ndjson =
            '{"message":"a","severity":"INFO","timestamp":"2026-07-24T14:36:00Z"}\n' +
            '{"message":"b","severity":"ERROR","timestamp":"2026-07-24T14:37:00Z"}\n';

        await expect(runJson(stubBinary(ndjson), { args: ['projects', 'logs'] })).resolves.toEqual([
            { message: 'a', severity: 'INFO', timestamp: '2026-07-24T14:36:00Z' },
            { message: 'b', severity: 'ERROR', timestamp: '2026-07-24T14:37:00Z' },
        ]);
    });

    it('still prefers a single JSON document over the NDJSON path', async () => {
        // A one-line document must not be mistaken for a one-entry NDJSON stream.
        await expect(
            runJson(stubBinary('{"type":"Context","items":[]}'), { args: ['x'] }),
        ).resolves.toEqual({ type: 'Context', items: [] });
    });

    it('throws on genuinely malformed output', async () => {
        await expect(runJson(stubBinary('not json at all'), { args: ['x'] })).rejects.toThrow(
            /could not parse JSON/,
        );
    });

    it('never echoes stdout in the error, which may contain credentials', async () => {
        const secret = 'eyJhbGciOiJSUzI1NiJ9.SECRET_TOKEN_VALUE';

        await expect(
            runJson(stubBinary(secret), { args: ['context', 'list'] }),
        ).rejects.toSatisfy((err: unknown) => {
            const cliError = err as CliError;
            return (
                !cliError.message.includes('SECRET') && !cliError.stderr.includes('SECRET')
            );
        });
    });
});
