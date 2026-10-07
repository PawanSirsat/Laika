/**
 * `use-board.ts` has one writer for the board's state (LAI-707).
 *
 * A refresh now leaves the board on screen, so a refresh answer and a local
 * write can race — and the loser must not be drawn. That only holds if every
 * write goes through `commit`, which applies the pending-write and
 * write-after-read rules. A second `setState` would be a door around them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SOURCE = code(
  readFileSync(fileURLToPath(new URL('../../src/api/use-board.ts', import.meta.url)), 'utf8'),
);

void describe('use-board has one state writer (LAI-707)', () => {
  void test('exactly one setState( in the file', () => {
    const calls = SOURCE.match(/\bsetState\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      `found ${String(calls.length)} — every write must go through commit()`,
    );
  });

  void test('move() writes the board through commit', () => {
    const body = /const move = useCallback\([\s\S]*?\n {2}\}, \[/.exec(SOURCE)?.[0] ?? '';
    assert.ok(body.length > 0, 'move() not found — the scan is blind');
    assert.match(body, /\bcommit\(/);
  });

  void test('the fetch effect still depends on exactly [slug, filterKey, attempt]', () => {
    assert.match(SOURCE, /\}, \[slug, filterKey, attempt\]\);/);
  });
});
