// Dictionary lookup — shared shapes.
//
// Three-way shared (background provider clients / content client / the popup
// UI), so this file must stay free of anything context-specific: no fetch, no
// chrome.*, no DOM. Same discipline as main/aiProvider.ts.

export type DictProvider = "microsoft" | "google";

/** One accent's pronunciation. Providers may supply the text, the audio, or both. */
export interface DictPhonetic {
    accent: "uk" | "us";
    /** IPA, WITHOUT the surrounding brackets — the UI draws those. */
    text: string;
    /** Absolute URL of a recording, when the provider has one. */
    audio?: string;
}

export interface DictDefinition {
    /** Part of speech as the provider words it ("n.", "名词", "verb"…). */
    pos: string;
    /** One or more senses under that part of speech. */
    senses: string[];
}

export interface DictExample {
    source: string;
    /** Present only for providers that return bilingual pairs (Bing does). */
    target?: string;
}

export interface DictEntry {
    provider: DictProvider;
    /**
     * The headword the provider matched. Deliberately kept apart from `query`:
     * a lookup of "tools" or "ran" answers with "tool" / "run", and the user
     * needs to see that the answer is about a different form than the one they
     * selected.
     */
    word: string;
    /** What was actually looked up. */
    query: string;
    /**
     * Source language the provider detected, when it reports one (Google does;
     * Bing's page does not). This is what decides whose entry gets shown — see
     * `chooseDictEntry` — so it must come from the provider rather than from a
     * guess made before the request.
     */
    sourceLang?: string;
    phonetics: DictPhonetic[];
    definitions: DictDefinition[];
    examples: DictExample[];
}

/** True when the entry carries nothing worth drawing. */
export function isEmptyDictEntry(entry: DictEntry | null | undefined): boolean {
    return !entry || (entry.definitions.length === 0 && entry.examples.length === 0);
}
