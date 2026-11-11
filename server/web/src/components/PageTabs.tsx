import { tabHref, type PageTab } from '../routes/page-tabs.ts';
import { TAB_ACTIVE, TAB_ITEM, TabStrip, rovingTabIndex } from './tabs/TabStrip.tsx';
import './page-tabs.css';

export interface PageTabsProps {
  /** Names the strip for a screen reader: `Inbox sections`. */
  readonly label: string;
  /** The page the tabs belong to — `/inbox`. */
  readonly path: string;
  /** The tabs this reader is offered (`visibleTabs`). */
  readonly tabs: readonly PageTab[];
  readonly current: string;
  /**
   * Counts by tab id. A tab with a known count shows it — zero included, since
   * on a tab it is the answer to *"how many are waiting here"*.
   */
  readonly counts?: Readonly<Record<string, number | undefined>> | undefined;
  /** What a count counts, for a screen reader: `waiting` (the default), `people`. */
  readonly countNoun?: string | undefined;
  readonly onNavigate: (to: string) => void;
}

/**
 * The tabs of a page that holds several screens (LAI-796): Inbox, Insights,
 * Organisation. The space bar's tabs, at page scale — the active one in
 * `--accent` with an underline on the header's hairline.
 *
 * **Links, not buttons**: a tab is an address (`?tab=`), so middle-click,
 * copy-link and Back all work, and the click only suppresses the reload.
 *
 * **On the one tab strip** (LAI-1193): one stop in the Tab order (the current
 * tab), Left/Right/Home/End between tabs, and at 390px an edge fade where the
 * strip scrolls, with the current tab scrolled into view. The semantics stay
 * a `nav` of links with `aria-current` — the design system's *route variant*:
 * each tab is an address the screen under it reads, not a panel this strip
 * owns, so there is no `tabpanel` for `aria-controls` to name.
 */
export function PageTabs({
  label,
  path,
  tabs,
  current,
  counts,
  countNoun = 'waiting',
  onNavigate,
}: PageTabsProps) {
  const anyActive = tabs.some((tab) => tab.id === current);
  return (
    <nav className="page-tabs" aria-label={label}>
      <TabStrip activeKey={current} element="ul">
        {tabs.map((tab, index) => {
          const active = tab.id === current;
          const href = tabHref(path, tab.id);
          const count = counts?.[tab.id];
          return (
            <li key={tab.id}>
              <a
                href={href}
                className={active ? 'page-tab page-tab-active' : 'page-tab'}
                aria-current={active ? 'page' : undefined}
                tabIndex={rovingTabIndex(active, index, anyActive)}
                data-tab={tab.id}
                {...{ [TAB_ITEM]: '' }}
                {...(active ? { [TAB_ACTIVE]: '' } : {})}
                onClick={(event) => {
                  // Modified clicks stay the browser's — new tab, new window.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(href);
                }}
              >
                {tab.label}
                {tab.badge !== undefined && <span className="page-tab-badge">{tab.badge}</span>}
                {count !== undefined && (
                  <span className="page-tab-count">
                    {count}
                    <span className="visually-hidden"> {countNoun}</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </TabStrip>
    </nav>
  );
}
