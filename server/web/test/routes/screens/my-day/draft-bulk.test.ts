/**
 * Many drafted blocks at once (LAI-810): ten to a page, a run selected with
 * Shift, and a batch that uses the endpoints that exist — and **never
 * confirms a block on nothing** because it rode along in a selection.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../../../src/api/errors.ts';
import type { TimeDraft } from '../../../../src/api/time.ts';
import {
  confirmPlan,
  minutesOf,
  nameBlocks,
  needCardLine,
  pageOf,
  runBulk,
  selectRange,
  type BulkApi,
} from '../../../../src/routes/screens/my-day/draft-bulk.ts';

const MIDNIGHT = Date.parse('2026-10-20T00:00:00Z');

function draft(n: number, over: Partial<TimeDraft> = {}): TimeDraft {
  const start = MIDNIGHT + (7 * 60 + n * 20) * 60_000;
  return {
    id: `d${String(n)}`,
    source: 'collector',
    day: '2026-10-20',
    tz: 'UTC',
    started_at: start,
    ended_at: start + 15 * 60_000,
    minutes: 15,
    task: { id: `t${String(n)}`, key: `LAI-${String(n)}`, title: `Card ${String(n)}` },
    task_key: null,
    project: { id: 'p1', slug: 'atlas', name: 'Atlas' },
    general: false,
    signals: { prompts: 0, replies: 1, sessions: 1, commits: 0, marks: 0 },
    note: null,
    ...over,
  };
}

/** On nothing: no card, no space, not General. */
const untied = (n: number, over: Partial<TimeDraft> = {}): TimeDraft =>
  draft(n, { task: null, project: null, ...over });

/** Every write a batch made, in order; refuses the ids in `refuse`. */
function fakeApi(refuse: ReadonlySet<string> = new Set()) {
  const sent: string[] = [];
  const write = (verb: string) => (id: string) => {
    sent.push(`${verb} ${id}`);
    return refuse.has(id)
      ? Promise.reject(
          new ApiError('unprocessable', 'That day would hold more than 24 hours.', 422),
        )
      : Promise.resolve({});
  };
  const api: BulkApi = {
    confirmDraft: write('confirm'),
    confirmDay: write('day'),
    dismissDraft: write('dismiss'),
    toGeneral: write('general'),
  };
  return { api, sent };
}

void describe('paging', () => {
  const rows = Array.from({ length: 37 }, (_, i) => i + 1);

  void test('ten a page, said as a range of the whole', () => {
    assert.equal(pageOf(rows, 0).label, '1–10 of 37');
    assert.deepEqual(pageOf(rows, 0).items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(pageOf(rows, 1).label, '11–20 of 37');
    assert.equal(pageOf(rows, 3).label, '31–37 of 37');
    assert.equal(pageOf(rows, 0).pages, 4);
  });

  void test('a page past the end shows the last one — the list shrank under it', () => {
    const shrunk = pageOf(rows.slice(0, 12), 3);
    assert.equal(shrunk.page, 1);
    assert.equal(shrunk.label, '11–12 of 12');
    assert.equal(pageOf([], 2).label, '0 of 0');
  });
});

void describe('selecting', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  void test('Shift-click selects every row from the last one clicked to this one', () => {
    const next = selectRange(new Set(['b']), ids, 'b', 'e', true);
    assert.deepEqual([...next].sort(), ['b', 'c', 'd', 'e']);
    // Upwards too.
    assert.deepEqual([...selectRange(new Set(), ids, 'e', 'c', true)].sort(), ['c', 'd', 'e']);
  });

  void test('Shift-click that unticks a row unticks the run', () => {
    const next = selectRange(new Set(ids), ids, 'b', 'd', false);
    assert.deepEqual([...next].sort(), ['a', 'e', 'f']);
  });

  void test('with no anchor it is one row, as a plain click is', () => {
    assert.deepEqual([...selectRange(new Set(), ids, undefined, 'c', true)], ['c']);
    assert.deepEqual([...selectRange(new Set(), ids, 'gone', 'c', true)], ['c']);
  });

  void test('the selection’s time is the sum of what is selected', () => {
    const drafts = [draft(1), draft(2, { minutes: 40 }), draft(3)];
    assert.equal(minutesOf(drafts, new Set(['d2', 'd3'])), 55);
  });
});

