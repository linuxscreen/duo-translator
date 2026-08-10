import * as OpenCC from 'opencc-js';

/**
 * Simplified ↔ Traditional converters, each built once on first use.
 *
 * `OpenCC.Converter()` compiles the mapping dictionaries into a lookup trie,
 * which dwarfs the cost of the conversion itself — measured at 6 ms (t→cn) and
 * 46 ms (cn→twp) to build, versus ~1 ms to convert 9000 characters. The two
 * differ by an order of magnitude because opencc-js's simplified→traditional
 * dictionary is 1.0 MB against 68 KB the other way.
 *
 * Building them per call put that on hot paths: `detectLanguage` converts once
 * per sampled paragraph (main/lang.ts), and the Yandex provider once per
 * returned translation (main/translateService.ts). Lazily built so the cost
 * lands on the first Chinese text seen, not on module load in every content
 * script.
 *
 * Note the dictionaries ship either way: opencc-js's `Locale` is an object
 * literal referencing every dictionary and `Converter` is built from it, so
 * tree-shaking cannot drop the unused direction. Measured in a production
 * build — both content.js and background.js already carried the full set
 * before anything here used `cn`→`twp`.
 */
type Convert = (input: string) => string;

let simplifier: Convert | null = null;
let traditionalizer: Convert | null = null;

/** Traditional → Simplified. Simplified input is a fixed point (returned as-is). */
export function toSimplified(input: string): string {
    if (!simplifier) simplifier = OpenCC.Converter({ from: 't', to: 'cn' });
    return simplifier(input);
}

/**
 * Simplified → Traditional.
 *
 * Target is `twp`, not `tw`: `tw` converts characters only, so 软件/鼠标/数据库
 * come out as 軟件/鼠標/數據庫 — mainland vocabulary in Traditional characters,
 * which is not what a zh-TW reader expects. `twp` also converts the vocabulary
 * (軟體/滑鼠/資料庫). This additionally keeps us consistent with the other
 * providers: Microsoft's own `to=zh-TW` output uses 軟體.
 *
 * `twp` is the wrong direction for Hong Kong, but zh-TW is the only Traditional
 * entry in LANGUAGES, so the Taiwan reading is the right one. (OpenCC has an
 * `hk` target ready if zh-HK is ever added.)
 */
export function toTraditional(input: string): string {
    if (!traditionalizer) traditionalizer = OpenCC.Converter({ from: 'cn', to: 'twp' });
    return traditionalizer(input);
}

/**
 * Is this text Traditional Chinese?
 *
 * Simplified text is already a fixed point of the t→cn mapping and comes back
 * byte-identical; Traditional text changes. Assumes the caller has established
 * the text is Chinese at all (franc reporting "cmn").
 */
export function isTraditionalChinese(input: string) {
    return toSimplified(input) !== input;
}
