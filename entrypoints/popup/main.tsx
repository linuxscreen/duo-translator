import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './popup.css';
import App from './App';
import { initExtensionPageTheme } from '@/utils/theme';

// Stamp data-theme on <html> before first render (light theme is a CSS token
// override; dark is the attribute-less default).
initExtensionPageTheme();

// Extension popups that size their window to their content fire `resize` (and
// an occasional `blur`) on every DOM mutation — Firefox up to 10x/sec (Bugzilla
// #1700193), Safari's auto-sizing popover the same way. Radix Select closes
// itself on `window` resize/blur (see react-select's SelectContentImpl), so it
// snaps shut the instant its portal content mounts, making every dropdown in
// the popup look unclickable. Radix exposes no prop to disable those listeners,
// so we swallow the spurious events while any Radix popper layer is open.
// Registered here — before React mounts, therefore before Radix registers its
// own window listeners — so this runs first at the target and can
// stopImmediatePropagation() Radix's close handler.
//
// Deliberately NOT gated on a browser: the guard only fires while a popper is
// open, it is inert on Chromium (which never sends the storm), and nothing else
// in the popup listens for `resize`. Gating it on Firefox is what left Safari
// broken.
const swallowWhilePopperOpen = (event: Event) => {
  if (document.querySelector('[data-radix-popper-content-wrapper]')) {
    event.stopImmediatePropagation();
  }
};
window.addEventListener('resize', swallowWhilePopperOpen);
window.addEventListener('blur', swallowWhilePopperOpen);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
