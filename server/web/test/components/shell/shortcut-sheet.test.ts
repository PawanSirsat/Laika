/**
 * What the app's keyboard-shortcuts sheet lists (LAI-1221): only the sidebar
 * destinations the reader can see, each with its Alt key, and every key My
 * day and the Review dialog actually bind — the sheet's copies are held to
 * the screens' own tables, so a key added there and not here goes red.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { navShortcutRows, shortcutGroups } from '../../../src/components/shell/shortcut-sheet.ts';
import { navRoutes } from '../../../src/routes/route-table.ts';
import { shortcutFor } from '../../../src/routes/screens/my-day/shortcuts.ts';
import { dialogCommand } from '../../../src/routes/screens/review/review-derive.ts';

void describe('the shortcuts sheet', () => {
  const sheet = shortcutGroups(() => true);
  const listed = (group: string): string[] =>
    (sheet.find((g) => g.name === group)?.rows ?? []).flatMap((r) => r.keys);

  void test('Go to lists only the destinations the reader can see, with their keys', () => {
    const member = navShortcutRows((p) => p !== 'audit_log.export');
    assert.deepEqual(
      member.map((r) => r.label),
      navRoutes((p) => p !== 'audit_log.export').map((r) => r.label),
    );
    assert.deepEqual(navShortcutRows(() => true)[1], { keys: ['Alt+2'], label: 'Inbox' });
  });

  void test('every letter My day binds is in the sheet', () => {
    const mine = listed('My day').map((k) => k.toLowerCase());
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const bound = shortcutFor({
        key: letter,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: null,
      });
      if (bound !== undefined) assert.ok(mine.includes(letter), `My day's ${letter} is missing`);
    }
  });

  void test('every letter the Review dialog binds is in the sheet', () => {
    const mine = listed('Reviewing a task').map((k) => k.toLowerCase());
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const bound = dialogCommand(
        { key: letter, metaKey: false, ctrlKey: false, altKey: false },
        false,
      );
      if (bound !== null) assert.ok(mine.includes(letter), `Review's ${letter} is missing`);
    }
  });
});

void describe('the zoom keys', () => {
  void test('My day’s −, + and = are all listed', () => {
    const rows = shortcutGroups(() => true).find((g) => g.name === 'My day')?.rows ?? [];
    const keys = rows.flatMap((r) => r.keys);
    for (const key of ['-', '+', '=']) {
      const bound = shortcutFor({
        key,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: null,
      });
      assert.ok(bound !== undefined, `My day no longer binds ${key}`);
      assert.ok(keys.includes(key), `${key} is missing from the sheet`);
    }
  });
});
