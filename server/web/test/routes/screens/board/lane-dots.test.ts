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
import { MOVABLE_STATUSES, primaryStatus } from '../../../../src/api/board-derive.ts';
import type { BoardColumn } from '../../../../src/api/columns.ts';

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

  void test('every movable status is accounted for', () => {
    // If a sixth status is ever added, this fails rather than letting it render
    // with the default dot and look deliberate.
    const named = new Set(Object.keys(EXPECTED));
    const unhandled = MOVABLE_STATUSES.filter((c) => c !== 'backlog' && !named.has(c));
    assert.deepEqual(unhandled, [], 'these statuses have no colour mapping');
  });

  void test("a lane's dot comes from its primary status, never its name", () => {
    const column = (statuses: string[]): BoardColumn => ({
      id: 'c',
      project_id: 'p',
      name: 'Whatever it is called',
      position: 0,
      hidden: false,
      statuses: statuses as BoardColumn['statuses'],
      primary_status: (statuses[0] ?? null) as BoardColumn['primary_status'],
    });

    // Order is configuration, so these two differ — an implementation that
    // sorted by the canonical status order would return `todo` for both.
    assert.equal(primaryStatus(column(['todo', 'backlog'])), 'todo');
    assert.equal(primaryStatus(column(['backlog', 'todo'])), 'backlog');

    assert.equal(primaryStatus(column(['review'])), 'review');
    assert.equal(primaryStatus(column([])), undefined, 'an empty lane has no drop target');

    // The safety rail: a lane can hold `cancelled`, and dropping must never
    // resolve to it. An implementation taking `statuses[0]` fails here.
    assert.equal(primaryStatus(column(['cancelled', 'done'])), 'done');
    assert.equal(primaryStatus(column(['cancelled'])), undefined);
  });
});
