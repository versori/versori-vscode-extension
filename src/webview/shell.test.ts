import { describe, expect, it } from 'vitest';

import { BASE_CSS, CONTROLS_SCRIPT, FIELD_PICKER_SCRIPT, htmlDocument } from './shell';

const parts = {
    nonce: 'TESTNONCE',
    title: 'Versori',
    styles: '.extra { color: red; }',
    body: '<div id="body"></div>',
    script: 'const x = 1;',
};

describe('htmlDocument', () => {
    it('locks the CSP to the nonce and forbids every default source', () => {
        const html = htmlDocument(parts);
        expect(html).toContain(
            "default-src 'none'; style-src 'nonce-TESTNONCE'; script-src 'nonce-TESTNONCE';",
        );
    });

    it('nonces both the style and script tags, or the CSP would block them', () => {
        const html = htmlDocument(parts);
        expect(html).toContain('<style nonce="TESTNONCE">');
        expect(html).toContain('<script nonce="TESTNONCE">');
    });

    it('includes the base CSS ahead of the caller styles, so callers can override', () => {
        const html = htmlDocument(parts);
        expect(html.indexOf(BASE_CSS)).toBeGreaterThan(-1);
        expect(html.indexOf(BASE_CSS)).toBeLessThan(html.indexOf('.extra { color: red; }'));
    });

    it('places the body and script where the caller supplied them', () => {
        const html = htmlDocument(parts);
        expect(html).toContain('<div id="body"></div>');
        expect(html).toContain('const x = 1;');
    });

    it('names no external origin anywhere — every resource is inline', () => {
        expect(htmlDocument(parts)).not.toMatch(/https?:\/\//);
    });
});

describe('shared scripts', () => {
    it('declare the functions panels call, so a panel cannot silently miss one', () => {
        expect(CONTROLS_SCRIPT).toContain('function renderControls(');
        expect(FIELD_PICKER_SCRIPT).toContain('function renderFieldPicker(');
    });
});
