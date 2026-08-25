import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { isProject, listProjects } from '../../../api/projects.ts';
import { useRoute } from '../../use-route.ts';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { formatRange } from '../sprints/sprint-derive.ts';
import { useSprints } from '../sprints/use-sprints.ts';
import {
  isCurrent,
  isPast,
  monthBands,
  timelineRange,
  todayPosition,
  toSegments,
} from './timeline-derive.ts';
import './timeline.css';

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
  const { params } = useRoute();
  const [slug, setSlug] = useState<string | undefined>(params.get('project') ?? undefined);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  // Fixed at mount rather than read per render: every position on the axis is
  // derived from it, and a clock that moved mid-render would shift the marker
  // away from the bars it is meant to line up with.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();

    listProjects({}, controller.signal)
      .then((page) => {
        const live = page.data.filter(isProject);
        setSlug((slug === undefined ? live[0] : live.find((p) => p.slug === slug))?.slug);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectError(cause);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

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
          normally implies task bars, and their absence here is a decision
          (D-014) rather than an omission. It belongs with the chart it
          explains, not in a header that has to stay one line. */}
      <p className="timeline-sub">
        One bar per sprint. Tasks have no dates of their own — open a sprint to see what is in it.
      </p>

      <div className="timeline-chart">
        <div className="timeline-months" aria-hidden="true">
          {bands.map((band) => (
            <div key={band.key} className="timeline-month" style={{ flexGrow: band.days }}>
              <span className="timeline-month-label">{band.label}</span>
            </div>
          ))}
        </div>

        <div className="timeline-track-wrap">
          <div className="timeline-track">
            {segments.map((segment, i) =>
              segment.kind === 'gap' ? (
                <div
                  key={`gap-${String(i)}`}
                  className="timeline-gap"
                  style={{ flexGrow: segment.days }}
                />
              ) : (
                <button
                  key={segment.sprint.id}
                  type="button"
                  className={[
                    'timeline-bar',
                    `timeline-bar-${segment.sprint.status}`,
                    isPast(segment.sprint, now) ? 'timeline-bar-past' : '',
                    isCurrent(segment.sprint, now) ? 'timeline-bar-now' : '',
                    expanded === segment.sprint.id ? 'timeline-bar-open' : '',
                  ]
                    .filter((c) => c !== '')
                    .join(' ')}
                  style={{ flexGrow: segment.days }}
                  aria-expanded={expanded === segment.sprint.id}
                  onClick={() => {
                    setExpanded(expanded === segment.sprint.id ? undefined : segment.sprint.id);
                  }}
                >
                  <span className="timeline-bar-name">{segment.sprint.name}</span>
                  <span className="timeline-bar-meta">
                    {(() => {
                      const row = byId.get(segment.sprint.id);
                      return row === undefined || row.progress.total === 0
                        ? 'no tasks'
                        : `${String(row.progress.done)}/${String(row.progress.total)}`;
                    })()}
                  </span>
                  <span
                    className="timeline-bar-fill"
                    style={{
                      width: `${String(byId.get(segment.sprint.id)?.progress.percent ?? 0)}%`,
                    }}
                  />
                </button>
              ),
            )}
          </div>

          {today.on === 'axis' && (
            <div
              className="timeline-today"
              style={{ left: `${String(today.percent)}%` }}
              role="presentation"
            >
              <span className="timeline-today-label">Today</span>
            </div>
          )}
        </div>

        {today.on !== 'axis' && (
          <p className="timeline-note" role="status">
            {/* The axis is not stretched to reach today — that would squash every
                bar to accommodate empty months. Saying where today is instead. */}
            Today is {today.on === 'before' ? 'before' : 'after'} every sprint on this timeline.
          </p>
        )}
      </div>

      <ul className="timeline-legend">
        {rows.map((row) => (
          <li key={row.sprint.id} className="timeline-legend-item">
            <button
              type="button"
              className="timeline-legend-button"
              aria-expanded={expanded === row.sprint.id}
              onClick={() => {
                setExpanded(expanded === row.sprint.id ? undefined : row.sprint.id);
              }}
            >
              <span className={`timeline-chip timeline-chip-${row.sprint.status}`}>
                {row.sprint.status}
              </span>
              <span className="timeline-legend-name">{row.sprint.name}</span>
              <span className="timeline-legend-dates">
                {formatRange(row.sprint.starts_on, row.sprint.ends_on)}
              </span>
              <span className="timeline-legend-count">
                {row.progress.total === 0
                  ? 'no tasks'
                  : `${String(row.progress.done)}/${String(row.progress.total)} done`}
              </span>
            </button>

            {expanded === row.sprint.id && (
              <ul className="timeline-tasks">
                {row.tasks.length === 0 && (
                  <li className="timeline-task-empty">Nothing assigned to this sprint.</li>
                )}
                {row.tasks.map((task) => (
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
          </li>
        ))}
      </ul>

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
