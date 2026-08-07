import { describe, expect, it } from 'vitest';

import { popupHideAction } from './popup-policy';

describe('popup hide policy', () => {
    it('ignores a hide that follows an accepted screen', () => {
        expect(popupHideAction(true)).toBe('ignore');
    });

    it('cancels when a screen hides without an acceptance', () => {
        expect(popupHideAction(false)).toBe('cancel');
    });
});
