/**
 * The one list of filter keys (LAI-485, LAI-487).
 *
 * It decides when the List's page resets, and — from LAI-487 — what the badge
 * counts and what *Clear all* clears. Two hand-written lists is how *Clear all*
 * came to miss `sprint`, so this file checks the list against the screen that
 * reads the URL, not against a copy of itself.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import {
  activeSprintId,
  ALL_SPRINTS,
  readSprintScope,
  activeFilters,
  FILTER_KEYS,
  filterCount,
  filterSignature,
  readBlocked,
  readOverdue,
  readStatus,
  readTop,
  readUpdated,
  updatedSince,
  withoutFilters,
} from '../../../../src/routes/screens/board/filter-keys.ts';
import { code } from '../../../helpers/code.ts';

let board = '';
before(async () => {
  // The board reads some keys directly and the rest through this module's
  // validators (LAI-487), so "what the board reads" is both files.
  const read = async (rel: string) => code(await readFile(new URL(rel, import.meta.url), 'utf8'));
  board =
    (await read('../../../../src/routes/screens/BoardScreen.tsx')) +
    (await read('../../../../src/routes/screens/board/filter-keys.ts'));
});

void describe('FILTER_KEYS', () => {
  void test('names every key the board reads as a filter', () => {
    // Positive control: the scan finds keys at all, or the next test is air.
    const read = [...board.matchAll(/params\.get\('([a-z_]+)'\)/g)].map((m) => m[1]);
    assert.ok(
      read.includes('priority'),
      `the scan found nothing it recognises: ${read.join(', ')}`,
    );
    for (const key of FILTER_KEYS) {
      assert.ok(read.includes(key), `${key} is listed as a filter but the board never reads it`);
    }
  });

  void test('leaves out every key that does not change which tasks match', () => {
    for (const key of ['project', 'task', 'group', 'view', 'sort', 'dir', 'page']) {
      assert.ok(!(FILTER_KEYS as readonly string[]).includes(key), `${key} is not a filter`);
    }
  });
});

void describe('filterSignature', () => {
  const sig = (s: string) => filterSignature(new URLSearchParams(s));

  void test('changes when a filter changes', () => {
    assert.notEqual(sig('priority=p1'), sig('priority=p2'));
    assert.notEqual(sig(''), sig('sprint=s1'));
  });

  void test('ignores sort, page, the open task and the project', () => {
    assert.equal(sig('priority=p1'), sig('priority=p1&sort=key&dir=asc&page=3&task=t1&project=x'));
  });

  void test('does not depend on the order the keys were written', () => {
    assert.equal(sig('q=a&priority=p1'), sig('priority=p1&q=a'));
  });
});

const q = (s: string) => new URLSearchParams(s);
const names = { status: (s: string) => s.toUpperCase() };

void describe('the four new filters read the URL as untrusted (LAI-487)', () => {
  void test('status: one known status, or nothing', () => {
    assert.equal(readStatus(q('status=review')), 'review');
    assert.equal(readStatus(q('status=cancelled')), 'cancelled');
    assert.equal(readStatus(q('status=bogus')), undefined, 'the server would 400 on this');
    assert.equal(readStatus(q('')), undefined);
  });

  void test('updated: a window name, never a timestamp', () => {
    assert.equal(readUpdated(q('updated=7d')), '7d');
    assert.equal(readUpdated(q('updated=90d')), undefined);
    assert.equal(readUpdated(q('updated=1790000000000')), undefined);
  });

  void test('blocked: only the literal true', () => {
    assert.equal(readBlocked(q('blocked=true')), true);
    assert.equal(readBlocked(q('blocked=yes')), false);
    assert.equal(readBlocked(q('')), false);
  });

  void test('a window means the same span whenever the link is opened', () => {
    const monday = new Date(2026, 8, 28, 15, 30).getTime();
    const friday = new Date(2026, 9, 2, 9, 0).getTime();
    assert.equal(monday - updatedSince('7d', monday), 7 * 86_400_000);
    assert.equal(friday - updatedSince('7d', friday), 7 * 86_400_000);
    assert.equal(friday - updatedSince('30d', friday), 30 * 86_400_000);
  });

  void test('today is since local midnight, not the last 24 hours', () => {
    const afternoon = new Date(2026, 8, 28, 15, 30).getTime();
    assert.equal(updatedSince('today', afternoon), new Date(2026, 8, 28, 0, 0).getTime());
  });
});

void describe('the badge, the chips and Clear all read one list (LAI-487)', () => {
  void test('the badge counts every applied filter, ready=false and sprint included', () => {
    assert.equal(
      filterCount(q('status=done&sprint=s1&ready=false&blocked=true&updated=today'), names),
      5,
    );
  });

  void test('search is shown as a chip but not counted on the button', () => {
    assert.equal(filterCount(q('q=login'), names), 0);
    assert.deepEqual(
      activeFilters(q('q=login'), names).map((f) => f.key),
      ['q'],
    );
  });

  void test('a value the board would ignore is not counted', () => {
    assert.equal(filterCount(q('status=bogus&updated=90d&blocked=yes'), names), 0);
  });

  /*
   * **Priority and tag too** (LAI-724 follow-up). The board names a refused
   * `?priority=` or `?tag=` and does not apply it; a chip and a badge counting
   * it said the opposite, beside the notice saying it was ignored.
   */
  void test('a priority or tag the server would refuse is not counted, and has no chip', () => {
    for (const bad of ['priority=p9', 'priority=P1', 'tag=-x', 'tag=a%20b']) {
      assert.equal(filterCount(q(bad), names), 0, bad);
      assert.deepEqual(activeFilters(q(bad), names), [], bad);
    }
    assert.equal(filterCount(q('priority=p1&tag=API'), names), 2, 'positive control');
  });

  void test('the chip names a status the way the board does', () => {
    assert.equal(activeFilters(q('status=review'), names)[0]?.label, 'Status REVIEW');
  });

  void test('Clear all removes every filter and keeps project, task, group, sort and page', () => {
    const all = `${FILTER_KEYS.map((k) => `${k}=x`).join('&')}&project=p&task=t&group=assignee&sort=key&dir=asc&page=2`;
    const left = withoutFilters(q(all));
    for (const key of FILTER_KEYS) assert.equal(left.has(key), false, `${key} survived Clear all`);
    for (const key of ['project', 'task', 'group', 'sort', 'dir', 'page']) {
      assert.equal(left.has(key), true, `Clear all removed ${key}`);
    }
  });
});

