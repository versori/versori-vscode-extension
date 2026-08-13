import { describe, expect, it } from 'vitest';

import { parseKeybindings, stripJsonComments } from './parse';

describe('stripJsonComments', () => {
    it('removes line and block comments', () => {
        const text = `[
            // a leading note
            { "key": "cmd+d" } /* trailing block */
        ]`;
        expect(JSON.parse(stripJsonComments(text))).toEqual([{ key: 'cmd+d' }]);
    });

    it('leaves comment-like text inside strings alone', () => {
        // The reason this is hand-written rather than a regex: a naive strip
        // eats the rest of any line containing a URL.
        const text = '[{ "command": "open", "args": "https://example.com/x" }]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([
            { command: 'open', args: 'https://example.com/x' },
        ]);
    });

    it('drops trailing commas before a closing brace or bracket', () => {
        const text = '[{ "key": "cmd+d", },]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([{ key: 'cmd+d' }]);
    });

    it('keeps a comma that is part of a string value', () => {
        const text = '[{ "key": "cmd+d", "args": "a, }" }]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([
            { key: 'cmd+d', args: 'a, }' },
        ]);
    });

    it('preserves escaped quotes inside strings', () => {
        const text = '[{ "args": "say \\"hi\\" // not a comment" }]';
        expect(JSON.parse(stripJsonComments(text))).toEqual([
            { args: 'say "hi" // not a comment' },
        ]);
    });
});

describe('parseKeybindings', () => {
    it('collects versori chords', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "versori.deployProject" },
            { "key": "cmd+shift+l", "command": "versori.logs" }
        ]`;
        expect(parseKeybindings(text)).toEqual(
            new Map([
                ['versori.deployProject', 'cmd+shift+d'],
                ['versori.logs', 'cmd+shift+l'],
            ]),
        );
    });

    it('ignores commands from other extensions', () => {
        const text = '[{ "key": "cmd+p", "command": "workbench.action.quickOpen" }]';
        expect(parseKeybindings(text).size).toBe(0);
    });

    it('lets a later row win', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "versori.deployProject" },
            { "key": "cmd+alt+d", "command": "versori.deployProject" }
        ]`;
        expect(parseKeybindings(text).get('versori.deployProject')).toBe('cmd+alt+d');
    });

    it('treats a leading dash as an unbind', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "versori.deployProject" },
            { "key": "cmd+shift+d", "command": "-versori.deployProject" }
        ]`;
        expect(parseKeybindings(text).has('versori.deployProject')).toBe(false);
    });

    it('keeps a binding made after an unbind', () => {
        const text = `[
            { "key": "cmd+shift+d", "command": "-versori.deployProject" },
            { "key": "cmd+alt+d", "command": "versori.deployProject" }
        ]`;
        expect(parseKeybindings(text).get('versori.deployProject')).toBe('cmd+alt+d');
    });

    it('records a chord even when the row has a when clause', () => {
        // We cannot evaluate `when`, so we show the key and say so in the README.
        const text =
            '[{ "key": "cmd+shift+d", "command": "versori.deployProject", "when": "editorFocus" }]';
        expect(parseKeybindings(text).get('versori.deployProject')).toBe('cmd+shift+d');
    });

    it('ignores rows with a missing or blank key', () => {
        const text = `[
            { "command": "versori.logs" },
            { "key": "   ", "command": "versori.issues" }
        ]`;
        expect(parseKeybindings(text).size).toBe(0);
    });

    it('returns an empty map for malformed, empty, or non-array input', () => {
        expect(parseKeybindings('not json at all {').size).toBe(0);
        expect(parseKeybindings('').size).toBe(0);
        expect(parseKeybindings('{ "key": "cmd+d" }').size).toBe(0);
    });
});
