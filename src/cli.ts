import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const BIN_NAME = 'versori';

/** Logs can be large; the 1 MB execFile default truncates them. */
const MAX_BUFFER = 16 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 60_000;

export class CliError extends Error {
    constructor(
        message: string,
        readonly stderr: string,
        readonly exitCode: number | undefined,
        readonly argv: string[],
    ) {
        super(message);
        this.name = 'CliError';
    }
}

export interface CommandSpec {
    /** Command and flags, without the `--output` flag. */
    args: string[];
    /** Working directory. Matters: the CLI reads `.versori` relative to it. */
    cwd?: string;
    /** Append `--output json`. Default true. Set false for streaming/plain output. */
    json?: boolean;
}

/**
 * Build the full argv for a command.
 *
 * `--output`/`-o` is a global flag accepting `table`, `json`, or `yaml`
 * (see docs/README.md in the cli repo).
 */
export function buildArgs(spec: CommandSpec): string[] {
    return spec.json === false ? [...spec.args] : [...spec.args, '--output', 'json'];
}

/**
 * Locate the `versori` binary.
 *
 * `versori` is commonly a shell alias (`alias versori=~/go/bin/versori`), and
 * `spawn` does not load shell rc files — so a bare `spawn('versori')` fails with
 * ENOENT even though it works in the user's terminal. VS Code launched from
 * Finder also inherits a minimal PATH that omits `~/go/bin`.
 */
export function findCli(
    configuredPath?: string,
    env: NodeJS.ProcessEnv = process.env,
    homedir: string = os.homedir(),
): string | undefined {
    if (configuredPath) {
        // An explicit setting that is wrong should fail loudly, not fall back
        // to some other binary the user did not choose.
        return isExecutable(configuredPath) ? configuredPath : undefined;
    }

    for (const dir of (env.PATH ?? '').split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        const candidate = path.join(dir, BIN_NAME);
        if (isExecutable(candidate)) {
            return candidate;
        }
    }

    const goBin = path.join(homedir, 'go', 'bin', BIN_NAME);
    return isExecutable(goBin) ? goBin : undefined;
}

function isExecutable(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile() && isExecutableMode(filePath);
    } catch {
        return false;
    }
}

function isExecutableMode(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

export interface CliResult {
    stdout: string;
    stderr: string;
}

/** Run a command and return its raw output. Throws {@link CliError} on non-zero exit. */
export async function run(bin: string, spec: CommandSpec): Promise<CliResult> {
    const argv = buildArgs(spec);

    try {
        const { stdout, stderr } = await execFileAsync(bin, argv, {
            cwd: spec.cwd,
            maxBuffer: MAX_BUFFER,
            timeout: DEFAULT_TIMEOUT_MS,
        });
        return { stdout, stderr };
    } catch (err) {
        const e = err as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: number | string;
        };
        const stderr = (e.stderr ?? '').trim();
        const exitCode = typeof e.code === 'number' ? e.code : undefined;

        throw new CliError(
            stderr || e.message || `versori ${argv[0] ?? ''} failed`,
            stderr,
            exitCode,
            argv,
        );
    }
}

/**
 * Parse newline-delimited JSON, or undefined if any non-blank line fails.
 *
 * `projects logs -o json` emits one object per line — no array, no
 * `{type,items}` envelope like every other list command.
 */
export function parseNdjson(text: string): unknown[] | undefined {
    const lines = text.split('\n').filter((line) => line.trim());

    if (lines.length === 0) {
        return undefined;
    }

    const parsed: unknown[] = [];
    for (const line of lines) {
        try {
            parsed.push(JSON.parse(line));
        } catch {
            return undefined;
        }
    }

    return parsed;
}

/**
 * Run a command and parse its JSON stdout.
 *
 * Handles all three shapes the CLI emits:
 *   - empty stdout — the success-with-no-rows signal (`projects logs` exits 0
 *     and prints zero bytes rather than `[]`)
 *   - a single JSON document — the `{type,items:[...]}` envelope most commands use
 *   - NDJSON — one object per line, as `projects logs` returns
 */
export async function runJson<T>(bin: string, spec: CommandSpec): Promise<T | undefined> {
    const { stdout } = await run(bin, { ...spec, json: true });

    if (!stdout.trim()) {
        return undefined;
    }

    try {
        return JSON.parse(stdout) as T;
    } catch {
        const ndjson = parseNdjson(stdout);
        if (ndjson) {
            return ndjson as T;
        }

        // Deliberately does not echo stdout: `context list -o json` returns full
        // JWTs, and this error is surfaced in a user-visible output channel.
        throw new CliError(
            `could not parse JSON from \`versori ${spec.args.join(' ')}\``,
            '',
            undefined,
            buildArgs(spec),
        );
    }
}

/** Render argv for display, so the user can see exactly what ran. */
export function displayCommand(spec: CommandSpec): string {
    return `versori ${buildArgs(spec).join(' ')}`;
}
