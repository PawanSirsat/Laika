import type { ReactNode } from 'react';
import {
  ciLine,
  ciVerdict,
  evidenceSummary,
  roundAgentName,
  waitingFor,
  type ReviewQueueItem,
} from '../../../api/review.ts';
import { buildLabel } from '../../../api/estimates.ts';
import { pageState, toggleOne, togglePage } from '../list/list-select.ts';
import type { SpaceGroup } from './review-derive.ts';

export interface ReviewGroupsProps {
  readonly groups: readonly SpaceGroup[];
  /** The clock the waiting labels count to. */
  readonly now: number;
  /** The task ids ticked — only ever rows the reader may decide. */
  readonly selected: ReadonlySet<string>;
  readonly onSelect: (next: ReadonlySet<string>) => void;
  /** A bulk run is under way: the boxes hold still. */
  readonly busy: boolean;
  /** The row whose proof is open, if any. */
  readonly expanded: string | null;
  readonly onToggle: (item: ReviewQueueItem) => void;
  /** The open row's proof and decisions, drawn under its line. */
  readonly detail: (item: ReviewQueueItem) => ReactNode;
}

/**
 * The queue by space (D-146, LAI-1168): a heading per space with its count
 * and a select-all box, then the rows — a checkbox beside the line for a row
 * the reader may decide, an empty cell for one they may not, so the lines
 * align whichever view is open.
 *
 * **The checkbox is outside the row button.** The line is a button that opens
 * the proof; a box inside it would be a control inside a control, and a near
 * miss on a 16px box must tick, not expand.
 */
export function ReviewGroups({
  groups,
  now,
  selected,
  onSelect,
  busy,
  expanded,
  onToggle,
  detail,
}: ReviewGroupsProps) {
  return (
    <div className="rev-groups">
      {groups.map((group) => {
        const headState = pageState(selected, group.decidable);
        const headingId = `rev-group-${group.project.id}`;
        return (
          <section
            key={group.project.id}
            className="rev-group"
            data-space={group.project.slug}
            aria-labelledby={headingId}
          >
            <header className="rev-group-head">
              <span className="rev-cell">
                {group.decidable.length > 0 && (
                  <input
                    type="checkbox"
                    className="checkbox-input rev-check"
                    aria-label={`Select every task in ${group.project.name}`}
                    checked={headState === 'all'}
                    disabled={busy}
                    // `indeterminate` is a property, not an attribute, so React
                    // has no prop for it; the ref sets it on every render.
                    ref={(box) => {
                      if (box !== null) box.indeterminate = headState === 'some';
                    }}
                    onChange={() => {
                      onSelect(togglePage(selected, group.decidable));
                    }}
                  />
                )}
              </span>
              <h3 className="rev-group-title" id={headingId}>
                {group.project.name}
              </h3>
              <span className="rev-group-count">
                {group.items.length}
                <span className="visually-hidden"> waiting</span>
              </span>
            </header>
            <ul
              className="rev-list"
              aria-label={`Tasks waiting for review in ${group.project.name}`}
            >
              {group.items.map((item) => {
                const open = expanded === item.task.id;
                const ticked = selected.has(item.task.id);
                const summary = evidenceSummary(item.round);
                const ci = ciVerdict(item.round);
                const agent = item.round === null ? null : roundAgentName(item.round);
                return (
                  <li
                    key={item.task.id}
                    className={[
                      'rev-row',
                      open ? 'rev-row-open' : '',
                      ticked ? 'rev-row-selected' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    data-task={item.task.key}
                  >
                    <span className="rev-cell">
                      {item.can_decide && (
                        <input
                          type="checkbox"
                          className="checkbox-input rev-check"
                          aria-label={`Select ${item.task.key}`}
                          checked={ticked}
                          disabled={busy}
                          onChange={() => {
                            onSelect(toggleOne(selected, item.task.id));
                          }}
                        />
                      )}
                    </span>
                    <button
                      type="button"
                      className="rev-line"
                      aria-expanded={open}
                      aria-controls={`rev-detail-${item.task.id}`}
                      onClick={() => {
                        onToggle(item);
                      }}
                    >
                      <span className="rev-key">{item.task.key}</span>
                      <span className="rev-title">{item.task.title}</span>
                      <span className="rev-wait" title="Waiting since it entered review">
                        {waitingFor(item.waiting_since, now)}
                      </span>
                      <span className="rev-meta">
                        <span>{item.assignee_name ?? 'Unassigned'}</span>
                        {agent !== null && <span className="rev-agent">{agent}</span>}
                        {item.round !== null && <span>round {item.round.number}</span>}
                      </span>
                      <span className="rev-proof">
                        {item.cue !== null && (
                          <span
                            className="rev-chip rev-chip-check"
                            data-cue={item.cue.kind}
                            title={`Finished in ${buildLabel(item.cue.build_ms)} against a forecast of ${buildLabel(
                              item.cue.forecast_p50_ms,
                            )}, and CI has not confirmed it`}
                          >
                            check this one
                          </span>
                        )}
                        {summary.empty ? (
                          <span className="rev-chip rev-chip-none">no proof</span>
                        ) : (
                          <>
                            {summary.commits > 0 && (
                              <span className="rev-chip">
                                {summary.commits} {summary.commits === 1 ? 'commit' : 'commits'}
                              </span>
                            )}
                            {summary.pullRequest !== null && <span className="rev-chip">PR</span>}
                            {summary.testsPassed > 0 && (
                              <span className="rev-chip rev-chip-pass">
                                ✓ {summary.testsPassed} passed
                              </span>
                            )}
                            {summary.testsFailed > 0 && (
                              <span className="rev-chip rev-chip-fail">
                                ✗ {summary.testsFailed} failed
                              </span>
                            )}
                            {ci !== 'none' && item.round?.ci != null && (
                              <span
                                className={`rev-chip rev-chip-ci rev-chip-ci-${ci}`}
                                title={ciLine(item.round.ci)}
                                data-ci={ci}
                              >
                                {ci === 'failed' ? '✗ CI' : ci === 'confirmed' ? '✓ CI' : '… CI'}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </button>
                    {open && detail(item)}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
