export type PopupHideAction = 'cancel' | 'ignore';

/**
 * A QuickPick can emit onDidHide as part of accepting an item. The hide event
 * must only cancel a screen when no accept event won the same event cycle.
 */
export function popupHideAction(accepted: boolean): PopupHideAction {
    return accepted ? 'ignore' : 'cancel';
}
