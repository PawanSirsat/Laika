import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initTheme } from './theme/theme.ts';
import './index.css';

// Before React renders, so the first paint React produces is already themed.
// This cannot be an inline <script> in index.html: the CSP is `script-src 'self'`
// with no 'unsafe-inline' (LAI-023, verified in LAI-103). Module scripts are
// deferred, so a dark-mode reader may still see one light frame — a smaller
// price than relaxing the policy.
initTheme();

const container = document.getElementById('root');

// A missing #root means index.html and this entry point have drifted apart.
// Throwing names the cause; `createRoot(null!)` would fail later and vaguer.
if (!container) {
  throw new Error('Laika: no #root element in index.html — cannot mount the app.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
