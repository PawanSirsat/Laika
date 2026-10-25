import { useEffect, useRef, useState } from 'react';
import type { TaskRef, TimeDraft } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { effectiveSelection, pageState, togglePage, NO_SELECTION } from '../list/list-select.ts';
import { groupByPart } from './day-groups.ts';
import { DraftRow } from './DraftRow.tsx';
import { minutesOf, needsCard, selectRange, type BulkKind } from './draft-bulk.ts';
import { duration } from './format.ts';
import { HeaderPopover } from './HeaderPopover.tsx';

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
  /**
   * Run one batch over `chosen`; `card` with `assign`. Resolves to the ids
   * that stay selected.
   */
  readonly onBulk: (
    kind: BulkKind,
    chosen: readonly TimeDraft[],
    card?: string,
  ) => Promise<readonly string[]>;
  /** The cards *Assign task* offers: the day's, and the person's in progress. */
  readonly assignOptions?: readonly TaskRef[];
  /** Somebody else's day, read (LAI-959): no boxes to tick and nothing to run. */
  readonly readOnly?: boolean;
  /** Drafting is off (D-110): the empty list says so. */
  readonly draftOff?: boolean;
}

/**
 * *To review* (the owner's design, LAI-514; LAI-810): the day's drafted
 * blocks — the reader's, and read only by owners and admins (D-102,
 * LAI-968) — grouped by the part of the day, a box on every row, and a
 * floating bar at the foot of the page that acts on what is ticked: Confirm
 * (or *Confirm k* when some have no task), *Assign task ▾*, *Not work time*,
 * ×. The list has no scroll of its own, so the wheel always moves the page
 * (LAI-311). Clicking a row puts it in the editor.
 *
 * The box in the header selects every block and shows a dash when some are;
 * Shift-click selects a run. What a batch acts on is always pruned to the
 * blocks still drafted.
 *
 * **Confirm leaves out what has no task**: those blocks stay ticked and the
 * toast counts them. *Assign task*, *No task* and *Not work time* act at
 * once — **Undo** takes any of them back exactly.
 */
export function DraftList({
  drafts,
  pending,
  batch,
  selected,
  onSelect,
  onNavigate,
  onBulk,
  assignOptions = [],
  readOnly = false,
  draftOff = false,
}: DraftListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [assignOpen, setAssignOpen] = useState(false);
  const head = useRef<HTMLInputElement | null>(null);

  const live = effectiveSelection(checked, drafts);
  // One list, grouped by the part of the day (LAI-505): the box takes it all.
  const allIds = drafts.map((d) => d.id);
  const headState = pageState(live, allIds);
  const groups = groupByPart(drafts);
  const busy = pending !== undefined;
  const chosen = drafts.filter((d) => live.has(d.id));
  const chosenReady = chosen.filter((d) => !needsCard(d)).length;
  const dayNeedCard = drafts.filter(needsCard).length;
  const total = drafts.reduce((sum, d) => sum + d.minutes, 0);

  useEffect(() => {
    if (head.current !== null) head.current.indeterminate = headState === 'some';
  }, [headState]);

  const act = (kind: BulkKind, card?: string): void => {
    setAssignOpen(false);
    void onBulk(kind, chosen, card).then((keep) => {
      setChecked(new Set(keep));
      setAnchor(undefined);
    });
  };

  return (
    <>
      <section
        className="myday-card myday-drafts myday-settle"
        aria-labelledby="myday-drafts-title"
      >
        <header className="myday-card-head">
          {!readOnly && (
            <input
              ref={head}
              type="checkbox"
              className="myday-check"
              checked={headState === 'all'}
              disabled={busy || drafts.length === 0}
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
            {drafts.length} · {duration(total)}
          </span>
          <span className="myday-card-head-gap" />
          {drafts.length > 0 && (
            <span
              className={
                dayNeedCard > 0 ? 'myday-card-caption myday-caption-warn' : 'myday-card-caption'
              }
              data-settle-hint
            >
              {dayNeedCard > 0 ? `${String(dayNeedCard)} with no task yet` : 'All ready to confirm'}
            </span>
          )}
        </header>

        {batch.kind === 'running' && (
          <p className="myday-bulk-progress" role="status">
            <Spinner size="sm" label={batch.label} />
            <progress max={Math.max(1, batch.total)} value={batch.done} />
            {batch.label} {batch.done} of {batch.total}…
          </p>
        )}

        {drafts.length === 0 ? (
          <p className="myday-quiet myday-list-empty" data-review-empty>
            {draftOff
              ? 'Nothing to review. Drafting is off.'
              : 'All reviewed. Nothing waiting on you.'}
          </p>
        ) : (
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
        )}
      </section>

      {/*
        The bar floats at the foot of the page while something is ticked (the
        design) — outside the card, which clips, so it can stick to the window.
      */}
      {!readOnly && live.size > 0 && (
        <div className="myday-bulk-dock">
          <div className="myday-bulk" role="toolbar" aria-label="Bulk actions">
            <span className="myday-bulk-count" data-bulk-count>
              <strong>{live.size} selected</strong>
            </span>
            <span className="myday-bulk-sum">{duration(minutesOf(drafts, live))}</span>
            <span className="myday-bulk-divider" aria-hidden="true" />
            <button
              type="button"
              className="myday-chip myday-chip-primary"
              disabled={busy || chosenReady === 0}
              data-bulk-confirm
              title={
                chosenReady < chosen.length
                  ? `${String(chosen.length - chosenReady)} with no task yet stay in To review`
                  : 'Confirm every ticked block'
              }
              onClick={() => {
                act('confirm');
              }}
            >
              {chosenReady === chosen.length ? 'Confirm' : `Confirm ${String(chosenReady)}`}
            </button>
            <HeaderPopover
              trigger={<>Assign task ▾</>}
              label="Assign task"
              title="Put every ticked block on a task"
              triggerClassName="myday-chip"
              width="narrow"
              placement="above"
              dataAttr="data-bulk-assign"
              disabled={busy}
              open={assignOpen}
              onOpenChange={setAssignOpen}
            >
              <ul className="myday-assign-list" aria-label="Tasks">
                {assignOptions.map((task) => (
                  <li key={task.key}>
                    <button
                      type="button"
                      className="myday-assign-option"
                      data-bulk-assign-task={task.key}
                      onClick={() => {
                        act('assign', task.key);
                      }}
                    >
                      <span className="myday-assign-key">{task.key}</span>
                      <span className="myday-assign-title">{task.title}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="myday-assign-option"
                    data-bulk-assign-task="general"
                    onClick={() => {
                      act('general');
                    }}
                  >
                    <span className="myday-assign-key myday-assign-key-none">No task</span>
                    <span className="myday-assign-title">Shows as its kind</span>
                  </button>
                </li>
              </ul>
            </HeaderPopover>
            <button
              type="button"
              className="myday-chip"
              disabled={busy}
              onClick={() => {
                act('dismiss');
              }}
            >
              Not work time
            </button>
            <button
              type="button"
              className="myday-chip myday-bulk-clear"
              aria-label="Clear selection"
              title="Clear selection"
              disabled={busy}
              onClick={() => {
                setChecked(NO_SELECTION);
                setAnchor(undefined);
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
