import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initFont } from './theme/font.ts';
import { initTheme } from './theme/theme.ts';
import './index.css';

// Before React renders. `public/theme-boot.js` already put the stored theme and
// font on <html> before the first paint (LAI-1212) — a classic same-origin
// script, since the CSP has no 'unsafe-inline' (LAI-023, LAI-103); these calls
// are the authority and re-apply the same answer from the real modules.
initTheme();
// The interface font a reader chose on this device (LAI-1125), for the same
// reason and in the same place — the sign-in screen is set in it too.
initFont();

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
