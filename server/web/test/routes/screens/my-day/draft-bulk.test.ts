/**
 * Many drafted blocks at once (LAI-810): ten to a page, a run selected with
 * Shift, and a batch that uses the endpoints that exist — **what was ticked,
 * by id, never the day the server holds** (review round 1), and never a
 * block on nothing because it rode along in a selection.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../../../src/api/errors.ts';
import type { TimeDraft, TimeEntry } from '../../../../src/api/time.ts';
import {
  confirmPlan,
  dayReport,
  minutesOf,
  nameBlocks,
  needCardLine,
  placed,
  runBulk,
  runConfirmDay,
  selectRange,
  whyRefused,
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

/** What a refusal looks like from the server, by kind. */
function refusal(kind: 'stale' | 'full' | 'other', id: string): ApiError {
  if (kind === 'stale') return new ApiError('not_found', `No draft "${id}"`, 404);
  if (kind === 'full') {
    return new ApiError(
      'unprocessable',
      'That would put 1452 minutes on 2026-10-20; a day holds 1440',
      422,
      { reason: 'day_full', field: 'minutes' },
    );
  }
  return new ApiError('internal', 'The entry could not be written.', 500);
}

/** The entry a confirmed draft becomes. */
function entryOf(d: TimeDraft): TimeEntry {
  return {
    id: `e-${d.id}`,
    day: d.day,
    tz: d.tz,
    started_at: d.started_at,
    ended_at: d.ended_at,
    minutes: d.minutes,
    source: 'draft',
    task: d.task,
    project: d.project,
    note: null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
  };
}

/**
 * Every write a batch made, in order. `refuse` maps an id (or the day) to the
 * refusal it gets; `day` is what confirm-day answers — the server's day,
 * which need not be the page's.
 */
function fakeApi(
  refuse: ReadonlyMap<string, 'stale' | 'full' | 'other'> = new Map(),
  day: readonly TimeEntry[] = [],
) {
  const sent: string[] = [];
  const write = (verb: string) => (id: string) => {
    sent.push(`${verb} ${id}`);
    const kind = refuse.get(id);
    return kind === undefined ? Promise.resolve({}) : Promise.reject(refusal(kind, id));
  };
  const api: BulkApi = {
    confirmDraft: write('confirm'),
    confirmDay: (d: string) => {
      sent.push(`day ${d}`);
      const kind = refuse.get(d);
      return kind === undefined
        ? Promise.resolve({ entries: day })
        : Promise.reject(refusal(kind, d));
    },
    dismissDraft: write('dismiss'),
    toGeneral: write('general'),
  };
  return { api, sent };
}

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
    const plan = confirmPlan([draft(1), untied(2), draft(3)]);
    assert.deepEqual(
      plan.ready.map((d) => d.id),
      ['d1', 'd3'],
    );
    assert.deepEqual(
      plan.needCard.map((d) => d.id),
      ['d2'],
    );
  });

  void test('a card the reader cannot see is a block on nothing too', () => {
    assert.equal(confirmPlan([untied(1, { task_key: 'LAI-758' })]).needCard.length, 1);
  });

  void test('General and a space are ready as they stand', () => {
    assert.equal(
      confirmPlan([untied(1, { general: true }), draft(2, { task: null })]).ready.length,
      2,
    );
  });

  void test('on a card or a space is what General would take it off', () => {
    assert.equal(placed(draft(1)), true);
    assert.equal(placed(draft(2, { task: null })), true);
    assert.equal(placed(untied(3)), false);
    assert.equal(placed(untied(4, { general: true })), false);
  });

  void test('the ones left out are named by when they were', () => {
    assert.equal(needCardLine(1), '1 needs a card or General');
    assert.equal(needCardLine(2), '2 need a card or General');
    assert.equal(nameBlocks([untied(1), untied(2)]), '7:20–7:35 AM, 7:40–7:55 AM');
    assert.equal(
      nameBlocks([untied(1, { started_at: null, ended_at: null, minutes: 30 })]),
      'a 30 min block with no set time',
    );
    assert.match(nameBlocks(Array.from({ length: 7 }, (_, i) => untied(i))), / and 2 more$/);
  });
});

