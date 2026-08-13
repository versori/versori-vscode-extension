import { describe, expect, it } from 'vitest';

import { appendChord, formatChord } from './format';

describe('formatChord on macOS', () => {
    it('renders modifiers as glyphs with no separator', () => {
        expect(formatChord('cmd+shift+d', 'darwin')).toBe('⌘⇧D');
    });

    it('accepts the meta, option, and control spellings', () => {
        expect(formatChord('meta+option+ctrl+k', 'darwin')).toBe('⌘⌥⌃K');
    });

    it('keeps two-part chords separated by a space', () => {
        expect(formatChord('cmd+k cmd+s', 'darwin')).toBe('⌘K ⌘S');
    });

    it('title-cases named keys', () => {
        expect(formatChord('cmd+escape', 'darwin')).toBe('⌘Escape');
        expect(formatChord('f5', 'darwin')).toBe('F5');
    });
});

describe('formatChord off macOS', () => {
    it('renders title-cased modifiers joined by plus', () => {
        expect(formatChord('ctrl+shift+d', 'win32')).toBe('Ctrl+Shift+D');
        expect(formatChord('ctrl+alt+l', 'linux')).toBe('Ctrl+Alt+L');
    });

    it('keeps two-part chords separated by a space', () => {
        expect(formatChord('ctrl+k ctrl+s', 'win32')).toBe('Ctrl+K Ctrl+S');
    });
});

describe('appendChord', () => {
    it('appends the chord after a middot', () => {
        expect(appendChord('dry run by default', '⌘⇧D')).toBe('dry run by default · ⌘⇧D');
    });

    it('leaves an unbound description untouched', () => {
        expect(appendChord('dry run by default', undefined)).toBe('dry run by default');
    });

    it('adds no separator when there is no description', () => {
        expect(appendChord(undefined, '⌘⇧D')).toBe('⌘⇧D');
    });

    it('returns undefined when there is neither', () => {
        expect(appendChord(undefined, undefined)).toBeUndefined();
    });
});