void describe('what Confirm selected confirms', () => {
  void test('a block on nothing is left out, not confirmed as General', () => {
    const all = [draft(1), untied(2), draft(3)];
    const plan = confirmPlan(all, all);
    assert.deepEqual(
      plan.ready.map((d) => d.id),
      ['d1', 'd3'],
    );
    assert.deepEqual(
      plan.needCard.map((d) => d.id),
      ['d2'],
    );
    assert.equal(plan.wholeDay, false);
  });

  void test('a card the reader cannot see is a block on nothing too', () => {
    const plan = confirmPlan(
      [untied(1, { task_key: 'LAI-758' })],
      [untied(1, { task_key: 'LAI-758' })],
    );
    assert.equal(plan.needCard.length, 1);
  });

  void test('General and a space are ready as they stand', () => {
    const all = [untied(1, { general: true }), draft(2, { task: null })];
    assert.equal(confirmPlan(all, all).ready.length, 2);
  });

  void test('the whole day is meant only when every block is chosen and ready', () => {
    const all = [draft(1), draft(2)];
    assert.equal(confirmPlan(all, all).wholeDay, true);
    assert.equal(confirmPlan(all, [draft(1)]).wholeDay, false);
  });

  void test('the ones left out are named by when they were', () => {
    assert.equal(needCardLine(1), '1 needs a card or General');
    assert.equal(needCardLine(2), '2 need a card or General');
    assert.equal(nameBlocks([untied(1), untied(2)]), '07:20–07:35, 07:40–07:55');
    assert.equal(
      nameBlocks([untied(1, { started_at: null, ended_at: null, minutes: 30 })]),
      'a 0:30 block with no set time',
    );
    assert.match(nameBlocks(Array.from({ length: 7 }, (_, i) => untied(i))), / and 2 more$/);
  });
});

void describe('a batch', () => {
  void test('confirms the ready blocks one by one and names the one left out', async () => {
    const all = [draft(1), untied(2), draft(3), draft(4)];
    const { api, sent } = fakeApi();
    const progress: string[] = [];
    const result = await runBulk('confirm', all.slice(0, 3), all, '2026-10-20', api, (d, t) => {
      progress.push(`${String(d)}/${String(t)}`);
    });
    assert.deepEqual(sent, ['confirm d1', 'confirm d3']);
    assert.deepEqual(progress, ['1/2', '2/2']);
    assert.deepEqual(result.keep, ['d2']);
    assert.equal(result.ok, false);
    assert.equal(
      result.text,
      'Confirmed 2 blocks. Left out, still selected — 1 needs a card or General: 07:40–07:55.',
    );
  });

  void test('only blocks on nothing: nothing is sent and the reader is told why', async () => {
    const all = [untied(1), untied(2)];
    const { api, sent } = fakeApi();
    const result = await runBulk('confirm', all, all, '2026-10-20', api);
    assert.deepEqual(sent, []);
    assert.match(result.text, /^Nothing confirmed\. Left out, still selected — 2 need a card/);
  });

  void test('a partial failure keeps the failed blocks selected and says why', async () => {
    const all = [draft(1), draft(2), draft(3), draft(4)];
    const { api, sent } = fakeApi(new Set(['d2', 'd4']));
    const result = await runBulk('confirm', all.slice(0, 4), [...all, draft(5)], '2026-10-20', api);
    assert.deepEqual(sent, ['confirm d1', 'confirm d2', 'confirm d3', 'confirm d4']);
    assert.deepEqual(result.keep, ['d2', 'd4']);
    assert.equal(result.ok, false);
    assert.equal(
      result.text,
      'Confirmed 2 blocks. 2 blocks did not save and stay selected: That day would hold more than 24 hours.',
    );
  });

  void test('the whole day ready and chosen is one confirm-day request', async () => {
    const all = [draft(1), draft(2), draft(3)];
    const { api, sent } = fakeApi();
    const result = await runBulk('confirm', all, all, '2026-10-20', api);
    assert.deepEqual(sent, ['day 2026-10-20']);
    assert.deepEqual(result.keep, []);
    assert.equal(result.text, 'Confirmed 3 blocks.');
    assert.equal(result.ok, true);
  });

  void test('a refused confirm-day keeps every block selected', async () => {
    const all = [draft(1), draft(2)];
    const { api } = fakeApi(new Set(['2026-10-20']));
    const result = await runBulk('confirm', all, all, '2026-10-20', api);
    assert.deepEqual(result.keep, ['d1', 'd2']);
    assert.match(result.text, /^2 blocks did not save and stay selected/);
  });

  void test('General skips a block already on General; Not work sends every one', async () => {
    const all = [draft(1), untied(2, { general: true }), untied(3)];
    const general = fakeApi();
    const moved = await runBulk('general', all, all, '2026-10-20', general.api);
    assert.deepEqual(general.sent, ['general d1', 'general d3']);
    assert.equal(moved.text, 'Moved 2 blocks to General.');

    const dismiss = fakeApi();
    const marked = await runBulk('dismiss', all, all, '2026-10-20', dismiss.api);
    assert.deepEqual(dismiss.sent, ['dismiss d1', 'dismiss d2', 'dismiss d3']);
    assert.equal(marked.text, 'Marked 3 blocks as not work.');
  });
});
