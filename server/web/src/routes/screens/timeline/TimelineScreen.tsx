import { everyPage } from '../../../api/every-page.ts';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { blockedState, byIdIndex, statusLabel } from '../../../api/board-derive.ts';
import { formatRange, progressFor } from '../sprints/sprint-derive.ts';
import type { Sprint } from '../../../api/sprints.ts';
import { listMembers, type Member, type Task } from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { useTimeline, type TasksLoad } from './use-timeline.ts';
import {
  blockedTally,
  chartWindow,
  countdownFor,
  countsProgress,
  DAY_WIDTH,
  dayIndex,
  monthBands,
  onAxis,
  quarterBands,
  readZoom,
  sprintPhase,
  sprintSpan,
  todayLabel,
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

/** Roughly how wide a label is, for keeping labels clear of each other. */
const charWidth = (text: string, px: number): number => text.length * px;

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

/** `1 blocked · 2 unknown`, or nothing when both are zero. */
function blockedText(tally: { readonly blocked: number; readonly unknown: number }): string {
  const parts: string[] = [];
  if (tally.blocked > 0) parts.push(`${String(tally.blocked)} blocked`);
  if (tally.unknown > 0) parts.push(`${String(tally.unknown)} unknown`);
  return parts.join(' · ');
}

/**
 * Timeline (SPEC §11.4.3, LAI-721 — Jira's timeline, by sprint; D-074).
 *
 * **One row per sprint**, a bar across its dates, on an axis that scrolls
 * sideways at a chosen zoom with today marked. A sprint opens to list its
 * tasks, and **tasks get no bars** — the owner, 2026-10-08: *"by the sprints,
 * like Jira … I don't want the tasks in time."*
 *
 * ## Layout
 *
 * One scroll container, both ways, and the page's only vertical scroller while
 * it is on screen. Each row is a sticky left cell (the sprint or task) and a
 * track exactly `days × DAY_WIDTH[zoom]` wide; the header is sticky at the top
 * and its corner sticky at both. Nothing is measured from the card's width, so
 * a zoom is a scale, not a squeeze. The scroller takes focus, and the arrow
 * keys pan it.
 *
 * ## Data, on demand
 *
 * `use-timeline.ts`: the sprints come with `task_counts`, so every bar shows
 * done over total unopened; a sprint's tasks load when it is opened, and the
 * tray's when it is. Live: the space's stream refetches what is open.
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

  /** Which sprints are open. Collapsed by default — the owner asked for sprints. */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [trayOpen, setTrayOpen] = useState(false);
  const toggle = (id: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openKeys = useMemo(
    () => new Set([...open, ...(trayOpen ? ['none'] : [])]),
    [open, trayOpen],
  );
  const timeline = useTimeline(slug, openKeys);

  const all: readonly Sprint[] = useMemo(
    () =>
      timeline.sprints.status === 'ready'
        ? [...timeline.sprints.sprints].sort(
            (a, b) => a.starts_on - b.starts_on || a.id.localeCompare(b.id),
          )
        : [],
    [timeline.sprints],
  );
  /** Drawn, and not: a date the axis cannot hold is listed, never plotted. */
  const rows = useMemo(() => all.filter((s) => onAxis(s, now)), [all, now]);
  const offAxis = useMemo(() => all.filter((s) => !onAxis(s, now)), [all, now]);

  const rowsKey = rows.map((s) => `${s.id}:${String(s.starts_on)}:${String(s.ends_on)}`).join('|');
  const range = useMemo(() => chartWindow(rows, now, zoom), [rowsKey, now, zoom]);
  const dayWidth = DAY_WIDTH[zoom];

  /** The header, built once per window and zoom — never per render. */
  const header = useMemo(() => {
    if (range === null) return undefined;
    return {
      ticks: weekTicks(range),
      top: zoom === 'quarters' ? quarterBands(range) : monthBands(range),
      lower: zoom === 'quarters' ? monthBands(range, true) : undefined,
    };
  }, [range?.from, range?.to, zoom]);

  /*
   * **`?sprint=` opens that sprint — if it is one** (LAI-721 review). The
   * Board writes `all` and `none` into the same parameter; neither is a sprint
   * here, and an id that is not on this axis is ignored rather than sent.
   * Once, when the sprints first arrive.
   */
  const named = params.get('sprint') ?? undefined;
  const [deepLink, setDeepLink] = useState<string | undefined>(undefined);
  const deepLinkSettled = useRef(false);
  useEffect(() => {
    if (deepLinkSettled.current || timeline.sprints.status !== 'ready') return;
    deepLinkSettled.current = true;
    if (named !== undefined && rows.some((s) => s.id === named)) {
      setDeepLink(named);
      setOpen(new Set([named]));
    }
  }, [timeline.sprints.status, rowsKey]);

  const scroller = useRef<HTMLDivElement>(null);
  /** The day at the middle of the view, kept so a zoom stays where you were. */
  const centreDay = useRef<number | undefined>(undefined);
  /** The scroll position, for placing the month labels; updated once a frame. */
  const [scrollX, setScrollX] = useState(0);
  const frame = useRef<number | undefined>(undefined);

  /** The scrollport's width beside the sticky sprint column. */
  const viewWidth = (el: HTMLElement): number =>
    el.clientWidth - (el.querySelector<HTMLElement>('.tlx-corner')?.offsetWidth ?? 0);

  const scrollToDay = (day: number, at: number): void => {
    const el = scroller.current;
    if (el === null) return;
    el.scrollLeft = Math.max(0, day * dayWidth - viewWidth(el) * at);
    setScrollX(el.scrollLeft);
  };

  const todayIndex = range === null ? undefined : dayIndex(range, now);

  /*
   * **Open on today — or on the linked sprint — then keep the middle under a
   * zoom.** Jira opens with today a third of the way in; a link to a sprint
   * opens on that sprint's start instead. A zoom rescales around what you were
   * looking at rather than throwing you back.
   */
  useLayoutEffect(() => {
    if (range === null || todayIndex === undefined) return;
    if (centreDay.current !== undefined) {
      scrollToDay(centreDay.current, 1 / 2);
      return;
    }
    const linked = deepLink === undefined ? undefined : rows.find((s) => s.id === deepLink);
    if (linked !== undefined) scrollToDay(sprintSpan(range, linked).start, 1 / 8);
    else scrollToDay(todayIndex, 1 / 3);
  }, [zoom, range?.from, range?.to, deepLink]);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

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

  const notices = (
    <>
      {timeline.sprints.truncated && (
        <p className="tlx-notice" role="status">
          This project has more sprints than the timeline loads at once; only the first {all.length}{' '}
          are here.
        </p>
      )}
      {offAxis.length > 0 && (
        <p className="tlx-notice" role="status">
          {offAxis.length === 1 ? 'One sprint has' : `${String(offAxis.length)} sprints have`} dates
          out of range and {offAxis.length === 1 ? 'is' : 'are'} not drawn:{' '}
          {offAxis.map((s) => s.name).join(', ')}. Fix the dates on the Sprints screen.
        </p>
      )}
    </>
  );

  if (range === null || todayIndex === undefined || header === undefined) {
    return (
      <div className="timeline">
        {notices}
        <EmptyState
          headline="Nothing scheduled yet"
          body="The timeline is drawn from sprints. Plan one and it will appear here."
        />
        {tray}
      </div>
    );
  }

  const width = range.days * dayWidth;
  const { ticks, top, lower } = header;
  const firstMonday = ticks[0]?.index ?? 0;
  const todayX = (todayIndex + 0.5) * dayWidth;
  const allOpen = rows.length > 0 && rows.every((r) => open.has(r.id));
  const pillText = `TODAY · ${todayLabel(now)}`;
  /** Tick labels give way to the pill rather than sit under it. */
  const pillClear = charWidth(pillText, 7) / 2 + 14;
  const clearOfPill = (x: number, label: string): boolean =>
    x + charWidth(label, 7) + 6 < todayX - pillClear || x > todayX + pillClear;

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

  /*
   * **The arrow keys pan.** The scroller is one tab stop; with focus on it
   * (not on a chevron inside it) left and right move a week, Home and End go
   * to the ends.
   */
  const onChartKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const el = event.currentTarget;
    const step = Math.max(80, dayWidth * 7);
    const moves: Record<string, number> = {
      ArrowRight: step,
      ArrowLeft: -step,
      End: el.scrollWidth,
      Home: -el.scrollWidth,
    };
    const by = moves[event.key];
    if (by === undefined) return;
    event.preventDefault();
    el.scrollLeft += by;
  };

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

      {notices}

      <div
        ref={scroller}
        className="tlx"
        style={chartStyle}
        tabIndex={0}
        role="region"
        aria-label="Sprint timeline — the arrow keys scroll it"
        onKeyDown={onChartKey}
        onScroll={(event) => {
          const el = event.currentTarget;
          centreDay.current = (el.scrollLeft + viewWidth(el) / 2) / dayWidth;
          if (frame.current !== undefined) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = undefined;
            setScrollX(el.scrollLeft);
          });
        }}
      >
        <div className="tlx-inner">
          {/* The header: sticky to the top, its corner sticky both ways. */}
          <div className="tlx-row tlx-head">
            <div className="tlx-side tlx-corner">Sprint</div>
            <div className="tlx-track tlx-scale" aria-hidden="true">
              <div className="tlx-scale-row">
                {top.map((band) => {
                  /*
                   * **The month you are in stays named, and never half-named.**
                   * The label rides at the left of the view while its band is
                   * under it, and stops at the band's end; once less than the
                   * label's width of the band is left, it is not drawn at all,
                   * rather than a clipped tail ("326") beside the next month.
                   */
                  const from = band.start * dayWidth;
                  const to = (band.start + band.days) * dayWidth;
                  const labelWidth = charWidth(band.label, 10) + 20;
                  const x = Math.min(Math.max(from, scrollX), to - labelWidth);
                  // Whole, inside its band, and inside the view — not under the sprint column.
                  const fits = x >= from && x >= scrollX && x + labelWidth <= to;
                  return (
                    <span
                      key={band.key}
                      className="tlx-scale-band"
                      style={{ left: from, width: to - from }}
                    >
                      {fits && (
                        <span className="tlx-scale-label" style={{ left: x - from }}>
                          {band.label}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="tlx-scale-row tlx-scale-lower">
                {lower === undefined
                  ? ticks.map((tick) => {
                      const x = tick.index * dayWidth;
                      const show =
                        (zoom === 'weeks' || dayWidth * 7 >= 28) && clearOfPill(x, tick.label);
                      return (
                        <span key={tick.index} className="tlx-scale-tick" style={{ left: x }}>
                          {show ? tick.label : ''}
                        </span>
                      );
                    })
                  : lower.map((band) => {
                      const x = band.start * dayWidth;
                      return (
                        <span key={band.key} className="tlx-scale-tick" style={{ left: x }}>
                          {clearOfPill(x, band.label) ? band.label : ''}
                        </span>
                      );
                    })}
              </div>
              <span className="tlx-today-pill" style={{ left: todayX }}>
                {pillText}
              </span>
            </div>
          </div>

          {/* One line for today, under the header and the sprint column. */}
          <div
            className="tlx-today"
            style={{ left: `calc(var(--tlx-side) + ${String(todayX)}px)` }}
          />

          {rows.map((sprint, index) => (
            <SprintGroup
              key={sprint.id}
              sprint={sprint}
              index={index}
              now={now}
              span={sprintSpan(range, sprint)}
              dayWidth={dayWidth}
              isOpen={open.has(sprint.id)}
              load={timeline.tasks(sprint.id)}
              members={members}
              theme={theme}
              onToggle={() => {
                toggle(sprint.id);
              }}
              onOpenTask={openTask}
            />
          ))}
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

/** One sprint: its row and, when open, its tasks. */
function SprintGroup({
  sprint,
  index,
  now,
  span,
  dayWidth,
  isOpen,
  load,
  members,
  theme,
  onToggle,
  onOpenTask,
}: {
  readonly sprint: Sprint;
  readonly index: number;
  readonly now: number;
  readonly span: { readonly start: number; readonly days: number };
  readonly dayWidth: number;
  readonly isOpen: boolean;
  readonly load: TasksLoad | undefined;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: ReturnType<typeof useTheme>['theme'];
  readonly onToggle: () => void;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const phase = sprintPhase(sprint, now);
  const tasks = load?.status === 'ready' ? load.tasks : undefined;
  /*
   * Progress: the loaded tasks when open (they are fresher), else the sprint
   * list's `task_counts` — legible without expanding (§11.4.3).
   */
  const done =
    tasks !== undefined
      ? progressFor(tasks)
      : sprint.task_counts === undefined
        ? undefined
        : countsProgress(sprint.task_counts);
  const tally = tasks === undefined ? undefined : blockedTally(tasks);
  const byTaskId = byIdIndex(tasks ?? []);
  const key = `S${String(index + 1)}`;
  const tasksId = `tlx-tasks-${sprint.id}`;
  const progress =
    done === undefined
      ? undefined
      : done.total === 0
        ? 'no tasks'
        : `${String(done.done)}/${String(done.total)}`;
  const blockedLabel = tally === undefined ? '' : blockedText(tally);
  /*
   * **The key first.** At Quarters a two-week bar is ~50px. What does not fit
   * inside it without squeezing the sprint's own name off — the count, the
   * blocked note — goes just past the bar's end, on the same row (each sprint
   * has a row to itself, so nothing else is there).
   */
  const barWidth = span.days * dayWidth;
  const roomForCount = barWidth >= 96;
  const roomForBlocked = barWidth >= 220;
  const count = progress === undefined ? null : <span className="tlx-bar-count">{progress}</span>;
  const blockedNote =
    blockedLabel === '' ? null : <span className="tlx-bar-blocked">{blockedLabel}</span>;
  const aside = [!roomForCount && count, !roomForBlocked && blockedNote].filter(Boolean);

  return (
    <div className={`tlx-group tlx-${phase}`} data-sprint-id={sprint.id}>
      <div className="tlx-row tlx-sprint">
        <div className="tlx-side">
          <button
            type="button"
            className="tlx-chevron"
            aria-expanded={isOpen}
            aria-controls={tasksId}
            onClick={onToggle}
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
              {countdownText(countdownFor(sprint, now))}
            </span>
          </span>
          <span className={`tlx-lozenge tlx-lozenge-${phase}`}>{PHASE_LABEL[phase]}</span>
        </div>

        <div className="tlx-track">
          {/* A pointer shortcut for the chevron — not a second tab stop. */}
          <div
            className={`tlx-bar tlx-bar-${phase}`}
            style={{ left: span.start * dayWidth, width: span.days * dayWidth }}
            title={`${key} ${sprint.name} · ${formatRange(sprint.starts_on, sprint.ends_on)}${
              progress === undefined ? '' : ` · ${progress} done`
            }${blockedLabel === '' ? '' : ` · ${blockedLabel}`}${
              sprint.goal === null ? '' : `\n${sprint.goal}`
            }`}
            onClick={onToggle}
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
            {roomForCount && count}
            {roomForBlocked && blockedNote}
          </div>
          {aside.length > 0 && (
            <span
              className="tlx-bar-aside"
              style={{ left: (span.start + span.days) * dayWidth + 6 }}
            >
              {aside}
            </span>
          )}
        </div>
      </div>

      {isOpen && (
        <div id={tasksId} role="group" aria-label={`Tasks in ${sprint.name}`}>
          {tasks === undefined && (
            <div className="tlx-row tlx-task">
              <div className="tlx-side tlx-task-side tlx-task-none" role="status">
                {load?.status === 'error'
                  ? 'Could not load this sprint’s tasks. Close it and open it again to retry.'
                  : 'Loading tasks…'}
              </div>
              <div className="tlx-track" />
            </div>
          )}
          {tasks?.length === 0 && (
            <div className="tlx-row tlx-task">
              <div className="tlx-side tlx-task-side tlx-task-none">No tasks in this sprint.</div>
              <div className="tlx-track" />
            </div>
          )}
          {tasks?.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              who={task.assignee_id === null ? undefined : members.get(task.assignee_id)}
              ink={task.assignee_id === null ? undefined : avatarColor(task.assignee_id, theme)}
              blocked={blockedState(task, byTaskId)}
              onOpen={onOpenTask}
            />
          ))}
          {load?.status === 'ready' && load.truncated && (
            <div className="tlx-row tlx-task">
              <div className="tlx-side tlx-task-side tlx-task-none" role="status">
                Only the first {load.tasks.length} tasks of this sprint are listed.
              </div>
              <div className="tlx-track" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A task inside an open sprint: **a row, not a bar** (§11.4.3, D-074). Its
 * track is left empty — anything drawn there read as a placeholder bar.
 */
function TaskRow({
  task,
  who,
  ink,
  blocked,
  onOpen,
}: {
  readonly task: Task;
  readonly who: Member | undefined;
  /** `undefined` for an unassigned task: a neutral mark, not a colour of its id. */
  readonly ink: { readonly background: string; readonly foreground: string } | undefined;
  /** `board-derive`'s answer: `undefined` is "a blocker that is not loaded". */
  readonly blocked: boolean | undefined;
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
        {blocked === true && <span className="tlx-task-blocked">Blocked</span>}
        {blocked === undefined && (
          <span
            className="tlx-task-blocked tlx-task-unknown"
            title="Blocked by a task in another sprint or in no sprint, whose status is not loaded here"
          >
            Blocked?
          </span>
        )}
        {/* `In progress`, not `in_progress`: the lane's word, not the enum's. */}
        <span className={`timeline-task-status timeline-task-${task.status}`}>
          {statusLabel(task.status)}
        </span>
        {ink === undefined ? (
          <span className="tlx-avatar tlx-avatar-none" title="Unassigned">
            –
          </span>
        ) : (
          <span
            className="tlx-avatar"
            style={{ background: ink.background, color: ink.foreground }}
            title={who?.name ?? 'Unknown member'}
          >
            {who === undefined ? '?' : initials(who.name)}
          </span>
        )}
      </div>
      <div className="tlx-track" />
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
  readonly load: TasksLoad | undefined;
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
        <div id="timeline-tray-list" className="timeline-tray-list">
          {tasks === undefined ? (
            <p className="timeline-task-empty" role="status">
              {load?.status === 'error'
                ? 'Could not load the unscheduled tasks. Close this and open it again to retry.'
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
          {load?.status === 'ready' && load.truncated && (
            <p className="timeline-task-empty" role="status">
              Only the first {load.tasks.length} unscheduled tasks are listed.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
