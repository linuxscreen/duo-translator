// Pure CSS-string builders for translation styling + bilingual highlighting.
// Extracted from main/content.ts so the string logic is unit-testable in
// isolation (no DOM, no config). content.ts reads config and feeds the values
// in via buildTranslationCss().
import { effectiveFontColor } from "@/utils/color";
import {
    BLUR_RADIUS_PX,
    DIM_OPACITY,
    HIGHLIGHT_BORDER_LINE_STYLE,
    QUOTE_BAR_DEFAULT_COLOR,
    QUOTE_BAR_GAP,
    QUOTE_BAR_WIDTH_PX,
    styleUsesBackground,
} from "@/utils/translationStyle";
import { STYLE_BLUR, STYLE_DIM, STYLE_QUOTE } from "@/main/constants";
import { HIGHLIGHT_ORIGINAL, HIGHLIGHT_TRANSLATION } from "@/main/dom/sentenceHighlight";

export interface TranslationCssOptions {
    bgColor: string;
    fontColor: string;
    borderStyle: string;
    borderColor: string;
    /** The quote style's leading bar; empty means "follow the text color". */
    quoteBorderColor: string;
    highlightBg: string;
    highlightFontColor: string;
    highlightStyle: string;
    highlightBorderColor: string;
    highlightSwitch: boolean;
}

/**
 * Translate a style name (+ optional color) into a CSS declaration string.
 * Handles the border variants (solid/dotted/dashed), the underline variants
 * (wavy/double/under/dotted/dashed Line), the enhance styles (dim/quote/blur)
 * and `noneStyleSelect`.
 *
 * `color` is whichever color the style actually uses — the border color for the
 * border/underline variants, the bar color for `quote`, and nothing for the two
 * attenuating styles. The enhance styles emit only their *resting* state; their
 * hover counterpart is a separate rule (getEnhanceHoverRuleString) because a
 * declaration string cannot carry a second selector.
 */
export function getCSSRuleString(style: string, color?: string): string {
    let cssRule = "";
    const isBorder = style === "solidBorder" || style === "dottedBorder" || style === "dashedBorder";
    const isUnderline = !!style && style.endsWith("Line");
    switch (style) {
        case "noneStyleSelect":
            cssRule = "border: none;";
            break;
        // Dim is unconditional — it is a permanent de-emphasis, not a
        // reveal-on-hover. (Blur is the opposite: unreadable until hovered, so
        // it must have a way back. Hence no transition here and one there.)
        case STYLE_DIM:
            cssRule = `opacity: ${DIM_OPACITY};`;
            break;
        case STYLE_BLUR:
            cssRule = `filter: blur(${BLUR_RADIUS_PX}px);transition: filter 0.2s ease;`;
            break;
        case STYLE_QUOTE:
            // inline-block so the bar spans every line: `.duo-translation` is a
            // <span>, and an inline box draws its left border on the first line
            // fragment only. It stays inline-*level* rather than block so the
            // preceding <br> still does its job — a block box after a <br>
            // leaves an empty line. No width: shrink-to-fit already fills the
            // available width once the text wraps.
            //
            // currentColor rather than dropping the declaration when unset: a
            // borderless "quote" style would be indistinguishable from none.
            cssRule =
                `display: inline-block;` +
                `border-left: ${QUOTE_BAR_WIDTH_PX}px solid ${color || QUOTE_BAR_DEFAULT_COLOR};` +
                `padding-left: ${QUOTE_BAR_GAP};`;
            break;
        case "solidBorder":
            cssRule = "border: 2px solid;";
            break;
        case "dottedBorder":
            cssRule = "border: 2px dotted;";
            break;
        case "dashedBorder":
            cssRule = "border: 2px dashed;";
            break;
        case "wavyLine":
            cssRule = "text-decoration: wavy underline;";
            break;
        case "doubleLine":
            cssRule = "text-decoration: underline double;";
            break;
        case "underLine":
            cssRule = "text-decoration: underline;";
            break;
        case "dottedLine":
            cssRule = "text-decoration: underline dotted;";
            break;
        case "dashedLine":
            cssRule = "text-decoration: underline dashed;";
            break;
    }
    if (color) {
        if (isBorder) {
            cssRule += `border-color: ${color};`;
        } else if (isUnderline) {
            cssRule += `text-decoration-color: ${color};`;
        }
    }
    if (isUnderline) {
        cssRule += `text-underline-offset: 4px;`;
    }
    return cssRule;
}

/**
 * The hover half of the blur style, or "" for every other style. Kept separate
 * from getCSSRuleString because it needs its own selector
 * (`.duo-translation:hover`), not another declaration.
 *
 * Blur alone gets one, because blurred text cannot be read at all and a style
 * with no way back would just be "hide the translation". Dim stays dimmed on
 * hover — it is legible as-is, and restoring it would make the page flicker
 * under a moving pointer.
 *
 * Only the translation carries the hover state, never the whole container:
 * pointing at the original must leave the translation blurred — that is the
 * entire point of the style, and it is also what bindRangeHighlightHandler
 * mirrors when it refuses to paint a highlight the reader could not see (see
 * main/content.ts).
 */
export function getEnhanceHoverRuleString(style: string): string {
    return style === STYLE_BLUR ? "filter: none;" : "";
}

