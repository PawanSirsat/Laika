import { useState } from 'react';
import { statusLabel } from '../../../api/board-derive.ts';
import type { TaskStatus } from '../../../api/tasks.ts';
import { Donut } from '../../../components/Donut.tsx';
import { percentLabel, roundedPercents } from '../../../components/donut-arcs.ts';
import type { StatusBreakdown } from './dashboard-derive.ts';
import { DashLink, listHref } from './DashLink.tsx';

/**
 * The board's lane colours (`board.css`), so a status is the same colour on
 * both screens — and never the accent, which `theme.css` keeps for "you".
 */
const STATUS_COLOR: Readonly<Record<TaskStatus, string>> = {
  backlog: 'var(--text-muted)',
  todo: 'var(--chip-purple)',
  in_progress: 'var(--chip-blue)',
  review: 'var(--chip-orange)',
  done: 'var(--chip-green)',
  cancelled: 'var(--border-default)',
};

/**
 * **Status overview** (LAI-711) — Jira's donut, and the old Release progress
 * folded into its centre: the share of live work that is done.
 *
 * Cancelled work is left out of the ring for the reason `statusBreakdown`
 * gives — work that will not happen must not make a finished project look
 * unfinished — and named beneath it, so the cancellations are still a fact on
 * the page.
 */
export function StatusOverview({
  breakdown,
  slug,
}: {
  readonly breakdown: StatusBreakdown;
  readonly slug: string;
}) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const live = breakdown.counts.filter((c) => c.status !== 'cancelled');
  const percents = roundedPercents(live.map((c) => c.count));
  const cancelled = breakdown.total - breakdown.live;
  const donePct = breakdown.live === 0 ? 0 : Math.round((breakdown.done / breakdown.live) * 100);

  return (
    <section className="dash-card dash-status" aria-labelledby="dash-status-title">
      <header className="dash-card-head">
        <h2 id="dash-status-title" className="dash-card-title">
          Status overview
        </h2>
        <span className="dash-card-meta">
          {breakdown.live} {breakdown.live === 1 ? 'task' : 'tasks'}
        </span>
      </header>

      {breakdown.live === 0 ? (
        <p className="dash-empty">This project has no tasks yet.</p>
      ) : (
        <div className="dash-chart">
          <Donut
            label="Tasks by status"
            value={`${String(donePct)}%`}
            caption="done"
            slices={live.map((c) => ({
              key: c.status,
              label: statusLabel(c.status),
              value: c.count,
              color: STATUS_COLOR[c.status],
            }))}
            active={active}
            onActive={setActive}
          />
          <ul className="dash-legend">
            {live.map((c, i) => (
              <li key={c.status}>
                <DashLink
                  href={listHref(slug, { status: c.status })}
                  className="dash-legend-row"
                  title={`Open ${statusLabel(c.status)} in the List`}
                  onMouseEnter={() => {
                    setActive(c.status);
                  }}
                  onMouseLeave={() => {
                    setActive(undefined);
                  }}
                  onFocus={() => {
                    setActive(c.status);
                  }}
                  onBlur={() => {
                    setActive(undefined);
                  }}
                >
                  <span
                    className="dash-swatch"
                    style={{ background: STATUS_COLOR[c.status] }}
                    aria-hidden="true"
                  />
                  <span className="dash-legend-name">{statusLabel(c.status)}</span>
                  <span className="dash-legend-n" data-status={c.status}>
                    {c.count}
                  </span>
                  <span className="dash-legend-pct">
                    {percentLabel(percents[i] ?? 0, c.count)}
                  </span>
                </DashLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cancelled > 0 && (
        <p className="dash-card-foot">
          {cancelled} cancelled, not counted in the {breakdown.live}.
        </p>
      )}
    </section>
  );
}
