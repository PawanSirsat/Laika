export type DayTab = 'overview' | 'review' | 'confirmed';

export interface DayTabsProps {
  readonly current: DayTab;
  readonly counts: Readonly<Record<'review' | 'confirmed', number>>;
  readonly onPick: (tab: DayTab) => void;
}

const TABS: readonly { readonly id: DayTab; readonly label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'review', label: 'To review' },
  { id: 'confirmed', label: 'Confirmed' },
];

/**
 * The tabs under the Timeline (the owner's design, D-110 item 6, LAI-505):
 * Overview, To review with how many wait, Confirmed with how many there are.
 * Buttons, not addresses: the tab is the page's own state, kept per browser.
 */
export function DayTabs({ current, counts, onPick }: DayTabsProps) {
  return (
    <nav className="page-tabs myday-tabs" aria-label="The day's lists">
      <ul>
        {TABS.map((tab) => {
          const active = tab.id === current;
          const count = tab.id === 'overview' ? undefined : counts[tab.id];
          return (
            <li key={tab.id}>
              <button
                type="button"
                className={active ? 'page-tab page-tab-active' : 'page-tab'}
                aria-current={active ? 'page' : undefined}
                data-day-tab={tab.id}
                onClick={() => {
                  onPick(tab.id);
                }}
              >
                {tab.label}
                {count !== undefined && (
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
