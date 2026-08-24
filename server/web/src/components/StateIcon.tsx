/**
 * The small inline glyphs the state components use.
 *
 * Hand-written SVG rather than an icon package: five glyphs do not justify a
 * dependency, and CLAUDE.md §5 forbids one no task named. `aria-hidden` on all
 * of them — the headline already says what the state is, so announcing the icon
 * would repeat it.
 */

export type StateIconName = 'empty' | 'error' | 'forbidden';

const PATHS: Record<StateIconName, string> = {
  // Empty tray.
  empty: 'M3 13h4l1 3h8l1-3h4M5 5h14l2 8v6H3v-6z',
  // Alert triangle.
  error: 'M12 4l9 16H3l9-16zm0 6v4m0 3h.01',
  // Padlock.
  forbidden: 'M6 11V8a6 6 0 1112 0v3M5 11h14v9H5z',
};

export function StateIcon({ name }: { readonly name: StateIconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d={PATHS[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
