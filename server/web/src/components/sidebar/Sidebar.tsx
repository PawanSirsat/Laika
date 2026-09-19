import { NAV_GROUPS, routesInGroup } from '../../routes/route-table.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { navHref } from '../../routes/nav-url.ts';
import { SpacesSection } from './SpacesSection.tsx';
import { SidebarFooter } from './SidebarFooter.tsx';
import type { Space } from '../../routes/spaces.ts';
import type { MeProfile } from '../../api/me.ts';
import './sidebar.css';

export interface SidebarProps {
  readonly currentPath: string;
  readonly onNavigate: (to: string) => void;
  /** Open on narrow viewports, where the sidebar is off-canvas. */
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * The prototype's `navMini` (LAI-249): 56px rail showing two-letter keys.
   * Toggled by the logo; distinct from `open`, which is the narrow-viewport
   * off-canvas state.
   */
  readonly collapsed: boolean;
  readonly onToggleCollapse: () => void;
  /** Slug of the project in the URL, when there is one. */
  readonly projectSlug?: string | undefined;
  /** The pinned spaces, most recent first (LAI-247). Empty renders no section. */
  readonly spaces?: readonly Space[] | undefined;
  /** Every fetched space, for the More-spaces popover. */
  readonly allSpaces?: readonly Space[] | undefined;
  /** Open a space: sets the project and goes to its board. */
  readonly onOpenSpace?: ((slug: string) => void) | undefined;
  /**
   * The reader's org role, for entries that require a permission. Absent means
   * "unrestricted" — gated entries stay hidden rather than leaking.
   */
  readonly orgRole?: string | undefined;
  /** The organisation's name, under the wordmark (prototype line 50). */
  readonly orgName?: string | undefined;
  /**
   * The open project's name, from `GET /projects/:slug`.
   *
   * **Authoritative, because the list is not.** `useSpaces` asks for
   * `listProjects({ limit: 20 })`, so a project past the twentieth — or one
   * reached by URL alone — is simply not in it. Deriving the name only from
   * that list is how "No space" appeared over a project that plainly existed
   * (LAI-259); this keeps the by-slug answer that fixed it, moved here with
   * the name itself.
   */
  readonly spaceName?: string | undefined;
  /** Counts by route path. No entry, no badge — that is how it stays honest. */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
  /** The signed-in user, for the footer. Absent renders no footer. */
  readonly user?: MeProfile | undefined;
  readonly onSignOut?: (() => void) | undefined;
  readonly signingOut?: boolean | undefined;
}

/**
 * The rail, to the prototype's own geometry (LAI-249): 212px, collapsing to
 * 56px on the logo (`transition: width .16s ease`), head of logo + wordmark +
 * org line, SPACES above the route groups, footer of theme row + user chip.
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
  orgRole,
  orgName,
  spaceName,
  counts,
  user,
  onSignOut,
  signingOut,
}: SidebarProps) {
  /**
   * The reader's permissions, mirrored from `policy/can.ts` at one remove.
   * `audit_log.export` is admin-up; the same predicate the unlisted screen
   * uses — one mirror, not two.
   */
  const holds = permissionHolder(orgRole);

  /*
   * `allSpaces` first: `spaces` is the recent-and-current shortlist, and a
   * project reached by URL alone need not be on it. Both are already props —
   * this needs no new plumbing and no second request.
   */
  /*
   * The list is the *fallback*, not the source: it is already loaded, so it
   * names the space on the first paint instead of flashing the product name
   * while the by-slug request is in flight.
   */
  const listed =
    projectSlug === undefined
      ? undefined
      : (allSpaces?.find((s) => s.slug === projectSlug)?.name ??
        spaces?.find((s) => s.slug === projectSlug)?.name);
  const openSpace = spaceName ?? listed;

  const railClass = ['sidebar', open ? 'sidebar-open' : '', collapsed ? 'sidebar-collapsed' : '']
    .filter((c) => c !== '')
    .join(' ');

  return (
    <nav id="sidebar" className={railClass} aria-label="Primary">
      <div className="sidebar-head">
        {/*
          The logo is the collapse control, as the prototype has it (line 49):
          a 28px radius-9 square on `--tx`, glyph stroked in `--card`.
        */}
        <button
          type="button"
          className="sidebar-logo"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <span className="visually-hidden">
            {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          </svg>
        </button>
        {!collapsed && (
          <div className="sidebar-identity">
            {/*
              **The open project, not the product** (LAI-295).

              The owner asked for this slot to carry the project name, and for
              the space bar to stop repeating it — the bar had `Laika Core`
              beside `Laika` in the rail, which is the same word twice and a
              line of bar width spent on it.

              Falls back to the product name when no project is open: the rail
              is global chrome and `/organisation`, `/members` and the unlisted
              screens have no space to name. A blank wordmark there would read
              as a loading state that never resolves.
            */}
            <span className="sidebar-wordmark">{openSpace ?? 'Laika'}</span>
            {/*
              The org's real name, from `GET /org` — "Kvelld Dynamics" in the
              prototype is a fixture. `undefined` renders nothing rather than a
              placeholder that looks like data.
            */}
            {orgName !== undefined && <span className="sidebar-orgline">{orgName}</span>}
          </div>
        )}
      </div>

      <div className="sidebar-nav">
        {spaces !== undefined && spaces.length > 0 && onOpenSpace !== undefined && (
          <SpacesSection
            spaces={spaces}
            all={allSpaces ?? spaces}
            projectSlug={projectSlug}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onOpenSpace={onOpenSpace}
            onClose={onClose}
          />
        )}

        {NAV_GROUPS.filter((group) => routesInGroup(group, holds).length > 0).map((group) => (
          <div key={group} className="sidebar-group">
            {collapsed ? (
              <div className="sidebar-minirule" aria-hidden="true" />
            ) : (
              <h2 className="sidebar-group-title" id={`nav-${group}`}>
                {group}
              </h2>
            )}
            <ul className="sidebar-list" aria-label={group}>
              {routesInGroup(group, holds).map((route) => {
                const active = route.path === currentPath;
                const count = counts?.[route.path];
                // The project travels with the link, not beside it — a bare
                // path drops `?project=` and the destination then falls back
                // to a different project entirely (LAI-423).
                const href = navHref(route.path, projectSlug);

                return (
                  <li key={route.path}>
                    <a
                      href={href}
                      className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
                      aria-current={active ? 'page' : undefined}
                      title={route.label}
                      onClick={(event) => {
                        // Modified clicks stay the browser's — new tab, new
                        // window, download.
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                          return;
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
                      {/* The collapsed rail's two letters (prototype `n.abbr`). */}
                      <span className="sidebar-mini" aria-hidden="true">
                        {route.mini ?? ''}
                      </span>
                      <span className="sidebar-link-label">{route.label}</span>

                      {/* Only where a count is real and non-zero: a fixture
                          badge or a zero badge is noise. */}
                      {count !== undefined && count > 0 && (
                        <span className="sidebar-count">
                          {count}
                          <span className="visually-hidden"> {route.label.toLowerCase()}</span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {user !== undefined && onSignOut !== undefined && (
        <SidebarFooter
          user={user}
          collapsed={collapsed}
          onSignOut={onSignOut}
          signingOut={signingOut ?? false}
        />
      )}
    </nav>
  );
}
