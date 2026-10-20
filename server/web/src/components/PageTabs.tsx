import { tabHref, type PageTab } from '../routes/page-tabs.ts';
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
  readonly onNavigate: (to: string) => void;
}

/**
 * The tabs of a page that holds several screens (LAI-796): Inbox, Insights,
 * Organisation. The space bar's tabs, at page scale — the active one in
 * `--accent` with an underline on the header's hairline.
 *
 * **Links, not buttons**: a tab is an address (`?tab=`), so middle-click,
 * copy-link and Back all work, and the click only suppresses the reload.
 */
export function PageTabs({ label, path, tabs, current, counts, onNavigate }: PageTabsProps) {
  return (
    <nav className="page-tabs" aria-label={label}>
      <ul>
        {tabs.map((tab) => {
          const active = tab.id === current;
          const href = tabHref(path, tab.id);
          const count = counts?.[tab.id];
          return (
            <li key={tab.id}>
              <a
                href={href}
                className={active ? 'page-tab page-tab-active' : 'page-tab'}
                aria-current={active ? 'page' : undefined}
                data-tab={tab.id}
                onClick={(event) => {
                  // Modified clicks stay the browser's — new tab, new window.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(href);
                }}
              >
                {tab.label}
                {count !== undefined && (
                  <span className="page-tab-count">
                    {count}
                    <span className="visually-hidden"> waiting</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
