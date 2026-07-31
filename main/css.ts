// Pure CSS-string builders for translation styling + bilingual highlighting.
// Extracted from main/content.ts so the string logic is unit-testable in
// isolation (no DOM, no config). content.ts reads config and feeds the values
// in via buildTranslationCss().
import { effectiveFontColor } from "@/utils/color";
import { HIGHLIGHT_ORIGINAL, HIGHLIGHT_TRANSLATION } from "@/main/dom/sentenceHighlight";

export interface TranslationCssOptions {
    bgColor: string;
    fontColor: string;
    borderStyle: string;
    borderColor: string;
    highlightBg: string;
    highlightFontColor: string;
    highlightStyle: string;
    highlightBorderColor: string;
    highlightSwitch: boolean;
}

/**
 * Translate a style name (+ optional color) into a CSS declaration string.
 * Handles the border variants (solid/dotted/dashed), the underline variants
 * (wavy/double/under/dotted/dashed Line), and `noneStyleSelect`.
 */
export function getCSSRuleString(style: string, color?: string): string {
    let cssRule = "";
    const isBorder = style === "solidBorder" || style === "dottedBorder" || style === "dashedBorder";
    const isUnderline = !!style && style.endsWith("Line");
    switch (style) {
        case "noneStyleSelect":
            cssRule = "border: none;";
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
 * Build the full stylesheet text for translation styling + bilingual
 * highlighting. Always returns a complete CSS string so the caller can swap the
 * stylesheet atomically via replaceSync.
 */
export function buildTranslationCss(opts: TranslationCssOptions): string {
    const blocks: string[] = [];

    // Translation style — applied to the appended translation copy.
    const translationDecls: string[] = [];
    if (opts.bgColor) translationDecls.push(`background-color: ${opts.bgColor};`);
    // Nudge the font to a near-color only when it exactly matches the bg, so
    // identical bg+font text stays visible (config is untouched).
    const translationFont = effectiveFontColor(opts.bgColor, opts.fontColor);
    if (translationFont) translationDecls.push(`color: ${translationFont};`);
    const translationRule = getCSSRuleString(opts.borderStyle, opts.borderColor);
    if (translationRule) translationDecls.push(translationRule);
    if (translationDecls.length > 0) {
        blocks.push(`.duo-translation { ${translationDecls.join(" ")} }`);
    }

    // Bilingual highlighting — unified across the original and its translation,
    // and emitted for BOTH painting strategies (content.ts picks one at runtime
    // via supportsHighlightApi; the other's rule simply never matches):
    //
    //   - `::highlight(…)` for the CSS Custom Highlight API path, where the
    //     hovered sentence is a Range registered in CSS.highlights and nothing
    //     in the page is wrapped. A highlight pseudo is painted as an overlay
    //     and never enters the box tree, so only paint-only properties apply —
    //     background-color / color / text-decoration do, `border` does not. The
    //     border variants of getCSSRuleString are inert here (the declaration
    //     parses and is simply never applied); mapping them onto a
    //     text-decoration equivalent is deliberately left for a follow-up.
    //   - `.duo-highlight-*` for the <duo-span> fallback on browsers without
    //     that API, where every property including `border` works.
    //
    // They must stay two separate rules: an unsupported selector invalidates the
    // whole rule it appears in, so merging the four selectors into one list
    // would lose the class rule on exactly the old browsers that need it.
    if (opts.highlightSwitch) {
        const highlightDecls: string[] = [];
        if (opts.highlightBg) highlightDecls.push(`background-color: ${opts.highlightBg};`);
        const highlightFont = effectiveFontColor(opts.highlightBg, opts.highlightFontColor);
        if (highlightFont) highlightDecls.push(`color: ${highlightFont};`);
        const highlightRule = getCSSRuleString(opts.highlightStyle, opts.highlightBorderColor);
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
