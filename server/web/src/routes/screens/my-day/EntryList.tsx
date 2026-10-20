import { useRef, useState } from 'react';
import type { EntryPatch, TimeEntry } from '../../../api/time.ts';
import { formatDuration } from '../../../api/duration.ts';
import { EntryRow } from './EntryRow.tsx';
import { PAGE_SIZE, pageOf } from './draft-bulk.ts';

export interface EntryListProps {
  readonly entries: readonly TimeEntry[];
  /** The action in flight anywhere on the page. */
  readonly pending: string | undefined;
  readonly onNavigate: (to: string) => void;
  readonly onSave: (entry: TimeEntry, patch: EntryPatch) => Promise<boolean>;
  readonly onDelete: (entry: TimeEntry) => void;
}

/**
 * The day's confirmed time (LAI-810): the drafted list's treatment — ten to a
 * page in a scroll area of its own — and, when there are more than a page of
 * them, **one summary line until the reader asks**. Confirmed time is the
 * record; on a busy day it is rarely what the reader came to change.
 */
export function EntryList({ entries, pending, onNavigate, onSave, onDelete }: EntryListProps) {
  const long = entries.length > PAGE_SIZE;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const paged = pageOf(entries, page);
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  const shown = !long || open;

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
        <span className="myday-card-caption" data-confirmed-caption>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {formatDuration(total)}
        </span>
        {long && (
          <button
            type="button"
            className="myday-linkish"
            aria-expanded={open}
            aria-controls="myday-entries-list"
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            {open ? 'Hide them' : 'Show them'}
          </button>
        )}
      </header>

      {shown && (
        <>
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
                  pending={pending}
                  onNavigate={onNavigate}
                  onSave={(patch) => onSave(entry, patch)}
                  onDelete={() => {
                    onDelete(entry);
                  }}
                />
              ))}
            </ol>
          </div>
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
        </>
      )}
    </section>
  );
}