void describe('why a block was refused', () => {
  void test('gone, full, or the server’s own reason', () => {
    assert.equal(whyRefused(refusal('stale', 'd1')), 'stale');
    assert.equal(whyRefused(refusal('full', 'd1')), 'full');
    assert.equal(whyRefused(refusal('other', 'd1')), 'other');
    assert.equal(whyRefused(new ApiError('unprocessable', 'No minutes', 422)), 'other');
    assert.equal(whyRefused(new TypeError('Failed to fetch')), 'other');
  });
});

void describe('Confirm selected', () => {
  void test('every block ticked and ready is still confirmed one by one, by id — never the day', async () => {
    const all = [draft(1), draft(2), draft(3)];
    const { api, sent } = fakeApi();
    const progress: string[] = [];
    const result = await runBulk('confirm', all, api, (d, t) => {
      progress.push(`${String(d)}/${String(t)}`);
    });
    assert.deepEqual(sent, ['confirm d1', 'confirm d2', 'confirm d3']);
    assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
    assert.equal(result.text, 'Confirmed 3 blocks.');
    assert.deepEqual(result.keep, []);
    assert.equal(result.ok, true);
  });

  void test('a block on nothing is left out, named, and stays selected', async () => {
    const { api, sent } = fakeApi();
    const result = await runBulk('confirm', [draft(1), untied(2), draft(3)], api);
    assert.deepEqual(sent, ['confirm d1', 'confirm d3']);
    assert.deepEqual(result.keep, ['d2']);
    assert.equal(
      result.text,
      'Confirmed 2 blocks. Left out, still selected — 1 needs a card or General: 7:40–7:55 AM.',
    );
  });

  void test('only blocks on nothing: nothing is sent, and the reader is told why', async () => {
    const { api, sent } = fakeApi();
    const result = await runBulk('confirm', [untied(1), untied(2)], api);
    assert.deepEqual(sent, []);
    assert.match(result.text, /^Nothing confirmed\. Left out, still selected — 2 need a card/);
  });

  void test('a refusal keeps that block selected and says why, once', async () => {
    const all = [draft(1), draft(2), draft(3), draft(4)];
    const { api, sent } = fakeApi(
      new Map([
        ['d2', 'other'],
        ['d4', 'other'],
      ]),
    );
    const result = await runBulk('confirm', all, api);
    assert.equal(sent.length, 4);
    assert.deepEqual(result.keep, ['d2', 'd4']);
    assert.equal(
      result.text,
      'Confirmed 2 blocks. 2 blocks did not save and stay selected: The entry could not be written.',
    );
  });

  void test('blocks that changed since the page loaded are one sentence, and not kept', async () => {
    const all = [draft(1), draft(2), draft(3), untied(4)];
    const { api } = fakeApi(
      new Map([
        ['d2', 'stale'],
        ['d3', 'stale'],
      ]),
    );
    const result = await runBulk('confirm', all, api);
    assert.deepEqual(result.keep, ['d4']);
    assert.equal(
      result.text,
      'Confirmed 1 block. 2 blocks changed since this page loaded — reloaded; please review again. ' +
        'Left out, still selected — 1 needs a card or General: 8:20–8:35 AM.',
    );
    assert.doesNotMatch(result.text, /No draft/);
  });

  void test('a full day stops the pass: the rest are not tried, and stay selected', async () => {
    const all = [draft(1), draft(2), draft(3), draft(4)];
    const { api, sent } = fakeApi(new Map([['d2', 'full']]));
    const result = await runBulk('confirm', all, api);
    assert.deepEqual(sent, ['confirm d1', 'confirm d2']);
    assert.deepEqual(result.keep, ['d2', 'd3', 'd4']);
    assert.equal(
      result.text,
      'Confirmed 1 block. Stopped at 7:40–7:55 AM: confirming it would put more than 24 hours on ' +
        'the day. 3 blocks not confirmed, still selected.',
    );
  });

  void test('General skips a block already on General; Not work sends every one', async () => {
    const all = [draft(1), untied(2, { general: true }), untied(3)];
    const general = fakeApi();
    const moved = await runBulk('general', all, general.api);
    assert.deepEqual(general.sent, ['general d1', 'general d3']);
    assert.equal(moved.text, 'Moved 2 blocks to General.');

    const dismiss = fakeApi();
    const marked = await runBulk('dismiss', all, dismiss.api);
    assert.deepEqual(dismiss.sent, ['dismiss d1', 'dismiss d2', 'dismiss d3']);
    assert.equal(marked.text, 'Marked 3 blocks as not work.');
  });
});

