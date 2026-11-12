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
  | 'download'
  | 'info'
  | 'more'
  | 'status'
  | 'flag'
  | 'person'
  | 'agent'
  | 'sprint'
  | 'calendar'
  | 'parent'
  | 'eye'
  | 'share'
  | 'expand'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'pencil'
  | 'clock'
  | 'doc'
  | 'checklist'
  | 'link'
  | 'estimate'
  | 'activity'
  | 'subtasks'
  | 'blocked'
  | 'proof'
  | 'tokens'
  | 'focus'
  | 'chevron-down'
  | 'reply'
  | 'swap'
  | 'play'
  | 'dot'
  | 'tag'
  | 'hash'
  | 'question';

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
  // LAI-1209: the dialogs. An (i) for the info hints, three dots for an
  // overflow menu, and the small leading marks on the Create task labels —
  // a ring for status, a flag for priority, a person, an agent, a loop for the
  // sprint, a calendar page for the due date.
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 11v5', 'M12 7.75v.01'],
  more: [
    'M6 10.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z',
    'M12 10.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z',
    'M18 10.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z',
  ],
  status: ['M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  flag: ['M5.5 20.5v-16', 'M5.5 4.5h11l-2.5 4 2.5 4h-11'],
  person: ['M12 4a3.75 3.75 0 1 0 0 7.5A3.75 3.75 0 0 0 12 4z', 'M5 20a7 7 0 0 1 14 0'],
  agent: [
    'M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
    'M12 4.5V8',
    'M9.5 13h.01M14.5 13h.01',
  ],
  sprint: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5V8H16'],
  calendar: [
    'M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M8 3v4M16 3v4M3.5 10h17',
    'M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01',
  ],
  // LAI-1213: the space views and the task. A corner arrow for "subtask of",
  // an eye for watching, the share graph for copying a link, the two corners
  // of expand-to-page, plain arrows for sort order and "goes to", a pencil for
  // an edit, and the task's section marks — a clock, a
  // page, a checklist, a chain link, a gauge, a pulse line, nested rows, a
  // barred circle, a seal, a coin stack and a focus frame.
  parent: ['M6 4.5V12a4 4 0 0 0 4 4h8.5', 'm15 12.5 3.5 3.5-3.5 3.5'],
  eye: [
    'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  ],
  share: [
    'M18 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'M6 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'M18 16.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6',
  ],
  expand: ['M14 4h6v6M10 20H4v-6', 'M20 4l-7 7M4 20l7-7'],
  'arrow-up': ['M12 19V5', 'm6 11 6-6 6 6'],
  'arrow-down': ['M12 5v14', 'm6 13 6 6 6-6'],
  'arrow-right': ['M5 12h14', 'm13 6 6 6-6 6'],
  pencil: ['M4.5 19.5 5.5 15 15.5 5a2.1 2.1 0 0 1 3 3l-10 10z', 'M13.5 7l3 3'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 2'],
  doc: [
    'M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z',
    'M13.5 3.5V8.5h5',
    'M8.5 13h7M8.5 16.5h5',
  ],
  checklist: ['m4 6.5 1.5 1.5 3-3', 'm4 13.5 1.5 1.5 3-3', 'M11.5 7h8.5M11.5 14h8.5M11.5 19h8.5'],
  link: [
    'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1',
    'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  ],
  estimate: ['M4 16a8 8 0 1 1 16 0', 'M12 16l3.5-4.5', 'M4 19.5h16'],
  activity: ['M3.5 12h4l2.5-6 4 12 2.5-6h4'],
  subtasks: ['M5 5h9', 'M9 12h10', 'M9 19h10', 'M5 5v14M5 12h2M5 19h2'],
  blocked: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M6 6l12 12'],
  proof: ['M12 3 19 6v5.5c0 4.2-3 7.7-7 9.5-4-1.8-7-5.3-7-9.5V6z', 'm8.75 12 2.25 2.25 4.25-4.5'],
  tokens: [
    'M12 4c4.14 0 7.5 1.34 7.5 3s-3.36 3-7.5 3-7.5-1.34-7.5-3 3.36-3 7.5-3z',
    'M4.5 7v5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V7',
    'M4.5 12v5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-5',
  ],
  focus: ['M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5'],
  'chevron-down': ['m6 9 6 6 6-6'],
  // The task feed's marks (LAI-1213), which were typed characters: sent back,
  // a work request handed across, started, and anything else.
  reply: ['M9.5 14.5 4.5 9.5l5-5', 'M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-2'],
  swap: ['M4 8h14', 'm14.5 4.5 3.5 3.5-3.5 3.5', 'M20 16H6', 'm9.5 12.5-3.5 3.5 3.5 3.5'],
  play: ['M8 5.5v13l10.5-6.5z'],
  dot: ['M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z'],
  // View settings' field marks (LAI-1213): a tag, the key's hash, a question.
  tag: ['M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z', 'M8 8h.01'],
  hash: ['M9.5 4 8 20M16 4l-1.5 16', 'M4.5 9h15M4 15h15'],
  question: [
    'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z',
    'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6',
    'M12 17h.01',
  ],
};
