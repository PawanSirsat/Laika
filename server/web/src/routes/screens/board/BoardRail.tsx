import { DemoNotice } from '../../../components/DemoNotice.tsx';
import { describeEvent } from '../../../api/activity.ts';
import { demoAgentSessions } from '../../../demo/agent-sessions.ts';
import type { ActivityEvent } from '../../../api/activity.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import type { StreamStatus } from '../../../api/use-events.ts';
import './board-rail.css';

export interface BoardRailProps {
  readonly status: StreamStatus;
  readonly events: readonly ActivityEvent[];
  readonly gapped: boolean;
  readonly tasks: readonly Task[];
  readonly members: ReadonlyMap<string, Member>;
}

const DAY = 86_400_000;
/** The design's threshold: five days without a status change or comment. */
const STALE_DAYS = 5;

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

function ageDays(at: number, now: number): number {
  return Math.floor((now - at) / DAY);
}

/**
 * The 266px rail beside the board (prototype, band D right).
 *
 * **Live stream and Stale are real.** The stream is the SSE feed — the first
 * consumer the endpoint has ever had — and stale tasks are computed from
 * `updated_at`, which every task carries. **Agent sessions is sample data**:
 * nothing stores a session, and `heartbeats` is an empty table with no route.
 */
export function BoardRail({ status, events, gapped, tasks, members }: BoardRailProps) {
  const now = Date.now();
  const sessions = demoAgentSessions(tasks);

  const stale = tasks
    .filter((t) => t.status !== 'done' && ageDays(t.updated_at, now) >= STALE_DAYS)
    .sort((a, b) => a.updated_at - b.updated_at)
    .slice(0, 4);

  return (
    <aside className="rail" aria-label="Board activity">
      <section className="rail-card">
        <header className="rail-head">
          <span className={`rail-dot rail-dot-${status}`} aria-hidden="true" />
          <h2>Live stream</h2>
          <code>/events</code>
        </header>

        {gapped && (
          <p className="rail-gap" role="status">
            The stream skipped ahead — some events could not be replayed. Refresh for the full
            picture.
          </p>
        )}

        {events.length === 0 ? (
          <p className="rail-empty">
            {status === 'live' ? 'Connected. Nothing has happened yet.' : 'Waiting for the stream…'}
          </p>
        ) : (
          <ol className="rail-feed">
            {events.map((event) => (
              <li key={event.id}>
                <time dateTime={new Date(event.created_at).toISOString()}>
                  {clock(event.created_at)}
                </time>
                <span className="rail-feed-what">
                  {event.actor_kind === 'agent' && <span className="rail-bot">agent</span>}
                  {describeEvent(event)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rail-card">
        <header className="rail-head">
          <h2>Agent sessions</h2>
          <span className="rail-count">{sessions.length}</span>
        </header>
        <DemoNotice what="No session data exists — nothing writes to heartbeats." />
        <ul className="rail-sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <p className="rail-session-who">
                {session.who}
                <span className={`rail-pill rail-pill-${session.state}`}>
                  {session.state.toUpperCase()}
                </span>
              </p>
              <p className="rail-session-task">{session.task}</p>
              <span className="rail-bar" aria-hidden="true">
                <span style={{ width: `${String(session.pct)}%` }} />
              </span>
              <p className="rail-session-meta">{session.meta}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rail-card">
        <header className="rail-head">
          <h2>Stale · no movement</h2>
          <span className="rail-count">{stale.length}</span>
        </header>
        {stale.length === 0 ? (
          <p className="rail-empty">Everything has moved in the last {STALE_DAYS} days.</p>
        ) : (
          <ul className="rail-stale">
            {stale.map((task) => (
              <li key={task.id}>
                <span className="rail-stale-title">{task.title}</span>
                <span className="rail-stale-meta">
                  <code>{task.key}</code>
                  {ageDays(task.updated_at, now)}d idle
                  {task.assignee_id !== null && members.has(task.assignee_id) && (
                    <em>{members.get(task.assignee_id)?.name}</em>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="rail-note">Threshold: {STALE_DAYS} days without an update.</p>
      </section>
    </aside>
  );
}
