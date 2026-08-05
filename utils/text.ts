const utf8Encoder = new TextEncoder();

/**
 * Length of `text` in UTF-8 BYTES.
 *
 * The measure to use whenever a length is meant to stand for "how much content
 * is this" across languages — `String.length` counts UTF-16 code units, so one
 * CJK character weighs the same as one Latin letter even though it carries
 * roughly a whole word. Budgets built on `.length` (line-splitting caps,
 * request sizes, sampling weights) therefore let CJK text grow several times
 * longer than the intended limit.
 */
export function utf8Length(text: string): number {
    return utf8Encoder.encode(text).length;
}
