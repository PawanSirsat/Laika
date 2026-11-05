import type { AvailabilitySeen, LoadProject } from '../../../api/availability.ts';
import { projectRoleLabel } from '../../../api/members.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { AvailabilityPill } from '../../../components/availability/AvailabilityPill.tsx';
import {
  firstName,
  hoursMinutes,
  rangeShort,
  updatedAgo,
  workWeekLine,
} from '../../../components/availability/availability-derive.ts';
import '../../../components/availability/availability.css';
import type { LoadState } from './profile-availability.ts';

export interface CurrentLoadCardProps {
  readonly name: string;
  readonly state: LoadState;
  readonly onRetry: () => void;
}

function projectName(row: LoadProject): string {
  if (row.hidden) return 'Spaces you can’t open';
  return row.project?.name ?? 'No space';
}

/**
 * **Current load** (frames 2d–2f, D-131; LAI-1139): facts about what someone
 * is carrying, read-only, for an owner or *See everyone's analytics* — never
 * on your own profile, and every read is a logged look.
 *
 * **Facts, not a score.** Hours by space over their last two weeks, their card
 * counts, and their working week as **two numbers printed side by side on a
 * neutral track with no fill** (plan Q2): a bar filled in proportion would be
 * a utilisation figure, which D-088 and D-131 rule out. No free hours anywhere.
 */
export function CurrentLoadCard({ name, state, onRetry }: CurrentLoadCardProps) {
  const first = firstName(name);
  return (
    <section className="prof-card" data-section="load" aria-labelledby="prof-load-title">
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="prof-load-title">
          Current load
        </h3>
        <span className="prof-card-caption">
          facts, not a score · read-only · {first} can see you looked
        </span>
      </header>
      {state.status === 'idle' || state.status === 'loading' ? (
        <LoadingState shape="card" count={1} label={`Reading ${first}’s load`} />
      ) : state.status === 'error' ? (
        <ApiErrorState error={state.error} resource={`${first}’s load`} onRetry={onRetry} />
      ) : (
        <LoadBody first={first} load={state.load} />
      )}
    </section>
  );
}

function LoadBody({
  first,
  load,
}: {
  readonly first: string;
  readonly load: Extract<LoadState, { status: 'ready' }>['load'];
}) {
  const largest = Math.max(1, ...load.projects.map((p) => p.confirmed_minutes + p.drafted_minutes));
  const week = load.week;
  const tracked = week.confirmed_minutes + week.drafted_minutes;
  const workWeek = workWeekLine(load.availability?.work_week);
  return (
    <div className="load-grid">
      <div className="load-part" data-load="projects">
        <span className="avail-label">Projects · last 2 weeks</span>
        {load.projects.length === 0 ? (
          <p className="avail-quiet">No time in the last two weeks.</p>
        ) : (
          <ul className="load-rows">
            {load.projects.map((row) => {
              const minutes = row.confirmed_minutes + row.drafted_minutes;
              return (
                <li key={row.project?.id ?? (row.hidden ? 'hidden' : 'none')} className="load-row">
                  <span className="load-row-name">
                    {projectName(row)}
                    {row.role !== null && (
                      <span className="load-row-role"> · {projectRoleLabel(row.role)}</span>
                    )}
                  </span>
                  <span className="load-figure">{hoursMinutes(minutes)}</span>
                  {/* How their own two weeks split between spaces — no one is compared with anyone. */}
                  <span className="load-bar" aria-hidden="true">
                    <span style={{ width: `${String(Math.round((minutes / largest) * 100))}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="load-part" data-load="cards">
        <span className="avail-label">Cards</span>
        <dl className="load-cards">
          <div>
            <dt>In progress</dt>
            <dd>{load.cards.in_progress}</dd>
          </div>
          <div>
            <dt>Waiting for review</dt>
            <dd>{load.cards.in_review}</dd>
          </div>
          <div>
            <dt>Due in 7 days</dt>
            <dd>{load.cards.due_7d}</dd>
          </div>
        </dl>
      </div>

      <div className="load-part" data-load="week">
        <span className="avail-label">Working week</span>
        <p className="load-week-figures" data-load-week>
          <span className="load-figure">{hoursMinutes(tracked)}</span> tracked
          {week.set_minutes === null ? (
            <> · no working hours set</>
          ) : (
            <>
              {' '}
              of <span className="load-figure">{hoursMinutes(week.set_minutes)}</span> set
            </>
          )}
        </p>
        {/* Neutral and unfilled, on purpose: the numbers are the fact (plan Q2). */}
        <span className="load-track" data-load-track aria-hidden="true" />
        <p className="avail-quiet">
          {workWeek === null ? 'No working week set' : `Set by ${first}: ${workWeek}`}
        </p>
      </div>

      <div className="load-part" data-load="away">
        <span className="avail-label">Away</span>
        {load.away.length === 0 ? (
          <p className="avail-quiet">No time away planned.</p>
        ) : (
          <ul className="load-away">
            {load.away.map((p) => (
              <li key={`${p.from}-${p.to}`}>
                <span aria-hidden="true">◐</span> {rangeShort(p.from, p.to)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The header's line under the name (frames 2d–2f): the pill, their note and
 * tags, and who set it when. Nothing when they have said nothing.
 */
export function ProfileAvailabilityLine({
  name,
  seen,
  now = Date.now(),
}: {
  readonly name: string;
  readonly seen: AvailabilitySeen | null | undefined;
  readonly now?: number;
}) {
  if (seen === null || seen === undefined) return null;
  const said =
    seen.status !== null || seen.away !== null || seen.note !== null || seen.tags.length > 0;
  if (!said) return null;
  const updated = updatedAgo(seen.updated_at, now);
  return (
    <div className="prof-avail" data-profile-availability>
      <AvailabilityPill availability={seen} />
      {seen.note !== null && <span className="avail-note">“{seen.note}”</span>}
      {seen.tags.length > 0 && (
        <span className="avail-tagrow">
          {seen.tags.map((t) => (
            <span key={t} className="avail-chip">
              {t}
            </span>
          ))}
        </span>
      )}
      {updated !== null && (
        <span className="avail-quiet" data-stale={updated.stale}>
          set by {firstName(name)} · {updated.text}
          {updated.stale && ' · may be out of date'}
        </span>
      )}
    </div>
  );
}
