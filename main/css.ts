// Pure CSS-string builders for translation styling + bilingual highlighting.
// Extracted from main/content.ts so the string logic is unit-testable in
// isolation (no DOM, no config). content.ts reads config and feeds the values
// in via buildTranslationCss().
import { effectiveFontColor } from "@/utils/color";

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

    // Bilingual highlighting — unified across original + translation spans.
    if (opts.highlightSwitch) {
        const highlightDecls: string[] = [];
        if (opts.highlightBg) highlightDecls.push(`background-color: ${opts.highlightBg};`);
        const highlightFont = effectiveFontColor(opts.highlightBg, opts.highlightFontColor);
        if (highlightFont) highlightDecls.push(`color: ${highlightFont};`);
        const highlightRule = getCSSRuleString(opts.highlightStyle, opts.highlightBorderColor);
        if (highlightRule) highlightDecls.push(highlightRule);
        if (highlightDecls.length > 0) {
            blocks.push(
                `.duo-highlight-original, .duo-highlight-translation { ${highlightDecls.join(" ")} }`,
            );
        }
    }
    return blocks.join("\n");
}
