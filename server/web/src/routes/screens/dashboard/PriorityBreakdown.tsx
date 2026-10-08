import { PRIORITY_NAMES, PriorityIcon } from '../../../components/PriorityIcon.tsx';
import type { TaskPriority } from '../../../api/tasks.ts';
import { DashLink, listHref } from './DashLink.tsx';
import type { PriorityCount } from './summary-derive.ts';

/** The priority icon's own colours (`priority-icon.css`), so the bar matches the mark. */
const PRIORITY_COLOR: Readonly<Record<TaskPriority, string>> = {
  p1: 'var(--priority-high)',
  p2: 'var(--priority-medium)',
  p3: 'var(--priority-low)',
};

/**
 * **Priority breakdown** (LAI-711) — Jira's, for open work. Each bar is drawn
 * against the largest, so the busiest priority fills the track; each row opens
 * the List filtered to it.
 */
export function PriorityBreakdown({
  counts,
  slug,
}: {
  readonly counts: readonly PriorityCount[];
  readonly slug: string;
}) {
  const peak = Math.max(0, ...counts.map((c) => c.count));
  const open = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <section className="dash-card dash-priority" aria-labelledby="dash-priority-title">
      <header className="dash-card-head">
        <h2 id="dash-priority-title" className="dash-card-title">
          Priority breakdown
        </h2>
        <span className="dash-card-meta">{open} open</span>
      </header>
      {open === 0 ? (
        <p className="dash-empty">No open work.</p>
      ) : (
        <ul className="dash-bars-list">
          {counts.map((c) => (
            <li key={c.priority}>
              <DashLink
                href={listHref(slug, { priority: c.priority })}
                className="dash-prio-row"
                title={`Open ${PRIORITY_NAMES[c.priority]} priority in the List`}
              >
                <span className="dash-prio-name">
                  <PriorityIcon priority={c.priority} />
                  {PRIORITY_NAMES[c.priority]}
                </span>
                <span className="dash-prio-track" aria-hidden="true">
                  <span
                    className="dash-prio-fill"
                    style={{
                      width: peak === 0 ? '0%' : `${String((c.count / peak) * 100)}%`,
                      background: PRIORITY_COLOR[c.priority],
                    }}
                  />
                </span>
                <span className="dash-prio-n" data-priority={c.priority}>
                  {c.count}
                </span>
              </DashLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
