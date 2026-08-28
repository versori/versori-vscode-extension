import * as fs from 'node:fs';

/** Bytes to sniff. Matches the heuristic git uses for its own binary check. */
const SAMPLE_BYTES = 8000;

/**
 * A NUL byte in the first few KB means the diff editor would render mojibake,
 * so the pair is skipped rather than opened.
 */
export function looksBinary(sample: Buffer): boolean {
    return sample.includes(0);
}

/**
 * Unreadable counts as binary: a file the diff editor cannot open is one to
 * skip, and Compare must never fail the whole run over one file.
 */
export function isBinaryFile(filePath: string): boolean {
    let handle: number | undefined;
    try {
        handle = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(SAMPLE_BYTES);
        const read = fs.readSync(handle, buffer, 0, SAMPLE_BYTES, 0);
        return looksBinary(buffer.subarray(0, read));
    } catch {
        return true;
    } finally {
        if (handle !== undefined) {
            try {
                fs.closeSync(handle);
            } catch {
                // Nothing useful to do; the descriptor dies with the process.
            }
        }
    }
}
