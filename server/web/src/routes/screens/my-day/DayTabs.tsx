export type DayTab = 'overview' | 'review' | 'confirmed' | 'all';

export interface DayTabsProps {
  readonly current: DayTab;
  readonly counts: Readonly<Record<'review' | 'confirmed', number>>;
  readonly onPick: (tab: DayTab) => void;
}

const TABS: readonly { readonly id: DayTab; readonly label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'review', label: 'To review' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'all', label: 'All' },
];

/**
 * The tabs under the Timeline (the owner's design, D-110 item 6, LAI-505;
 * LAI-514): Overview, To review with how many wait, Confirmed with how many
 * there are, and All — every section at once. Buttons, not addresses: the tab
 * is the page's own state, kept per browser. A count is a mono pill; the
 * selected tab carries the accent bar.
 */
export function DayTabs({ current, counts, onPick }: DayTabsProps) {
  return (
    <nav className="page-tabs myday-tabs" aria-label="Day sections">
      <ul role="tablist">
        {TABS.map((tab) => {
          const active = tab.id === current;
          const count = tab.id === 'review' || tab.id === 'confirmed' ? counts[tab.id] : undefined;
          return (
            <li key={tab.id} role="presentation">
              <button
                type="button"
                role="tab"
                className={active ? 'page-tab page-tab-active' : 'page-tab'}
                aria-current={active ? 'page' : undefined}
                aria-selected={active}
                data-day-tab={tab.id}
                onClick={() => {
                  onPick(tab.id);
                }}
              >
                {tab.label}
                {count !== undefined && count > 0 && (
                  <span className="page-tab-count" aria-label={`${String(count)} blocks`}>
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
