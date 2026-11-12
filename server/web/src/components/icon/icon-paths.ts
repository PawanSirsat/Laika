import type { NavIconName } from '../../routes/route-table.ts';

/**
 * Every icon's path data, in one registry (LAI-1204).
 *
 * Drawn on a 24px grid, stroked in `currentColor`, round caps and joins —
 * the family the sidebar started (LAI-796). **No icon package**: none is named
 * by a task (CLAUDE.md §5), and a registry this small does not need one.
 *
 * Brand marks are not here and never will be: a vendor's logo is not an icon,
 * and it lives in `components/agent-mark/` with its own NOTICE.
 */
export type IconName =
  | NavIconName
  | 'rail-close'
  | 'rail-open'
  | 'spaces-more'
  | 'plus'
  | 'chevron'
  | 'search'
  | 'rows'
  | 'gear'
  | 'check'
  | 'close'
  | 'moon'
  | 'sun'
  | 'sign-out'
  | 'trash'
  | 'alert'
  | 'chevron-left'
  | 'download';

/** The stroke every icon is drawn in. One number, so the family stays one weight. */
export const ICON_STROKE = 1.9;

export const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
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
  // The Spaces page's toolbar and card footer (LAI-978): a magnifier, rows
  // for the list view beside the four squares of the grid, and settings.
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'm15.5 15.5 4.5 4.5'],
  rows: ['M4.5 6.5h15M4.5 12h15M4.5 17.5h15'],
  gear: [
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
  // LAI-1204: the glyphs the migrated controls drew as characters (☾ ☀ ✓ × ✕).
  // An emoji or a typed symbol is a different weight in every font; these are
  // drawn on the same grid and stroke as everything above.
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  moon: ['M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  ],
  'sign-out': [
    'M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3',
    'M10 16.5 5.5 12 10 7.5',
    'M5.5 12h10',
  ],
  trash: [
    'M4.5 7h15',
    'M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2',
    'M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12',
  ],
  alert: ['M12 4 2.8 19.5h18.4z', 'M12 10v4.5', 'M12 17.25v.01'],
  'chevron-left': ['m15 6-6 6 6 6'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
};
