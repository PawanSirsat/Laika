import { navHref } from '../routes/nav-url.ts';
import { spaceTabs } from '../routes/route-table.ts';
import './space-tabs.css';

export interface SpaceTabsProps {
  readonly currentPath: string;
  readonly projectSlug?: string | undefined;
  readonly onNavigate: (to: string) => void;
  readonly holds?: ((permission: string) => boolean) | undefined;
  /** Counts by route path, the same shape the sidebar takes. */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
}

/**
 * The views of one space, as a tab bar (LAI-247).
 *
 * The live design ties every view to a space — its `projectScreens` test lights
 * the space row for the board, timeline, sprints, dashboard and meeting review
 * alike. Once the sidebar lists spaces rather than views, this is where the
 * views go.
 *
 * **Every tab carries `?project=`**, which is what makes the bar honest: these
 * are views *of* this project. `spaceTabs()` refuses an `orgLevel` route for
 * the same reason — Capacity reads across every project and is in the sidebar's
 * `ORG` group instead.
 *
 * Rendered only when there is a project to be inside of; org-level screens get
 * no tab bar, because there is no space they belong to.
 */
export function SpaceTabs({ currentPath, projectSlug, onNavigate, holds, counts }: SpaceTabsProps) {
  const tabs = spaceTabs(holds);
  if (projectSlug === undefined || tabs.length === 0) return null;

  return (
    <nav className="space-tabs" aria-label="Views in this space">
      <ul className="space-tabs-list">
        {tabs.map((route) => {
          const active = route.path === currentPath;
          const href = navHref(route.path, projectSlug);
          const count = counts?.[route.path];

          return (
            <li key={route.path}>
              <a
                href={href}
                className={active ? 'space-tab space-tab-active' : 'space-tab'}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  // Modified clicks stay the browser's — new tab, new window.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(href);
                }}
              >
                {route.label}
                {count !== undefined && <span className="space-tab-count">{count}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
