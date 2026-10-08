import { useState } from 'react';
import { statusLabel, updatedAge } from '../../../api/board-derive.ts';
import type { Task } from '../../../api/tasks.ts';
import type { BlockedTask } from './dashboard-derive.ts';
import { DashLink, boardHref } from './DashLink.tsx';
import { STALE_DAYS } from './summary-derive.ts';

/**
 * **Needs attention** (LAI-711): what cannot move, and what has stopped moving.
 *
 * Two lists the old page kept in two cards — "Needs a decision" across the top
 * and "Stale" in a narrow rail — as one card with tabs, each tab carrying its
 * true count. Every row opens the task. The list scrolls inside the card, so
 * nothing is cut to fit and nothing is counted after a cut.
 */
export function NeedsAttention({
  blocked,
  stale,
  slug,
  now,
}: {
  readonly blocked: readonly BlockedTask[];
  readonly stale: readonly Task[];
  readonly slug: string;
  readonly now: number;
}) {
  const [tab, setTab] = useState<'blocked' | 'stale'>(
    blocked.length === 0 && stale.length > 0 ? 'stale' : 'blocked',
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
          blocked.length === 0 ? (
            <p className="dash-empty">Nothing is waiting on unfinished work.</p>
          ) : (
            <ul className="dash-att-list">
              {blocked.map((row) => (
                <li key={row.task.id}>
                  <DashLink href={boardHref(slug, { task: row.task.id })} className="dash-att-row">
                    <span className="dash-key">{row.task.key}</span>
                    <span className="dash-att-title">{row.task.title}</span>
                    <span className="dash-att-meta">
                      waiting on{' '}
                      {[
                        ...row.blockedBy.map((dep) => dep.key),
                        ...(row.unknown.length > 0
                          ? [`${String(row.unknown.length)} not on this board`]
                          : []),
                      ].join(', ')}
                    </span>
                  </DashLink>
                </li>
              ))}
            </ul>
          )
        ) : stale.length === 0 ? (
          <p className="dash-empty">Everything open has moved in the last {STALE_DAYS} days.</p>
        ) : (
          <ul className="dash-att-list">
            {stale.map((task) => (
              <li key={task.id}>
                <DashLink href={boardHref(slug, { task: task.id })} className="dash-att-row">
                  <span className="dash-key">{task.key}</span>
                  <span className="dash-att-title">{task.title}</span>
                  <span className="dash-att-meta">
                    <span className="dash-att-quiet">{updatedAge(task.updated_at, now)} quiet</span>{' '}
                    · {statusLabel(task.status)}
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
