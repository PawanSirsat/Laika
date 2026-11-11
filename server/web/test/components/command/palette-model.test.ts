/**
 * The command palette's rules (LAI-1192): when ⌘K opens it, what each group
 * lists, how tasks are matched and opened, and what is said when the rows
 * change. The component only renders these answers; the browser half is
 * `test/browser/command-palette.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TaskSummary } from '../../../src/api/tasks.ts';
import {
  emptySuggestion,
  filterItems,
  goToItems,
  isPaletteShortcut,
  looksLikeKey,
  matchTasks,
  resultCountMessage,
  shortcutLabel,
  spaceHref,
  spaceItems,
  taskHref,
  typingIn,
  type PaletteKey,
} from '../../../src/components/command/palette-model.ts';
import { navRoutes, ROUTES, spaceTabs } from '../../../src/routes/route-table.ts';
import { SHORTCUT_GROUPS, shortcutFor } from '../../../src/routes/screens/my-day/shortcuts.ts';

const key = (k: string, mods: Partial<PaletteKey> = {}): PaletteKey => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

void describe('the ⌘K shortcut', () => {
  void test('opens on ⌘K and Ctrl+K, either case', () => {
    assert.equal(isPaletteShortcut(key('k', { metaKey: true })), true);
    assert.equal(isPaletteShortcut(key('k', { ctrlKey: true })), true);
    // Caps Lock, or Shift held with the modifier.
    assert.equal(isPaletteShortcut(key('K', { metaKey: true })), true);
  });

  void test('never on a bare letter, Alt, or both modifiers at once', () => {
    assert.equal(isPaletteShortcut(key('k')), false);
    assert.equal(isPaletteShortcut(key('K')), false);
    assert.equal(isPaletteShortcut(key('k', { altKey: true, metaKey: true })), false);
    assert.equal(isPaletteShortcut(key('k', { metaKey: true, ctrlKey: true })), false);
    assert.equal(isPaletteShortcut(key('j', { metaKey: true })), false);
  });

  /**
   * Every key on My day's sheet (`SHORTCUT_GROUPS`), as My day reads it, and
   * the space bar's `/` (SpaceTopBar). The sheet is read, not copied, so a key
   * added to it is checked here without anybody remembering to.
   */
  const GLYPHS: Readonly<Record<string, readonly string[]>> = {
    '↵': ['Enter'],
    '←': ['ArrowLeft'],
    '→': ['ArrowRight'],
    Esc: ['Escape'],
  };
  const sheetKeys = [
    ...new Set(
      SHORTCUT_GROUPS.flatMap((g) => g.rows.map(([keys]) => keys))
        .flatMap((keys) => keys.split(' '))
        .filter((token) => /^(?:[A-Z?]|↵|←|→|Esc)$/.test(token))
        .flatMap((token) => GLYPHS[token] ?? [token, token.toLowerCase()]),
    ),
    '/',
  ];

  void test('reads the sheet: its letters, ?, Enter, Escape and the arrows', () => {
    for (const expected of ['n', 'T', 'j', 'K', 'g', 'X', '?', 'Enter', 'Escape', 'ArrowLeft']) {
      assert.ok(sheetKeys.includes(expected), `${expected} was not read from SHORTCUT_GROUPS`);
    }
  });

  void test("collides with none of My day's keys, bare or with Shift", () => {
    for (const k of sheetKeys) {
      assert.equal(isPaletteShortcut(key(k)), false, `${k} would open the palette`);
    }
  });

  void test('is not one of My day’s shortcuts either way round', () => {
    for (const mods of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = { ...key('k', mods), target: null };
      assert.equal(isPaletteShortcut(event), true);
      assert.equal(shortcutFor(event), undefined, 'My day would also act on ⌘K');
    }
  });

  void test('prints ⌘K on a Mac and Ctrl K elsewhere', () => {
    assert.equal(shortcutLabel(true), '⌘K');
    assert.equal(shortcutLabel(false), 'Ctrl K');
  });
});

