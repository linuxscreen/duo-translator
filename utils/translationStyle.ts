import type { CSSProperties } from 'react';
import { STYLE_NONE } from '@/main/constants';

// Build inline CSS for the translation style preview.
// `borderColor` is only applied when the style produces a border (not for underline/text-decoration styles).
export function buildStylePreview(opts: {
  style: string;
  bgColor?: string;
  fontColor?: string;
  borderColor?: string;
}): CSSProperties {
  const css: CSSProperties = {};
  if (opts.bgColor) css.backgroundColor = opts.bgColor;
  if (opts.fontColor) css.color = opts.fontColor;
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
