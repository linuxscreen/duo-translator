// Sentence segmentation, extracted from main/content.ts. This backs the
// bilingual sentence-level highlighting: the returned chunks partition the input
// losslessly, so main/dom/sentenceHighlight.ts can turn them into one Range per
// sentence and pair the two sides by index.

/**
 * Split text into sentence strings. Whitespace between sentences is attached to
 * the following sentence (it accumulates into the next emitted chunk).
 */
export function splitSentence(text: string | null): string[] {
    if (!text) {
        return [];
    }
    const segmenter = new Intl.Segmenter(undefined, {
        granularity: "sentence",
    })

    return Array.from(segmenter.segment(text), x => x.segment)
}
