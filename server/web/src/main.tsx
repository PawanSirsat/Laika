import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

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