void describe('top and overdue (D-066)', () => {
  const names = { status: (s: string) => s };

  void test('both read only the literal true', () => {
    assert.equal(readTop(new URLSearchParams('top=true')), true);
    assert.equal(readTop(new URLSearchParams('top=1')), false);
    assert.equal(readTop(new URLSearchParams('')), false);
    assert.equal(readOverdue(new URLSearchParams('overdue=true')), true);
    assert.equal(readOverdue(new URLSearchParams('overdue=yes')), false);
  });

  void test('each is a chip, counted on the button, and cleared by Clear all', () => {
    const params = new URLSearchParams('top=true&overdue=true&task=t1');
    const labels = activeFilters(params, names).map((f) => f.label);
    assert.ok(labels.includes('Top-level only'), labels.join(', '));
    assert.ok(labels.includes('Overdue'), labels.join(', '));
    assert.equal(filterCount(params, names), 2);

    const cleared = withoutFilters(params);
    assert.equal(cleared.get('top'), null);
    assert.equal(cleared.get('overdue'), null);
    assert.equal(cleared.get('task'), 't1');
  });
});

void describe('the sprint a board opens on (LAI-713)', () => {
  const names = { status: (s: string) => s };

  void test('missing, empty and all mean every sprint; anything else is sent', () => {
    assert.equal(readSprintScope(new URLSearchParams('')), undefined);
    assert.equal(readSprintScope(new URLSearchParams('sprint=')), undefined);
    assert.equal(readSprintScope(new URLSearchParams(`sprint=${ALL_SPRINTS}`)), undefined);
    assert.equal(readSprintScope(new URLSearchParams('sprint=s2')), 's2');
    assert.equal(readSprintScope(new URLSearchParams('sprint=none')), 'none');
  });

  void test('all sprints, chosen, is not a filter — no chip, no count', () => {
    const params = new URLSearchParams(`sprint=${ALL_SPRINTS}`);
    assert.equal(filterCount(params, names), 0);
    assert.deepEqual(activeFilters(params, names), []);
    assert.equal(filterCount(new URLSearchParams('sprint=s2'), names), 1);
  });

  void test('the active sprint, or none when no sprint is active', () => {
    assert.equal(
      activeSprintId([
        { id: 's1', status: 'completed' },
        { id: 's2', status: 'active' },
        { id: 's3', status: 'planned' },
      ]),
      's2',
    );
    assert.equal(activeSprintId([{ id: 's1', status: 'planned' }]), undefined);
    assert.equal(activeSprintId([]), undefined);
  });
});
