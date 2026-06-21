// Small color helpers for readability checks on the translation style colors.
// Only the formats our pickers can produce are supported: `#rgb` / `#rrggbb`
// (react-colorful emits prefixed 6-digit hex; presets are 6-digit hex).

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

/** Parse `#rgb` / `#rrggbb` to RGB (0–255). Returns null for empty/invalid. */
export function parseHexColor(input: string | undefined): Rgb | null {
    if (!input) return null;
    let hex = input.trim().replace(/^#/, "");
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return null;
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
    };
}

/** WCAG relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
    const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two colors (1 = identical, 21 = black-on-white).
 * Returns null when either color can't be evaluated (empty / unparseable) — the
 * caller should treat that as "not checkable", not "bad".
 */
export function contrastRatio(a: string | undefined, b: string | undefined): number | null {
    const ca = parseHexColor(a);
    const cb = parseHexColor(b);
    if (!ca || !cb) return null;
    const la = relativeLuminance(ca);
    const lb = relativeLuminance(cb);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Minimum contrast we treat as "legible" for the translation overlay.
 */
export const MIN_READABLE_CONTRAST = 1.3;

/**
 * True when bg/fg are safe to use together — including when the pair can't be
 * evaluated (e.g. either is the "default/transparent" empty value, where the
 * real background is the page's and unknown). Only an evaluable, below-threshold
 * pair is considered unreadable.
 */
export function isReadableContrast(
    bg: string | undefined,
    fg: string | undefined,
    min: number = MIN_READABLE_CONTRAST,
): boolean {
    const ratio = contrastRatio(bg, fg);
    return ratio === null || ratio >= min;
}

/** Pick black or white — whichever contrasts better against `bg`. */
export function readableFontColor(bg: string | undefined): string {
    const c = parseHexColor(bg);
    if (!c) return "#000000";
    // Contrast of white vs bg compared to black vs bg.
    const lum = relativeLuminance(c);
    const whiteRatio = (1.0 + 0.05) / (lum + 0.05);
    const blackRatio = (lum + 0.05) / (0.0 + 0.05);
    return whiteRatio >= blackRatio ? "#ffffff" : "#000000";
}

/** Format RGB (0–255, clamped) as `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
    const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** True only when both colors parse and are the exact same RGB. */
export function colorsEqual(a: string | undefined, b: string | undefined): boolean {
    const ca = parseHexColor(a);
    const cb = parseHexColor(b);
    if (!ca || !cb) return false;
    return ca.r === cb.r && ca.g === cb.g && ca.b === cb.b;
}

/**
 * Fixed blend amount toward black/white used by `distinguishableFontColor`.
 * 0.5 keeps the result in the same hue family yet clearly different in
 * lightness — close but legible.
 */
export const FONT_NUDGE_RATIO = 0.5;

/**
 * Derive a fixed, slightly-shifted color from `font` so it can be told apart
 * from a same-colored background WITHOUT changing the stored config. Light
 * fonts are darkened, dark fonts lightened, by a fixed fraction toward the
 * opposite extreme.
 */
export function distinguishableFontColor(font: string | undefined): string {
    const c = parseHexColor(font);
    if (!c) return font ?? "";
    const target = relativeLuminance(c) >= 0.5 ? 0 : 255;
    const mix = (v: number) => v + (target - v) * FONT_NUDGE_RATIO;
    return rgbToHex(mix(c.r), mix(c.g), mix(c.b));
}

/**
 * The font color to actually render: the configured one, unless it is exactly
 * equal to the background — then a nudged near-color so the text stays visible.
 * Pure/derived at render time; the saved config is never touched.
 */
export function effectiveFontColor(
    bg: string | undefined,
    font: string | undefined,
): string | undefined {
    return colorsEqual(bg, font) ? distinguishableFontColor(font) : font;
}
