import { viewTabHref } from '../../routes/nav-url.ts';
import { spaceTabGroups } from '../../routes/route-table.ts';
import { TAB_ACTIVE, TAB_ITEM, TabStrip, rovingTabIndex } from '../tabs/TabStrip.tsx';

export interface ViewTabsProps {
  readonly currentPath: string;
  readonly projectSlug: string | undefined;
  readonly onNavigate: (to: string) => void;
  readonly holds?: ((permission: string) => boolean) | undefined;
  /** Counts by route path, real ones only — a fixture badge is a lie. */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
  /** The current query, so Board ↔ List can carry the filters (LAI-488). */
  readonly params?: URLSearchParams | undefined;
}

/**
 * Row two: the views of this space (prototype line 141; LAI-251).
 *
 * Replaces `SpaceTabs` from LAI-248 — same idea, the design's geometry: 34px
 * tabs at 12.5px, the active one in `--accent` with a 2px underline and weight
 * 700, the strip scrolling horizontally rather than wrapping (a tab bar that
 * changes height moves the content under it).
 *
 * **Every tab carries `?project=`**; an org-level route would drop it on
 * purpose (LAI-423), and none is a tab since Capacity moved to the sidebar
 * (LAI-754). `navHref` makes that decision from the route table, not from
 * here.
 *
 * **Two groups, with a hairline between** (LAI-796, the owner's reference):
 * the ways of looking at the work, then how it is going. The hairline is a
 * list item of its own, `role="presentation"`, so the tabs stay one list a
 * screen reader counts as eight.
 *
 * **On the one tab strip** (LAI-1193), as `PageTabs` is: one Tab stop,
 * Left/Right/Home/End, and at 390px a fade on the edge that hides a view,
 * with the current view scrolled into view (visual audit #4). Still a `nav`
 * of links — each view is its own screen.
 */
export function ViewTabs({
  currentPath,
  projectSlug,
  onNavigate,
  holds,
  counts,
  params,
}: ViewTabsProps) {
  const groups = spaceTabGroups(holds);
  if (projectSlug === undefined || groups.length === 0) return null;
  const anyActive = groups.some((tabs) => tabs.some((route) => route.path === currentPath));
  let position = -1;

  return (
    <nav className="view-tabs" aria-label="Views in this space">
      <TabStrip activeKey={currentPath} element="ul">
        {groups.flatMap((tabs, index) => [
          ...(index === 0
            ? []
            : [<li key={`rule-${String(index)}`} className="view-tab-rule" role="presentation" />]),
          ...tabs.map((route) => {
            const active = route.path === currentPath;
            position += 1;
            const href = viewTabHref(
              route.path,
              projectSlug,
              currentPath,
              params ?? new URLSearchParams(),
            );
            const count = counts?.[route.path];

            return (
              <li key={route.path}>
                <a
                  href={href}
                  className={active ? 'view-tab view-tab-active' : 'view-tab'}
                  aria-current={active ? 'page' : undefined}
                  tabIndex={rovingTabIndex(active, position, anyActive)}
                  {...{ [TAB_ITEM]: '' }}
                  {...(active ? { [TAB_ACTIVE]: '' } : {})}
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
          }),
        ])}
      </TabStrip>
    </nav>
  );
}
