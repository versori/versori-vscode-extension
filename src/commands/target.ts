import { ResolvedState } from '../resolver/types';

/**
 * Name the project explicitly rather than relying on the CLI reading `.versori`
 * from cwd. The id comes from that same file, so the pinned-context override
 * still applies (config.go requires the resolved id to match `.versori`'s,
 * which it does).
 */
export function projectArgs(state: ResolvedState): string[] {
    return state.projectId ? ['--project', state.projectId] : [];
}

/**
 * The context to state explicitly via `-x`, or undefined when the active context
 * is already the right one.
 *
 * Only `.versori`-pinned contexts need stating: commands taking the project id
 * positionally (`projects details`) resolve their organisation from the active
 * context and would otherwise query the wrong org.
 */
export function contextFor(state: ResolvedState): string | undefined {
    return state.source === 'versori-file' ? state.contextName : undefined;
}
