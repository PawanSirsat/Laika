/**
 * What kind of break a window is, from its name (LAI-894, D-105 item 4): a
 * manager types any label — *Lunch*, *Tea Break*, *Coffee*, *Stand-up* — and
 * the glyph beside it on the Organisation screen and on every Timeline follows
 * the word. Nothing is stored for it; the label is the whole of the truth, and
 * a word nobody listed gets the plain pause glyph.
 */

export type BreakKind = 'meal' | 'cup' | 'rest' | 'walk' | 'people' | 'pause';

const RULES: readonly (readonly [BreakKind, RegExp])[] = [
  ['meal', /\b(lunch|dinner|supper|breakfast|brunch|meal|food|eat|tiffin)\b/i],
  ['cup', /\b(tea|coffee|chai|snack|drink|caf[eé]|espresso|cuppa)\b/i],
  ['rest', /\b(rest|nap|siesta|sleep|quiet|recharge|downtime)\b/i],
  ['walk', /\b(walk|gym|exercise|stretch|run|yoga|workout|fitness)\b/i],
  ['people', /\b(stand-?up|meeting|sync|huddle|scrum|daily|check-?in|town ?hall)\b/i],
];

/** The glyph a window's label earns; `pause` when no listed word is in it. */
export function breakKind(label: string): BreakKind {
  for (const [kind, rule] of RULES) if (rule.test(label)) return kind;
  return 'pause';
}

/** What each glyph says, for a title. */
export const BREAK_KIND_NAMES: Readonly<Record<BreakKind, string>> = {
  meal: 'a meal',
  cup: 'tea or coffee',
  rest: 'a rest',
  walk: 'a walk or exercise',
  people: 'a stand-up or meeting',
  pause: 'a break',
};

export interface BreakPreset {
  readonly id: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly days: readonly number[];
}

const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The windows a manager adds in one click (D-105 item 5). Each is a starting
 * point — the label, the clock and the days stay theirs to change — and the
 * list is short on purpose: anything else is typed.
 */
export const BREAK_PRESETS: readonly BreakPreset[] = [
  { id: 'lunch', label: 'Lunch', start: '13:00', end: '14:00', days: WEEKDAYS },
  { id: 'tea', label: 'Tea break', start: '16:00', end: '16:15', days: WEEKDAYS },
  { id: 'coffee', label: 'Coffee break', start: '10:30', end: '10:45', days: WEEKDAYS },
  { id: 'standup', label: 'Stand-up', start: '09:30', end: '09:45', days: WEEKDAYS },
  { id: 'walk', label: 'Walk', start: '15:00', end: '15:20', days: WEEKDAYS },
  { id: 'rest', label: 'Rest', start: '14:00', end: '14:20', days: WEEKDAYS },
];
