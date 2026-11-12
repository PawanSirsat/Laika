import { BrandMark } from '../brand/BrandMark.tsx';
import { Wordmark } from '../brand/Wordmark.tsx';
import { Chip } from '../chip/Chip.tsx';
import { COUNT_CAP, formatCount } from '../chip/chip-model.ts';
import {
  GROUP_TITLES,
  NAV_GROUPS,
  navSection,
  routesInGroup,
  type NavGroup,
} from '../../routes/route-table.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { navHref } from '../../routes/nav-url.ts';
import { SpacesSection } from './SpacesSection.tsx';
import { SidebarFooter } from './SidebarFooter.tsx';
import { NavIcon } from './NavIcon.tsx';
import { PaletteTrigger } from '../command/PaletteTrigger.tsx';
import type { SidebarSpace, Space } from '../../routes/spaces.ts';
import type { MeProfile } from '../../api/me.ts';
import './sidebar.css';
import { usePermissions } from '../../api/permissions.ts';

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
  readonly onToggleCollapse: () => void;
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
  /** The organisation's name, under the wordmark (prototype line 50). */
  readonly orgName?: string | undefined;
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
  /** The signed-in user, for the footer. Absent renders no footer. */
  readonly user?: MeProfile | undefined;
  readonly onSignOut?: (() => void) | undefined;
  readonly signingOut?: boolean | undefined;
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
  onToggleCollapse,
  projectSlug,
  spaces,
  allSpaces,
  onOpenSpace,
  onTogglePin,
  orgName,
  counts,
  countTargets,
  user,
  onSignOut,
  signingOut,
}: SidebarProps) {
  const { permissions } = usePermissions(user !== undefined);
  /**
   * The reader's permissions, mirrored from `policy/can.ts` at one remove — the
   * one predicate every gated entry and tab asks.
   */
  const holds = permissionHolder(permissions?.me.actions);
  // The Connect wizard lights Developer access, the page it is opened from.
  const section = navSection(currentPath);

  const railClass = ['sidebar', open ? 'sidebar-open' : '', collapsed ? 'sidebar-collapsed' : '']
    .filter((c) => c !== '')
    .join(' ');

  /* A group with nothing the reader may open is not drawn at all. */
  const shown = NAV_GROUPS.filter((group) => routesInGroup(group, holds).length > 0);

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
            const href = withTab(
              navHref(route.path, projectSlug),
              counted ? target?.tab : undefined,
            );

            return (
              <li key={route.path}>
                <a
                  href={href}
                  className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
                  aria-current={active ? 'page' : undefined}
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
                      what a screen reader reads either way. */}
                  <span className="sidebar-link-label sidebar-tip">{route.label}</span>

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
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <nav id="sidebar" className={railClass} aria-label="Primary">
      <div className="sidebar-head">
        {/* The brand mark (LAI-1126): with the wordmark beside it, the lockup;
            alone in the collapsed rail, the mark. Decorative either way — the
            wordmark carries the name, and the rail's nav says where you are. */}
        <span className="sidebar-logo">
          <BrandMark size={28} />
        </span>
        {!collapsed && (
          <div className="sidebar-identity">
            {/* Always the product, never the open project (owner,
                2026-09-21): the space bar names the project. */}
            <span className="sidebar-wordmark">
              <Wordmark height={15} />
            </span>
            {/* The org's real name, from `GET /org`. `undefined` renders
                nothing rather than a placeholder that looks like data. */}
            {orgName !== undefined && <span className="sidebar-orgline">{orgName}</span>}
          </div>
        )}
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={!collapsed}
          aria-controls="sidebar"
          onClick={onToggleCollapse}
        >
          <NavIcon name={collapsed ? 'rail-open' : 'rail-close'} size={17} />
          <span className="sidebar-tip">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </button>
      </div>

      <div className="sidebar-nav">
        {/* Search and commands, ⌘K (LAI-1192). */}
        <div className="sidebar-group sidebar-group-search">
          <PaletteTrigger variant="sidebar" />
        </div>

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

      {user !== undefined && onSignOut !== undefined && (
        <SidebarFooter
          user={user}
          collapsed={collapsed}
          onSignOut={onSignOut}
          signingOut={signingOut ?? false}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      )}
    </nav>
  );
}
