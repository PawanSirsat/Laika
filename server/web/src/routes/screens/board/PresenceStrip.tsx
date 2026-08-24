import { demoPresenceFor } from '../../../demo/presence.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Member } from '../../../api/tasks.ts';
import type { Theme } from '../../../theme/theme.ts';
import './presence-strip.css';

export interface PresenceStripProps {
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  /** The member currently filtering the board, if any. */
  readonly assignee: string | undefined;
  readonly onFilter: (userId: string | undefined) => void;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * "Who is working on what, right now" (prototype, band C).
 *
 * **The people are real** — project members from `GET /projects/:slug/members`,
 * with their derived avatar colours — and clicking one really does filter the
 * board by assignee. **What they are doing is sample data**: the `heartbeats`
 * table has no reader, no writer and no route, so nothing in Laika knows where
 * anyone is (see `demo/presence.ts`).
 *
 * Built this way round on purpose. Inventing colleagues would make the strip
 * unreadable; inventing only their activity keeps the faces honest and puts the
 * fiction in one clearly-labelled place.
 */
export function PresenceStrip({ members, theme, assignee, onFilter }: PresenceStripProps) {
  const people = [...members.values()];
  if (people.length === 0) return null;

  return (
    <section className="presence" aria-label="Who is working now">
      <h2 className="presence-label">WORKING NOW</h2>

      <div className="presence-people">
        {people.map((person, index) => {
          const state = demoPresenceFor(index);
          if (state === undefined) return null;
          const colour = avatarColor(person.user_id, theme);
          const on = assignee === person.user_id;

          return (
            <button
              key={person.user_id}
              type="button"
              className={on ? 'presence-chip presence-chip-on' : 'presence-chip'}
              aria-pressed={on}
              onClick={() => {
                onFilter(on ? undefined : person.user_id);
              }}
              title={`Filter the board to ${person.name}`}
            >
              <span className="presence-face">
                <span
                  className="presence-avatar"
                  style={{
                    background: colour.background,
                    color: colour.foreground,
                    borderColor: colour.border,
                  }}
                  aria-hidden="true"
                >
                  {initials(person.name)}
                </span>
                {state.agentLive && <span className="presence-bot" aria-hidden="true" />}
              </span>

              <span className="presence-who">
                <span className="presence-name">
                  {person.name}
                  <span className={`presence-dot presence-dot-${state.state}`} aria-hidden="true" />
                </span>
                <span className="presence-where">{state.where}</span>
              </span>
            </button>
          );
        })}
      </div>

      {assignee !== undefined && (
        <button
          type="button"
          className="presence-clear"
          onClick={() => {
            onFilter(undefined);
          }}
        >
          Clear filter ✕
        </button>
      )}

      <p className="presence-note">Activity is sample data — nothing reports presence yet.</p>
    </section>
  );
}
