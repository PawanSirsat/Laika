import { ALL_FIELDS, FIELD_KEYS, type CardFields } from './card-fields.ts';

/**
 * How this reader likes the board drawn (LAI-266).
 *
 * ## What is here and what is not
 *
 * These three are about **this person's eyes**: which fields a card shows, how
 * dense it is, how wide the lanes are. A link carrying "and also hide the age
 * field" would impose one reader's preferences on whoever opened it.
 *
 * **Filter and Group are deliberately elsewhere** — in the URL, beside
 * `?priority`, `?assignee`, `?tag` and `?q`, because a filtered board is a thing
 * you send someone.
 *
 * **Hide-done-after is deliberately elsewhere too**, on the project. It does not
 * change how work looks, it removes work from the board — so as a personal
 * setting it would have two people on "the same board" disagreeing about
 * whether a task exists. That is D-060's *"an order only its arranger can see is
 * a private opinion wearing the board's clothes"* pointed at visibility.
 *
 * ## One key holding every project
 *
 * `use-theme.ts`'s cross-tab listener fires per changed storage key, so one key
 * means one listener; a key per slug would mean prefix-matching or no cross-tab
 * sync at all. `routes/spaces.ts` already demonstrates the single JSON-valued
 * key. The object grows with projects, so it is trimmed — see `writePreferences`.
 */

export const STORAGE_KEY = 'laika.board-view';

export type Density = 'standard' | 'compact';
export type ColumnWidth = 'narrow' | 'standard' | 'wide';

export interface ViewPreferences {
  readonly fields: CardFields;
  readonly density: Density;
  readonly columnWidth: ColumnWidth;
  /**
   * Swimlane keys this reader has collapsed (LAI-290).
   *
   * Personal, like the rest of this record — one person folding away a
   * colleague's row should not fold it away for everyone. Keys are the
   * grouping value (a user id, a priority, `''` for Unassigned), so they stay
   * meaningful when the grouping changes back.
   */
  readonly collapsedGroups: readonly string[];
}

export const DEFAULT_PREFERENCES: ViewPreferences = Object.freeze({
  fields: ALL_FIELDS,
  density: 'standard',
  columnWidth: 'standard',
  collapsedGroups: Object.freeze([]),
});

/** How many projects' preferences to keep. Same shape as `promote()` in `spaces.ts`. */
const SLUG_LIMIT = 20;

const DENSITIES: readonly string[] = ['standard', 'compact'];
const WIDTHS: readonly string[] = ['narrow', 'standard', 'wide'];

/**
 * Merge whatever was stored over the defaults, **field by field**.
 *
 * Not a shape check that accepts or rejects the whole object. Two things follow
 * from that, and both matter more than they look:
 *
 *  - a stored `fields: { tags: "yes" }` degrades *one* field to its default
 *    rather than poisoning the rest;
 *  - adding a tenth card field is a non-event, because every reader who has
 *    saved a preference simply gets the new field's default.
 */
function normalise(value: unknown): ViewPreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES;

  const raw = value as Record<string, unknown>;
  const storedFields =
    typeof raw.fields === 'object' && raw.fields !== null
      ? (raw.fields as Record<string, unknown>)
      : {};

  const fields = { ...ALL_FIELDS } as Record<string, boolean>;
  for (const key of FIELD_KEYS) {
    const stored = storedFields[key];
    if (typeof stored === 'boolean') fields[key] = stored;
  }

  const density = raw.density;
  const columnWidth = raw.columnWidth;
  // Anything that is not an array of strings degrades to "nothing collapsed",
  // the same field-by-field posture as the rest of this function.
  const collapsed = Array.isArray(raw.collapsedGroups)
    ? (raw.collapsedGroups as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];

  return {
    fields: fields as unknown as CardFields,
    density:
      typeof density === 'string' && DENSITIES.includes(density)
        ? (density as Density)
        : DEFAULT_PREFERENCES.density,
    columnWidth:
      typeof columnWidth === 'string' && WIDTHS.includes(columnWidth)
        ? (columnWidth as ColumnWidth)
        : DEFAULT_PREFERENCES.columnWidth,
    collapsedGroups: collapsed,
  };
}

export function isDefault(preferences: ViewPreferences): boolean {
  return (
    preferences.density === DEFAULT_PREFERENCES.density &&
    preferences.columnWidth === DEFAULT_PREFERENCES.columnWidth &&
    preferences.collapsedGroups.length === 0 &&
    FIELD_KEYS.every((key) => preferences.fields[key])
  );
}

function readAll(storage: Pick<Storage, 'getItem'>): Record<string, unknown> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return {};

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch {
    // Storage throws outright in Safari's private mode, and malformed JSON is
    // one bad write away. A display preference must never be the reason the
    // board fails to render.
    return {};
  }
}

export function readPreferences(
  slug: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
): ViewPreferences {
  return normalise(readAll(storage)[slug]);
}

/**
 * Save, or **remove** when the value is the default.
 *
 * Copied from `theme.ts`'s `writePreference` and for its stated reason: *"so a
 * future change to the default reaches users who never made an explicit
 * choice."* It matters more here than for theme, because card fields will keep
 * being added — somebody who once toggled a setting and reset it should not be
 * frozen at the snapshot of defaults that existed that day.
 */
export function writePreferences(
  slug: string,
  preferences: ViewPreferences,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
): void {
  try {
    const all = readAll(storage);

    if (isDefault(preferences)) {
      delete all[slug];
    } else {
      all[slug] = preferences;
    }

    const slugs = Object.keys(all);
    if (slugs.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }

    // Keep the most recently written, so the key cannot grow without bound as
    // somebody visits more projects.
    const kept = slugs.slice(-SLUG_LIMIT);
    const trimmed: Record<string, unknown> = {};
    for (const key of kept) trimmed[key] = all[key];

    storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota, or private mode. Losing a preference is survivable; throwing here
    // would take the board down with it.
  }
}
