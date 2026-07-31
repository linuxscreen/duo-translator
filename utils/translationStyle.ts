import type { CSSProperties } from 'react';
import { STYLE_NONE } from '@/main/constants';
import { effectiveFontColor } from '@/utils/color';

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
export function buildStylePreview(opts: {
  style: string;
  bgColor?: string;
  fontColor?: string;
  borderColor?: string;
  forHighlight?: boolean;
}): CSSProperties {
  const css: CSSProperties = {};
  if (opts.bgColor) css.backgroundColor = opts.bgColor;
  // Mirror the live page: nudge font to a near-color when it equals the bg.
  const fontColor = effectiveFontColor(opts.bgColor, opts.fontColor);
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
export function styleHasBorder(style: string): boolean {
  return style !== STYLE_NONE && style !== '';
}
