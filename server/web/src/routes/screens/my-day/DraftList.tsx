import { useEffect, useRef, useState } from 'react';
import type { DraftPatch, TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import {
  effectiveSelection,
  pageState,
  selectAll,
  togglePage,
  NO_SELECTION,
} from '../list/list-select.ts';
import { DraftRow } from './DraftRow.tsx';
import {
  PAGE_SIZE,
  minutesOf,
  needCardLine,
  needsCard,
  pageOf,
  placed,
  selectRange,
  type BulkKind,
} from './draft-bulk.ts';
import { hm } from './my-day-derive.ts';

/** A batch in flight, or what the last one did — on the day it ran on. */
export type Batch =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      readonly day: string;
      readonly label: string;
      readonly done: number;
      readonly total: number;
    }
  | { readonly kind: 'said'; readonly day: string; readonly text: string; readonly ok: boolean };

/** The bar asks once before a batch that is hard to take back. */
type Asking = 'none' | 'dismiss' | 'general';

export interface DraftListProps {
  readonly drafts: readonly TimeDraft[];
  /** The action in flight anywhere on the page. */
  readonly pending: string | undefined;
  readonly batch: Batch;
  readonly onNavigate: (to: string) => void;
  readonly onPatch: (draft: TimeDraft, patch: DraftPatch, verb: string) => Promise<boolean>;
  readonly onSplit: (draft: TimeDraft, at: number) => Promise<boolean>;
  readonly onDismiss: (draft: TimeDraft) => void;
  readonly onConfirm: (draft: TimeDraft) => void;
  /** Run one batch over `chosen`; resolves to the ids that stay selected. */
  readonly onBulk: (kind: BulkKind, chosen: readonly TimeDraft[]) => Promise<readonly string[]>;
}

/**
 * The day's drafted blocks (LAI-810, the owner: *"that must show in scroll
 * then in pagination; also add the all select and multi select"*): ten to a
 * page in a scroll area of their own, a box on every row, and a bar that
 * acts on what is ticked.
 *
 * The box in the header selects **this page**, as every mail client's does;
 * once it is ticked a link offers every page. Shift-click selects a run.
 * Selection is kept by id across pages, and what a batch acts on is always
 * pruned to the blocks still drafted.
 *
 * Two batches ask first (LAI-810 review round 1): *Not work*, because a
 * dismissed block cannot be brought back here; and *General* when any ticked
 * block is on a card or a space, because General takes it off — asked
 * rather than refused, since moving blocks the collector put on the wrong
 * card is a correction worth making many at a time.
 */
