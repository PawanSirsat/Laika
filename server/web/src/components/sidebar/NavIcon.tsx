import type { NavIconName } from '../../routes/route-table.ts';

export type IconName =
  NavIconName | 'rail-close' | 'rail-open' | 'spaces-more' | 'plus' | 'chevron';

/**
 * The sidebar's glyphs (LAI-796): one per entry, for the rail the owner asked
 * the sidebar to collapse to, and beside each label when it is open. Drawn
 * here, on a 24px grid in the stroke weight the rest of the app's icons use
 * (the space bar's, the board toolbar's), so they read as one family — and
 * no icon package, which no task names (CLAUDE.md §5).
 *
 * Decoration beside a label that is always present for assistive tech, so
 * every one is `aria-hidden`.
 */
const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  // A calendar page with a tick: the reader's own day.
  day: [
    'M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M8 3v4M16 3v4M3.5 10h17',
    'm8.75 14.75 2.25 2.25 4.5-4.5',
  ],
  // A tray: things arrive here and wait.
  inbox: [
    'M3.5 13 6 5.8A2 2 0 0 1 7.9 4.5h8.2A2 2 0 0 1 18 5.8l2.5 7.2v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
    'M3.5 13h5l1.5 2.5h4L15.5 13h5',
  ],
  // Bars over a baseline: what the numbers say.
  insights: ['M4 20h16', 'M7 16.5V11M12 16.5V6.5M17 16.5v-3.5'],
  // A building: the organisation.
  organisation: [
    'M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v15.5',
    'M15 9.5h2.5A1.5 1.5 0 0 1 19 11v9.5',
    'M3.5 20.5h17',
    'M8.5 7.5h3M8.5 11h3M8.5 14.5h3',
  ],
  // A key: tokens and the agents that hold them.
  developer: [
    'M8 11.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M10.9 12.6 19.5 4',
    'm16 7.5 2.5 2.5M13.5 10l2 2',
  ],
  // The panel, closing and opening.
  'rail-close': [
    'M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    'M9 4.5v15',
    'm15.5 10-2 2 2 2',
  ],
  'rail-open': [
    'M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    'M9 4.5v15',
    'm13.5 10 2 2-2 2',
  ],
  // Four squares: every space.
  'spaces-more': [
    'M5 4.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM15 4.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM5 14.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5zM15 14.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5z',
  ],
  plus: ['M12 5v14M5 12h14'],
  chevron: ['m9 6 6 6-6 6'],
};

export interface NavIconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}

export function NavIcon({ name, size = 18, className }: NavIconProps) {
  return (
    <svg
      className={className === undefined ? 'nav-icon' : `nav-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
