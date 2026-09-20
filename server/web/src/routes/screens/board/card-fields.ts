/**
 * Which parts of a card the board draws (LAI-266).
 *
 * ## Four fields are not here, and their absence is the design
 *
 * The panel lists nine toggles and says in one sentence why the rest always
 * show. It does **not** render them greyed out — a disabled checkbox invites a
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
 * ## One prop, not nine booleans
 *
 * `TaskCard` takes this whole record. A tenth field then changes this file and
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
  readonly stale: boolean;
  readonly comments: boolean;
  readonly deps: boolean;
  readonly age: boolean;
  /** The avatar, and the agent badge that sits on its corner. */
  readonly assignee: boolean;
}

/** Everything on, so a board with no stored preference looks exactly as before. */
export const ALL_FIELDS: CardFields = Object.freeze({
  tags: true,
  priority: true,
  sprint: true,
  ready: true,
  stale: true,
  comments: true,
  deps: true,
  age: true,
  assignee: true,
});

/** The panel's rows, in the order it lists them. */
export const FIELD_LABELS: Readonly<Record<keyof CardFields, string>> = {
  tags: 'Tags',
  priority: 'Priority',
  sprint: 'Sprint',
  ready: 'Ready marker',
  stale: 'Stale marker',
  comments: 'Comment count',
  deps: 'Dependency count',
  age: 'Last updated',
  assignee: 'Assignee',
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
  stale: '\u25f4',
  comments: '\u25a1',
  deps: '\u26ad',
  age: '\u25f4',
  assignee: '\u25cb',
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
