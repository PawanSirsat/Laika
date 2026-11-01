/**
 * The Organisation → Activity filters (LAI-951): what the address says, what
 * `GET /activity/history` is asked, and how a change rewrites the address.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  filtersFrom,
  historyQuery,
  localDayEnd,
  localDayStart,
  withFilter,
} from '../../../../src/routes/screens/organisation/org-history.ts';

void describe('the filters live in the address', () => {
  void test('each one the address names, and nothing it leaves empty', () => {
    const params = new URLSearchParams(
      'tab=activity&actor=u2&project=atlas&type=task.created&from=2026-10-01&to=2026-10-02',
    );
    assert.deepEqual(filtersFrom(params), {
      actor: 'u2',
      project: 'atlas',
      type: 'task.created',
      from: '2026-10-01',
      to: '2026-10-02',
    });
    assert.deepEqual(filtersFrom(new URLSearchParams('tab=activity&actor=&project=')), {});
  });

  void test('a date that is not a date is no filter, rather than a 400 on every load', () => {
    assert.deepEqual(filtersFrom(new URLSearchParams('from=yesterday&to=2026-13-40')), {});
  });

  void test('setting one keeps the tab and the others; clearing one removes it', () => {
    const start = new URLSearchParams('tab=activity&actor=u2');
    const set = withFilter(start, 'project', 'atlas');
    assert.equal(set.toString(), 'tab=activity&actor=u2&project=atlas');
    assert.equal(withFilter(set, 'actor', '').toString(), 'tab=activity&project=atlas');
    // The original is not mutated — it is the route's.
    assert.equal(start.toString(), 'tab=activity&actor=u2');
  });
});

void describe('what the endpoint is asked', () => {
  void test('the person, space and type as they are', () => {
    assert.deepEqual(historyQuery({ actor: 'u2', project: 'atlas', type: 'comment.added' }), {
      actor: 'u2',
      project: 'atlas',
      type: 'comment.added',
    });
    assert.deepEqual(historyQuery({}), {});
  });

  void test('from and to are whole days in the reader’s time, both inclusive', () => {
    const query = historyQuery({ from: '2026-10-01', to: '2026-10-02' });
    assert.equal(query.since, new Date(2026, 9, 1).getTime());
    assert.equal(query.until, new Date(2026, 9, 3).getTime() - 1);
  });

  void test('a day starts at its midnight and ends a millisecond before the next', () => {
    assert.equal(localDayStart('2026-02-28'), new Date(2026, 1, 28).getTime());
    assert.equal(localDayEnd('2026-02-28'), new Date(2026, 2, 1).getTime() - 1);
    assert.equal(localDayStart('nope'), undefined);
    assert.equal(localDayEnd('2026-02-30'), undefined);
  });
});
