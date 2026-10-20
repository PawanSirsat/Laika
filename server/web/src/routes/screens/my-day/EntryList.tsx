import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TimeEntry } from '../../../api/time.ts';
import { EntryRow } from './EntryRow.tsx';
import { PAGE_SIZE, pageOf } from './draft-bulk.ts';
import { duration } from './format.ts';

export interface EntryListProps {
  readonly entries: readonly TimeEntry[];
  /** The entry in the inspector. */
  readonly selected: string | undefined;
  readonly onSelect: (entry: TimeEntry) => void;
  readonly onNavigate: (to: string) => void;
  /** *Add time*, at the foot of the list, as the design has it. */
  readonly children?: ReactNode;
}

/**
 * *Confirmed* (the owner's design, LAI-831; LAI-810): the day's confirmed
 * time — **the only time anyone else can see** — ten to a page in a scroll
 * area of its own, and *Add time* at its foot. Clicking a row puts it in the
 * inspector.
 */
export function EntryList({ entries, selected, onSelect, onNavigate, children }: EntryListProps) {
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const paged = pageOf(entries, page);
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);

  const selectedAt = selected === undefined ? -1 : entries.findIndex((e) => e.id === selected);
  useEffect(() => {
    if (selectedAt >= 0) setPage(Math.floor(selectedAt / PAGE_SIZE));
  }, [selectedAt]);

  const go = (to: number): void => {
    setPage(to);
    if (scroller.current !== null) scroller.current.scrollTop = 0;
  };

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
        <span className="myday-card-caption">the only time anyone else can see</span>
      </header>

      {entries.length === 0 ? (
        <p className="myday-quiet myday-pad">Nothing confirmed yet.</p>
      ) : (
        <div
          ref={scroller}
          id="myday-entries-list"
          className="myday-scroll"
          role="region"
          aria-label={`Confirmed entries, ${paged.label}`}
          tabIndex={0}
        >
          <ol className="myday-blocks" aria-label="Confirmed entries">
            {paged.items.map((entry, i) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                position={paged.page * PAGE_SIZE + i + 1}
                count={entries.length}
                selected={entry.id === selected}
                onSelect={() => {
                  onSelect(entry);
                }}
                onNavigate={onNavigate}
              />
            ))}
          </ol>
        </div>
      )}
      {paged.pages > 1 && (
        <nav className="myday-pager" aria-label="Confirmed pages">
          <button
            type="button"
            className="myday-chip"
            disabled={paged.page === 0}
            onClick={() => {
              go(paged.page - 1);
            }}
          >
            ‹ Prev
          </button>
          <span className="myday-pager-label" aria-live="polite">
            {paged.label}
          </span>
          <button
            type="button"
            className="myday-chip"
            disabled={paged.page >= paged.pages - 1}
            onClick={() => {
              go(paged.page + 1);
            }}
          >
            Next ›
          </button>
        </nav>
      )}
      {children}
    </section>
  );
}
