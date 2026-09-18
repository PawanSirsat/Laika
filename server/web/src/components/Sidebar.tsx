import type { ReactNode } from 'react';
import { Brand } from './Brand.tsx';
import { NAV_GROUPS, routesInGroup } from '../routes/route-table.ts';
import { permissionHolder } from '../routes/nav-permissions.ts';
import { navHref } from '../routes/nav-url.ts';
import type { Space } from '../routes/spaces.ts';

export interface SidebarProps {
  readonly currentPath: string;
  readonly onNavigate: (to: string) => void;
  /** Open on narrow viewports, where the sidebar is off-canvas. */
  readonly open: boolean;
  readonly onClose: () => void;
  /** Slug of the project in the URL, when there is one. */
  readonly projectSlug?: string | undefined;
  /**
   * The spaces to list, most recent first (LAI-247).
   *
   * Empty renders no SPACES section at all — before the project list arrives,
   * and for somebody in no project yet. An empty section with a heading would
   * claim there is something to see.
   */
  readonly spaces?: readonly Space[] | undefined;
  /** Open a space: sets the project and goes to its board. */
  readonly onOpenSpace?: ((slug: string) => void) | undefined;
  /**
   * The reader's org role, for entries that require a permission.
   *
   * Absent means "unrestricted" — the pre-auth render and the tests pass
   * nothing, and gated entries then stay hidden rather than leaking.
   */
  readonly orgRole?: string | undefined;
  /** Laika's version, from `/health`. Not a project version — none exists. */
  readonly version?: string | undefined;
  /**
   * Counts by route path. A path with no entry, or an `undefined` entry, gets no
   * badge — which is how a screen with no count endpoint stays honest.
   */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
  /** The user chip and theme control, pinned to the bottom. */
  readonly footer?: ReactNode;
}

/**
 * The three groups from `docs/design/README.md`, in its order:
 * WORK · REVIEW · SETTINGS.
 *
 * **No SYSTEM group.** The prototype has one so all thirteen screens are
 * reachable in a single file; login, first boot and the project picker are
 * pre-auth or org-level routes, not nav destinations (CLAUDE.md §5.1). They are
 * still routed — they are just not here.
 *
 * **No Calendar item** — SPEC §14 q10 is unanswered, so it has no endpoints and
 * no decision behind it.
 *
 * A real `<a href>` per item, not a div with a click handler: middle-click,
 * copy-link and the browser's own focus handling all come free, and the
 * `onClick` only suppresses the reload.
 */
