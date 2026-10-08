import { everyPage } from '../../../api/every-page.ts';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { blockedState, byIdIndex, statusLabel } from '../../../api/board-derive.ts';
import { formatRange, progressFor } from '../sprints/sprint-derive.ts';
import type { Sprint } from '../../../api/sprints.ts';
import { useTimeline, type TasksLoad as TasksLoadView } from './use-timeline.ts';
import { listMembers, type Member, type Task } from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import {
  chartWindow,
  DAY_WIDTH,
  dayIndex,
  monthBands,
  quarterBands,
  readZoom,
  sprintPhase,
  sprintSpan,
  sprintSummary,
  weekTicks,
  ZOOM_LABELS,
  ZOOMS,
  type SprintCountdown,
  type Zoom,
} from './timeline-derive.ts';
import './timeline.css';
import { pickProject } from '../../../api/pick-project.ts';
import { withProjectParam } from '../../nav-url.ts';

/** What a sprint's dates say about it, in the lozenge's words. */
const PHASE_LABEL = { past: 'Ended', current: 'Active', future: 'Planned' } as const;

function countdownText(countdown: SprintCountdown): string {
  switch (countdown.kind) {
    case 'left':
      return `${String(countdown.days)} ${countdown.days === 1 ? 'day' : 'days'} left`;
    case 'starts_in':
      return `starts in ${String(countdown.days)}d`;
    case 'ended':
      return `ended ${String(countdown.days)}d ago`;
  }
}

/**
 * Timeline (SPEC §11.4.3, LAI-721 — Jira's timeline, by sprint).
 *
 * **One row per sprint**, a bar across its dates, on an axis that scrolls
 * sideways at a chosen zoom with today marked. A sprint opens to list its
 * tasks, and **tasks get no bars** — the owner, 2026-10-08: *"by the sprints,
 * like Jira … I don't want the tasks in time."* That is §11.4.3 as written;
 * D-074 withdraws D-049's row per task, which had put three hundred rows on
 * one squeezed axis.
 *
 * ## Layout
 *
 * One scroll container, both ways. Each row is a sticky left cell (the sprint
 * or task) and a track exactly `days × DAY_WIDTH[zoom]` wide; the header is
 * sticky at the top and its corner sticky at both. Nothing is measured from
 * the card's width, so a zoom is a scale, not a squeeze.
 *
 * ## Data, on demand
 *
 * Only the sprints load up front (`use-timeline.ts`); a sprint's tasks are
 * fetched with `?sprint=` when it is opened, and the tray's with
 * `?sprint=none`. So a sprint's progress shows once it has been opened —
 * `progressFor`, the Sprints screen's own "done over total", with `cancelled`
 * out of the denominator. Read-only, as before.
 */
