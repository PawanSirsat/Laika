import { navHref } from '../../routes/nav-url.ts';
import { spaceTabs } from '../../routes/route-table.ts';

export interface ViewTabsProps {
  readonly currentPath: string;
  readonly projectSlug: string | undefined;
  readonly onNavigate: (to: string) => void;
  readonly holds?: ((permission: string) => boolean) | undefined;
  /** Counts by route path, real ones only — a fixture badge is a lie. */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
}

/**
 * Row two: the views of this space (prototype line 141; LAI-251).
 *
 * Replaces `SpaceTabs` from LAI-248 — same idea, the design's geometry: 34px
 * tabs at 12.5px, the active one in `--acc` with a 2px underline and weight
 * 700, the strip scrolling horizontally rather than wrapping (a tab bar that
 * changes height moves the content under it).
 *
 * **Every tab carries `?project=` except the org-level ones**, which drop it on
 * purpose (LAI-423): Capacity reads across every project, and a URL claiming
 * otherwise would be wrong even though the tab sits inside a space. `navHref`
 * makes that decision from the route table, not from here.
 */
export function ViewTabs({ currentPath, projectSlug, onNavigate, holds, counts }: ViewTabsProps) {
  const tabs = spaceTabs(holds);
  if (projectSlug === undefined || tabs.length === 0) return null;

  return (
    <nav className="view-tabs" aria-label="Views in this space">
      <ul>
        {tabs.map((route) => {
          const active = route.path === currentPath;
          const href = navHref(route.path, projectSlug);
          const count = counts?.[route.path];

          return (
            <li key={route.path}>
              <a
                href={href}
                className={active ? 'view-tab view-tab-active' : 'view-tab'}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  // Modified clicks stay the browser's — new tab, new window.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(href);
                }}
              >
                {route.label}
                {count !== undefined && count > 0 && (
                  <span className="view-tab-count">{count}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
