/**
 * Column status dots (LAI-067).
 *
 * The mapping is five lines of CSS and nothing else refers to it, so a rename or
 * a copy-paste would move a colour without failing anything — and a wrong dot is
 * not obviously wrong, it just quietly says a column means something else.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { BOARD_COLUMNS } from '../../../../src/api/board-derive.ts';

const EXPECTED: Readonly<Record<string, string>> = {
  // Backlog takes the default `--tx3`; the rest are named explicitly.
  todo: '--pur',
  in_progress: '--acc',
  review: '--amb',
  done: '--grn',
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
    assert.match(sheet, /\.lane-dot\s*\{[^}]*background:\s*var\(--tx3\)/);
  });

  void test('every board column is accounted for', () => {
    // If a sixth column is ever added, this fails rather than letting it render
    // with the default dot and look deliberate.
    const named = new Set(Object.keys(EXPECTED));
    const unhandled = BOARD_COLUMNS.filter((c) => c !== 'backlog' && !named.has(c));
    assert.deepEqual(unhandled, [], 'these columns have no colour mapping');
  });
});
