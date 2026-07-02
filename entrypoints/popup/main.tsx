import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './popup.css';
import App from './App';

// Firefox extension popups recalc their window size on every DOM mutation and
// fire `resize` (and an occasional `blur`) up to 10x/sec — Bugzilla #1700193.
// Radix Select closes itself on `window` resize/blur (see react-select's
// SelectContentImpl), so it snaps shut the instant its portal content mounts,
// making every dropdown in the popup look unclickable. Radix exposes no prop to
// disable those listeners, so we swallow the spurious events while any Radix
// popper layer is open. Registered here — before React mounts, therefore before
// Radix registers its own window listeners — so this runs first at the target
// and can stopImmediatePropagation() Radix's close handler.
if (import.meta.env.BROWSER === 'firefox') {
  const swallowWhilePopperOpen = (event: Event) => {
    if (document.querySelector('[data-radix-popper-content-wrapper]')) {
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener('resize', swallowWhilePopperOpen);
  window.addEventListener('blur', swallowWhilePopperOpen);
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
