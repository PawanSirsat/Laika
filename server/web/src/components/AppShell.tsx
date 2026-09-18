import { useEffect, useState } from 'react';
import { SpaceTabs } from './SpaceTabs.tsx';
import { ScreenOutlet } from './shell/ScreenOutlet.tsx';
import { ShellHeader } from './shell/ShellHeader.tsx';
import { ShellSidebar } from './shell/ShellSidebar.tsx';
import { SessionGate } from './shell/SessionGate.tsx';
import { ShellProvider } from './shell/ShellProvider.tsx';
import { useShell } from './shell/shell-context.ts';
import { showsAppNav } from './shell-chrome.ts';
import { permissionHolder } from '../routes/nav-permissions.ts';
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
    route: { path, navigate, params },
    session,
    me,
    sprintCount,
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

  const projectSlug = params.get('project') ?? undefined;

  return (
    <div className={signedIn ? 'shell' : 'shell shell-preauth'}>
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
          The views of the space you are in (LAI-248). Above `<main>`, not
          inside it, because it belongs to the shell rather than to whichever
          screen happens to be showing — and it is the same bar across all of
          them, which is what makes them read as views of one thing.

          `SpaceTabs` renders nothing without a project, so org-level screens
          and the pre-auth routes get no bar: there is no space to be inside of.
        */}
        {signedIn && (
          <SpaceTabs
            currentPath={path}
            projectSlug={projectSlug}
            onNavigate={navigate}
            holds={permissionHolder(me?.org_role)}
            counts={{ '/sprints': sprintCount }}
          />
        )}

        <main id="main" className="shell-main" tabIndex={-1}>
          <SessionGate>
            <ScreenOutlet />
          </SessionGate>
        </main>
      </div>
    </div>
  );
}
