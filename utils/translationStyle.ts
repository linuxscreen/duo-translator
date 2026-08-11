import type { CSSProperties } from 'react';
import { STYLE_BLUR, STYLE_DIM, STYLE_NONE, STYLE_QUOTE } from '@/main/constants';
import { effectiveFontColor } from '@/utils/color';

// ─── Enhance styles ─────────────────────────────────────────────────────────
// The numbers live here rather than in main/css.ts so the Options preview and
// the page render from one source.
/** Dimmed translation; hovering it restores full opacity. */
export const DIM_OPACITY = 0.6;
/** Blurred translation; hovering it lifts the blur. */
export const BLUR_RADIUS_PX = 4;
/** Leading bar of the quote style. */
export const QUOTE_BAR_WIDTH_PX = 3;
export const QUOTE_BAR_GAP = '0.6em';
/** Fallback for an unset quote-bar color: follow the translation's own text. */
export const QUOTE_BAR_DEFAULT_COLOR = 'currentColor';

/**
 * Which color pickers a style actually uses, in the order they should be shown.
 *
 * This is the single definition of that mapping — Options renders its rows from
 * it and main/css.ts gates its declarations on it, so a picker is never offered
 * for a color the page will ignore (nor a color silently applied with no way to
 * change it).
 *
 * - `none`: background + font, as before.
 * - border / underline styles: the border color leads, since it is what the
 *   style is *about*; background + font follow.
 * - `dim` / `blur`: font only — both work by attenuating the whole paragraph,
 *   and a background fill would defeat that.
 * - `quote`: font + the bar's own color (`quoteBorder`, its own config key).
 */
export type StyleColorField = 'border' | 'bg' | 'font' | 'quoteBorder';

export function styleColorFields(style: string): StyleColorField[] {
  switch (style) {
    case STYLE_DIM:
    case STYLE_BLUR:
      return ['font'];
    case STYLE_QUOTE:
      return ['font', 'quoteBorder'];
    case STYLE_NONE:
    case '':
      return ['bg', 'font'];
    default:
      return ['border', 'bg', 'font'];
  }
}

/** Does this style paint the configured background color? */
export function styleUsesBackground(style: string): boolean {
  return styleColorFields(style).includes('bg');
}

// The three border styles, mapped onto the line style that stands in for them in
// the *bilingual-highlight* context. Shared with main/css.ts
// (getHighlightCSSRuleString), which explains why the substitution exists: the
// highlight painter has no box to put a border on.
export const HIGHLIGHT_BORDER_LINE_STYLE: Record<string, string> = {
  solidBorder: 'solid',
  dottedBorder: 'dotted',
  dashedBorder: 'dashed',
};

// Build inline CSS for the translation style preview.
// `borderColor` is only applied when the style produces a border (not for underline/text-decoration styles).
// `forHighlight` previews the bilingual-highlight context, where the border
// styles render as `underline overline` instead — the preview has to show what
// the page will actually paint, not a box the page cannot draw.
// `quoteBorderColor` colors the quote style's leading bar; `hovered` previews the
// hover state of the two attenuating styles (dim / blur), which the page gets
// from `.duo-translation:hover`.
export function buildStylePreview(opts: {
  style: string;
  bgColor?: string;
  fontColor?: string;
  borderColor?: string;
  quoteBorderColor?: string;
  forHighlight?: boolean;
  hovered?: boolean;
}): CSSProperties {
  const css: CSSProperties = {};
  // A style that ignores the background must ignore it here too, or the preview
  // shows a fill the page will never paint.
  const bgColor = styleUsesBackground(opts.style) ? opts.bgColor : '';
  if (bgColor) css.backgroundColor = bgColor;
  // Mirror the live page: nudge font to a near-color when it equals the bg.
  const fontColor = effectiveFontColor(bgColor, opts.fontColor);
  if (fontColor) css.color = fontColor;
  const highlightLine = opts.forHighlight ? HIGHLIGHT_BORDER_LINE_STYLE[opts.style] : undefined;
  if (highlightLine) {
    // No textUnderlineOffset: there is no overline counterpart, so offsetting
    // one of the pair would render them lopsided.
    css.textDecoration = `underline overline ${highlightLine}`;
    css.textDecorationThickness = '1px';
    if (opts.borderColor) css.textDecorationColor = opts.borderColor;
    return css;
  }
  switch (opts.style) {
    case STYLE_NONE:
      css.border = 'none';
      break;
    // Dim does not lift on hover — see getEnhanceHoverRuleString.
    case STYLE_DIM:
      css.opacity = DIM_OPACITY;
      break;
    case STYLE_BLUR:
      css.filter = opts.hovered ? 'none' : `blur(${BLUR_RADIUS_PX}px)`;
      css.transition = 'filter 0.2s ease';
      break;
    case STYLE_QUOTE:
      css.borderLeft = `${QUOTE_BAR_WIDTH_PX}px solid ${opts.quoteBorderColor || QUOTE_BAR_DEFAULT_COLOR}`;
      css.paddingLeft = QUOTE_BAR_GAP;
      // The preview box is rounded; a rounded corner on a 3px edge that has no
      // neighbours curls the bar's ends into hooks. The page's translation has
      // no radius, so squaring it here is what makes the two agree.
      css.borderRadius = 0;
      break;
    case 'solidBorder':
      css.border = `2px solid ${opts.borderColor || 'currentColor'}`;
      break;
    case 'dottedBorder':
      css.border = `2px dotted ${opts.borderColor || 'currentColor'}`;
      break;
    case 'dashedBorder':
      css.border = `2px dashed ${opts.borderColor || 'currentColor'}`;
      break;
    case 'wavyLine':
      css.textDecoration = `wavy underline`;
      if (opts.borderColor) css.textDecorationColor = opts.borderColor;
      css.textUnderlineOffset = '4px';
      break;
    case 'doubleLine':
      css.textDecoration = `underline double`;
      if (opts.borderColor) css.textDecorationColor = opts.borderColor;
      css.textUnderlineOffset = '4px';
      break;
    case 'underLine':
      css.textDecoration = `underline`;
      if (opts.borderColor) css.textDecorationColor = opts.borderColor;
      css.textUnderlineOffset = '4px';
      break;
    case 'dottedLine':
      css.textDecoration = `underline dotted`;
      if (opts.borderColor) css.textDecorationColor = opts.borderColor;
      css.textUnderlineOffset = '4px';
      break;
    case 'dashedLine':
      css.textDecoration = `underline dashed`;
      if (opts.borderColor) css.textDecorationColor = opts.borderColor;
      css.textUnderlineOffset = '4px';
      break;
  }
  return css;
}

// True when the selected style produces a border ring (so the border-color picker
// makes sense). For underline variants we still allow color on text-decoration,
// so treat them as "has border" too for color picker visibility.
//
// Only the *highlight* picker uses this — its option list (STYLE_GROUPS) has no
// enhance styles. The translation picker renders its rows from
// styleColorFields, which covers the same ground plus the enhance cases.
export function styleHasBorder(style: string): boolean {
  return style !== STYLE_NONE && style !== '';
}