void describe('the header’s Confirm day', () => {
  void test('every block ready: one confirm-day request, matching what the page showed', async () => {
    const all = [draft(1), draft(2), draft(3)];
    const { api, sent } = fakeApi(new Map(), all.map(entryOf));
    const result = await runConfirmDay(all, '2026-10-20', api);
    assert.deepEqual(sent, ['day 2026-10-20']);
    assert.equal(result.text, 'Confirmed the day: 3 blocks, 45 min.');
    assert.equal(result.ok, true);
    assert.deepEqual(result.keep, []);
  });

  void test('the server’s day held more: said plainly, and an untied block now General named', async () => {
    const all = [draft(1), draft(2)];
    const arrived = untied(9, { minutes: 20 });
    const { api } = fakeApi(new Map(), [...all, arrived].map(entryOf));
    const result = await runConfirmDay(all, '2026-10-20', api);
    assert.equal(result.ok, false);
    assert.equal(
      result.text,
      'Confirmed the day: 3 blocks, 50 min. 1 block more arrived since this page loaded and was ' +
        'confirmed too. 1 block on no card was confirmed as General — change it under Confirmed ' +
        'if it belongs on one.',
    );
  });

  void test('fewer, or the same number with other minutes, is said too', () => {
    const all = [draft(1), draft(2)];
    assert.match(
      dayReport(all, [entryOf(draft(1))]).text,
      /1 block shown here had changed since this page loaded and was not among them\.$/,
    );
    assert.match(
      dayReport(all, [entryOf(draft(1)), entryOf(draft(3, { minutes: 40 }))]).text,
      /The day changed since this page loaded: 55 min was confirmed, not the 30 min shown\.$/,
    );
  });

  void test('a stretch over the clock: nothing confirmed, and the block named (review round 2)', async () => {
    const all = [draft(1), draft(2), draft(3)];
    const api: BulkApi = {
      confirmDraft: () => Promise.resolve({}),
      dismissDraft: () => Promise.resolve(),
      toGeneral: () => Promise.resolve({}),
      confirmDay: () =>
        Promise.reject(
          new ApiError('conflict', 'That would count confirmed time twice', 409, {
            reason: 'overlaps_confirmed',
            draft_id: 'd2',
            stretch_minutes: 160,
            would_hold: 190,
          }),
        ),
    };
    const result = await runConfirmDay(all, '2026-10-20', api);
    assert.equal(result.ok, false);
    assert.equal(
      result.text,
      'Nothing confirmed: 7:40–7:55 AM would count confirmed time twice — its stretch has ' +
        '2 h 40 min of clock and would hold 3 h 10 min. Shorten it or mark it not work, then confirm again.',
    );
  });

  void test('a full day refuses the whole request: nothing confirmed, said so', async () => {
    const all = [draft(1)];
    const { api } = fakeApi(new Map([['2026-10-20', 'full']]));
    const result = await runConfirmDay(all, '2026-10-20', api);
    assert.match(result.text, /^Nothing confirmed: the day would hold more than 24 hours/);
  });

  void test('some need a card: the ready ones one by one, and exactly how many were left', async () => {
    const all = [draft(1), untied(2), draft(3)];
    const { api, sent } = fakeApi();
    const result = await runConfirmDay(all, '2026-10-20', api);
    assert.deepEqual(sent, ['confirm d1', 'confirm d3']);
    assert.equal(
      result.text,
      'Confirmed 2 of 3 blocks; 1 left drafted — 1 needs a card or General (7:40–7:55 AM).',
    );
    assert.doesNotMatch(result.text, /selected/);
  });

  void test('a full day part-way: confirmed so far, and the rest said, never “selected”', async () => {
    const all = [draft(1), untied(2), draft(3), draft(4), draft(5)];
    const { api, sent } = fakeApi(new Map([['d3', 'full']]));
    const result = await runConfirmDay(all, '2026-10-20', api);
    assert.deepEqual(sent, ['confirm d1', 'confirm d3']);
    assert.equal(
      result.text,
      'Confirmed 1 of 5 blocks; 4 left drafted — 1 needs a card or General (7:40–7:55 AM); ' +
        '3 blocks from 8:00–8:15 AM on would put more than 24 hours on the day.',
    );
    assert.doesNotMatch(result.text, /selected/);
  });
});
