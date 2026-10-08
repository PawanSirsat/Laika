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

  /*
   * LAI-724 moved the set into `task-store.ts`. A local write now goes to the
   * store — so every screen sees it, and the store's merge protects it from a
   * refresh — and comes back to the board through the one subscription, which
   * is the only caller of `commit` with the store's answers.
   */
  void test('move() writes through the store, never around commit', () => {
    const body = /const move = useCallback\([\s\S]*?\n {2}\}, \[/.exec(SOURCE)?.[0] ?? '';
    assert.ok(body.length > 0, 'move() not found — the scan is blind');
    assert.match(body, /\btaskStore\.writeLocal\(/);
    assert.match(body, /\btaskStore\.beginWrite\(/);
    assert.doesNotMatch(body, /\bsetState\(/);
  });

  void test('the store’s answers reach the board only through commit', () => {
    const effect = /taskStore\.subscribe\(slug, \(snapshot, change\) => \{[\s\S]*?\}\);/.exec(
      SOURCE,
    )?.[0];
    assert.ok(effect !== undefined, 'the subscription was not found — the scan is blind');
    assert.match(effect, /\bcommit\(derive\(snapshot,/);
    assert.match(SOURCE, /\}, \[slug\]\);/, 'the subscription depends on the project alone');
  });
});
