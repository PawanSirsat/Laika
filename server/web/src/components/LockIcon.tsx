/**
 * The padlock that means **blocked** (LAI-436).
 *
 * One glyph, three places: the task card, a project's stats line, and the
 * timeline's sprint tabs. It was pasted into the first two and LAI-436's Notes
 * called adding a third *"the third chance to get it wrong"*, after LAI-215's
 * fourth `initials()` and LAI-434's second blocked rule.
 *
 * **Not `StateIcon`'s `forbidden` padlock, which is a different drawing for a
 * different sentence** — that one means *you may not see this*, at 1.6 stroke on
 * an empty-state canvas. This one means *something is holding this up*, small
 * and beside a number. Merging them would make one glyph say both.
 *
 * `LoginScreen`'s padlock stays where it is: it labels a password field, and it
 * is a lock in the ordinary sense rather than this one.
 */
export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
