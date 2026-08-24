import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { FirstBootScreen } from '../routes/screens/FirstBootScreen.tsx';
import { InviteScreen } from '../routes/screens/InviteScreen.tsx';
import { LoginScreen } from '../routes/screens/LoginScreen.tsx';
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

  // The instance the browser is actually pointed at. Read from the location
  // rather than hardcoded: the prototype's `laika.kvelld.internal` is a fixture,
  // and this is correct for every deployment without configuration.
  const instanceHost = window.location.host;

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
          ) : path === '/login' ? (
            <LoginScreen host={instanceHost} />
          ) : path === '/invite' ? (
            // Layout preview until LAI-007 reads the invite token and supplies
            // the real inviter, org, email, role and expiry. The values below
            // are generic English rather than a fabricated person or company —
            // no Mira Kellner, no Kvelld Dynamics (CLAUDE.md §5.1).
            <InviteScreen
              host={instanceHost}
              inviterName="An administrator"
              orgName="this organisation"
              email="the address your invite was sent to"
              role="member"
              expiresIn="7 days"
            />
          ) : path === '/first-boot' ? (
            <FirstBootScreen
              host={instanceHost}
              migrationsApplied={0}
              migrationsTotal={0}
              smtpConfigured={false}
            />
          ) : (
            <Screen route={route} />
          )}
        </main>
      </div>
    </div>
  );
}
