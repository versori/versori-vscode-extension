import { LogEntry } from './entries';

export interface LogFilter {
    /**
     * Comma- or newline-separated substrings. An entry matching **any** of them
     * is kept; empty keeps everything. Alternatives rather than a conjunction,
     * so two triggers can be watched at once.
     */
    include: string;
    /** Same syntax. An entry matching **any** term is hidden. */
    exclude: string;
    /** Severities to keep. Empty keeps all. Compared case-insensitively. */
    severities: string[];
    caseSensitive: boolean;
}

export const EMPTY_FILTER: LogFilter = {
    include: '',
    exclude: '',
    severities: [],
    caseSensitive: false,
};

/** Split a filter box into terms, dropping blanks so a trailing comma is harmless. */
export function parseTerms(text: string): string[] {
    return text
        .split(/[,\n]/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0);
}

/**
 * Whether an entry survives the filter.
 *
 * Exclude is applied after include, so narrowing to a trigger and still dropping
 * its noisy heartbeat works. Matching runs over `searchText` — headline,
 * severity and every field value — so a term can name a field value the user
 * has not chosen to display.
 */
export function matchesEntry(entry: LogEntry, filter: LogFilter): boolean {
    if (
        filter.severities.length > 0 &&
        !filter.severities.some((s) => s.toLowerCase() === entry.severity.toLowerCase())
    ) {
        return false;
    }

    const haystack = filter.caseSensitive ? entry.searchText : entry.searchText.toLowerCase();
    const fold = (term: string) => (filter.caseSensitive ? term : term.toLowerCase());

    const include = parseTerms(filter.include);
    if (include.length > 0 && !include.some((term) => haystack.includes(fold(term)))) {
        return false;
    }

    return !parseTerms(filter.exclude).some((term) => haystack.includes(fold(term)));
}

/**
 * Positions of the surviving entries.
 *
 * Indices rather than entries: the panel posts these back to the webview, which
 * shows and hides rows it has already rendered. Re-sending the entries on every
 * keystroke would copy the whole page across the message boundary.
 */
export function visibleIndices(entries: LogEntry[], filter: LogFilter): number[] {
    const out: number[] = [];

    entries.forEach((entry, index) => {
        if (matchesEntry(entry, filter)) {
            out.push(index);
        }
    });

    return out;
}
