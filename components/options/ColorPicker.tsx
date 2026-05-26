import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { cn } from '@/lib/cn';

type Props = {
  value: string;
  selectedIndex: number;
  presets: string[];
  onChange: (color: string, index: number) => void;
  className?: string;
};

const CHECKER_BG =
  'linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)';

// Approximate popover size — used for viewport flipping math when opening.
const POPOVER_W = 240;
const POPOVER_H = 280;

// 5 preset swatches + 1 custom swatch (last). `presets[0]` empty string means
// the first swatch is the "no color / transparent" slot (rendered with a checker
// pattern). Selected swatch always shows a checkmark — including transparent
// and custom slots. The custom slot opens a HEX popover; first activation
// commits the last-used custom color so the swatch tracks state predictably.
//
// The popover is rendered in a portal at document.body with fixed positioning
// so cards / scroll containers can't clip it, and it flips above the trigger
// when there isn't room below in the viewport.
export function ColorPicker({ value, selectedIndex, presets, onChange, className }: Props) {
  const { t } = useTranslation();
  const customIndex = presets.length;
  const isCustom = selectedIndex === customIndex;

  // Last custom color the user picked (used to re-select on swatch click and as
  // the initial color when first opening the popover from a preset).
  const [customColor, setCustomColor] = useState<string>(
    isCustom && value ? value : '#48be78',
  );
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const customBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCustom && value) setCustomColor(value);
  }, [isCustom, value]);

  // Outside-click to close popover. The popover lives in a portal so it isn't
  // inside containerRef — we explicitly include it in the "inside" check.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Re-anchor when the trigger moves or the viewport scrolls/resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = customBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const flipUp = r.bottom + 8 + POPOVER_H > vh && r.top - 8 - POPOVER_H > 0;
      const top = flipUp ? r.top - 8 - POPOVER_H : r.bottom + 8;
      // Align right edge with the swatch; clamp inside viewport.
      let left = r.right - POPOVER_W;
      if (left < 8) left = 8;
      if (left + POPOVER_W > vw - 8) left = vw - POPOVER_W - 8;
      setPos({ left, top });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const handlePresetClick = (idx: number) => {
    setOpen(false);
    onChange(presets[idx] ?? '', idx);
  };

  const handleCustomClick = () => {
    // First click activates the custom slot using the last-used color so the
    // selection is committed immediately; subsequent clicks just toggle the panel.
    if (!isCustom) onChange(customColor, customIndex);
    setOpen((v) => !v);
  };

  const handlePopoverChange = (c: string) => {
    setCustomColor(c);
    onChange(c, customIndex);
  };

  return (
    <div ref={containerRef} className={cn('inline-flex items-center gap-1.5', className)}>
      {presets.map((color, idx) => {
        const isEmpty = color === '';
        const active = selectedIndex === idx;
        return (
          <button
            key={idx}
            type="button"
            onClick={() => handlePresetClick(idx)}
            title={isEmpty ? t('none', 'none') : color}
            className={cn(
              'relative h-5 w-5 cursor-pointer rounded-md border border-line/60 transition',
              'hover:scale-110',
              active && 'ring-2 ring-offset-1 ring-offset-surface ring-ink/50',
            )}
            style={
              isEmpty
                ? {
                    backgroundColor: '#fff',
                    backgroundImage: CHECKER_BG,
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                  }
                : { backgroundColor: color }
            }
          >
            {active && <Checkmark dark={isEmpty} />}
          </button>
        );
      })}
      <button
        ref={customBtnRef}
        type="button"
        onClick={handleCustomClick}
        title={t('customColor', 'Custom color')}
        className={cn(
          'relative h-5 w-5 cursor-pointer overflow-hidden rounded-md border border-line/60 transition',
          'hover:scale-110',
          isCustom && 'ring-2 ring-offset-1 ring-offset-surface ring-ink/50',
        )}
        style={{
          background:
            'conic-gradient(from 0deg, #ff5252, #ffeb3b, #4caf50, #2196f3, #9c27b0, #ff5252)',
        }}
      >
        {isCustom && <Checkmark dark={false} />}
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_W }}
            className="z-[2147483700] rounded-xl border border-line bg-surface p-3 shadow-[0_12px_28px_-8px_rgba(0,0,0,.6),0_0_0_0.5px_rgba(255,255,255,.04)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="duo-color-picker">
              <HexColorPicker color={customColor} onChange={handlePopoverChange} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[12px] uppercase tracking-wide text-ink-soft">HEX</span>
              <HexColorInput
                prefixed
                color={customColor}
                onChange={handlePopoverChange}
                className="h-7 w-24 rounded-md border border-line bg-surface px-2 text-[12px] uppercase tabular-nums text-ink outline-none focus:border-accent"
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Checkmark({ dark }: { dark: boolean }) {
  // `dark` = transparent swatch → checkmark sits on the white/checker pattern
  // so it must be an explicit dark color (theme `ink` is light in this dark UI
  // and would be near-invisible). Solid swatches use white with a soft shadow.
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-1.5 -translate-x-1/2 -translate-y-[60%] rotate-45 border-b-2 border-r-2"
      style={
        dark
          ? { borderColor: '#27272a' }
          : { borderColor: '#ffffff', filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.5))' }
      }
    />
  );
}
