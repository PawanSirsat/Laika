import type { ReactNode } from 'react';
import type { TimeEntry } from '../../../api/time.ts';
import { groupByPart } from './day-groups.ts';
import { EntryRow } from './EntryRow.tsx';
import { duration } from './format.ts';

export interface EntryListProps {
  readonly entries: readonly TimeEntry[];
  /** The entry in the inspector. */
  readonly selected: string | undefined;
  readonly onSelect: (entry: TimeEntry) => void;
  readonly onNavigate: (to: string) => void;
  readonly children?: ReactNode;
}

/**
 * *Confirmed* (the owner's design, LAI-505; LAI-810): the day's confirmed
 * time — **the time the organisation sees**; drafts only owners and admins
 * read (D-102, LAI-968) — grouped by the part of the day, with no scroll of
 * its own so the wheel always moves the page (LAI-311). Clicking a row puts
 * it in the editor.
 */
export function EntryList({ entries, selected, onSelect, onNavigate, children }: EntryListProps) {
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  const groups = groupByPart(entries);

  return (
    <section className="myday-card myday-entries" aria-labelledby="myday-entries-title">
      <header className="myday-card-head">
        <h2 className="myday-card-title" id="myday-entries-title">
          Confirmed
        </h2>
        <span className="myday-card-figure" data-confirmed-caption>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {duration(total)}
        </span>
        <span className="myday-card-head-gap" />
        <span className="myday-card-caption">the time your organisation sees</span>
      </header>

      {entries.length === 0 ? (
        <p className="myday-quiet myday-pad">Nothing confirmed yet.</p>
      ) : (
        <div
          id="myday-entries-list"
          className="myday-scroll"
          role="region"
          aria-label="Confirmed entries"
        >
          <ol className="myday-blocks" aria-label="Confirmed entries">
            {groups.flatMap((group) => [
              <li
                key={`head-${group.key}`}
                className="myday-group-head"
                data-group={group.key}
                aria-label={`${group.name}: ${String(group.items.length)} entries, ${duration(group.minutes)}`}
              >
                <span className="myday-group-name">{group.name}</span>
                <span className="myday-group-count">{group.items.length}</span>
                <span className="myday-group-sum">{duration(group.minutes)}</span>
              </li>,
              ...group.items.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  position={entries.findIndex((e) => e.id === entry.id) + 1}
                  count={entries.length}
                  selected={entry.id === selected}
                  onSelect={() => {
                    onSelect(entry);
                  }}
                  onNavigate={onNavigate}
                />
              )),
            ])}
          </ol>
        </div>
      )}
      {children}
    </section>
  );
}
