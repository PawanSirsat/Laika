import { useEffect, useState } from 'react';
import { ScreenOutlet } from './shell/ScreenOutlet.tsx';
import { ShellHeader } from './shell/ShellHeader.tsx';
import { ShellSidebar } from './shell/ShellSidebar.tsx';
import { SessionGate } from './shell/SessionGate.tsx';
import { ShellProvider } from './shell/ShellProvider.tsx';
import { useShell } from './shell/shell-context.ts';
import { showsAppNav } from './shell-chrome.ts';
import './app-shell.css';

/**
 * The frame every screen mounts into (LAI-019, decomposed by LAI-250).
 *
 * Composition only. What used to live here — the session, the setup gate, the
 * invite token, three submit handlers and a sixteen-branch ternary chain — is
 * now `ShellProvider` (state), `SessionGate` (who may see a screen) and
 * `ScreenOutlet` (which screen). This file decides what the chrome looks like
 * and nothing else.
 *
 * Landmarks are explicit: `<nav aria-label="Primary">` in the sidebar,
 * `<header>` for the top bar, `<main id="main">` for the screen. A skip link
 * jumps straight to `main`, because otherwise a keyboard user tabs through
 * every nav item on every navigation.
 */
export function AppShell() {
  return (
    <ShellProvider>
      <AppFrame />
    </ShellProvider>
  );
}

function AppFrame() {
  const {
    route: { path },
    session,
  } = useShell();

  const [navOpen, setNavOpen] = useState(false);
  // The 56px rail (LAI-249), toggled by the logo. Desktop-only — the CSS makes
  // it inert below 900px, where the sidebar is off-canvas at full width.
  const [navCollapsed, setNavCollapsed] = useState(false);

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

  /**
   * The app chrome belongs to a signed-in session, not to a list of routes
   * (LAI-062).
   *
   * Keying it on the route would mean every route added later inherits whatever
   * default it happened to get — which is exactly how `/login`, `/setup` and
   * `/invite` came to render eight protected destinations beside the words "Not
   * signed in", each one bouncing straight back to `/login`. Keying it on the
   * session fails safe in both directions.
   */
  const signedIn = showsAppNav(session);
  // A full-page screen that draws its own brand and theme control gets no
  // header on top of it (LAI-075).
  const ownsChrome = path === '/setup';

  return (
    <div
      className={[
        'shell',
        signedIn ? '' : 'shell-preauth',
        // The rail's width is a shell fact the task drawer's scrim reads
        // (LAI-252) — see `--rail-width` in app-shell.css.
        signedIn && navCollapsed ? 'shell-rail-mini' : '',
      ]
        .filter((c) => c !== '')
        .join(' ')}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {signedIn && (
        <ShellSidebar
          open={navOpen}
          onClose={() => {
            setNavOpen(false);
          }}
          collapsed={navCollapsed}
          onToggleCollapse={() => {
            setNavCollapsed((v) => !v);
          }}
        />
      )}

      {/* Click-catcher behind the off-canvas nav. `aria-hidden` and not
          focusable: Escape and the toggle are the accessible ways out. */}
      {signedIn && navOpen && (
        <div
          className="shell-scrim"
          aria-hidden="true"
          onClick={() => {
            setNavOpen(false);
          }}
        />
      )}

      <div className="shell-body">
        {ownsChrome ? null : (
          <ShellHeader
            signedIn={signedIn}
            navOpen={navOpen}
            onToggleNav={() => {
              setNavOpen((v) => !v);
            }}
          />
        )}

        {/*
          The space bar — identity, tabs, presence — belongs to the views of a
          space, so `SpaceLayout` renders it around them (LAI-251). It was here
          while it was only a tab strip; a bar that knows which project it is
          about cannot live above the screen that chose the project.
        */}

        <main id="main" className="shell-main" tabIndex={-1}>
          <SessionGate>
            <ScreenOutlet />
          </SessionGate>
        </main>
      </div>
    </div>
  );
}
