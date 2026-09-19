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
  /** The space being drawn, so a chip can name it — see {@link where}. */
  readonly spaceSlug?: string | undefined;
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
/** `Mira Kellner` → `Mira K.`, the design's form for a chip. */
function shortName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  if (parts.length < 2) return name;
  return `${parts[0] ?? ''} ${(parts[parts.length - 1] ?? '').charAt(0)}.`;
}

/**
 * Where the session is, as the design writes it: `laika-core · lai-142`.
 *
 * **`project_ids` and `matched_task_id` are ids, not names.** The first version
 * of this printed them straight out and rendered `p1 · t1` — ULIDs in
 * production. Presence has no slug or task key to give, so the *space's own
 * slug* is passed in (the strip knows which space it is drawing) and the branch
 * is the work — which is what a person reads to know what an agent is on.
 */
/**
 * The task a branch is for: `lai-251-space-bar` → `LAI-251`.
 *
 * The design writes this line as `laika-core · LAI-142` — a **key**, not a
 * branch. A branch that carries one is named by its key and a slug, and ours
 * rendered as `lai-251…`: lower-cased and then cut off mid-word, because the
 * slug made the line too long for the chip.
 *
 * A branch with no key in it is left exactly as it is. Guessing a key out of
 * `main` would be inventing one, and the full branch is on the chip's title
 * either way.
 */
function taskKey(branch: string): string {
  const match = /^([A-Za-z]{2,5})-(\d+)/.exec(branch);
  if (match === null) return branch;
  return `${(match[1] ?? '').toUpperCase()}-${match[2] ?? ''}`;
}

function where(entry: PresenceEntry, spaceSlug: string | undefined): string {
  const branch = taskKey(entry.branch ?? '');
  if (spaceSlug === undefined) return branch === '' ? (entry.repo ?? '') : branch;
  return branch === '' ? spaceSlug : `${spaceSlug} · ${branch}`;
}

export function PresencePerson({ entry, theme, variant, spaceSlug }: PresencePersonProps) {
  const ink = avatarColor(entry.user_id, theme);
  const located = hasLocation(entry);
  /*
   * **The design's short form is the chip's, not the row's** (LAI-271). A chip
   * in the Working-now strip is a glance and gets `Mira K.` with one line
   * beneath; a row on Capacity is where somebody goes to read exactly who is
   * on which branch, and it keeps the full name and the repo.
   */
  const chip = variant === 'chip';

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
          {/* `Mira K.`, as the design writes it — a chip is a glance, and a
              full surname pushes the line it shares out of the row. */}
          <span className="pp-name">{chip ? shortName(entry.name) : entry.name}</span>
          {/* A dot, not the word "agent": the design marks the session's state
              here and puts the agent badge on the avatar. */}
          {chip ? (
            <>
              <span
                className={entry.is_agent ? 'pp-dot pp-dot-agent' : 'pp-dot'}
                title={entry.is_agent ? 'Agent session' : 'Person'}
                aria-hidden="true"
              />
              <span className="visually-hidden">{entry.is_agent ? 'agent session' : 'person'}</span>
            </>
          ) : (
            entry.is_agent && <span className="marker marker-agent">agent</span>
          )}
        </span>

        {located ? (
          <span className="pp-where">
            {chip ? (
              /* `laika-core · LAI-142` — where the work is, in the product's
                 own vocabulary. A chip has one short line; the repo and branch
                 that produced it stay in the title. */
              <span className="pp-repo" title={`${entry.repo ?? ''} ${entry.branch ?? ''}`}>
                {where(entry, spaceSlug)}
              </span>
            ) : (
              /* A **row** has room, and Capacity is where somebody goes to ask
                 exactly where an agent is working. Unchanged. */
              <>
                <code className="pp-repo">{entry.repo}</code>
                <span className="pp-branch">{entry.branch}</span>
              </>
            )}
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
