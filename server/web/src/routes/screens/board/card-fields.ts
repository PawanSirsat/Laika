/**
 * Which parts of a card the board draws (LAI-266).
 *
 * ## Four fields are not here, and their absence is the design
 *
 * The panel lists every toggle below and says in one sentence why the rest
 * always show. It does **not** render them greyed out — a disabled checkbox invites a
 * hunt for the reason, where a sentence answers it.
 *
 *  - **Title.** A card without one is not a card.
 *  - **The key / open button.** It *is* the hit area: `.card-open::after` is
 *    `inset: 0`, stretched over the whole card. Hiding it would remove the
 *    card's only control and its only tab stop, and restore the small hit
 *    target LAI-424 existed to fix.
 *  - **The blocked banner.** A safety signal. `board-derive.ts` refuses to draw
 *    an unblocked card over a blocked task because it *"invites someone to start
 *    work that cannot proceed"* — a toggle would let a person opt into exactly
 *    that, with their own hand.
 *  - **The `deps ?` marker.** The honest half of the same signal: *we cannot
 *    judge this one*. Hiding it silently converts **unknown** into **fine**,
 *    which is the more damaging of the two errors.
 *
 * ## Three fields were removed, not hidden (LAI-701, D-069)
 *
 * *Stale marker*, *Comment count* and *Last updated* were toggles here until
 * the owner said of them *"I don't need that"*. They are gone from the card
 * rather than defaulted off, because a default cannot reach a board whose
 * reader saved their layout already. `readPreferences` reads stored fields by
 * this list, so an old record carrying those keys is read cleanly and they are
 * ignored. Staleness is still flagged by the server and listed on the Activity
 * tab; the comment count is still in the task view.
 *
 * ## One prop, not a boolean per field
 *
 * `TaskCard` takes this whole record. A new field then changes this file and
 * the panel, and no call site.
 *
 * ## Hiding means not rendering
 *
 * Consumers must branch, never reach for `display: none`. Three reasons: a
 * hidden node still costs render work on every card; `.card-foot` is a wrapping
 * flex row whose behaviour is carefully tuned, and a present-but-invisible child
 * is a future `:nth-child` bug; and CONVENTIONS §4's "assert absences" only
 * works if the node is genuinely absent.
 */
export interface CardFields {
  readonly tags: boolean;
  readonly priority: boolean;
  readonly sprint: boolean;
  readonly ready: boolean;
  readonly deps: boolean;
  /** The avatar, and the agent badge that sits on its corner. */
  readonly assignee: boolean;
  /** `n/m` on a parent and `↳ KEY` on a child (D-066). */
  readonly subtasks: boolean;
  /**
   * The due date — **only when it is today or past** on an open task (LAI-701,
   * D-069): amber *Due today*, red once it is gone. A date still ahead draws
   * nothing.
   */
  readonly due: boolean;
}

/** Everything on, so a board with no stored preference looks exactly as before. */
export const ALL_FIELDS: CardFields = Object.freeze({
  tags: true,
  priority: true,
  sprint: true,
  ready: true,
  deps: true,
  assignee: true,
  subtasks: true,
  due: true,
});

/** The panel's rows, in the order it lists them. */
export const FIELD_LABELS: Readonly<Record<keyof CardFields, string>> = {
  tags: 'Tags',
  priority: 'Priority',
  sprint: 'Sprint',
  ready: 'Ready marker',
  deps: 'Dependency count',
  assignee: 'Assignee',
  subtasks: 'Subtasks',
  due: 'Due date',
};

export const FIELD_KEYS = Object.keys(FIELD_LABELS) as (keyof CardFields)[];

/**
 * A glyph per field, so the Selected-fields list reads as a list of *things*
 * rather than a column of checkboxes.
 *
 * Text glyphs rather than an icon set: this repo has no icon dependency and a
 * field list is not worth adding one for.
 */
export const FIELD_ICONS: Readonly<Record<keyof CardFields, string>> = {
  tags: '\u25c7',
  priority: '\u2191',
  sprint: '\u25f7',
  ready: '\u25cf',
  deps: '\u26ad',
  assignee: '\u25cb',
  subtasks: '\u21b3',
  due: '\u25a6',
};

/**
 * The four a reader cannot switch off, with the reason shown beside each.
 *
 * They appear in the Selected-fields list with a **disabled** `\u00d7` rather
 * than being absent — the reference greys `Summary` the same way, and a field
 * that simply is not listed reads as an oversight.
 */
export const ALWAYS_ON: readonly {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly why: string;
}[] = [
  { key: 'title', label: 'Summary', icon: '\u2261', why: 'A card without a title is not a card' },
  { key: 'key', label: 'Work item key', icon: '#', why: 'The key is what opens the card' },
  {
    key: 'blocked',
    label: 'Blocked warning',
    icon: '\u26a0',
    why: 'Hiding it invites work that cannot proceed',
  },
  {
    key: 'deps-unknown',
    label: 'Unknown blockers',
    icon: '?',
    why: 'Hiding it turns “cannot judge” into “fine”',
  },
];
