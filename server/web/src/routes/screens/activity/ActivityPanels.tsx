import { describeEvent } from '../../../api/activity.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { streamEmptyNote } from './stream-presentation.ts';
import { describeActor } from './actor-presentation.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import type { ActivityEvent } from '../../../api/activity.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import { PresencePerson } from '../../../components/PresencePerson.tsx';
import type { PresenceView } from '../../../api/presence.ts';
import type { StreamStatus } from '../../../api/use-events.ts';
import './board-rail.css';

export interface BoardRailProps {
  readonly status: StreamStatus;
  readonly events: readonly ActivityEvent[];
  readonly gapped: boolean;
  readonly tasks: readonly Task[];
  readonly members: ReadonlyMap<string, Member>;
  /** `undefined` while the first read is in flight (LAI-440). */
  readonly presence: PresenceView | undefined;
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
export function BoardRail({ status, events, gapped, tasks, members, presence }: BoardRailProps) {
  const now = Date.now();
  // **Real agent sessions** (LAI-440): a heartbeat sent on a token is an agent,
  // per §4.8's `actor_kind`. `demoAgentSessions` invented a percentage bar and a
  // progress figure that nothing measures — there is no such thing on the wire,
  // and a bar that means nothing is worse than no bar.
  const agents = presence?.present.filter((entry) => entry.is_agent) ?? [];
  // Read through the hook, not `document.documentElement`: avatar colours are
  // computed in JS, so they only follow the theme if this component re-renders.
  const { theme } = useTheme();

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
          <p className="rail-empty">{streamEmptyNote(status)}</p>
        ) : (
          <ol className="rail-feed">
            {events.map((event) => {
              // `actor_id` is on every row precisely so this needs no second
              // lookup; the members map turns it into a name we can show.
              // One place decides who acted and how it is marked, because this
              // and the task detail render the same rows and disagreed about
              // them — see `actor-presentation.ts`.
              const actor = describeActor(event, members);
              const ink = avatarColor(event.actor_id ?? event.id, theme);

              return (
                <li key={event.id}>
                  <time dateTime={new Date(event.created_at).toISOString()}>
                    {clock(event.created_at)}
                  </time>
                  <span className="rail-feed-who">
                    <span
                      className="rail-feed-avatar"
                      style={{ background: ink.background, color: ink.foreground }}
                    >
                      {initials(actor.name)}
                    </span>
                    {/* The design marks a non-human actor with a corner dot on
                        the avatar rather than a word, so the row stays scannable
                        at 8.5px. Agent and system differ by **shape** as well as
                        colour — two dots that differ only in hue are not a
                        distinction for every reader (AC3). */}
                    {actor.badge !== undefined && (
                      <span
                        className={`rail-feed-bot rail-feed-bot-${actor.badge}`}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="rail-feed-what">
                    <b>{actor.name}</b>
                    {/* Only the qualifier is hidden text — the name is already
                        rendered, and repeating it here reads it twice aloud.
                        This is what carries the badge for a reader who cannot
                        see the dot at all. */}
                    {actor.badge !== undefined && (
                      <span className="visually-hidden"> ({actor.badge})</span>
                    )}{' '}
                    {describeEvent(event)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Hidden entirely when the org has presence off — the same rule as the
          strip. A card headed "Agent sessions" that can never fill is worse on a
          screen somebody looks at all day than no card. */}
      {presence?.enabled !== false && (
        <section className="rail-card">
          <header className="rail-head">
            <h2>Agent sessions</h2>
            {presence !== undefined && <span className="rail-count">{agents.length}</span>}
          </header>
          {presence === undefined ? (
            <p className="rail-empty">Loading…</p>
          ) : agents.length === 0 ? (
            /* Three states, and this is the one that used to be a bare heading:
               nobody is running an agent, said rather than implied. */
            <p className="rail-empty">No agent has a session in the last five minutes.</p>
          ) : (
            <ul className="rail-sessions">
              {agents.map((entry) => (
                <li key={entry.user_id}>
                  <PresencePerson entry={entry} theme={theme} variant="chip" />
                  <p className="rail-session-meta">
                    last seen {new Date(entry.last_seen).toLocaleTimeString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
