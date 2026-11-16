import { navRoutes } from '../../routes/route-table.ts';
import { navShortcut } from './nav-shortcuts.ts';

/**
 * What the app's keyboard-shortcuts sheet lists (LAI-1221), kept apart from
 * the sheet so `node --test` can hold it to the keys the app actually binds.
 *
 * Each key is written in `tooltip/shortcut.ts`'s spelling (`Mod+K`, `Alt+1`,
 * `Escape`) and drawn the way the reader's keyboard is labelled. A row with
 * two keys means either.
 *
 * The screens' own keys are listed here as well as on their screens, so one
 * sheet answers *what can I press?* anywhere. They are copies, and copies
 * drift: `shortcut-sheet.test.ts` reads My day's and the Review dialog's own
 * tables and fails when a key there is missing here.
 */
export interface ShortcutRow {
  readonly keys: readonly string[];
  readonly label: string;
}

export interface ShortcutGroup {
  readonly name: string;
  readonly rows: readonly ShortcutRow[];
}

/** The sidebar's destinations the reader can see, each with its Alt key. */
export function navShortcutRows(holds: (permission: string) => boolean): readonly ShortcutRow[] {
  return navRoutes(holds).flatMap((route) => {
    const keys = navShortcut(route.path);
    return keys === undefined ? [] : [{ keys: [keys], label: route.label }];
  });
}

export function shortcutGroups(holds: (permission: string) => boolean): readonly ShortcutGroup[] {
  return [
    {
      name: 'Anywhere',
      rows: [
        { keys: ['Mod+K'], label: 'Search and commands' },
        { keys: ['/'], label: 'Search, where the page has no search field of its own' },
        { keys: ['?'], label: 'This sheet (on My day, My day’s own keys)' },
        { keys: ['Escape'], label: 'Close a dialog, menu or panel' },
      ],
    },
    { name: 'Go to', rows: navShortcutRows(holds) },
    {
      name: 'In a space',
      rows: [
        { keys: ['C'], label: 'Create task, where you may create one' },
        { keys: ['/'], label: 'Search this space' },
        { keys: ['.'], label: 'Focus mode, on a task’s own page' },
      ],
    },
    {
      name: 'Reviewing a task',
      rows: [
        { keys: ['J', 'K'], label: 'Next or previous task' },
        { keys: ['A'], label: 'Accept' },
        { keys: ['S'], label: 'Send back' },
      ],
    },
    {
      name: 'My day',
      rows: [
        { keys: ['N'], label: 'Add time' },
        { keys: ['T'], label: 'Start or stop the timer' },
        { keys: ['J', 'K'], label: 'Next or previous to review' },
        { keys: ['Enter'], label: 'Confirm the selected entry' },
        { keys: ['G'], label: 'Set the selected entry’s task to General' },
        { keys: ['X'], label: 'Mark the selected entry as not work time' },
        { keys: ['D', 'W', 'M', 'Y'], label: 'Day, week, month or year' },
        { keys: ['-', '+', '='], label: 'Zoom out or in' },
        { keys: ['ArrowLeft', 'ArrowRight'], label: 'Move between blocks, or periods' },
      ],
    },
  ].filter((group) => group.rows.length > 0);
}
