import { useEffect, useRef, useState } from 'react';
import { useDelayed } from '../../../components/use-delayed.ts';
import { daysLeft } from '../sprints/sprint-derive.ts';
import type { Sprint } from '../../../api/sprints.ts';
import type { Task } from '../../../api/tasks.ts';
import './sprint-strip.css';

export interface SprintStripProps {
  readonly sprints: readonly Sprint[];
  /** Every loaded task, so counts can be taken per sprint. */
  readonly tasks: readonly Task[];
  /** The sprint the board is scoped to, or `undefined` for all sprints. */
  readonly selected: string | undefined;
  /**
   * Whether the sprint list is still in flight.
   *
   * **Load-bearing, not cosmetic.** Without it the strip cannot tell *"no
   * sprints yet"* from *"this project has none"*, so it drew nothing and then
   * appeared at full height, moving the whole board down 57px (LAI-297). The
   * board's own skeleton had already been matched to the pixel; this was the
   * entire remaining jump.
   */
  readonly loading?: boolean | undefined;
  readonly onSelect: (sprintId: string | undefined) => void;
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
export function SprintStrip({ sprints, tasks, selected, onSelect, loading }: SprintStripProps) {
  const now = Date.now();
  const current = sprints.find((s) => s.id === selected);
  const counts = countFor(tasks, selected);
  // Inclusive, and normalised to UTC midnight — see `daysLeft`. My first pass
  // used `ceil((ends_on - now) / DAY)`, which reported **0** on a sprint's last
  // day, when the honest answer is 1.
  const remaining = current === undefined ? undefined : daysLeft(current.ends_on, now);

  /**
   * Whether the pill row has more than fits, which is the only reason the
   * pager exists. Measured rather than guessed from a sprint count: how many
   * fit depends on their names and the viewport, not on how many there are.
   */
  const chips = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = chips.current;
    if (el === null) return;

    const measure = (): void => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [sprints.length]);

  /*
   * A placeholder only when the wait is long enough to notice (LAI-297).
   * `useDelayed` holds it once shown, so a response landing at 160ms does not
   * flash two chips and remove them.
   */
  const slow = useDelayed(loading === true && sprints.length === 0);

  /*
   * **The early return moved below the hooks, and it had to.**
   *
   * It was the first line of the component: `if (sprints.length === 0) return
   * null`. That is a conditional hook call — the first render of a board has
   * no sprints yet and ran **zero** hooks, and the render after they arrived
   * ran three, which is the "rendered more hooks than during the previous
   * render" error. It survived because the strip was usually mounted with its
   * sprints already in hand; giving it a loading state makes the empty render
   * the normal one.
   *
   * Loading is not empty: a project genuinely without sprints draws nothing,
   * which is what the strip is for.
   */
  if (sprints.length === 0 && loading !== true) return null;

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

        <div className="strip-chips" ref={chips}>
          {/*
            Placeholder chips while the list is slow (LAI-297). `aria-hidden`
            and not focusable: they carry no information, and a screen reader
            announcing two empty buttons is worse than silence. The row's
            height comes from the real `All sprints` button beside them, so
            these change nothing about the layout — they exist only so a long
            wait does not look like an empty strip.
          */}
          {slow &&
            [0, 1].map((i) => <span key={i} className="strip-chip-ghost" aria-hidden="true" />)}
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

        {/*
          The reference's right-hand arrow is a **pager**, not a link: it
          scrolls the pill row when there are more sprints than fit. Rendered
          only when there is something to scroll — a control that cannot do
          anything is what §5.1 forbids.
        */}
        {/* The reference draws it whether or not it can scroll, so it does not
            appear and vanish as sprints are added. Disabled when there is
            nothing past the edge — visible, and honest about being inert. */}
        {true && (
          <button
            type="button"
            disabled={!overflowing}
            className="strip-pager"
            onClick={() => {
              chips.current?.scrollBy({ left: 320, behavior: 'smooth' });
            }}
          >
            <span className="visually-hidden">Show more sprints</span>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}

        {/*
          The stats, inline — the design keeps them on the same row as the
          pills. `WIP` is not among them: it is a property of a column, and the
          design puts it on the In Progress header.
        */}
        <dl className="strip-stats">
          <div className="strip-stat">
            <dt>DONE</dt>
            <dd>
              {counts.done}
              <span>/{counts.total}</span>
            </dd>
          </div>
          <div className="strip-stat strip-stat-blocked">
            <dt>
              BLK<span className="visually-hidden"> blocked</span>
            </dt>
            <dd>{counts.blocked}</dd>
          </div>
          <div className="strip-stat">
            <dt>
              LEFT<span className="visually-hidden"> days remaining</span>
            </dt>
            <dd>{remaining === undefined ? '—' : Math.max(0, remaining)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
