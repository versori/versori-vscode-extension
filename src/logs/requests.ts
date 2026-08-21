export interface RequestToken {
    readonly generation: number;
    readonly target: string;
    readonly requiresLive: boolean;
    readonly signal: AbortSignal;
}

/**
 * Owns the lifecycle of asynchronous work for one open log panel.
 *
 * A token is valid only for the generation and target that started it. Bumping
 * the generation aborts every active CLI child and makes all of their eventual
 * continuations stale, even when cancellation races with process completion.
 */
export class RequestGate {
    private generation = 0;
    private disposed = false;
    private readonly active = new Set<AbortController>();

    begin(target: string, requiresLive: boolean): RequestToken {
        const controller = new AbortController();
        if (this.disposed) {
            controller.abort();
        } else {
            this.active.add(controller);
        }

        return {
            generation: this.generation,
            target,
            requiresLive,
            signal: controller.signal,
        };
    }

    isCurrent(token: RequestToken, target: string, liveEnabled: boolean): boolean {
        return (
            !this.disposed &&
            !token.signal.aborted &&
            token.generation === this.generation &&
            token.target === target &&
            (!token.requiresLive || liveEnabled)
        );
    }

    /**
     * Release a completed request and report whether it still owns this
     * generation. A stale request must not clear a newer poll's in-flight flag.
     */
    finish(token: RequestToken): boolean {
        for (const controller of this.active) {
            if (controller.signal === token.signal) {
                this.active.delete(controller);
                break;
            }
        }
        return !this.disposed && !token.signal.aborted && token.generation === this.generation;
    }

    invalidate(): void {
        this.generation += 1;
        for (const controller of this.active) {
            controller.abort();
        }
        this.active.clear();
    }

    dispose(): void {
        this.disposed = true;
        this.invalidate();
    }

    get isDisposed(): boolean {
        return this.disposed;
    }
}