/**
 * getCSSRuleString for the *bilingual-highlight* styles, where the three border
 * variants are remapped onto `underline overline` in the matching line style.
 * Everything else is unchanged.
 *
 * A stroked rectangle is not expressible on the preferred painter: highlight
 * pseudo-elements are a paint-time overlay with no box, so `border` (like
 * anything else that would affect layout) is never applied — the top and bottom
 * edges, which is what `underline overline` draws, are as close as that API
 * gets. The left and right edges are not achievable at all.
 *
 * The <duo-span> fallback *could* draw a real border, but deliberately uses the
 * same mapping, for two reasons: the two paths then look identical on old and
 * new browsers, and a real border there draws one box per span — so a sentence
 * crossing an inline element (`Hel<b>lo</b> there.`) gets internal vertical
 * edges, while the underlines of adjacent elements are collinear and read as one
 * continuous line.
 *
 * `.duo-translation` keeps its real border (getCSSRuleString): it is a single
 * block-level element, where neither problem arises.
 *
 * No text-underline-offset here, unlike the *Line styles: there is no
 * corresponding property for the overline, so offsetting only the underline
 * would render the pair visibly lopsided.
 */
export function getHighlightCSSRuleString(style: string, color?: string): string {
    const lineStyle = HIGHLIGHT_BORDER_LINE_STYLE[style];
    if (!lineStyle) {
        return getCSSRuleString(style, color);
    }
    // Thickness must follow the shorthand, which resets it to auto. 1px rather
    // than the 2px of the border being replaced: two 2px rules hugging the text
    // read far heavier than a 2px frame around it.
    let cssRule = `text-decoration: underline overline ${lineStyle};text-decoration-thickness: 1px;`;
    if (color) {
        cssRule += `text-decoration-color: ${color};`;
    }
    return cssRule;
}

/**
 * Build the full stylesheet text for translation styling + bilingual
 * highlighting. Always returns a complete CSS string so the caller can swap the
 * stylesheet atomically via replaceSync.
 */
export function buildTranslationCss(opts: TranslationCssOptions): string {
    const blocks: string[] = [];

    // Translation style — applied to the appended translation copy.
    const translationDecls: string[] = [];
    // The enhance styles attenuate the paragraph as a whole, so they drop the
    // background fill (styleColorFields says the same thing to the Options
    // pickers — one definition, so no color is offered that never lands, and
    // none lands that cannot be changed).
    const bgColor = styleUsesBackground(opts.borderStyle) ? opts.bgColor : "";
    if (bgColor) translationDecls.push(`background-color: ${bgColor};`);
    // Nudge the font to a near-color only when it exactly matches the bg, so
    // identical bg+font text stays visible (config is untouched).
    const translationFont = effectiveFontColor(bgColor, opts.fontColor);
    if (translationFont) translationDecls.push(`color: ${translationFont};`);
    // The quote bar has its own color key; every other style that takes a color
    // takes the border one.
    const isQuote = opts.borderStyle === STYLE_QUOTE;
    const styleColor = isQuote ? opts.quoteBorderColor : opts.borderColor;
    const translationRule = getCSSRuleString(opts.borderStyle, styleColor);
    // The quote bar is the one style that depends on the *layout* the
    // translation landed in. content.ts inserts either a <br class="duo-divide">
    // (own line) or a <span class="duo-divide"> of two nbsp (appended inline,
    // for translations under TRANSLATION_LINE_BREAK_MIN_CHARS), always directly
    // before the translation — so the adjacent-sibling selector asks exactly
    // "did this one get its own line?". A quote bar mid-sentence would read as
    // a stray glyph, so the inline case keeps only the color declarations.
    if (isQuote) {
        if (translationDecls.length > 0) {
            blocks.push(`.duo-translation { ${translationDecls.join(" ")} }`);
        }
        if (translationRule) {
            blocks.push(`br.duo-divide + .duo-translation { ${translationRule} }`);
        }
    } else {
        if (translationRule) translationDecls.push(translationRule);
        if (translationDecls.length > 0) {
            blocks.push(`.duo-translation { ${translationDecls.join(" ")} }`);
        }
    }
    const hoverRule = getEnhanceHoverRuleString(opts.borderStyle);
    if (hoverRule) {
        blocks.push(`.duo-translation:hover { ${hoverRule} }`);
    }

    // Bilingual highlighting — unified across the original and its translation,
    // and emitted for BOTH painting strategies (content.ts picks one at runtime
    // via supportsHighlightApi; the other's rule simply never matches):
    //
    //   - `::highlight(…)` for the CSS Custom Highlight API path, where the
    //     hovered sentence is a Range registered in CSS.highlights and nothing
    //     in the page is wrapped;
    //   - `.duo-highlight-*` for the <duo-span> fallback on browsers without
    //     that API.
    //
    // Both get the *same* declarations — see getHighlightCSSRuleString for why
    // the border styles are remapped rather than rendered natively on the path
    // that could.
    //
    // They must stay two separate rules: an unsupported selector invalidates the
    // whole rule it appears in, so merging the four selectors into one list
    // would lose the class rule on exactly the old browsers that need it.
    if (opts.highlightSwitch) {
        const highlightDecls: string[] = [];
        if (opts.highlightBg) highlightDecls.push(`background-color: ${opts.highlightBg};`);
        const highlightFont = effectiveFontColor(opts.highlightBg, opts.highlightFontColor);
        if (highlightFont) highlightDecls.push(`color: ${highlightFont};`);
        const highlightRule = getHighlightCSSRuleString(opts.highlightStyle, opts.highlightBorderColor);
        if (highlightRule) highlightDecls.push(highlightRule);
        if (highlightDecls.length > 0) {
            const decls = highlightDecls.join(" ");
            blocks.push(
                `::highlight(${HIGHLIGHT_ORIGINAL}), ::highlight(${HIGHLIGHT_TRANSLATION}) { ${decls} }`,
            );
            blocks.push(`.duo-highlight-original, .duo-highlight-translation { ${decls} }`);
        }
    }
    return blocks.join("\n");
}
