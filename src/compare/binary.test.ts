import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isBinaryFile, looksBinary } from './binary';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'versori-binary-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('looksBinary', () => {
    it('reads text as text', () => {
        expect(looksBinary(Buffer.from('hello world'))).toBe(false);
    });

    it('reads a NUL byte in the sample as binary', () => {
        expect(looksBinary(Buffer.from([0x68, 0x00, 0x69]))).toBe(true);
    });

    it('reads an empty file as text, so a new empty file still diffs', () => {
        expect(looksBinary(Buffer.alloc(0))).toBe(false);
    });
});

describe('isBinaryFile', () => {
    it('opens a text file for diffing', () => {
        const filePath = path.join(root, 'a.ts');
        fs.writeFileSync(filePath, 'export const a = 1;\n');

        expect(isBinaryFile(filePath)).toBe(false);
    });

    it('skips a file whose first bytes contain a NUL', () => {
        const filePath = path.join(root, 'logo.png');
        fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47]));

        expect(isBinaryFile(filePath)).toBe(true);
    });

    it('treats an unreadable path as binary rather than failing the run', () => {
        expect(isBinaryFile(path.join(root, 'missing.ts'))).toBe(true);
    });
});
