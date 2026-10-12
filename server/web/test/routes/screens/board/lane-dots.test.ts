/**
 * Lane status dots (LAI-067, LAI-266).
 *
 * The mapping is five lines of CSS and nothing else refers to it, so a rename or
 * a copy-paste would move a colour without failing anything — and a wrong dot is
 * not obviously wrong, it just quietly says a lane means something else.
 *
 * **This was never about board columns**, though its last test said so: the
 * property is *no status renders with the default dot and looks deliberate*.
 * Columns are configuration now, so the sweep is over statuses — which is what
 * it was always checking.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { STATUS_CATEGORIES } from '../../../../src/api/statuses.ts';

const EXPECTED: Readonly<Record<string, string>> = {
  /*
   * Backlog takes the default `--text-muted`; the rest are named explicitly.
   *
   * **In-progress is `--chip-blue`, never `--accent`** (LAI-606). The prototype
   * coloured in-progress with its accent, which was blue; ours is purple, so
   * the status keeps the *blue* and the accent keeps meaning "this one". Todo
   * is `--chip-purple` — the same hue as the accent by design, but its own
   * token, so an accent edit can never silently recolour a status.
   */
  todo: '--chip-purple',
  in_progress: '--chip-blue',
  review: '--chip-orange',
  done: '--chip-green',
  // A hidden-by-default kind, but a column a person can show (LAI-739): its
  // dot is the dropdown's cancelled grey, not the backlog default.
  cancelled: '--border-default',
};

async function css(): Promise<string> {
  return readFile(
    new URL('../../../../src/routes/screens/board/board.css', import.meta.url),
    'utf8',
  );
}

void describe('every column carries the right status colour', () => {
  void test('each named lane maps to its token', async () => {
    const sheet = await css();
    const wrong: string[] = [];

    for (const [column, token] of Object.entries(EXPECTED)) {
      const rule = new RegExp(`\\.lane-dot-${column}\\s*\\{[^}]*background:\\s*var\\(${token}\\)`);
      if (!rule.test(sheet)) wrong.push(`${column} should be var(${token})`);
    }
    assert.deepEqual(wrong, [], 'a wrong dot silently says a column means something else');
  });

  void test('backlog falls through to the muted default', async () => {
    const sheet = await css();
    // Deliberately has no rule of its own — `.lane-dot` is `--tx3`.
    assert.ok(!/\.lane-dot-backlog\s*\{/.test(sheet), 'backlog should use the base rule');
    assert.match(sheet, /\.lane-dot\s*\{[^}]*background:\s*var\(--text-muted\)/);
  });

  void test('every kind of status is accounted for', () => {
    // If a seventh kind is ever added, this fails rather than letting it render
    // with the default dot and look deliberate.
    const named = new Set(Object.keys(EXPECTED));
    const unhandled = STATUS_CATEGORIES.filter((c) => c !== 'backlog' && !named.has(c));
    assert.deepEqual(unhandled, [], 'these kinds have no colour mapping');
  });

  void test("a lane's dot comes from its kind, never its name (LAI-739)", async () => {
    // One column is one status: the colour is the status's category, so two
    // review columns called QA and Code review are both orange, and renaming
    // a column can never recolour it.
    const lane = await readFile(
      new URL('../../../../src/routes/screens/board/LaneRow.tsx', import.meta.url),
      'utf8',
    );
    assert.match(lane, /const dot = column\.category;/);
    assert.match(lane, /lane-dot lane-dot-\$\{dot\}/);
    assert.doesNotMatch(lane, /lane-dot-\$\{column\.name/);
  });
});
