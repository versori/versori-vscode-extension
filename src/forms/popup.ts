import * as vscode from 'vscode';

export const POPUP_BACK = Symbol('popup-back');
export type PopupResult<T> = T | typeof POPUP_BACK | undefined;

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
        this.configure(screen, screen.items ?? []);

        return this.waitForScreen(() => {
            const selected =
                this.quickPick.selectedItems?.[0] ?? this.quickPick.activeItems?.[0];
            return (selected as PopupItem<T> | undefined)?.value;
        });
    }

    async input(
        screen: Omit<PopupScreen<never>, 'items'>,
    ): Promise<PopupResult<string>> {
        this.prepareScreen();
        this.configure({ ...screen, items: [] }, []);

        return this.waitForScreen(() => this.quickPick.value);
    }

    loading(title: string, detail: string): void {
        this.prepareScreen();
        this.quickPick.title = title;
        this.quickPick.placeholder = undefined;
        this.quickPick.prompt = undefined;
        this.quickPick.value = '';
        this.quickPick.items = [{ label: detail }];
        this.quickPick.buttons = [];
        this.quickPick.step = undefined;
        this.quickPick.totalSteps = undefined;
        this.quickPick.busy = true;
        this.quickPick.enabled = false;
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
    ): void {
        this.quickPick.title = screen.title;
        this.quickPick.placeholder = screen.placeholder;
        this.quickPick.prompt = undefined;
        this.quickPick.value = screen.value ?? '';
        this.quickPick.matchOnDescription = screen.matchOnDescription ?? false;
        this.quickPick.items = items;
        this.quickPick.buttons = screen.back ? [vscode.QuickInputButtons.Back] : [];
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
            const finish = (result: PopupResult<T>): void => {
                if (settled) {
                    return;
                }
                settled = true;
                this.resolveCurrentScreen = undefined;
                this.disposeScreenSubscriptions();
                resolve(result);
            };

            this.resolveCurrentScreen = () => finish(undefined);
            this.screenSubscriptions = [
                this.quickPick.onDidAccept(() => finish(onAccept())),
                this.quickPick.onDidTriggerButton((button) => {
                    if (button === vscode.QuickInputButtons.Back) {
                        finish(POPUP_BACK);
                    }
                }),
                this.quickPick.onDidHide(() => finish(undefined)),
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
