import { PresencePerson } from '../PresencePerson.tsx';
import { useTheme } from '../../theme/use-theme.ts';
import type { PresenceView } from '../../api/presence.ts';
import './presence-strip.css';

export interface PresenceStripProps {
  /** `undefined` while the first request is in flight. */
  readonly presence: PresenceView | undefined;
  /** The space being drawn, for the chip's `laika-core · branch` line. */
  readonly spaceSlug?: string | undefined;
  /** The member currently filtering the board, if any. */
  readonly assignee: string | undefined;
  readonly onFilter: (userId: string | undefined) => void;
}

/**
 * "Who is working on what, right now" (prototype, band C — real since LAI-440).
 *
 * It rendered its heading and **nothing** in the shipped build: the chips came
 * from `demo/presence.ts`, which returns `undefined` unless demo mode is on
 * (D-032), because `heartbeats` had no reader. `GET /presence` exists now
 * (LAI-432) and the demo module is gone.
 *
 * ## Three states, three renderings
 *
 * A heading with nothing under it is a state, and it has to say which one:
 *
 * - **Loading** — a skeleton. Nothing is claimed yet.
 * - **Nobody working** — said in words. An empty strip under a heading reads as
 *   broken, and *"nobody has a session right now"* reads as an answer.
 * - **Presence off** — `null`. On the Board, unlike Capacity, there is nothing
 *   to explain and no room to explain it; a permanent empty band on the main
 *   screen of an org that has switched presence off is a standing reproach for a
 *   setting somebody chose.
 *
 * Clicking a person still filters the board by assignee, which is real and
 * always was.
 *
 * **Moved out of `board/` by LAI-251.** The design puts this band under the
 * space bar, above whichever view is showing — it is about the space, not
 * about the board.
 */
export function PresenceStrip({ presence, assignee, onFilter, spaceSlug }: PresenceStripProps) {
  // Read here rather than passed in: a stale `theme` prop keeps the previous
  // palette after a flip, which is the trap `theme/use-theme.ts` documents.
  const { theme } = useTheme();
  // `enabled: false` is a fact from the response, never inferred from an empty
  // list — the two are opposite claims (§4.2, LAI-150).
  if (presence !== undefined && !presence.enabled) return null;

  return (
    <section className="presence" aria-label="Who is working now">
      <h2 className="presence-label">WORKING NOW</h2>

      {presence === undefined ? (
        <p className="presence-note">Loading…</p>
      ) : presence.present.length === 0 ? (
        <p className="presence-note">Nobody has a session in the last five minutes.</p>
      ) : (
        <div className="presence-people">
          {presence.present.map((entry) => {
            const on = assignee === entry.user_id;
            return (
              <button
                key={entry.user_id}
                type="button"
                className={on ? 'presence-chip presence-chip-on' : 'presence-chip'}
                aria-pressed={on}
                onClick={() => {
                  onFilter(on ? undefined : entry.user_id);
                }}
                title={`Filter the board to ${entry.name}`}
              >
                {/* The one presence renderer (LAI-440). A chip and a row look
                    different and decide the same things. */}
                <PresencePerson entry={entry} theme={theme} variant="chip" spaceSlug={spaceSlug} />
              </button>
            );
          })}
        </div>
      )}

      {/*
        `2 agent sessions live · 4 people active`, at the right of the strip —
        the design's own summary. Both figures are counted from the same list
        the chips come from.
      */}
      {presence !== undefined && presence.present.length > 0 && (
        <p className="presence-summary">
          {presence.present.filter((p) => p.is_agent).length} agent{' '}
          {presence.present.filter((p) => p.is_agent).length === 1 ? 'session' : 'sessions'} live ·{' '}
          {presence.present.length} {presence.present.length === 1 ? 'person' : 'people'} active
        </p>
      )}

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
    </section>
  );
}
