import { useCallback, useEffect, useState } from 'react';
// Three stylesheets first, before the palette's: where the single stylesheet
// had them before screens were split, so its cascade is unchanged (LAI-1219 —
// see `shell/screen-styles.ts`).
import './tooltip/tooltip.css';
import './icon/icon.css';
import './states.css';
import { CommandPaletteHost } from './command/CommandPaletteHost.tsx';
import { CreateTaskProvider } from './create-task/CreateTaskProvider.tsx';
import { ShortcutsHost } from './shell/ShortcutsHost.tsx';
import { ScreenOutlet } from './shell/ScreenOutlet.tsx';
import { ShellHeader } from './shell/ShellHeader.tsx';
import { ROUTES_WITH_THEIR_OWN_BRAND } from './Brand.tsx';
import { ShellSidebar } from './shell/ShellSidebar.tsx';
import { SessionGate } from './shell/SessionGate.tsx';
import { ShellProvider } from './shell/ShellProvider.tsx';
import { useShell } from './shell/shell-context.ts';
import { showsAppNav } from './shell-chrome.ts';
import { DEFAULT_PATH } from '../routes/route-table.ts';
import { preloadPath } from '../routes/screen-chunks.ts';
import {
  NARROW_QUERY,
  railCollapsed,
  readSidebar,
  toggleRail,
  writeSidebar,
  type SidebarPreference,
} from './sidebar/sidebar-state.ts';
import { atOrBelow, below } from '../theme/breakpoints.ts';
import './app-shell.css';

/** Below this the sidebar is off-canvas, and the rail has no meaning (app-shell.css). */
const OFF_CANVAS_QUERY = atOrBelow('tablet');

/**
 * My day's drawer (LAI-511) is a 400px column beside the page. Under 1280px
 * the owner's design folds the sidebar away while it is open, so the page
 * keeps its width; here that is the icon rail. The screen says so on `<html>`
 * — a screen cannot reach the shell's state, and the attribute is the one
 * thing both can see.
 */
const DRAWER_ATTR = 'data-myday-drawer-open';
const DRAWER_TIGHT_QUERY = below('desktop');

/** Local storage, or nothing — reading the property itself can throw. */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Whether a media query matches, kept live. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => {
      setMatches(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, [query]);
  return matches;
}

/** Whether a screen has set {@link DRAWER_ATTR} on `<html>`, kept live. */
function useDrawerOpen(): boolean {
  const [open, setOpen] = useState(() => document.documentElement.hasAttribute(DRAWER_ATTR));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setOpen(root.hasAttribute(DRAWER_ATTR));
    });
    observer.observe(root, { attributes: true, attributeFilter: [DRAWER_ATTR] });
    setOpen(root.hasAttribute(DRAWER_ATTR));
    return () => {
      observer.disconnect();
    };
  }, []);
  return open;
}

/**
 * The icon rail (LAI-796): remembered per browser, automatic on a narrow
 * window, inert where the sidebar is off-canvas. The rules are
 * `sidebar-state.ts`'s; this only holds the state and reads the window.
 */
function useRail(): { readonly collapsed: boolean; readonly toggle: () => void } {
  const [preference, setPreference] = useState<SidebarPreference | undefined>(() => {
    const store = storage();
    return store === undefined ? undefined : readSidebar(store);
  });
  const narrow = useMedia(NARROW_QUERY);
  const offCanvas = useMedia(OFF_CANVAS_QUERY);
  const [openedWhileNarrow, setOpenedWhileNarrow] = useState(false);

  // A change of width starts the automatic band afresh.
  useEffect(() => {
    setOpenedWhileNarrow(false);
  }, [narrow]);

  const state = { preference, narrow, openedWhileNarrow };
  const toggle = useCallback(() => {
    const next = toggleRail({ preference, narrow, openedWhileNarrow });
    setPreference(next.preference);
    setOpenedWhileNarrow(next.openedWhileNarrow);
    const store = storage();
    if (next.remember && next.preference !== undefined && store !== undefined) {
      writeSidebar(store, next.preference);
    }
  }, [preference, narrow, openedWhileNarrow]);

  // Off-canvas, the sidebar is always drawn whole: the phone's menu.
  return { collapsed: !offCanvas && railCollapsed(state), toggle };
}

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
  // The icon rail (LAI-796), toggled in the top bar (LAI-1227) and remembered.
  // Inert below 900px, where the sidebar is off-canvas at full width.
  const { collapsed: remembered, toggle: toggleRailState } = useRail();
  // My day's drawer takes the rail's room under 1280px (LAI-511); off-canvas
  // there is no rail to fold.
  const drawerOpen = useDrawerOpen();
  const tight = useMedia(DRAWER_TIGHT_QUERY);
  const offCanvas = useMedia(OFF_CANVAS_QUERY);
  const navCollapsed = remembered || (drawerOpen && tight && !offCanvas);

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

  // The default screen — a space's board, where a nav link to a space lands —
  // is fetched once the first page has painted (LAI-1219), so the most likely
  // next page is already here. Signed in only: nothing is warmed for a
  // visitor on the sign-in page. Already loading if that is where we are.
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        preloadPath(DEFAULT_PATH);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [signedIn]);
  // A full-page screen that draws its own brand and theme control gets no
  // header on top of it (LAI-075).
  const ownsChrome = path === '/setup';

  return (
    <CreateTaskProvider>
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

        {/*
          **The top bar spans the window** (LAI-1227, the owner's Jira
          reference): it sits above the sidebar and the page alike, and holds
          the sidebar's toggle and the brand, so the sidebar below it is the
          navigation and nothing else.
        */}
        {ownsChrome ? null : (
          <ShellHeader
            signedIn={signedIn}
            brand={!ROUTES_WITH_THEIR_OWN_BRAND.includes(path)}
            navOpen={navOpen}
            onToggleNav={() => {
              setNavOpen((v) => !v);
            }}
            railCollapsed={navCollapsed}
            onToggleRail={toggleRailState}
          />
        )}

        <div className="shell-frame">
          {signedIn && (
            <ShellSidebar
              open={navOpen}
              onClose={() => {
                setNavOpen(false);
              }}
              collapsed={navCollapsed}
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
            {/*
              The space bar — identity, tabs, presence — belongs to the views of
              a space, so `SpaceLayout` renders it around them (LAI-251).
            */}
            <main id="main" className="shell-main" tabIndex={-1}>
              <SessionGate>
                <ScreenOutlet />
              </SessionGate>
            </main>
          </div>
        </div>

        {/* ⌘K, and the palette it opens (LAI-1192): a signed-in tool. */}
        {signedIn && <CommandPaletteHost />}
        {signedIn && <ShortcutsHost />}
      </div>
    </CreateTaskProvider>
  );
}
