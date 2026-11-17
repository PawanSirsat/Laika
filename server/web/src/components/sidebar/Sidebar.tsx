import { Chip } from '../chip/Chip.tsx';
import { COUNT_CAP, formatCount } from '../chip/chip-model.ts';
import {
  GROUP_TITLES,
  NAV_GROUPS,
  navSection,
  routesInGroup,
  type NavGroup,
} from '../../routes/route-table.ts';
import { meetingsHolder, permissionHolder } from '../../routes/nav-permissions.ts';
import { useMeetingsEnabled } from '../../api/meetings.ts';
import { useShell } from '../shell/shell-context.ts';
import { navHref } from '../../routes/nav-url.ts';
import { SpacesSection } from './SpacesSection.tsx';
import { NavIcon } from './NavIcon.tsx';
import type { SidebarSpace, Space } from '../../routes/spaces.ts';
import type { MeProfile } from '../../api/me.ts';
import './sidebar.css';
import { usePermissions } from '../../api/permissions.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { preloadOn } from '../../routes/screen-chunks.ts';
import { useEffect, useRef } from 'react';
import { navShortcut, navShortcutTarget } from '../shell/nav-shortcuts.ts';
import { ariaShortcut, formatShortcut, onMac } from '../tooltip/shortcut.ts';

const MAC = onMac();

