/**
 * The Calendar names each task's status, visibly, coloured by its kind
 * (LAI-739 review round 1).
 *
 * **Source assertions, and why.** The Calendar places tasks on demo due dates
 * (`demo/calendar.ts`), which a production build — the one the browser
 * harness serves — switches off, so no chip is drawn there to look at. What
 * can be pinned is that the chip prints the status's name, as the project
 * calls it, in an element that carries its kind, and that every kind has a
 * colour.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const read = (rel: string) =>
  readFile(new URL(`../../../../src/routes/screens/calendar/${rel}`, import.meta.url), 'utf8');

void describe('a calendar chip names its status', () => {
  void test('the name, as the project calls it now, in an element carrying its kind', async () => {
    const screen = await read('CalendarScreen.tsx');
    assert.match(
      screen,
      /<span className=\{`cal-task-status cal-status-\$\{task\.status\}`\}>\s*\{statusNameOf\(task, statuses\.byId\)\}\s*<\/span>/,
    );
  });

  void test('every kind but backlog has its own colour; backlog takes the muted default', async () => {
    const css = await read('calendar.css');
    assert.match(css, /\.cal-task-status\s*\{[^}]*color:\s*var\(--text-muted\)/);
    for (const [kind, token] of [
      ['todo', '--chip-purple'],
      ['in_progress', '--chip-blue'],
      ['review', '--chip-orange'],
    ] as const) {
      assert.match(
        css,
        new RegExp(`\\.cal-status-${kind}\\s*\\{[^}]*color:\\s*var\\(${token}\\)`),
        kind,
      );
    }
  });
});
