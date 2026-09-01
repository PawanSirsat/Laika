import { hasLocation, type PresenceEntry } from '../api/presence.ts';
import { avatarColor } from '../theme/avatar-color.ts';
import { initials } from '../theme/initials.ts';
import type { Theme } from '../theme/theme.ts';
import './markers.css';
import './presence-person.css';

export interface PresencePersonProps {
  readonly entry: PresenceEntry;
  readonly theme: Theme;
  /**
   * `row` for Capacity's list, `chip` for the Board's strip.
   *
   * The two genuinely look different — a full-width row against a compact
   * clickable chip — but everything they **decide** is the same, and that is
   * what must not be written twice.
   */
  readonly variant: 'row' | 'chip';
}

/**
 * One person, present (§9.3, §11.4.2).
 *
 * **The one renderer for a presence entry** (LAI-440): *"do not put a fourth
 * presence renderer in the tree — whatever LAI-439 builds is the component this
 * reuses."* LAI-439 built it inside `CapacityScreen`, so this is that function
 * lifted out rather than a second one written to match.
 *
 * What is shared is not the layout, which differs, but the three decisions that
 * are easy to get subtly and invisibly different:
 *
 * 1. **Whether a location may be shown at all** — `hasLocation`, on `repo`.
 * 2. **What to say when it may not** — *working elsewhere*, one sentence, one
 *    place. Two copies would drift into "unknown" on one screen and a dash on
 *    the other, and both readings are wrong in the same way.
 * 3. **How an agent is marked** — LAI-411's `.marker-agent`, the word rather
 *    than a colour.
 */
export function PresencePerson({ entry, theme, variant }: PresencePersonProps) {
  const ink = avatarColor(entry.user_id, theme);
  const located = hasLocation(entry);

  return (
    <span className={`pp pp-${variant}`}>
      <span
        className="pp-avatar"
        style={{ background: ink.background, color: ink.foreground, borderColor: ink.border }}
        aria-hidden="true"
      >
        {initials(entry.name)}
      </span>

      <span className="pp-body">
        <span className="pp-head">
          <span className="pp-name">{entry.name}</span>
          {entry.is_agent && <span className="marker marker-agent">agent</span>}
        </span>

        {located ? (
          <span className="pp-where">
            <code className="pp-repo">{entry.repo}</code>
            <span className="pp-branch">{entry.branch}</span>
          </span>
        ) : (
          /* **A normal state, not a loading one** (LAI-438). The hook fires in
             every repository a person opens, because `LAIKA_URL` lives in user
             settings (D-046) — publishing each one would make consent to be seen
             working here into consent to broadcast everything else.

             So: a sentence. No dash, no "unknown", no skeleton that never
             resolves, and nothing that reads as an error. */
          <span className="pp-elsewhere">working elsewhere</span>
        )}
      </span>
    </span>
  );
}
