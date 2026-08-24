import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { NotFound } from '../routes/screens/NotFound.tsx';
import { Screen } from '../routes/screens/Screen.tsx';
import { StateGallery } from './StateGallery.tsx';
import { TokenReference } from '../theme/TokenReference.tsx';
import { useRoute } from '../routes/use-route.ts';
import './app-shell.css';

/**
 * The frame every authenticated screen mounts into (LAI-019).
 *
 * Landmarks are explicit: `<nav aria-label="Primary">` in the sidebar,
 * `<header>` for the top bar, `<main id="main">` for the screen. A skip link
 * jumps straight to `main`, because otherwise a keyboard user tabs through every
 * nav item on every navigation.
 *
 * **No API call anywhere here.** The user chrome renders an unauthenticated
 * slot; wiring it to `GET /api/v1/me` is LAI-007, which depends on the API.
 */
export function AppShell() {
  const { path, route, navigate } = useRoute();
  const [navOpen, setNavOpen] = useState(false);

  // Escape closes the off-canvas nav. Anything that traps focus on a narrow
  // screen needs a way out that is not a mouse.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Sidebar
        currentPath={path}
        onNavigate={navigate}
        open={navOpen}
        onClose={() => {
          setNavOpen(false);
        }}
      />

      {/* Click-catcher behind the off-canvas nav. `aria-hidden` and not
          focusable: Escape and the toggle are the accessible ways out. */}
      {navOpen && (
        <div
          className="shell-scrim"
          aria-hidden="true"
          onClick={() => {
            setNavOpen(false);
          }}
        />
      )}

      <div className="shell-body">
        <header className="shell-head">
          <button
            type="button"
            className="shell-navtoggle"
            aria-expanded={navOpen}
            aria-controls="sidebar"
            onClick={() => {
              setNavOpen((v) => !v);
            }}
          >
            <span className="visually-hidden">
              {navOpen ? 'Close navigation' : 'Open navigation'}
            </span>
            <span className="shell-navtoggle-bars" aria-hidden="true" />
          </button>

          <div className="shell-head-right">
            <ThemeToggle />
            {/* Layout only (LAI-019 Notes). LAI-007 fills this from GET /me. */}
            <div className="shell-user" data-state="unauthenticated">
              <span className="shell-user-avatar" aria-hidden="true" />
              <span className="shell-user-text">Not signed in</span>
            </div>
          </div>
        </header>

        <main id="main" className="shell-main" tabIndex={-1}>
          {route === undefined ? (
            <NotFound path={path} onNavigate={navigate} />
          ) : path === '/design/tokens' ? (
            <TokenReference />
          ) : path === '/design/states' ? (
            <StateGallery />
          ) : (
            <Screen route={route} />
          )}
        </main>
      </div>
    </div>
  );
}
