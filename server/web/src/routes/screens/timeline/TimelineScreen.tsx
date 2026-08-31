import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { formatRange } from '../sprints/sprint-derive.ts';
import { useSprints } from '../sprints/use-sprints.ts';
import { listMembers, type Member } from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import {
  isCurrent,
  isPast,
  monthBands,
  timelineRange,
  todayPosition,
  toSegments,
  taskRows,
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
 * The prototype draws a row per task with its own start and length. Since
 * LAI-426 the rows are here — one per scheduled task, as the design has it —
 * but **the bar spans the task's sprint, not the task**. `tasks` has no
 * planned-start and no due-date column and D-014 keeps it that way: "draw it
 * from sprint boundaries and it costs a view; draw it from task dates and it
 * costs a scheduling engine".
 *
 * So tasks in one sprint share a horizontal extent and differ by row and by
 * status colour. The design's per-task ranges are not reachable without a
 * capability this product has deliberately refused, and inventing them is the
 * artifact class `docs/design/README.md` says not to reproduce.
 */
export function TimelineScreen() {
  const { params, setParams } = useRoute();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());

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

  // Names and avatar colours for the left column. A failure here costs the
  // initials, not the timeline, so it degrades to "?" rather than erroring.
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
  const range = timelineRange(rows.map((r) => r.sprint));

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
  const drawnRows = taskRows(rows);

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
          normally implies per-task ranges, and their absence is a decision
          (D-014) rather than an omission. It belongs with the chart it
          explains, not in a header that has to stay one line.

          It has to say this, because the chart otherwise looks like it is
          claiming task-level scheduling: every bar in a sprint has the same
          extent, and a reader who does not know why will read that as a bug. */}
      <p className="timeline-sub">
        One row per task. A bar spans the <strong>sprint</strong> that holds the task — tasks have
        no dates of their own, so every task in a sprint covers the same span.
      </p>

      {/*
        One row per task, sprints as columns (LAI-426).

        **Every bar spans its sprint's range, not the task's own.** D-014 refuses
        task dates — "draw it from sprint boundaries and it costs a view; draw it
        from task dates and it costs a scheduling engine" — so what the data
        knows is which sprint holds a task, and that is what is drawn. Tasks in
        one sprint therefore share an extent and differ by row and status colour.
        The design's per-task ranges are not reachable without a capability this
        product has deliberately refused.
      */}
      <div className="timeline-grid">
        <div className="timeline-head">
          <div className="timeline-head-label">TASK</div>
          <div className="timeline-head-cols">
            <div className="timeline-months" aria-hidden="true">
              {bands.map((band) => (
                <div key={band.key} className="timeline-month" style={{ flexGrow: band.days }}>
                  <span className="timeline-month-label">{band.label}</span>
                </div>
              ))}
            </div>

            {/* Sprint columns: name, done/total and range, read from the sprints
                endpoint. `progress` is the server's count, never re-derived from
                whatever tasks happen to be loaded. */}
            <div className="timeline-cols">
              {segments.map((segment, i) =>
                segment.kind === 'gap' ? (
                  <div
                    key={`colgap-${String(i)}`}
                    className="timeline-col-gap"
                    style={{ flexGrow: segment.days }}
                  />
                ) : (
                  <div
                    key={segment.sprint.id}
                    className={[
                      'timeline-col',
                      isCurrent(segment.sprint, now) ? 'timeline-col-now' : '',
                      isPast(segment.sprint, now) ? 'timeline-col-past' : '',
                    ]
                      .filter((c) => c !== '')
                      .join(' ')}
                    style={{ flexGrow: segment.days }}
                  >
                    <span className="timeline-col-name">{segment.sprint.name}</span>
                    <span className="timeline-col-meta">
                      {(() => {
                        const row = byId.get(segment.sprint.id);
                        return row === undefined || row.progress.total === 0
                          ? 'no tasks'
                          : `${String(row.progress.done)}/${String(row.progress.total)}`;
                      })()}
                    </span>
                    <span className="timeline-col-dates">
                      {formatRange(segment.sprint.starts_on, segment.sprint.ends_on)}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>

        <div className="timeline-body">
          {drawnRows.length === 0 && (
            <p className="timeline-task-empty">
              No task is in a sprint yet, so there is nothing to place on the axis.
            </p>
          )}

          {drawnRows.map(({ sprint, task }) => {
            const who = task.assignee_id === null ? undefined : members.get(task.assignee_id);
            const ink = avatarColor(task.assignee_id ?? task.id, theme);

            return (
              <div key={task.id} className="timeline-row">
                <div className="timeline-row-label">
                  <span
                    className="timeline-row-avatar"
                    style={{ background: ink.background, color: ink.foreground }}
                    title={who?.name ?? 'Unassigned'}
                  >
                    {who === undefined ? '?' : initials(who.name)}
                  </span>
                  <span className="timeline-row-title">{task.title}</span>
                  <span className="timeline-row-key">{task.key}</span>
                  <span className={`timeline-task-status timeline-task-${task.status}`}>
                    {task.status}
                  </span>
                </div>

                <div className="timeline-row-track">
                  {segments.map((segment, i) =>
                    segment.kind === 'sprint' && segment.sprint.id === sprint.id ? (
                      <div
                        key={`bar-${String(i)}`}
                        className={`timeline-task-bar timeline-task-bar-${task.status}`}
                        style={{ flexGrow: segment.days }}
                        title={`${task.key} · ${sprint.name} · ${formatRange(
                          sprint.starts_on,
                          sprint.ends_on,
                        )}`}
                      />
                    ) : (
                      <div
                        key={`empty-${String(i)}`}
                        className="timeline-gap"
                        style={{ flexGrow: segment.days }}
                      />
                    ),
                  )}
                </div>
              </div>
            );
          })}

          {today.on === 'axis' && (
            <div
              className="timeline-today"
              style={{
                left: `calc(var(--timeline-label) + (100% - var(--timeline-label)) * ${String(
                  today.percent / 100,
                )})`,
              }}
              role="presentation"
            >
              <span className="timeline-today-label">TODAY</span>
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