export interface SidebarProps {
  readonly currentPath: string;
  readonly onNavigate: (to: string) => void;
  /** Open on narrow viewports, where the sidebar is off-canvas. */
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * The icon rail (LAI-796, from LAI-249's 56px rail): icons, tooltips and the
   * same counts. Distinct from `open`, which is the phone's off-canvas state.
   */
  readonly collapsed: boolean;
  /** Slug of the project in the URL, when there is one. */
  readonly projectSlug?: string | undefined;
  /** The rail's spaces: pinned, then recent (LAI-247, LAI-989). Empty renders no section. */
  readonly spaces?: readonly SidebarSpace[] | undefined;
  /** Every fetched space, for the More-spaces popover. */
  readonly allSpaces?: readonly Space[] | undefined;
  /** Open a space: sets the project and goes to its board. */
  readonly onOpenSpace?: ((slug: string) => void) | undefined;
  /** Pin or unpin a space, in this browser (LAI-989). Absent draws no pin control. */
  readonly onTogglePin?: ((slug: string) => void) | undefined;
  /** Accepted and currently unused: the rail's wordmark is always the
   * product (owner, 2026-09-21); callers still pass the open space's name. */
  readonly spaceName?: string | undefined;
  /** Counts by route path. No entry, no badge — that is how it stays honest. */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
  /**
   * What a path's count counts, and the tab it lives on (LAI-1191, the audit's
   * B8): while the badge shows, the link opens that tab, and a screen reader
   * hears the noun. No entry: the page's own first tab, and *waiting*.
   */
  readonly countTargets?: Readonly<Record<string, CountTarget>> | undefined;
  /** The signed-in user: the Alt keys and the gates are a signed-in rail's. */
  readonly user?: MeProfile | undefined;
}

/** Where a badge leads and what it counts. */
export interface CountTarget {
  /** The `?tab=` the counted things are on. */
  readonly tab?: string;
  /** The noun for one, and for several: `token alert`, `token alerts`. */
  readonly one: string;
  readonly many: string;
}

/** `href` with `?tab=` set, keeping whatever else it carries. */
function withTab(href: string, tab: string | undefined): string {
  if (tab === undefined) return href;
  const at = href.indexOf('?');
  const params = new URLSearchParams(at === -1 ? '' : href.slice(at + 1));
  params.set('tab', tab);
  return `${at === -1 ? href : href.slice(0, at)}?${params.toString()}`;
}

/**
 * The sidebar, to the owner's reference (LAI-796): the reader's own places at
 * the top — *My day*, *Inbox* — then the spaces, then the organisation's
 * pages, and the person at the foot, whose menu holds their profile, the
 * theme, Developer access and signing out.
 *
 * **It collapses to an icon rail** with a toggle in its head: each entry keeps
 * its icon and its count, and says its name in a tooltip on hover and on
 * keyboard focus. Remembered per browser, and automatic on a narrow window
 * (`sidebar-state.ts`).
 *
 * A real `<a href>` per destination, not a div with a click handler:
 * middle-click, copy-link and the browser's focus handling come free, and the
 * `onClick` only suppresses the reload.
 */
export function Sidebar({
  currentPath,
  onNavigate,
  open,
  onClose,
  collapsed,
  projectSlug,
  spaces,
  allSpaces,
  onOpenSpace,
  onTogglePin,
  counts,
  countTargets,
  user,
}: SidebarProps) {
  const { permissions } = usePermissions(user !== undefined);
  const { signInMethod } = useShell();
  // Meetings exist only behind Microsoft SSO, so nothing is asked elsewhere.
  const meetingsOn = useMeetingsEnabled(user !== undefined && signInMethod === 'microsoft');
  /**
   * The reader's permissions, mirrored from `policy/can.ts` at one remove — the
   * one predicate every gated entry and tab asks — with Meetings offered only
   * where the instance syncs them (LAI-1312).
   */
  const holds = meetingsHolder(permissionHolder(permissions?.me.actions), meetingsOn);
  // The Connect wizard lights Developer access, the page it is opened from.
  const section = navSection(currentPath);

  const railClass = ['sidebar', open ? 'sidebar-open' : '', collapsed ? 'sidebar-collapsed' : '']
    .filter((c) => c !== '')
    .join(' ');

  /* A group with nothing the reader may open is not drawn at all. */
  const shown = NAV_GROUPS.filter((group) => routesInGroup(group, holds).length > 0);

  /** Where each destination's link goes — the same address its Alt key opens. */
  const hrefFor = (path: string): string => {
    const count = counts?.[path];
    const counted = count !== undefined && count > 0;
    return withTab(navHref(path, projectSlug), counted ? countTargets?.[path]?.tab : undefined);
  };

  /*
   * The destinations' keys (LAI-1221, `nav-shortcuts.ts`): ⌥1 – ⌥6, only for
   * the destinations drawn here, never while typing, never over a modal.
   * Kept in a ref so the listener is added once and reads the current rail.
   */
  const keys = useRef({ visible: [] as string[], hrefFor, onNavigate, onClose });
  keys.current = {
    visible: shown.flatMap((group) => routesInGroup(group, holds).map((r) => r.path)),
    hrefFor,
    onNavigate,
    onClose,
  };
  const signedIn = user !== undefined;
  useEffect(() => {
    if (!signedIn) return;
    const onKey = (event: KeyboardEvent): void => {
      const now = keys.current;
      const path = navShortcutTarget(
        {
          code: event.code,
          altKey: event.altKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          defaultPrevented: event.defaultPrevented,
          target: event.target instanceof Element ? event.target : null,
        },
        now.visible,
      );
      if (path === undefined) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      event.preventDefault();
      now.onNavigate(now.hrefFor(path));
      now.onClose();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [signedIn]);

  const renderGroup = (group: NavGroup) => {
    const title = GROUP_TITLES[group];
    return (
      <div key={group} className={`sidebar-group sidebar-group-${group.toLowerCase()}`}>
        {title !== null &&
          (collapsed ? (
            <div className="sidebar-minirule" aria-hidden="true" />
          ) : (
            <h2 className="sidebar-group-title" id={`nav-${group}`}>
              {title}
            </h2>
          ))}
        <ul className="sidebar-list" aria-label={title ?? 'Yours'}>
          {routesInGroup(group, holds).map((route) => {
            const active = route.path === section;
            const count = counts?.[route.path];
            const counted = count !== undefined && count > 0;
            const target = countTargets?.[route.path];
            // The project travels with the link, not beside it — a bare
            // path drops `?project=` and the destination then falls back
            // to a different project entirely (LAI-423). While a badge
            // shows, the link opens the tab its count lives on (LAI-1191).
            const href = hrefFor(route.path);
            const shortcut = navShortcut(route.path);

            const link = (
              <a
                href={href}
                className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
                aria-current={active ? 'page' : undefined}
                aria-keyshortcuts={shortcut === undefined ? undefined : ariaShortcut(shortcut, MAC)}
                // Warm the page's chunk before the click lands (LAI-1219).
                {...preloadOn(href)}
                onClick={(event) => {
                  // Modified clicks stay the browser's — new tab, new
                  // window, download.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  // The same URL the href advertises: copy-link and
                  // left-click must agree.
                  onNavigate(href);
                  onClose();
                }}
              >
                {/* Always present, transparent until active — selecting
                    an item must not shift its label sideways. */}
                <span className="sidebar-link-bar" aria-hidden="true" />
                {route.icon !== undefined && <NavIcon name={route.icon} />}
                {/* The name, and the rail's tooltip: in the rail it is
                    drawn beside the icon on hover and focus, and it is
                    what a screen reader reads either way. `data-shortcut`:
                    the rail's reveal draws the key after the name
                    (sidebar.css, `::after`), so the label's own text stays
                    the name alone (LAI-1221). */}
                <span
                  className="sidebar-link-label sidebar-tip"
                  data-shortcut={shortcut === undefined ? undefined : formatShortcut(shortcut, MAC)}
                >
                  {route.label}
                </span>

                {/* Only where a count is real and non-zero: a fixture
                    badge or a zero badge is noise. */}
                {/* The shared count badge (LAI-1206): `99+` past the cap,
                    the exact number in words for a screen reader. */}
                {counted && (
                  <Chip variant="count" className="sidebar-count">
                    {formatCount(count)}
                    <span className="visually-hidden">
                      {count > COUNT_CAP ? ` — ${String(count)}` : ''}{' '}
                      {target === undefined ? 'waiting' : count === 1 ? target.one : target.many}
                    </span>
                  </Chip>
                )}
              </a>
            );

            return (
              <li key={route.path}>
                {/* Open, the rail says each destination's key in the shared
                    tooltip on hover and focus (LAI-1221); collapsed, its own
                    name reveal says it, so there is one tooltip, not two. */}
                {shortcut !== undefined && !collapsed ? (
                  <Tooltip content={route.label} shortcut={shortcut}>
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <nav id="sidebar" className={railClass} aria-label="Primary">
      {/*
        **No head and no foot** (LAI-1227). The brand, the collapse toggle and
        the person menu moved to the app's top bar, which spans the sidebar
        as Jira's does: the mark and the person are the app's, not the
        navigation's, and two of each would be two doors to one room.
      */}
      <div className="sidebar-nav">
        {/* Search and commands, ⌘K, is the app header's search bar (LAI-1188). */}
        {shown.filter((group) => group === 'HOME').map(renderGroup)}

        {/* With no spaces yet, the section stays for whoever may create the first (LAI-1191). */}
        {spaces !== undefined &&
          (spaces.length > 0 || holds('project.create')) &&
          onOpenSpace !== undefined && (
            <SpacesSection
              spaces={spaces}
              all={allSpaces ?? spaces}
              projectSlug={projectSlug}
              collapsed={collapsed}
              onNavigate={onNavigate}
              onOpenSpace={onOpenSpace}
              onTogglePin={onTogglePin}
              onClose={onClose}
            />
          )}

        {shown.filter((group) => group !== 'HOME').map(renderGroup)}
      </div>
    </nav>
  );
}
