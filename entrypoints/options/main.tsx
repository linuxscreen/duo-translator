import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './options.css';
import App from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
