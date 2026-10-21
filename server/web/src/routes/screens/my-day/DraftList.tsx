import { useEffect, useRef, useState } from 'react';
import type { TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import {
  effectiveSelection,
  pageState,
  selectAll,
  togglePage,
  NO_SELECTION,
} from '../list/list-select.ts';
import { DraftRow } from './DraftRow.tsx';
import { ListScroller } from './ListScroller.tsx';
import {
  PAGE_SIZE,
  minutesOf,
  needCardLine,
  needsCard,
  pageOf,
  selectRange,
  type BulkKind,
} from './draft-bulk.ts';
import { duration } from './format.ts';

/** A batch in flight, on the day it runs on. Its last word is the page's toast. */
export type Batch =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      readonly day: string;
      readonly label: string;
      readonly done: number;
      readonly total: number;
    };

export interface DraftListProps {
  readonly drafts: readonly TimeDraft[];
  /** The action in flight anywhere on the page. */
  readonly pending: string | undefined;
  readonly batch: Batch;
  /** The block in the inspector. */
  readonly selected: string | undefined;
  readonly onSelect: (draft: TimeDraft) => void;
  readonly onNavigate: (to: string) => void;
  /** Run one batch over `chosen`; resolves to the ids that stay selected. */
  readonly onBulk: (kind: BulkKind, chosen: readonly TimeDraft[]) => Promise<readonly string[]>;
}

/**
 * *To settle* (the owner's design, LAI-831; LAI-810): the day's drafted
 * blocks — only the reader sees them — ten to a page in a scroll area of
 * their own, a box on every row and a bar that acts on what is ticked.
 * Clicking a row puts it in the inspector.
 *
 * The box in the header selects **this page**, as every mail client's does,
 * and shows a mixed state when some are; once it is ticked a link offers
 * every page. Shift-click selects a run. Selection is kept by id across pages,
 * and what a batch acts on is always pruned to the blocks still drafted.
 *
 * **Confirm leaves out what needs a card**: those blocks stay ticked and the
 * toast counts them. *General* and *Not work* act at once — **Undo** takes
 * either back exactly, which is why LAI-810's two questions are gone.
 */
export function DraftList({
  drafts,
  pending,
  batch,
  selected,
  onSelect,
  onNavigate,
  onBulk,
}: DraftListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const head = useRef<HTMLInputElement | null>(null);
  const card = useRef<HTMLElement | null>(null);

  const live = effectiveSelection(checked, drafts);
  const paged = pageOf(drafts, page);
  const pageIds = paged.items.map((d) => d.id);
  const headState = pageState(live, pageIds);
  const busy = pending !== undefined;
  const chosen = drafts.filter((d) => live.has(d.id));
  const chosenNeedCard = chosen.filter(needsCard).length;
  const dayNeedCard = drafts.filter(needsCard).length;
  const total = drafts.reduce((sum, d) => sum + d.minutes, 0);

  useEffect(() => {
    if (head.current !== null) head.current.indeterminate = headState === 'some';
  }, [headState]);

  // The selected block's page is the page shown: J and K walk every page.
  const selectedAt = selected === undefined ? -1 : drafts.findIndex((d) => d.id === selected);
  useEffect(() => {
    if (selectedAt >= 0) setPage(Math.floor(selectedAt / PAGE_SIZE));
  }, [selectedAt]);

  const act = (kind: BulkKind): void => {
    void onBulk(kind, chosen).then((keep) => {
      setChecked(new Set(keep));
      setAnchor(undefined);
    });
  };

  return (
    <section
      ref={card}
      className="myday-card myday-drafts myday-settle"
      aria-labelledby="myday-drafts-title"
    >
      <header className="myday-card-head">
        <input
          ref={head}
          type="checkbox"
          className="myday-check"
          checked={headState === 'all'}
          disabled={busy}
          aria-label="Select every block on this page"
          onChange={() => {
            setChecked(togglePage(live, pageIds));
            setAnchor(undefined);
          }}
        />
        <h2 className="myday-card-title" id="myday-drafts-title">
          To settle
        </h2>
        <span className="myday-card-figure" data-drafted-caption>
          {drafts.length} {drafts.length === 1 ? 'block' : 'blocks'} · {duration(total)}
        </span>
        {headState === 'all' && live.size < drafts.length && (
          <button
            type="button"
            className="myday-linkish"
            disabled={busy}
            onClick={() => {
              setChecked(selectAll(drafts));
            }}
          >
            Select all {drafts.length} drafted
          </button>
        )}
        <span className="myday-card-head-gap" />
        {live.size === 0 && (
          <span className="myday-card-caption" data-settle-hint>
            {dayNeedCard > 0 ? needCardLine(dayNeedCard) : 'all ready to confirm'}
          </span>
        )}
      </header>

      {live.size > 0 && (
        <div className="myday-bulk" role="group" aria-label="Selected blocks">
          <span className="myday-bulk-count" data-bulk-count>
            <strong>{live.size} selected</strong> · {duration(minutesOf(drafts, live))}
          </span>
          {chosenNeedCard > 0 && (
            <span className="myday-bulk-warn" data-bulk-needcard>
              {needCardLine(chosenNeedCard)} — left out of Confirm
            </span>
          )}
          <span className="myday-bulk-actions">
            <button
              type="button"
              className="myday-chip myday-chip-primary"
              disabled={busy}
              onClick={() => {
                act('confirm');
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                act('general');
              }}
            >
              General
            </button>
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                act('dismiss');
              }}
            >
              Not work
            </button>
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                setChecked(NO_SELECTION);
                setAnchor(undefined);
              }}
            >
              Clear
            </button>
          </span>
        </div>
      )}

      {batch.kind === 'running' && (
        <p className="myday-bulk-progress" role="status">
          <Spinner size="sm" label={batch.label} />
          <progress max={Math.max(1, batch.total)} value={batch.done} />
          {batch.label} {batch.done} of {batch.total}…
        </p>
      )}

      <ListScroller
        card={card}
        label={`Drafted blocks, ${paged.label}`}
        page={paged.page}
        selected={selected}
      >
        <ol className="myday-blocks" aria-label="Drafted blocks">
          {paged.items.map((draft, i) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              position={paged.page * PAGE_SIZE + i + 1}
              count={drafts.length}
              busy={busy}
              checked={live.has(draft.id)}
              selected={draft.id === selected}
              onSelect={() => {
                onSelect(draft);
              }}
              onCheck={(on, range) => {
                setChecked(
                  range
                    ? selectRange(
                        live,
                        drafts.map((d) => d.id),
                        anchor,
                        draft.id,
                        on,
                      )
                    : selectRange(live, [draft.id], undefined, draft.id, on),
                );
                setAnchor(draft.id);
              }}
              onNavigate={onNavigate}
            />
          ))}
        </ol>
      </ListScroller>

      {paged.pages > 1 && (
        <nav className="myday-pager" aria-label="Drafted pages">
          <button
            type="button"
            className="myday-chip"
            disabled={paged.page === 0}
            onClick={() => {
              setPage(paged.page - 1);
            }}
          >
            ‹ Prev
          </button>
          <span className="myday-pager-label" aria-live="polite" data-pager-label>
            {paged.label}
          </span>
          <button
            type="button"
            className="myday-chip"
            disabled={paged.page >= paged.pages - 1}
            onClick={() => {
              setPage(paged.page + 1);
            }}
          >
            Next ›
          </button>
        </nav>
      )}
    </section>
  );
}
