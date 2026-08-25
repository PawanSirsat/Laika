import { daysLeft, formatRange } from '../sprints/sprint-derive.ts';
import type { Sprint } from '../../../api/sprints.ts';
import type { Task } from '../../../api/tasks.ts';
import './sprint-strip.css';

export interface SprintStripProps {
  readonly sprints: readonly Sprint[];
  /** Every loaded task, so counts can be taken per sprint. */
  readonly tasks: readonly Task[];
  /** The sprint the board is scoped to, or `undefined` for all sprints. */
  readonly selected: string | undefined;
  readonly onSelect: (sprintId: string | undefined) => void;
  readonly onOpenSprints: () => void;
}

interface Counts {
  readonly total: number;
  readonly done: number;
  readonly blocked: number;
  readonly wip: number;
}

function countFor(tasks: readonly Task[], sprintId: string | undefined): Counts {
  const inScope = sprintId === undefined ? tasks : tasks.filter((t) => t.sprint_id === sprintId);
  return {
    total: inScope.length,
    done: inScope.filter((t) => t.status === 'done').length,
    // `ready` is server-computed (§4.5); a task that is not ready and not done
    // is waiting on something.
    blocked: inScope.filter((t) => !t.ready && t.status !== 'done').length,
    wip: inScope.filter((t) => t.status === 'in_progress').length,
  };
}

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/**
 * The band above the board (prototype, band A).
 *
 * Sprint names, dates, goals and every count here are **real** — they come from
 * `GET /projects/:slug/sprints` and the loaded task list. Only `WIP` is sample
 * data: nothing stores a per-column limit (see `demo/wip.ts`).
 *
 * Selecting a sprint scopes the board through `?sprint=`, which the tasks
 * endpoint has always accepted.
 */
export function SprintStrip({
  sprints,
  tasks,
  selected,
  onSelect,
  onOpenSprints,
}: SprintStripProps) {
  if (sprints.length === 0) return null;

  const now = Date.now();
  const current = sprints.find((s) => s.id === selected);
  const counts = countFor(tasks, selected);
  const ring = pct(counts.done, counts.total);
  // Inclusive, and normalised to UTC midnight — see `daysLeft`. My first pass
  // used `ceil((ends_on - now) / DAY)`, which reported **0** on a sprint's last
  // day, when the honest answer is 1.
  const remaining = current === undefined ? undefined : daysLeft(current.ends_on, now);

  return (
    <section className="strip" aria-label="Sprints">
      <div className="strip-row">
        <button
          type="button"
          className={selected === undefined ? 'strip-all strip-all-on' : 'strip-all'}
          aria-pressed={selected === undefined}
          onClick={() => {
            onSelect(undefined);
          }}
        >
          All sprints
        </button>

        <div className="strip-chips">
          {sprints.map((sprint, index) => {
            const c = countFor(tasks, sprint.id);
            const on = sprint.id === selected;
            return (
              <button
                key={sprint.id}
                type="button"
                className={
                  on ? 'strip-chip strip-chip-on' : `strip-chip strip-chip-${sprint.status}`
                }
                aria-pressed={on}
                onClick={() => {
                  onSelect(on ? undefined : sprint.id);
                }}
                title={sprint.goal ?? sprint.name}
              >
                <span className="strip-chip-head">
                  <span className="strip-chip-id">S{index + 1}</span>
                  <span className="strip-chip-name">{sprint.name}</span>
                  <span className="strip-chip-frac">
                    {c.done}/{c.total}
                  </span>
                </span>
                <span className="strip-chip-bar" aria-hidden="true">
                  <span style={{ width: `${String(pct(c.done, c.total))}%` }} />
                </span>
              </button>
            );
          })}
        </div>

        <button type="button" className="strip-detail" onClick={onOpenSprints}>
          Sprint detail →
        </button>
      </div>

      <div className="strip-summary">
        {/* A conic ring, as the prototype draws it — no charting library. */}
        <span
          className="strip-ring"
          style={{ background: `conic-gradient(var(--acc) ${String(ring)}%, var(--tub) 0)` }}
          aria-hidden="true"
        >
          <span className="strip-ring-hole">{ring}%</span>
        </span>

        <div className="strip-what">
          <p className="strip-title">
            <span className={`strip-badge strip-badge-${current?.status ?? 'all'}`}>
              {current === undefined ? 'ALL SPRINTS' : current.status.toUpperCase()}
            </span>
            <span className="strip-name">{current?.name ?? 'Every task in this project'}</span>
            {current !== undefined && (
              <span className="strip-dates">{formatRange(current.starts_on, current.ends_on)}</span>
            )}
          </p>
          {current?.goal != null && current.goal !== '' && (
            <p className="strip-goal">{current.goal}</p>
          )}
        </div>

        <dl className="strip-stats">
          <div className="strip-stat">
            <dt>DONE</dt>
            <dd>
              {counts.done}
              <span>/{counts.total}</span>
            </dd>
          </div>
          <div className="strip-stat strip-stat-blocked">
            <dt>BLOCKED</dt>
            <dd>{counts.blocked}</dd>
          </div>
          {/* A count, not a limit. Nothing stores a per-column limit, so a
              denominator here would be invented (LAI-067, LAI-069). */}
          <div className="strip-stat">
            <dt>WIP</dt>
            <dd>{counts.wip}</dd>
          </div>
          <div className="strip-stat">
            <dt>DAYS LEFT</dt>
            <dd>{remaining === undefined ? '—' : Math.max(0, remaining)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