void describe('where the shortcut does not fire', () => {
  void test('in text inputs, textareas, selects and rich editors', () => {
    assert.equal(typingIn({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(typingIn({ tagName: 'INPUT' }), true);
    assert.equal(typingIn({ tagName: 'input', type: 'search' }), true);
    assert.equal(typingIn({ tagName: 'TEXTAREA' }), true);
    assert.equal(typingIn({ tagName: 'SELECT' }), true);
    assert.equal(typingIn({ tagName: 'DIV', isContentEditable: true }), true);
  });

  void test('but does on buttons, checkboxes and the page', () => {
    assert.equal(typingIn({ tagName: 'BUTTON' }), false);
    assert.equal(typingIn({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(typingIn({ tagName: 'BODY' }), false);
    assert.equal(typingIn(null), false);
  });
});

void describe('Go to', () => {
  const everything = (): boolean => true;
  const nothing = (): boolean => false;

  void test('is exactly the sidebar’s entries, then the space tabs, for the same reader', () => {
    for (const holds of [everything, nothing]) {
      const ids = goToItems(holds, undefined, undefined).map((i) => i.href);
      const expected = [...navRoutes(holds), ...spaceTabs(holds)].map((r) => r.path);
      assert.deepEqual(ids, expected);
    }
  });

  /**
   * A property over the table, not a named page: the proposal's example was
   * Dashboard behind `audit_log.export`, and the table no longer gates it.
   * Whatever route does carry a `requires`, a reader who lacks it is not
   * offered it.
   */
  void test('a route that requires a permission is absent for a reader without it', () => {
    const gated = ROUTES.filter((r) => r.requires !== undefined);
    for (const route of gated) {
      const refuses = (p: string): boolean => p !== route.requires;
      const hrefs = goToItems(refuses, undefined, undefined).map((i) => i.href);
      assert.ok(!hrefs.includes(route.path), `${route.path} offered without ${route.requires}`);
    }
  });

  void test('before the server has answered, every gated entry is hidden', () => {
    assert.deepEqual(
      goToItems(undefined, undefined, undefined).map((i) => i.id),
      goToItems(nothing, undefined, undefined).map((i) => i.id),
    );
  });

  void test('space views carry the space, org pages do not', () => {
    const items = goToItems(everything, 'laika-core', 'Laika Core');
    const board = items.find((i) => i.id === 'go:/board');
    const org = items.find((i) => i.id === 'go:/organisation');
    assert.equal(board?.href, '/board?project=laika-core');
    assert.equal(board?.hint, 'Laika Core');
    assert.equal(org?.href, '/organisation');
  });
});

void describe('Spaces', () => {
  const spaces = [
    { id: '01A', slug: 'laika-core', name: 'Laika Core', key: 'LC' },
    { id: '01B', slug: 'laika-web', name: 'Laika Web', key: 'LW' },
  ];

  void test('lists every other space, keeping the view when on a space tab', () => {
    const rows = spaceItems(spaces, 'laika-core', '/list');
    assert.deepEqual(
      rows.map((r) => [r.label, r.href]),
      [['Laika Web', '/list?project=laika-web']],
    );
  });

  void test('off a space tab, switching opens the board', () => {
    assert.equal(spaceHref('laika-web', '/my-day'), '/board?project=laika-web');
    assert.equal(spaceHref('laika-web', '/board'), '/board?project=laika-web');
  });

  void test('a query matches name, key or slug', () => {
    const rows = spaceItems(spaces, undefined, '/board');
    assert.deepEqual(
      filterItems(rows, 'lw').map((r) => r.label),
      ['Laika Web'],
    );
    assert.deepEqual(
      filterItems(rows, 'core').map((r) => r.label),
      ['Laika Core'],
    );
    assert.deepEqual(
      filterItems(rows, 'laika web').map((r) => r.label),
      ['Laika Web'],
    );
    assert.deepEqual(filterItems(rows, 'zzz'), []);
  });
});

const task = (over: Partial<TaskSummary>): TaskSummary =>
  ({
    id: 't',
    key: 'LC-1',
    title: 'A task',
    project_id: '01A',
    status: 'todo',
    status_name: 'To do',
    external_ref: null,
    ...over,
  }) as TaskSummary;

void describe('Tasks', () => {
  const tasks = [
    task({ id: 'a', key: 'LC-12', title: 'Fix the login page' }),
    task({ id: 'b', key: 'LC-120', title: 'Palette shortcut' }),
    task({ id: 'c', key: 'LC-1', title: 'Board drag and drop', external_ref: 'LAI-1192' }),
    task({ id: 'd', key: 'LW-3', title: 'Login rate limit' }),
  ];

  void test('an exact key comes first, then keys starting with it', () => {
    assert.deepEqual(
      matchTasks(tasks, 'lc-12').map((t) => t.id),
      ['a', 'b'],
    );
  });

  void test('titles match every word, in any order', () => {
    assert.deepEqual(
      matchTasks(tasks, 'login').map((t) => t.id),
      ['a', 'd'],
    );
    assert.deepEqual(
      matchTasks(tasks, 'page login').map((t) => t.id),
      ['a'],
    );
  });

  void test('an outside id finds its card exactly', () => {
    assert.deepEqual(
      matchTasks(tasks, 'LAI-1192').map((t) => t.id),
      ['c'],
    );
  });

  void test('nothing under two characters, and the cap holds', () => {
    assert.deepEqual(matchTasks(tasks, 'l'), []);
    assert.equal(matchTasks(tasks, 'lc', 2).length, 2);
  });

  void test('opens in its own space by id, or by key search when the space is unknown', () => {
    const spaces = [{ id: '01A', slug: 'laika-core' }];
    assert.equal(taskHref(tasks[0]!, spaces), '/board?project=laika-core&task=a');
    assert.equal(taskHref({ id: 'z', key: 'XX-9', project_id: '09Z' }, spaces), '/board?q=XX-9');
  });
});

void describe('what is said, and the empty state', () => {
  void test('the count, singular and plural, and the empty case', () => {
    assert.equal(resultCountMessage(9, ''), '9 commands available');
    assert.equal(resultCountMessage(1, 'board'), '1 result for board');
    assert.equal(resultCountMessage(3, ' log '), '3 results for log');
    assert.equal(resultCountMessage(0, 'zzz'), 'No results for zzz');
  });

  void test('a key-shaped query is told how keys look', () => {
    assert.equal(looksLikeKey('LAI-42'), true);
    assert.equal(looksLikeKey('lai-'), true);
    assert.equal(looksLikeKey('login page'), false);
    assert.match(emptySuggestion('LAI-9'), /LAI-42/);
    assert.match(emptySuggestion('qwerty'), /page, a space or a task title/);
  });
});
