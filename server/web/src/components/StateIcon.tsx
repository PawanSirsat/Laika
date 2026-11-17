/**
 * The small inline glyphs the state components use.
 *
 * Hand-written SVG rather than an icon package: five glyphs do not justify a
 * dependency, and CLAUDE.md §5 forbids one no task named. `aria-hidden` on all
 * of them — the headline already says what the state is, so announcing the icon
 * would repeat it.
 */

export type StateIconName =
  | 'empty'
  | 'error'
  | 'forbidden'
  // LAI-1207: the empty-state variants' glyphs, drawn on the same 24px grid
  // with the same 1.6 stroke so the family reads as one set.
  | 'start'
  | 'filter'
  | 'done'
  | 'offline';

const PATHS: Record<StateIconName, string> = {
  // Empty tray.
  empty: 'M3 13h4l1 3h8l1-3h4M5 5h14l2 8v6H3v-6z',
  // Alert triangle.
  error: 'M12 4l9 16H3l9-16zm0 6v4m0 3h.01',
  // Padlock.
  forbidden: 'M6 11V8a6 6 0 1112 0v3M5 11h14v9H5z',
  // A plus in a rounded square: somewhere to make the first one.
  start: 'M12 8v8m-4-4h8M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z',
  // A funnel: a filter is what emptied this.
  filter: 'M4 5h16l-6 7.5V19l-4-2v-4.5z',
  // A check in a circle: nothing left, and that is the good outcome.
  done: 'M8 12.5l2.5 2.5L16 9.5M12 21a9 9 0 110-18 9 9 0 010 18z',
  // A cloud with a gap: the instance did not answer.
  offline: 'M3 3l18 18M8.5 7.2A5 5 0 0116.9 10H17a4 4 0 012.3 7.3M17 18H7a4 4 0 01-.9-7.9',
};

export function StateIcon({ name }: { readonly name: StateIconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={PATHS[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
