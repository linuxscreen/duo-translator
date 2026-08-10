import * as OpenCC from 'opencc-js';

/**
 * Traditional→Simplified converter, built once.
 *
 * `OpenCC.Converter()` compiles the mapping dictionaries into a lookup trie,
 * which dwarfs the cost of the conversion itself — measured at ~1.4 ms to build
 * versus ~0.001 ms to run. Building it per call put that on two hot paths:
 * `detectLanguage` calls this once per sampled paragraph (main/lang.ts), and
 * `transferLanguageCode` once per returned translation (main/translateService.ts).
 * Lazily built so the cost lands on the first Chinese text seen, not on module
 * load in every content script.
 */
let toSimplified: ((input: string) => string) | null = null;

/**
 * Is this text Traditional Chinese?
 *
 * Simplified text is already a fixed point of the t→cn mapping and comes back
 * byte-identical; Traditional text changes. Assumes the caller has established
 * the text is Chinese at all (franc reporting "cmn").
 */
export function isTraditionalChinese(input: string) {
    if (!toSimplified) toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
    return toSimplified(input) !== input;
}
