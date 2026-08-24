import { NAV_GROUPS, routesInGroup } from '../routes/route-table.ts';

export interface SidebarProps {
  readonly currentPath: string;
  readonly onNavigate: (to: string) => void;
  /** Open on narrow viewports, where the sidebar is off-canvas. */
  readonly open: boolean;
  readonly onClose: () => void;
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
export function Sidebar({ currentPath, onNavigate, open, onClose }: SidebarProps) {
  return (
    <nav id="sidebar" className={open ? 'sidebar sidebar-open' : 'sidebar'} aria-label="Primary">
      <div className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true" />
        <span className="sidebar-wordmark">Laika</span>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group} className="sidebar-group">
          <h2 className="sidebar-group-title" id={`nav-${group}`}>
            {group}
          </h2>
          <ul className="sidebar-list" aria-labelledby={`nav-${group}`}>
            {routesInGroup(group).map((route) => {
              const active = route.path === currentPath;
              return (
                <li key={route.path}>
                  <a
                    href={route.path}
                    className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
                    // `page`, not `true` — this link *is* the current page.
                    aria-current={active ? 'page' : undefined}
                    onClick={(event) => {
                      // Let the browser handle modified clicks: new tab, new
                      // window, download. Hijacking those is the thing people
                      // hate about hand-rolled routers.
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      onNavigate(route.path);
                      onClose();
                    }}
                  >
                    {route.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
