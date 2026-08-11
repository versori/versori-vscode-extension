import * as vscode from 'vscode';

import { popupHideAction } from './popup-policy';

export const POPUP_BACK = Symbol('popup-back');
export type PopupResult<T> = T | typeof POPUP_BACK | undefined;

/** Explicit Close (×) button shown on every popup screen. */
const CLOSE_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('close'),
    tooltip: 'Close',
};

export interface PopupItem<T> {
    label: string;
    value: T;
    description?: string;
    detail?: string;
}

export interface PopupScreen<T> {
    title: string;
    placeholder?: string;
    value?: string;
    items?: PopupItem<T>[];
    matchOnDescription?: boolean;
    step?: number;
    totalSteps?: number;
    back?: boolean;
}

export interface PopupManyScreen<T> extends PopupScreen<T> {
    /** Values that should render as checked when the screen opens. */
    picked?: readonly T[];
}

export class PopupSession {
    private readonly quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    private visible = false;
    private readonly visibilitySubscription = this.quickPick.onDidHide(() => {
        this.visible = false;
    });
    private screenSubscriptions: vscode.Disposable[] = [];
    private resolveCurrentScreen: (() => void) | undefined;

    async choose<T>(screen: PopupScreen<T>): Promise<PopupResult<T>> {
        this.prepareScreen();
        this.configure(screen, screen.items ?? [], false);

        return this.waitForScreen(() => {
            const selected =
                this.quickPick.selectedItems?.[0] ?? this.quickPick.activeItems?.[0];
            return (selected as PopupItem<T> | undefined)?.value;
        });
    }

    async chooseMany<T>(screen: PopupManyScreen<T>): Promise<PopupResult<T[]>> {
        this.prepareScreen();
        const picked = new Set(screen.picked ?? []);
        const items = (screen.items ?? []).map((item) => ({
            ...item,
            picked: picked.has(item.value),
        }));
        this.configure(screen, items, true);

        return this.waitForScreen(() =>
            this.quickPick.selectedItems.map((item) => (item as PopupItem<T>).value),
        );
    }

    async input(
        screen: Omit<PopupScreen<never>, 'items'>,
    ): Promise<PopupResult<string>> {
        this.prepareScreen();
        this.configure({ ...screen, items: [] }, [], false);

        return this.waitForScreen(() => this.quickPick.value);
    }

    loading(title: string, detail: string): void {
        this.prepareScreen();
        this.quickPick.title = title;
        this.quickPick.placeholder = undefined;
        this.quickPick.prompt = undefined;
        this.quickPick.value = '';
        this.quickPick.items = [{ label: detail }];
        this.quickPick.buttons = [CLOSE_BUTTON];
        this.quickPick.step = undefined;
        this.quickPick.totalSteps = undefined;
        this.quickPick.canSelectMany = false;
        this.quickPick.busy = true;
        this.quickPick.enabled = false;
        this.screenSubscriptions = [
            this.quickPick.onDidTriggerButton((button) => {
                if (button === CLOSE_BUTTON) {
                    this.close();
                }
            }),
        ];
        this.visible = true;
        this.quickPick.show();
    }

    close(): void {
        this.visible = false;
        this.quickPick.hide();
    }

    isVisible(): boolean {
        return this.visible;
    }

    dispose(): void {
        this.visible = false;
        this.resolveCurrentScreen?.();
        this.screenSubscriptions = [];
        this.visibilitySubscription.dispose();
        this.quickPick.dispose();
    }

    private configure<T>(
        screen: PopupScreen<T>,
        items: readonly vscode.QuickPickItem[],
        canSelectMany: boolean,
    ): void {
        this.quickPick.title = screen.title;
        this.quickPick.placeholder = screen.placeholder;
        this.quickPick.prompt = undefined;
        this.quickPick.value = screen.value ?? '';
        this.quickPick.matchOnDescription = screen.matchOnDescription ?? false;
        this.quickPick.canSelectMany = canSelectMany;
        this.quickPick.items = items;
        // Back (optional) then Close (always) — Close is the top-right ×.
        this.quickPick.buttons = screen.back
            ? [vscode.QuickInputButtons.Back, CLOSE_BUTTON]
            : [CLOSE_BUTTON];
        this.quickPick.step = screen.step;
        this.quickPick.totalSteps = screen.totalSteps;
        this.quickPick.busy = false;
        this.quickPick.enabled = true;
    }

    private prepareScreen(): void {
        this.resolveCurrentScreen?.();
        this.disposeScreenSubscriptions();
    }

    private waitForScreen<T>(
        onAccept: () => PopupResult<T>,
    ): Promise<PopupResult<T>> {
        return new Promise((resolve) => {
            let settled = false;
            let accepted = false;
            let hideCancellation: ReturnType<typeof setTimeout> | undefined;
            const finish = (result: PopupResult<T>): void => {
                if (settled) {
                    return;
                }
                settled = true;
                if (hideCancellation !== undefined) {
                    clearTimeout(hideCancellation);
                    hideCancellation = undefined;
                }
                this.resolveCurrentScreen = undefined;
                this.disposeScreenSubscriptions();
                resolve(result);
            };

            const accept = (): void => {
                accepted = true;
                finish(onAccept());
            };
            const cancelOnHide = (): void => {
                if (accepted || hideCancellation !== undefined) {
                    return;
                }
                // QuickPick acceptance may hide the control before onDidAccept
                // runs. Give that event a chance to win over Escape/cancellation.
                hideCancellation = setTimeout(() => {
                    hideCancellation = undefined;
                    if (popupHideAction(accepted) === 'cancel') {
                        finish(undefined);
                    }
                }, 0);
            };

            this.resolveCurrentScreen = () => finish(undefined);
            this.screenSubscriptions = [
                this.quickPick.onDidAccept(accept),
                this.quickPick.onDidTriggerButton((button) => {
                    if (button === vscode.QuickInputButtons.Back) {
                        finish(POPUP_BACK);
                        return;
                    }
                    if (button === CLOSE_BUTTON) {
                        // Same outcome as Escape: cancel the screen and unwind.
                        finish(undefined);
                    }
                }),
                this.quickPick.onDidHide(cancelOnHide),
            ];
            this.visible = true;
            this.quickPick.show();
        });
    }

    private disposeScreenSubscriptions(): void {
        for (const subscription of this.screenSubscriptions) {
            subscription.dispose();
        }
        this.screenSubscriptions = [];
    }
}
