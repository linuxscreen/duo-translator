import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './options.css';
import App from './App';
import { initExtensionPageTheme } from '@/utils/theme';

// Stamp data-theme on <html> before first render (light theme is a CSS token
// override; dark is the attribute-less default).
initExtensionPageTheme();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
