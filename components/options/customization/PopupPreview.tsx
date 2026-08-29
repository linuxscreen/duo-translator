import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PopupApp from '@/entrypoints/popup/App';
// @ts-ignore — Vite's ?inline returns the compiled file contents as a string.
import popupCss from '@/entrypoints/popup/popup.css?inline';
import { bindThemeToElement, useResolvedTheme } from '@/utils/theme';

/** Width the popup is fixed at (`#root` / `html, body` in popup.css). */
const POPUP_WIDTH = 380;

/**
 * The popup's stylesheet, retargeted for a Shadow DOM.
 *
 * Tailwind v4 emits its `@theme` tokens on `:root, :host`, so the DARK base
 * already applies inside a shadow root untouched. The light theme does not:
 * it is an override block scoped to `html[data-theme="light"]`, and inside a
 * shadow tree there is no `<html>` to match — the preview would be stuck dark
 * for every light-theme user, silently. Rewriting that one selector onto the
 * host (which `bindThemeToElement` stamps) is the whole adaptation.
 *
 * A second copy of the token table under a shadow-safe selector was the
 * alternative and is worse: two tables to keep in step, and the preview would
 * drift from the real popup the first time only one of them was edited.
 */
const PREVIEW_CSS = (popupCss as string).replaceAll(
  'html[data-theme="light"]',
  ':host([data-theme="light"])',
);

/**
 * Live preview of the toolbar popup.
 *
 * Renders the REAL popup component, so every setting on this card is shown
 * exactly as it will look — including the pieces this card can hide, which the
 * popup gates on the same `usePopupUiPrefs()` hook.
 *
 * Nothing in it is clickable: the whole surface is `pointer-events: none`.
 * That is deliberately blunt rather than per-control — the popup writes config
 * and messages tabs from a dozen handlers, and a preview that could fire any
 * one of them would be changing the user's setup from inside a picture of it.
 * Its mount-time work is read-only, so the card is live without being able to
 * act.
 */
export function PopupPreview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // StrictMode invokes effects twice in development; a second attachShadow on
    // the same element throws.
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    if (shadow.firstChild) return;
    const style = document.createElement('style');
    style.textContent = PREVIEW_CSS;
    shadow.appendChild(style);
    const m = document.createElement('div');
    shadow.appendChild(m);
    setMount(m);
  }, []);

  // On the HOST, not the mount: the light-theme block above is scoped to
  // `:host([data-theme="light"])`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mount) return;
    return bindThemeToElement(host);
  }, [mount]);

  return (
    <div
      ref={hostRef}
      style={{
        width: POPUP_WIDTH,
        maxWidth: '100%',
        // `html, body { … }` in popup.css cannot match inside a shadow tree, so
        // the few things it set are applied to the host instead.
        colorScheme: resolvedTheme,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {mount &&
        createPortal(
          <div
            className="font-sans bg-bg text-ink"
            style={{ width: POPUP_WIDTH, pointerEvents: 'none' }}
          >
            {/* `embedded`: this copy must not record its height as the real
                popup's opening height — see entrypoints/popup/popupHeight.ts. */}
            <PopupApp embedded />
          </div>,
          mount,
        )}
    </div>
  );
}
