/**
 * Where the effective context came from.
 *
 * Mirrors the CLI's `contextSource` enum in pkg/cmd/config/config.go, minus
 * `contextSourceFlag` — the extension never passes `--context`.
 */
export type ContextSource = 'versori-file' | 'active' | 'none';

/** What a `versori` command run against a given directory would actually target. */
export interface ResolvedState {
    /** Project ID from the nearest `.versori`. Undefined outside a synced project. */
    projectId?: string;
    /** Absolute path of the directory holding that `.versori`. */
    projectDir?: string;
    /** The context commands will run under, after precedence is applied. */
    contextName?: string;
    /** The persistent active context from the CLI config, whatever won above. */
    activeContextName?: string;
    source: ContextSource;
    /**
     * True when `.versori` pins a context that differs from the active one — the
     * case the CLI reports on stderr and the status bar renders in amber.
     */
    overridesActive: boolean;
}

export interface ContextResolver {
    /**
     * Resolve state for `startDir`, walking up to `boundaryDir` (typically the
     * containing workspace folder) or the filesystem root.
     *
     * Must be cheap enough to call on every editor change: no subprocess, no network.
     */
    resolve(startDir: string | undefined, boundaryDir?: string): ResolvedState;

    /** Drop cached state after a `.versori` or CLI-config change. */
    invalidate(): void;
}

/** State for a workspace with no project and no configured context. */
export const EMPTY_STATE: ResolvedState = {
    source: 'none',
    overridesActive: false,
};