export function Sidebar({
  currentPath,
  onNavigate,
  open,
  onClose,
  projectSlug,
  orgRole,
  version,
  counts,
  footer,
  spaces,
  onOpenSpace,
}: SidebarProps) {
  /**
   * The reader's permissions, mirrored from `policy/can.ts` at one remove.
   *
   * The table names an action; this turns it into a yes or no for this person.
   * `audit_log.export` is admin-up, and `mayTriageUnlisted` is the same
   * predicate the unlisted screen uses — one mirror, not two.
   */
  const holds = permissionHolder(orgRole);

  return (
    <nav id="sidebar" className={open ? 'sidebar sidebar-open' : 'sidebar'} aria-label="Primary">
      <div className="sidebar-head">
        <Brand variant="tile" />

        {/*
          The prototype reads `laika-core · v0.4`, which puts a project name and
          a version on one line as though the version belonged to the project.
          It does not: projects have no version column and no field in SPEC §4.3.
          The slug is the project; the version is Laika's own, from `/health`.
          Both are labelled so they cannot be read as one thing, and each is
          omitted entirely when the API has not supplied it.
        */}
        {(projectSlug !== undefined || version !== undefined) && (
          <p className="sidebar-context">
            {projectSlug !== undefined && (
              <span className="sidebar-project" title={`Project ${projectSlug}`}>
                {projectSlug}
              </span>
            )}
            {projectSlug !== undefined && version !== undefined && (
              <span className="sidebar-context-sep" aria-hidden="true">
                ·
              </span>
            )}
            {version !== undefined && (
              <span className="sidebar-version" title={`Laika ${version}`}>
                <span className="visually-hidden">Laika version </span>v{version}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="sidebar-nav">
        {/*
          **SPACES first, and it is not a route group** (LAI-247). Its rows are
          the projects you have opened, which the design puts above everything
          else — you pick where you are working before you pick what you are
          looking at.
        */}
        {spaces !== undefined && spaces.length > 0 && (
          <div className="sidebar-group">
            <h2 className="sidebar-group-title" id="nav-SPACES">
              SPACES
            </h2>
            <ul className="sidebar-list" aria-labelledby="nav-SPACES">
              {spaces.map((space) => {
                // A space is current for **any** view of it, not only the
                // board — the design's `projectScreens` test. That is what
                // makes the tab bar read as being inside the space.
                const active = space.slug === projectSlug;
                const href = navHref('/board', space.slug);

                return (
                  <li key={space.slug}>
                    <a
                      href={href}
                      className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
                      aria-current={active ? 'page' : undefined}
                      title={`${space.name} — ${space.meta}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                          return;
                        event.preventDefault();
                        onOpenSpace?.(space.slug);
                        onNavigate(href);
                        onClose();
                      }}
                    >
                      <span className="sidebar-dot" aria-hidden="true" />
                      <span className="space-key" aria-hidden="true">
                        {space.key}
                      </span>
                      <span className="sidebar-label">
                        {space.name}
                        <span className="space-meta">{space.meta}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
              <li>
                <a
                  href="/projects"
                  className={
                    currentPath === '/projects'
                      ? 'sidebar-link sidebar-link-active'
                      : 'sidebar-link'
                  }
                  aria-current={currentPath === '/projects' ? 'page' : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate('/projects');
                    onClose();
                  }}
                >
                  <span className="sidebar-dot" aria-hidden="true" />
                  <span className="space-key" aria-hidden="true">
                    MS
                  </span>
                  <span className="sidebar-label">More spaces</span>
                </a>
              </li>
            </ul>
          </div>
        )}

        {NAV_GROUPS.filter((group) => routesInGroup(group, holds).length > 0).map((group) => (
          <div key={group} className="sidebar-group">
            <h2 className="sidebar-group-title" id={`nav-${group}`}>
              {group}
            </h2>
            <ul className="sidebar-list" aria-labelledby={`nav-${group}`}>
              {routesInGroup(group, holds).map((route) => {
                const active = route.path === currentPath;
                const count = counts?.[route.path];
                // The project travels with the link, not beside it — a bare
                // path drops `?project=` and the destination then falls back to
                // a different project entirely (LAI-423).
                const href = navHref(route.path, projectSlug);

                return (
                  <li key={route.path}>
                    <a
                      href={href}
                      className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
                      // `page`, not `true` — this link *is* the current page.
                      aria-current={active ? 'page' : undefined}
                      onClick={(event) => {
                        // Let the browser handle modified clicks: new tab, new
                        // window, download. Hijacking those is the thing people
                        // hate about hand-rolled routers.
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                          return;
                        event.preventDefault();
                        // The same URL the href advertises. Navigating to
                        // `route.path` here would make copy-link and left-click
                        // disagree, which is worse than either being wrong.
                        onNavigate(href);
                        onClose();
                      }}
                    >
                      {/* Always present, transparent until active — so selecting
                        an item does not shift its label sideways. */}
                      <span className="sidebar-link-bar" aria-hidden="true" />
                      <span className="sidebar-link-label">{route.label}</span>

                      {/*
                      Only where a count is real, and only when there is
                      something to count. `Sprints 4` and `Meeting review 4` are
                      fixtures in the mockup; meeting review has no endpoint at
                      all. A zero badge is noise, so it is left off too.
                    */}
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

      {footer !== undefined && <div className="sidebar-footer">{footer}</div>}
    </nav>
  );
}