export function DraftList({
  drafts,
  pending,
  batch,
  onNavigate,
  onPatch,
  onSplit,
  onDismiss,
  onConfirm,
  onBulk,
}: DraftListProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [asking, setAsking] = useState<Asking>('none');
  const head = useRef<HTMLInputElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const live = effectiveSelection(selected, drafts);
  const paged = pageOf(drafts, page);
  const pageIds = paged.items.map((d) => d.id);
  const headState = pageState(live, pageIds);
  const busy = pending !== undefined;
  const chosen = drafts.filter((d) => live.has(d.id));
  const chosenNeedCard = chosen.filter(needsCard).length;
  const chosenPlaced = chosen.filter(placed);
  const dayNeedCard = drafts.filter(needsCard).length;
  const total = drafts.reduce((sum, d) => sum + d.minutes, 0);

  useEffect(() => {
    if (head.current !== null) head.current.indeterminate = headState === 'some';
  }, [headState]);

  const go = (to: number): void => {
    setPage(to);
    if (scroller.current !== null) scroller.current.scrollTop = 0;
  };

  const act = (kind: BulkKind, blocks: readonly TimeDraft[] = chosen): void => {
    setAsking('none');
    // Ticked but not part of this batch ("only the ones on nothing"): still ticked.
    const untouched = chosen.filter((d) => !blocks.includes(d)).map((d) => d.id);
    void onBulk(kind, blocks).then((keep) => {
      setSelected(new Set([...keep, ...untouched]));
      setAnchor(undefined);
    });
  };

  return (
    <section className="myday-card myday-drafts" aria-labelledby="myday-drafts-title">
      <header className="myday-card-head">
        <input
          ref={head}
          type="checkbox"
          className="myday-check"
          checked={headState === 'all'}
          disabled={busy}
          aria-label="Select every block on this page"
          onChange={() => {
            setSelected(togglePage(live, pageIds));
            setAnchor(undefined);
            setAsking('none');
          }}
        />
        <h2 className="myday-card-title" id="myday-drafts-title">
          Drafted — not yet confirmed
        </h2>
        <span className="myday-card-caption" data-drafted-caption>
          {drafts.length} {drafts.length === 1 ? 'block' : 'blocks'} · {hm(total)}
          {dayNeedCard > 0 && ` · ${needCardLine(dayNeedCard)}`}
        </span>
        {headState === 'all' && live.size < drafts.length && (
          <button
            type="button"
            className="myday-linkish"
            disabled={busy}
            onClick={() => {
              setSelected(selectAll(drafts));
              setAsking('none');
            }}
          >
            Select all {drafts.length} drafted
          </button>
        )}
      </header>

      {live.size > 0 && (
        <div className="myday-bulk" role="group" aria-label="Selected blocks">
          <span className="myday-bulk-count" data-bulk-count>
            <strong>{live.size} selected</strong> · {hm(minutesOf(drafts, live))}
          </span>
          {chosenNeedCard > 0 && (
            <span className="myday-bulk-warn" data-bulk-needcard>
              {needCardLine(chosenNeedCard)} — left out of Confirm
            </span>
          )}
          <span className="myday-bulk-actions">
            {asking === 'dismiss' && (
              <>
                <span className="myday-quiet" data-bulk-ask>
                  Mark {live.size} as not work? They stay dismissed.
                </span>
                <button
                  type="button"
                  className="myday-chip myday-chip-danger"
                  disabled={busy}
                  onClick={() => {
                    act('dismiss');
                  }}
                >
                  Mark not work
                </button>
              </>
            )}
            {asking === 'general' && (
              <>
                <span className="myday-quiet" data-bulk-ask>
                  {chosenPlaced.length} of these {chosenPlaced.length === 1 ? 'is' : 'are'} on a
                  card or a space — move {chosenPlaced.length === 1 ? 'it' : 'them'} to General too?
                </span>
                <button
                  type="button"
                  className="myday-chip myday-chip-danger"
                  disabled={busy}
                  onClick={() => {
                    act('general');
                  }}
                >
                  Move all {live.size} to General
                </button>
                {chosenPlaced.length < live.size && (
                  <button
                    type="button"
                    className="myday-chip"
                    disabled={busy}
                    onClick={() => {
                      act(
                        'general',
                        chosen.filter((d) => !placed(d)),
                      );
                    }}
                  >
                    Only the {live.size - chosenPlaced.length} on nothing
                  </button>
                )}
              </>
            )}
            {asking !== 'none' ? (
              <button
                type="button"
                className="myday-chip"
                onClick={() => {
                  setAsking('none');
                }}
              >
                Keep them
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="myday-chip myday-chip-primary"
                  disabled={busy}
                  onClick={() => {
                    act('confirm');
                  }}
                >
                  Confirm selected
                </button>
                <button
                  type="button"
                  className="myday-chip"
                  disabled={busy}
                  onClick={() => {
                    if (chosenPlaced.length > 0) setAsking('general');
                    else act('general');
                  }}
                >
                  General
                </button>
                <button
                  type="button"
                  className="myday-chip"
                  disabled={busy}
                  onClick={() => {
                    setAsking('dismiss');
                  }}
                >
                  Not work
                </button>
                <button
                  type="button"
                  className="myday-chip"
                  disabled={busy}
                  onClick={() => {
                    setSelected(NO_SELECTION);
                    setAnchor(undefined);
                  }}
                >
                  Clear
                </button>
              </>
            )}
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
      {batch.kind === 'said' && (
        <p
          className={batch.ok ? 'myday-bulk-said' : 'myday-bulk-said myday-bulk-said-warn'}
          role={batch.ok ? 'status' : 'alert'}
          data-bulk-said
        >
          {batch.text}
        </p>
      )}

      <div
        ref={scroller}
        className="myday-scroll"
        role="region"
        aria-label={`Drafted blocks, ${paged.label}`}
        // A region that scrolls is reachable by keyboard, so it can be scrolled.
        tabIndex={0}
      >
        <ol className="myday-blocks" aria-label="Drafted blocks">
          {paged.items.map((draft, i) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              position={paged.page * PAGE_SIZE + i + 1}
              count={drafts.length}
              pending={pending}
              selected={live.has(draft.id)}
              onSelect={(on, range) => {
                setSelected(
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
                setAsking('none');
              }}
              onNavigate={onNavigate}
              onPatch={(patch, verb) => onPatch(draft, patch, verb)}
              onSplit={(at) => onSplit(draft, at)}
              onDismiss={() => {
                onDismiss(draft);
              }}
              onConfirm={() => {
                onConfirm(draft);
              }}
            />
          ))}
        </ol>
      </div>

      {paged.pages > 1 && (
        <nav className="myday-pager" aria-label="Drafted pages">
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
          <span className="myday-pager-label" aria-live="polite" data-pager-label>
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
    </section>
  );
}
