import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { formatRange } from '../sprints/sprint-derive.ts';
import { useSprints } from '../sprints/use-sprints.ts';
import { blockedState, byIdIndex } from '../../../api/board-derive.ts';
import { listMembers, type Member } from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import {
  isCurrent,
  monthBands,
  sprintSummary,
  taskActuals,
  taskBar,
  timelineRange,
  todayPosition,
  toSegments,
} from './timeline-derive.ts';
import './timeline.css';
import { pickProject } from '../../../api/pick-project.ts';
import { withProjectParam } from '../../nav-url.ts';

/**
 * Timeline (SPEC §11.4.3, D-014 — LAI-084).
 *
 * A Gantt-style view drawn **entirely from sprint boundaries**. Because §4.15
 * forbids sprints of a project from overlapping, the axis is one track and this
 * is a rendering pass rather than a layout solver — that is the whole reason
 * D-014 chose sprints as the unit.
 *
 * ## It reuses the sprints screen's data path on purpose
 *
 * `useSprints` already fetches the project's sprints and tasks, walks both
 * cursors, groups tasks by sprint and computes progress. Both folders are mine
 * under D-028, so the alternative was a second copy of the cursor-walking and a
 * second definition of "done over total" — which is the drift LAI-119 is about,
 * one layer up. The mutations it exposes go unused here; this screen is read-only
 * (dragging a sprint edge is explicitly out of scope).
 *
 * ## Tasks are contents, never bars
 *
 * The prototype draws a row per task with its own start and length. `tasks` has
 * no planned-start and no due-date column and D-014 keeps it that way, so those
 * rows are invented dates — the artifact class `docs/design/README.md` says not
 * to reproduce. Tasks here appear inside their sprint's bar when it is expanded,
 * or in the unscheduled tray, and nowhere on the axis.
 */
