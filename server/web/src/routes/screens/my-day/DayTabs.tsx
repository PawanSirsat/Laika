import { Tabs } from '../../../components/tabs/Tabs.tsx';

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
 *
 * On the shared `Tabs` (LAI-1193): arrow keys, Home/End and a roving
 * tabindex — its tab roles had none of the keys, and both `aria-current` and
 * `aria-selected` (interaction inventory B26). **No `aria-controls` yet**:
 * the sections a tab shows are siblings in My day's grid, styled by sibling
 * combinators, so there is no one element to name without reshaping that
 * screen — a follow-up, not this change.
 */
export function DayTabs({ current, counts, onPick }: DayTabsProps) {
  return (
    <div className="page-tabs myday-tabs">
      <Tabs
        element="ul"
        label="Day sections"
        tabClassName="page-tab"
        selectedClassName="page-tab-active"
        idBase="myday-tab"
        selected={current}
        onSelect={onPick}
        items={TABS.map((tab) => {
          const count = tab.id === 'review' || tab.id === 'confirmed' ? counts[tab.id] : undefined;
          return {
            id: tab.id,
            data: { 'data-day-tab': tab.id },
            label: (
              <>
                {tab.label}
                {count !== undefined && count > 0 && (
                  <span className="page-tab-count" aria-label={`${String(count)} blocks`}>
                    {count}
                  </span>
                )}
              </>
            ),
          };
        })}
      />
    </div>
  );
}
