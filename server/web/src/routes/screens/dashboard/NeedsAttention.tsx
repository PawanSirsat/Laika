import { useState } from 'react';
import { staleFor } from '../../../api/board-derive.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import type { BlockedTask } from './dashboard-derive.ts';
import { DashLink, boardHref } from './DashLink.tsx';
import { REVIEW_WAIT_DAYS, type ReviewWait } from './summary-derive.ts';

type Tab = 'blocked' | 'stale' | 'review';

/**
 * **Needs attention** (LAI-711, reshaped by LAI-817 and D-092): what cannot
 * move, what the server says has stopped, and what waits on a reviewer.
 *
 * Each tab carries its true count, every row opens the task, and the list
 * scrolls inside the card, so nothing is cut to fit and nothing is counted
 * after a cut.
 *
 * - **Blocked** counts committed work — to do and in progress — waiting on
 *   unfinished work. Backlog chains are listed apart, under the count, and
 *   not in it (D-092 item 3).
 * - **Stale** is the server's flag (`stale_flagged_at`, §11.6), not a rule of
 *   this page's own (D-092 item 4).
 * - **Waiting for review** is a long wait on a reviewer, which used to read as
 *   "stale" against the person whose work was done.
 */
export function NeedsAttention({
  blocked,
  blockedApart,
  stale,
  review,
  nameOf,
  slug,
  now,
}: {
  /** Committed work waiting on unfinished work — the count. */
  readonly blocked: readonly BlockedTask[];
  /** Backlog (and anything else not committed) waiting the same way — shown, not counted. */
  readonly blockedApart: readonly BlockedTask[];
  readonly stale: readonly TaskSummary[];
  readonly review: readonly ReviewWait[];
  readonly nameOf: (id: string) => string;
  readonly slug: string;
  readonly now: number;
}) {
  const [tab, setTab] = useState<Tab>(
    blocked.length > 0
      ? 'blocked'
      : stale.length > 0
        ? 'stale'
        : review.length > 0
          ? 'review'
          : 'blocked',
  );

  const blockedRow = (row: BlockedTask) => (
    <li key={row.task.id}>
      <DashLink href={boardHref(slug, { task: row.task.id })} className="dash-att-row">
        <span className="dash-key">{row.task.key}</span>
        <span className="dash-att-title">{row.task.title}</span>
        <span className="dash-att-meta">
          {row.task.status_name} · waiting on{' '}
          {[
            ...row.blockedBy.map((dep) => dep.key),
            ...(row.unknown.length > 0 ? [`${String(row.unknown.length)} not on this board`] : []),
          ].join(', ')}
        </span>
      </DashLink>
    </li>
  );

  return (
    <section className="dash-card dash-attention" aria-labelledby="dash-attention-title">
      <header className="dash-card-head">
        <h2 id="dash-attention-title" className="dash-card-title">
          Needs attention
        </h2>
        <span className="dash-tabs" role="tablist" aria-label="Needs attention">
          {(
            [
              ['blocked', 'Blocked', blocked.length],
              ['stale', 'Stale', stale.length],
              ['review', `Waiting for review > ${String(REVIEW_WAIT_DAYS)} days`, review.length],
            ] as const
          ).map(([id, name, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`dash-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="dash-attention-list"
              className={tab === id ? 'dash-tab dash-tab-on' : 'dash-tab'}
              onClick={() => {
                setTab(id);
              }}
            >
              {name} <span className="dash-tab-count">{count}</span>
            </button>
          ))}
        </span>
      </header>

      <div
        id="dash-attention-list"
        className="dash-attention-scroll"
        role="tabpanel"
        aria-labelledby={`dash-tab-${tab}`}
      >
        {tab === 'blocked' ? (
          <>
            {blocked.length === 0 ? (
              <p className="dash-empty">
                Nothing to do or in progress is waiting on unfinished work.
              </p>
            ) : (
              <ul className="dash-att-list">{blocked.map(blockedRow)}</ul>
            )}
            {blockedApart.length > 0 && (
              <>
                <h3 className="dash-att-apart">
                  Not counted — {blockedApart.length} in backlog or review, waiting the same way
                </h3>
                <ul className="dash-att-list dash-att-list-apart">
                  {blockedApart.map(blockedRow)}
                </ul>
              </>
            )}
          </>
        ) : tab === 'stale' ? (
          stale.length === 0 ? (
            <p className="dash-empty">
              Nothing is flagged stale — all work in progress has a recent heartbeat or commit.
            </p>
          ) : (
            <ul className="dash-att-list">
              {stale.map((task) => (
                <li key={task.id}>
                  <DashLink href={boardHref(slug, { task: task.id })} className="dash-att-row">
                    <span className="dash-key">{task.key}</span>
                    <span className="dash-att-title">{task.title}</span>
                    <span className="dash-att-meta">
                      <span className="dash-att-quiet">
                        stale {staleFor(task.stale_flagged_at ?? now, now)}
                      </span>{' '}
                      · {task.status_name}
                      {task.assignee_id !== null && <> · {nameOf(task.assignee_id)}</>}
                    </span>
                  </DashLink>
                </li>
              ))}
            </ul>
          )
        ) : review.length === 0 ? (
          <p className="dash-empty">
            Nothing has waited for review more than {REVIEW_WAIT_DAYS} days.
          </p>
        ) : (
          <ul className="dash-att-list">
            {review.map(({ task, since }) => (
              <li key={task.id}>
                <DashLink href={boardHref(slug, { task: task.id })} className="dash-att-row">
                  <span className="dash-key">{task.key}</span>
                  <span className="dash-att-title">{task.title}</span>
                  <span className="dash-att-meta">
                    <span className="dash-att-quiet">{staleFor(since, now)} in review</span>
                    {task.assignee_id !== null && <> · {nameOf(task.assignee_id)}’s</>}
                  </span>
                </DashLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