export function TimelineScreen() {
  const { params, setParams } = useRoute();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);

  // Fixed at mount: every position is derived from it, and a clock that moved
  // mid-render would shift the today line away from the bars.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();

    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // One rule on every screen (LAI-423): the most recently active
        // project, written into the URL so the address bar names it.
        const wanted = pickProject(items, slug);
        setSlug(wanted?.slug);
        if (wanted !== undefined && slug === undefined) {
          setParams(new URLSearchParams(withProjectParam(params.toString(), wanted.slug)));
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectError(cause);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());

  // Names and avatar colours for the task rows. A failure costs the initials,
  // not the timeline.
  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    listMembers(slug, controller.signal)
      .then((page) => {
        setMembers(new Map(page.members.map((m) => [m.user_id, m])));
      })
      .catch(() => {
        setMembers(new Map());
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  const { theme } = useTheme();
  const timeline = useTimeline(slug);

  /*
   * **Every hook is up here, above the early returns** — a hook after them is
   * called a different number of times on different renders, which React
   * answers with a blank screen (the LAI-436 lesson).
   */

  /** `?zoom=`, so a zoom survives a reload and travels in a link. */
  const zoom = readZoom(params.get('zoom'));
  const setZoom = (next: Zoom): void => {
    const changed = new URLSearchParams(params);
    if (next === 'months') changed.delete('zoom');
    else changed.set('zoom', next);
    setParams(changed);
  };

  /**
   * Which sprints are open. **Collapsed by default** — the owner asked for
   * sprints, not tasks — except one named by `?sprint=`, the board's chips'
   * parameter, so a sprint picked there opens here.
   */
  const named = params.get('sprint') ?? undefined;
  const [open, setOpen] = useState<ReadonlySet<string>>(() =>
    named === undefined ? new Set() : new Set([named]),
  );
  const toggle = (id: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows: readonly Sprint[] =
    timeline.sprints.status === 'ready'
      ? [...timeline.sprints.sprints].sort(
          (a, b) => a.starts_on - b.starts_on || a.id.localeCompare(b.id),
        )
      : [];
  const range = chartWindow(rows, now);

  /** The tray's own disclosure — it fetches nothing until it is opened. */
  const [trayOpen, setTrayOpen] = useState(false);

  // An open sprint loads its tasks; `load` is a no-op once asked.
  const { load } = timeline;
  useEffect(() => {
    for (const id of open) load(id);
    if (trayOpen) load('none');
  }, [open, trayOpen, load, rows.length]);
  const dayWidth = DAY_WIDTH[zoom];

  const scroller = useRef<HTMLDivElement>(null);
  /** The day at the middle of the view, kept so a zoom stays where you were. */
  const centreDay = useRef<number | undefined>(undefined);

  /** The scrollport's width beside the sticky sprint column. */
  const viewWidth = (el: HTMLElement): number =>
    el.clientWidth - (el.querySelector<HTMLElement>('.tlx-corner')?.offsetWidth ?? 0);

  const scrollToDay = (day: number, at: number): void => {
    const el = scroller.current;
    if (el === null) return;
    el.scrollLeft = Math.max(0, day * dayWidth - viewWidth(el) * at);
  };

  const todayIndex = range === null ? undefined : dayIndex(range, now);

  /*
   * **Open on today, then keep the middle under a zoom.** Jira opens with
   * today a third of the way in; changing the zoom rescales around what you
   * were looking at rather than throwing you back to the start.
   */
  useLayoutEffect(() => {
    if (range === null || todayIndex === undefined) return;
    if (centreDay.current === undefined) scrollToDay(todayIndex, 1 / 3);
    else scrollToDay(centreDay.current, 1 / 2);
  }, [zoom, range?.from, range?.to]);

  if (projectError !== null) {
    return (
      <div className="timeline">
        <ApiErrorState error={projectError} resource="your projects" scope="organisation" />
      </div>
    );
  }

  if (timeline.sprints.status === 'loading') {
    return (
      <div className="timeline">
        <LoadingState shape="row" count={3} label="Loading timeline" />
      </div>
    );
  }

  if (timeline.sprints.status === 'error') {
    return (
      <div className="timeline">
        <ApiErrorState
          error={timeline.sprints.error}
          resource="this project's timeline"
          scope="project"
          onRetry={timeline.reload}
        />
      </div>
    );
  }

  const tray = (
    <UnscheduledTray
      open={trayOpen}
      onToggle={() => {
        setTrayOpen((o) => !o);
      }}
      load={timeline.tasks('none')}
    />
  );

  if (range === null || todayIndex === undefined) {
    return (
      <div className="timeline">
        <EmptyState
          headline="Nothing scheduled yet"
          body="The timeline is drawn from sprints. Plan one and it will appear here."
        />
        {tray}
      </div>
    );
  }

  const width = range.days * dayWidth;
  const ticks = weekTicks(range);
  const firstMonday = ticks[0]?.index ?? 0;
  const top = zoom === 'quarters' ? quarterBands(range) : monthBands(range);
  const lower = zoom === 'quarters' ? monthBands(range, true) : undefined;
  const todayX = (todayIndex + 0.5) * dayWidth;
  const allOpen = rows.length > 0 && rows.every((r) => open.has(r.id));

  /** `TUE 18 AUG`, for the pill on the today line. */
  const todayLabel = new Date(now)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase()
    .replace(/,/g, '');

  const openTask = (taskId: string): void => {
    // The space's own drawer reads `?task=` on every tab (`SpaceLayout`); a
    // history entry, so Back closes it (LAI-252).
    const next = new URLSearchParams(params);
    next.set('task', taskId);
    setParams(next, { push: true });
  };

  const chartStyle = {
    '--tlx-day': `${String(dayWidth)}px`,
    '--tlx-width': `${String(width)}px`,
    '--tlx-week-offset': `${String(firstMonday * dayWidth)}px`,
  } as CSSProperties;

  const first = rows[0];
  const last = rows[rows.length - 1];

  return (
    <div className="timeline">
      <SpaceSlot
        context={
          first === undefined || last === undefined
            ? undefined
            : `${formatRange(first.starts_on, last.ends_on)} · ${String(rows.length)} ${
                rows.length === 1 ? 'sprint' : 'sprints'
              }`
        }
      />

      <div className="tlx-toolbar">
        <button
          type="button"
          className="tlx-tool"
          onClick={() => {
            scrollToDay(todayIndex, 1 / 3);
          }}
        >
          Today
        </button>
        <div className="tlx-zoom" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className={z === zoom ? 'tlx-zoom-option tlx-zoom-on' : 'tlx-zoom-option'}
              aria-pressed={z === zoom}
              onClick={() => {
                setZoom(z);
              }}
            >
              {ZOOM_LABELS[z]}
            </button>
          ))}
        </div>
        <span className="tlx-toolbar-spacer" />
        <button
          type="button"
          className="tlx-tool"
          onClick={() => {
            setOpen(allOpen ? new Set() : new Set(rows.map((r) => r.id)));
          }}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div
        ref={scroller}
        className="tlx"
        style={chartStyle}
        onScroll={(event) => {
          const el = event.currentTarget;
          centreDay.current = (el.scrollLeft + viewWidth(el) / 2) / dayWidth;
        }}
      >
        <div className="tlx-inner">
          {/* The header: sticky to the top, its corner sticky both ways. */}
          <div className="tlx-row tlx-head">
            <div className="tlx-side tlx-corner">Sprint</div>
            <div className="tlx-track tlx-scale" aria-hidden="true">
              <div className="tlx-scale-row">
                {top.map((band) => (
                  <span
                    key={band.key}
                    className="tlx-scale-band"
                    style={{ left: band.start * dayWidth, width: band.days * dayWidth }}
                  >
                    <span className="tlx-scale-label">{band.label}</span>
                  </span>
                ))}
              </div>
              <div className="tlx-scale-row tlx-scale-lower">
                {lower === undefined
                  ? ticks.map((tick) => (
                      <span
                        key={tick.index}
                        className="tlx-scale-tick"
                        style={{ left: tick.index * dayWidth }}
                      >
                        {zoom === 'weeks' || dayWidth * 7 >= 28 ? tick.label : ''}
                      </span>
                    ))
                  : lower.map((band) => (
                      <span
                        key={band.key}
                        className="tlx-scale-tick"
                        style={{ left: band.start * dayWidth }}
                      >
                        {band.label}
                      </span>
                    ))}
              </div>
              <span className="tlx-today-pill" style={{ left: todayX }}>
                TODAY · {todayLabel}
              </span>
            </div>
          </div>

          {/* One line for today, under the header and the sprint column. */}
          <div
            className="tlx-today"
            style={{ left: `calc(var(--tlx-side) + ${String(todayX)}px)` }}
          />

          {rows.map((sprint, index) => {
            const phase = sprintPhase(sprint, now);
            const span = sprintSpan(range, sprint);
            const loaded = timeline.tasks(sprint.id);
            const tasks = loaded?.status === 'ready' ? loaded.tasks : undefined;
            /*
             * Blocked by `board-derive`'s rule, against this sprint's tasks: a
             * blocker in another sprint is not loaded, so it cannot be judged
             * and is not counted — the rule's own "unknown", not a guess.
             */
            const byTaskId = byIdIndex(tasks ?? []);
            const blocked = (tasks ?? []).filter((t) => blockedState(t, byTaskId) === true).length;
            const summary = sprintSummary(tasks ?? [], blocked, sprint, now);
            const done = tasks === undefined ? undefined : progressFor(tasks);
            const isOpen = open.has(sprint.id);
            const key = `S${String(index + 1)}`;
            const tasksId = `tlx-tasks-${sprint.id}`;
            const progress =
              done === undefined
                ? undefined
                : done.total === 0
                  ? 'no tasks'
                  : `${String(done.done)}/${String(done.total)}`;

            return (
              <div key={sprint.id} className={`tlx-group tlx-${phase}`} data-sprint-id={sprint.id}>
                <div className="tlx-row tlx-sprint">
                  <div className="tlx-side">
                    <button
                      type="button"
                      className="tlx-chevron"
                      aria-expanded={isOpen}
                      aria-controls={tasksId}
                      onClick={() => {
                        toggle(sprint.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" aria-hidden="true">
                        <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="visually-hidden">
                        {isOpen ? 'Hide' : 'Show'} the tasks in {sprint.name}
                      </span>
                    </button>
                    <span className="tlx-sprint-key">{key}</span>
                    <span className="tlx-sprint-text">
                      <span className="tlx-sprint-name" title={sprint.goal ?? sprint.name}>
                        {sprint.name}
                      </span>
                      <span className="tlx-sprint-meta">
                        {formatRange(sprint.starts_on, sprint.ends_on)} ·{' '}
                        {countdownText(summary.countdown)}
                      </span>
                    </span>
                    <span className={`tlx-lozenge tlx-lozenge-${phase}`}>{PHASE_LABEL[phase]}</span>
                  </div>

                  <div className="tlx-track">
                    <button
                      type="button"
                      className={`tlx-bar tlx-bar-${phase}`}
                      style={{ left: span.start * dayWidth, width: span.days * dayWidth }}
                      title={`${key} ${sprint.name} · ${formatRange(sprint.starts_on, sprint.ends_on)}${
                        progress === undefined ? '' : ` · ${progress} done`
                      }`}
                      aria-expanded={isOpen}
                      aria-controls={tasksId}
                      onClick={() => {
                        toggle(sprint.id);
                      }}
                    >
                      {done !== undefined && (
                        <span
                          className="tlx-bar-fill"
                          style={{ width: `${String(done.percent)}%` }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="tlx-bar-name">
                        <b>{key}</b> {sprint.name}
                      </span>
                      {progress !== undefined && <span className="tlx-bar-count">{progress}</span>}
                      {blocked > 0 && <span className="tlx-bar-blocked">{blocked} blocked</span>}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div id={tasksId} role="group" aria-label={`Tasks in ${sprint.name}`}>
                    {tasks === undefined && (
                      <div className="tlx-row tlx-task">
                        <div className="tlx-side tlx-task-side tlx-task-none" role="status">
                          {loaded?.status === 'error'
                            ? 'Could not load this sprint’s tasks. Close and open it to retry.'
                            : 'Loading tasks…'}
                        </div>
                        <div className="tlx-track" />
                      </div>
                    )}
                    {tasks?.length === 0 && (
                      <div className="tlx-row tlx-task">
                        <div className="tlx-side tlx-task-side tlx-task-none">
                          No tasks in this sprint.
                        </div>
                        <div className="tlx-track" />
                      </div>
                    )}
                    {tasks?.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        who={task.assignee_id === null ? undefined : members.get(task.assignee_id)}
                        ink={avatarColor(task.assignee_id ?? task.id, theme)}
                        blocked={blockedState(task, byTaskId) === true}
                        span={{ left: span.start * dayWidth, width: span.days * dayWidth }}
                        onOpen={openTask}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="tlx-legend">
        <span className="tlx-legend-item">
          <span className="tlx-swatch tlx-bar-current" aria-hidden="true" />
          active
        </span>
        <span className="tlx-legend-item">
          <span className="tlx-swatch tlx-bar-future" aria-hidden="true" />
          planned
        </span>
        <span className="tlx-legend-item">
          <span className="tlx-swatch tlx-bar-past" aria-hidden="true" />
          ended
        </span>
        <span className="tlx-legend-note">
          A bar is a sprint; its fill is the share done. Open a sprint to see its tasks.
        </span>
      </div>

      {tray}
    </div>
  );
}

/**
 * A task inside an open sprint: **a row, not a bar** (§11.4.3, D-074). The
 * track behind it shows its sprint's span faintly, so the eye can still tell
 * which bar it belongs to.
 */
function TaskRow({
  task,
  who,
  ink,
  blocked,
  span,
  onOpen,
}: {
  readonly task: Task;
  readonly who: Member | undefined;
  readonly ink: { readonly background: string; readonly foreground: string };
  readonly blocked: boolean;
  readonly span: { readonly left: number; readonly width: number };
  readonly onOpen: (taskId: string) => void;
}) {
  return (
    <div className="tlx-row tlx-task" data-task-id={task.id}>
      <div className="tlx-side tlx-task-side">
        <button
          type="button"
          className="tlx-task-open"
          onClick={() => {
            onOpen(task.id);
          }}
        >
          <span className="tlx-task-key">{task.key}</span>
          <span className="tlx-task-title" title={task.title}>
            {task.title}
          </span>
        </button>
        {blocked && <span className="tlx-task-blocked">Blocked</span>}
        {/* `In progress`, not `in_progress`: the lane's word, not the enum's. */}
        <span className={`timeline-task-status timeline-task-${task.status}`}>
          {statusLabel(task.status)}
        </span>
        <span
          className="tlx-avatar"
          style={{ background: ink.background, color: ink.foreground }}
          title={who?.name ?? 'Unassigned'}
        >
          {who === undefined ? '–' : initials(who.name)}
        </span>
      </div>
      <div className="tlx-track">
        <span className="tlx-span" style={span} aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * §11.4.3's unscheduled tray: tasks in no sprint. **A disclosure that fetches
 * on opening** (`?sprint=none`) — its list is as long as the backlog, and the
 * chart above it needs none of it. Read-only: moving a task into a sprint is
 * the Sprints screen's "Add tasks".
 */
function UnscheduledTray({
  open,
  onToggle,
  load,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly load: TasksLoadView | undefined;
}) {
  const tasks = load?.status === 'ready' ? load.tasks : undefined;
  return (
    <section className="timeline-tray" aria-label="Unscheduled tasks">
      <h2 className="timeline-tray-title">
        <button
          type="button"
          className="timeline-tray-toggle"
          aria-expanded={open}
          aria-controls="timeline-tray-list"
          onClick={onToggle}
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" aria-hidden="true">
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Unscheduled
          {tasks !== undefined && <span className="timeline-tray-count">{tasks.length}</span>}
        </button>
      </h2>
      {open && (
        <div id="timeline-tray-list">
          {tasks === undefined ? (
            <p className="timeline-task-empty" role="status">
              {load?.status === 'error'
                ? 'Could not load the unscheduled tasks. Close and open this to retry.'
                : 'Loading tasks…'}
            </p>
          ) : tasks.length === 0 ? (
            <p className="timeline-task-empty">Every task is in a sprint.</p>
          ) : (
            <ul className="timeline-tasks">
              {tasks.map((task) => (
                <li key={task.id} className="timeline-task">
                  <span className="timeline-task-key">{task.key}</span>
                  <span className="timeline-task-title">{task.title}</span>
                  <span className={`timeline-task-status timeline-task-${task.status}`}>
                    {statusLabel(task.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