export function TimelineScreen() {
  const { params, setParams } = useRoute();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);

  // Fixed at mount rather than read per render: every position on the axis is
  // derived from it, and a clock that moved mid-render would shift the marker
  // away from the bars it is meant to line up with.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();

    listProjects({}, controller.signal)
      .then((page) => {
        // One rule on every screen (LAI-423): the most recently active
        // project, never the alphabetically first, and written into the URL so
        // the address bar names what is on screen.
        const wanted = pickProject(page.data, slug);
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

  // Names and avatar colours for the left column. A failure costs the initials,
  // not the timeline, so it degrades to "?" rather than erroring the screen.
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
  const sprints = useSprints(slug);

  if (projectError !== null) {
    return (
      <div className="timeline">
        <ApiErrorState error={projectError} resource="your projects" scope="organisation" />
      </div>
    );
  }

  if (sprints.state.status === 'loading') {
    return (
      <div className="timeline">
        <LoadingState shape="row" count={3} label="Loading timeline" />
      </div>
    );
  }

  if (sprints.state.status === 'error') {
    return (
      <div className="timeline">
        <ApiErrorState
          error={sprints.state.error}
          resource="this project's timeline"
          scope="project"
          onRetry={sprints.reload}
        />
      </div>
    );
  }

  const { rows, unassigned } = sprints.state;
  const allTasks = [...rows.flatMap((r) => r.tasks), ...unassigned];
  const byTaskId = byIdIndex(allTasks);

  // The axis covers the sprints **and** every measured date, so a task that
  // started before the first sprint is drawn where it started rather than
  // clipped to the edge — clipping would show a date nobody gave us (D-049).
  const range = timelineRange(
    rows.map((r) => r.sprint),
    taskActuals(allTasks),
  );

  // AC5: an empty project gets the empty state, not a bare axis. An axis with
  // no bars is a chart that looks broken rather than a project that has not been
  // planned yet.
  if (range === null) {
    return (
      <div className="timeline">
        <EmptyState
          headline="Nothing scheduled yet"
          body="The timeline is drawn from sprints. Plan one and it will appear here."
        />
      </div>
    );
  }

  const segments = toSegments(
    rows.map((r) => r.sprint),
    range,
  );
  const bands = monthBands(range);
  const today = todayPosition(range, now);
  const byId = new Map(rows.map((r) => [r.sprint.id, r]));

  /** One drawn row per task that has earned a position. */
  const drawn = rows.flatMap((row) =>
    row.tasks.flatMap((task) => {
      const bar = taskBar(task, row.sprint, range, now);
      return bar === undefined ? [] : [{ task, sprint: row.sprint, bar }];
    }),
  );

  const active = rows.find((r) => isCurrent(r.sprint, now)) ?? rows[0];
  const summary =
    active === undefined
      ? undefined
      : sprintSummary(
          active.tasks,
          // `board-derive`'s rule, not a second one (LAI-215).
          active.tasks.filter((t) => blockedState(t, byTaskId) === true).length,
          active.sprint,
          now,
        );

  return (
    <div className="timeline">
      <ScreenHeader
        title="Timeline"
        /* Derived, never a fixture: the axis the chart actually drew and the
           sprints actually on it. */
        context={`${formatRange(range.from, range.to)} · ${String(rows.length)} ${
          rows.length === 1 ? 'sprint' : 'sprints'
        }`}
      />

      {/* Kept out of the header band rather than deleted with it: a Gantt
          normally implies per-task bars, and their absence here is a decision
          (D-014, D-040) rather than an omission. It belongs with the chart it
          explains, not in a header that has to stay one line.

          The second sentence is the part that earns its place. LAI-426 built
          the design's row-per-task version and it had to be reverted: a task
          belongs to exactly one sprint, so every bar in a sprint came out the
          same length — 17 bars, 2 distinct geometries. **A constraint a reader
          cannot see reads as a bug**, so the screen says outright why there is
          no bar per task rather than leaving them to infer one is missing. */}
      <p className="timeline-sub">
        One row per task. A <strong>solid</strong> bar is what happened, from the day work started
        to the day it finished. An <strong>outline</strong> is the sprint a task sits in — a plan,
        not a measurement.
      </p>

      {/*
        The task track (D-049, LAI-434).

        **A solid bar is something that happened; an outline is somewhere a task
        was put.** That distinction is the whole of what survives D-014, so it is
        carried by *shape* — a filled bar against a hatched outline — and not by
        colour alone: a colour-only difference disappears for a colour-blind
        reader and in a screenshot.
      */}
      {summary !== undefined && active !== undefined && (
        <div className="tl-strip">
          <span className="tl-strip-name">{active.sprint.name}</span>
          <span className="tl-stat">
            DONE <b>{summary.done}</b>/{summary.total}
          </span>
          <span className="tl-stat tl-stat-blocked">
            BLOCKED <b>{summary.blocked}</b>
          </span>
          <span className="tl-stat">
            WIP <b>{summary.wip}</b>
          </span>
          <span className="tl-stat">
            DAYS LEFT <b>{summary.daysLeft}</b>
          </span>
        </div>
      )}

      <div className="tl-grid">
        <div className="tl-head">
          <div className="tl-head-label">TASK</div>
          <div className="tl-head-axis">
            <div className="timeline-months" aria-hidden="true">
              {bands.map((band) => (
                <div key={band.key} className="timeline-month" style={{ flexGrow: band.days }}>
                  <span className="timeline-month-label">{band.label}</span>
                </div>
              ))}
            </div>
            <div className="tl-bands">
              {segments.map((segment, i) =>
                segment.kind === 'gap' ? (
                  <div
                    key={`g${String(i)}`}
                    className="tl-band-gap"
                    style={{ flexGrow: segment.days }}
                  />
                ) : (
                  <div
                    key={segment.sprint.id}
                    className={isCurrent(segment.sprint, now) ? 'tl-band tl-band-now' : 'tl-band'}
                    style={{ flexGrow: segment.days }}
                  >
                    <span className="tl-band-name">{segment.sprint.name}</span>
                    <span className="tl-band-meta">
                      {(() => {
                        const row = byId.get(segment.sprint.id);
                        return row === undefined || row.progress.total === 0
                          ? 'no tasks'
                          : `${String(row.progress.done)}/${String(row.progress.total)}`;
                      })()}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>

        <div className="tl-body">
          {drawn.length === 0 && (
            <p className="timeline-task-empty">
              No task has a sprint or a recorded start, so there is nothing to place on the axis.
            </p>
          )}

          {drawn.map(({ task, bar }) => {
            const who = task.assignee_id === null ? undefined : members.get(task.assignee_id);
            const ink = avatarColor(task.assignee_id ?? task.id, theme);
            const isBlocked = blockedState(task, byTaskId) === true;

            return (
              <div key={task.id} className="tl-row">
                <div className="tl-row-label">
                  <span
                    className="tl-avatar"
                    style={{ background: ink.background, color: ink.foreground }}
                    title={who?.name ?? 'Unassigned'}
                  >
                    {who === undefined ? '?' : initials(who.name)}
                  </span>
                  <span className="tl-lines">
                    <span className="tl-title" title={task.title}>
                      {task.title}
                    </span>
                    <span className="tl-meta">
                      <span className="tl-key">{task.key}</span>
                      <span className={`timeline-task-status timeline-task-${task.status}`}>
                        {task.status}
                      </span>
                      {/*
                    The row says which dates the bar is. A sprint's range
                    presented in the same voice as a measured one is the
                    misreading D-014 exists to prevent, and it is invisible once
                    the bar is drawn.
                  */}
                      <span className={bar.fromSprint ? 'tl-dates tl-dates-planned' : 'tl-dates'}>
                        {formatRange(bar.from, bar.to)}
                        {bar.fromSprint && <span className="tl-planned-note"> · sprint</span>}
                      </span>
                    </span>
                  </span>
                </div>

                <div className="tl-track">
                  <div className="tl-lead" style={{ flexGrow: bar.leadDays }} />
                  <div
                    className={[
                      'tl-bar',
                      `tl-bar-${bar.kind}`,
                      `tl-bar-${task.status}`,
                      isBlocked ? 'tl-bar-blocked' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    style={{ flexGrow: bar.solidDays }}
                    title={`${task.key} · ${formatRange(bar.from, bar.to)}${
                      bar.fromSprint ? ' (the sprint, not the task)' : ''
                    }`}
                  >
                    {isBlocked && <span className="tl-blocked-dot" aria-hidden="true" />}
                    <span className="visually-hidden">
                      {bar.fromSprint ? 'planned, from its sprint' : 'actual'}
                      {isBlocked ? ', blocked' : ''}
                    </span>
                  </div>
                  {bar.remainderDays > 0 && (
                    <div className="tl-remainder" style={{ flexGrow: bar.remainderDays }} />
                  )}
                  <div className="tl-trail" style={{ flexGrow: bar.trailDays }} />
                </div>
              </div>
            );
          })}

          {today.on === 'axis' && (
            <div
              className="tl-today"
              style={{
                left: `calc(var(--tl-label) + (100% - var(--tl-label)) * ${String(today.percent / 100)})`,
              }}
              role="presentation"
            >
              <span className="tl-today-label">TODAY</span>
            </div>
          )}
        </div>
      </div>

      {today.on !== 'axis' && (
        <p className="timeline-note" role="status">
          {/* The axis is not stretched to reach today — that would squash every
              bar to accommodate empty months. Saying where today is instead. */}
          Today is {today.on === 'before' ? 'before' : 'after'} every sprint on this timeline.
        </p>
      )}

      {/* §11.4.3's unscheduled tray. Read-only here: dragging into a sprint is
          the Sprints screen's "Add tasks", and duplicating it is out of scope. */}
      <section className="timeline-tray" aria-label="Unscheduled tasks">
        <h2 className="timeline-tray-title">
          Unscheduled <span className="timeline-tray-count">{unassigned.length}</span>
        </h2>
        {unassigned.length === 0 ? (
          <p className="timeline-task-empty">
            {/* "Every task is in a sprint" is vacuously true of a project with no
                tasks at all, and reads as a claim about work that does not exist.
                Two messages because they mean different things to the reader. */}
            {rows.every((r) => r.tasks.length === 0)
              ? 'This project has no tasks yet.'
              : 'Every task is in a sprint.'}
          </p>
        ) : (
          <ul className="timeline-tasks">
            {unassigned.map((task) => (
              <li key={task.id} className="timeline-task">
                <span className="timeline-task-key">{task.key}</span>
                <span className="timeline-task-title">{task.title}</span>
                <span className={`timeline-task-status timeline-task-${task.status}`}>
                  {task.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
