import { useEffect, useRef, useState } from 'react';
import type { TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { effectiveSelection, pageState, togglePage, NO_SELECTION } from '../list/list-select.ts';
import { groupByPart } from './day-groups.ts';
import { DraftRow } from './DraftRow.tsx';
import { minutesOf, needCardLine, needsCard, selectRange, type BulkKind } from './draft-bulk.ts';
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
  /** Somebody else's day, read (LAI-959): no boxes to tick and nothing to run. */
  readonly readOnly?: boolean;
}

/**
 * *To settle* (the owner's design, LAI-831; LAI-810): the day's drafted
 * blocks — the reader's, and read only by owners and admins (D-102,
 * LAI-968) — ten to a page, a box on every row
 * and a bar that acts on what is ticked. The page of ten is the bound: the
 * list has no scroll of its own, so the wheel always moves the page (LAI-311).
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
  readOnly = false,
}: DraftListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const head = useRef<HTMLInputElement | null>(null);

  const live = effectiveSelection(checked, drafts);
  // One list, grouped by the part of the day (LAI-505): the box takes it all.
  const allIds = drafts.map((d) => d.id);
  const headState = pageState(live, allIds);
  const groups = groupByPart(drafts);
  const busy = pending !== undefined;
  const chosen = drafts.filter((d) => live.has(d.id));
  const chosenNeedCard = chosen.filter(needsCard).length;
  const dayNeedCard = drafts.filter(needsCard).length;
  const total = drafts.reduce((sum, d) => sum + d.minutes, 0);

  useEffect(() => {
    if (head.current !== null) head.current.indeterminate = headState === 'some';
  }, [headState]);

  const act = (kind: BulkKind): void => {
    void onBulk(kind, chosen).then((keep) => {
      setChecked(new Set(keep));
      setAnchor(undefined);
    });
  };

  return (
    <section className="myday-card myday-drafts myday-settle" aria-labelledby="myday-drafts-title">
      <header className="myday-card-head">
        {!readOnly && (
          <input
            ref={head}
            type="checkbox"
            className="myday-check"
            checked={headState === 'all'}
            disabled={busy}
            aria-label="Select every drafted block"
            onChange={() => {
              setChecked(togglePage(live, allIds));
              setAnchor(undefined);
            }}
          />
        )}
        <h2 className="myday-card-title" id="myday-drafts-title">
          To review
        </h2>
        <span className="myday-card-figure" data-drafted-caption>
          {drafts.length} {drafts.length === 1 ? 'block' : 'blocks'} · {duration(total)}
        </span>
        <span className="myday-card-head-gap" />
        {live.size === 0 && (
          <span className="myday-card-caption" data-settle-hint>
            {dayNeedCard > 0 ? needCardLine(dayNeedCard) : 'all ready to confirm'}
          </span>
        )}
        {!readOnly && live.size > 0 && (
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
      </header>

      {batch.kind === 'running' && (
        <p className="myday-bulk-progress" role="status">
          <Spinner size="sm" label={batch.label} />
          <progress max={Math.max(1, batch.total)} value={batch.done} />
          {batch.label} {batch.done} of {batch.total}…
        </p>
      )}

      <div className="myday-scroll" role="region" aria-label="Drafted blocks">
        <ol
          className={readOnly ? 'myday-blocks myday-blocks-read' : 'myday-blocks'}
          aria-label="Drafted blocks"
        >
          {groups.flatMap((group) => [
            <li
              key={`head-${group.key}`}
              className="myday-group-head"
              data-group={group.key}
              aria-label={`${group.name}: ${String(group.items.length)} blocks, ${duration(group.minutes)}`}
            >
              <span className="myday-group-name">{group.name}</span>
              <span className="myday-group-count">{group.items.length}</span>
              <span className="myday-group-sum">{duration(group.minutes)}</span>
            </li>,
            ...group.items.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                position={drafts.findIndex((d) => d.id === draft.id) + 1}
                count={drafts.length}
                busy={busy}
                checkable={!readOnly}
                checked={live.has(draft.id)}
                selected={draft.id === selected}
                onSelect={() => {
                  onSelect(draft);
                }}
                onCheck={(on, range) => {
                  setChecked(
                    range
                      ? selectRange(live, allIds, anchor, draft.id, on)
                      : selectRange(live, [draft.id], undefined, draft.id, on),
                  );
                  setAnchor(draft.id);
                }}
                onNavigate={onNavigate}
              />
            )),
          ])}
        </ol>
      </div>
    </section>
  );
}
