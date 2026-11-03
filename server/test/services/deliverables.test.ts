import { describe, expect, it } from 'vitest';
import type { TaskDeliverable } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  DELIVERABLE_LIMITS,
  deliveredCount,
  markDeliverables,
  normaliseDeliverables,
  normalisePoints,
} from '../../src/services/deliverables.ts';

/**
 * "What this delivers" (§4.5, LAI-1115): the pure rules every writer of a
 * task's `deliverables`, `solves` and `unlocks` goes through.
 */

function item(
  id: string,
  title: string,
  state: TaskDeliverable['state'] = 'pending',
): TaskDeliverable {
  return { id, title, detail: null, state };
}

/** The refusal's `code` and `details`, or the test fails on the wrong shape. */
function refusal(run: () => unknown): { code: string; details: Record<string, unknown> } {
  try {
    run();
  } catch (err) {
    if (err instanceof ApiError) {
      return { code: err.code, details: (err.details ?? {}) as Record<string, unknown> };
    }
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('normaliseDeliverables', () => {
  it('mints an id per new item, trims the texts, and starts every item pending', () => {
    let n = 0;
    const list = normaliseDeliverables(
      [{ title: '  Terminal viewer ' }, { title: 'Watch view', detail: ' tails the audit  ' }],
      [],
      () => `id-${String(++n)}`,
    );
    expect(list).toEqual([
      { id: 'id-1', title: 'Terminal viewer', detail: null, state: 'pending' },
      { id: 'id-2', title: 'Watch view', detail: 'tails the audit', state: 'pending' },
    ]);
    // Key order is what `taskVersion` hashes.
    expect(Object.keys(list[0]!)).toEqual(['id', 'title', 'detail', 'state']);
  });

  it('keeps a sent id, its state and its new position; a sent state wins', () => {
    const existing = [item('a', 'First', 'done'), item('b', 'Second', 'in_progress')];
    const list = normaliseDeliverables(
      [
        { id: 'b', title: 'Second, renamed' },
        { id: 'a', title: 'First', state: 'pending' },
        { title: 'Third' },
      ],
      existing,
      () => 'c',
    );
    expect(list.map((d) => [d.id, d.title, d.state])).toEqual([
      ['b', 'Second, renamed', 'in_progress'],
      ['a', 'First', 'pending'],
      ['c', 'Third', 'pending'],
    ]);
  });

  it('refuses an id the task does not have, naming it', () => {
    const r = refusal(() => normaliseDeliverables([{ id: 'zzz', title: 'X' }], [item('a', 'A')]));
    expect(r.code).toBe('unprocessable');
    expect(r.details).toMatchObject({
      field: 'deliverables',
      reason: 'unknown_deliverable',
      id: 'zzz',
    });
  });

  it('refuses the same id twice, an empty title, and a list over the limit', () => {
    const twice = refusal(() =>
      normaliseDeliverables(
        [
          { id: 'a', title: 'A' },
          { id: 'a', title: 'A again' },
        ],
        [item('a', 'A')],
      ),
    );
    expect(twice.details).toMatchObject({ reason: 'duplicate_deliverable', id: 'a' });

    const empty = refusal(() => normaliseDeliverables([{ title: '   ' }], []));
    expect(empty.details).toMatchObject({ reason: 'empty_title' });

    const many = Array.from({ length: DELIVERABLE_LIMITS.items + 1 }, (_, i) => ({
      title: `d${String(i)}`,
    }));
    const over = refusal(() => normaliseDeliverables(many, []));
    expect(over.details).toMatchObject({ reason: 'too_many', count: DELIVERABLE_LIMITS.items + 1 });
    // And exactly the limit is fine.
    expect(normaliseDeliverables(many.slice(0, DELIVERABLE_LIMITS.items), [])).toHaveLength(
      DELIVERABLE_LIMITS.items,
    );
  });

  it('refuses a title or a detail past its length, with the length', () => {
    const title = refusal(() =>
      normaliseDeliverables([{ title: 'x'.repeat(DELIVERABLE_LIMITS.title + 1) }], []),
    );
    expect(title.details).toMatchObject({
      reason: 'title_too_long',
      length: DELIVERABLE_LIMITS.title + 1,
    });
    const detail = refusal(() =>
      normaliseDeliverables(
        [{ title: 'ok', detail: 'y'.repeat(DELIVERABLE_LIMITS.detail + 1) }],
        [],
      ),
    );
    expect(detail.details).toMatchObject({ reason: 'detail_too_long' });
  });
});

describe('normalisePoints', () => {
  it('trims each line and names the field it refuses', () => {
    expect(normalisePoints('solves', ['  one ', 'two'])).toEqual(['one', 'two']);
    expect(refusal(() => normalisePoints('unlocks', [' '])).details).toMatchObject({
      field: 'unlocks',
      reason: 'empty_line',
    });
    expect(
      refusal(() =>
        normalisePoints(
          'solves',
          Array.from({ length: DELIVERABLE_LIMITS.points + 1 }, () => 'x'),
        ),
      ).details,
    ).toMatchObject({ field: 'solves', reason: 'too_many' });
    expect(
      refusal(() => normalisePoints('solves', ['z'.repeat(DELIVERABLE_LIMITS.point + 1)])).details,
    ).toMatchObject({ reason: 'line_too_long' });
  });
});

describe('markDeliverables', () => {
  const list = [
    item('a', 'Terminal viewer'),
    item('b', 'Watch view', 'in_progress'),
    item('c', 'Docs', 'done'),
  ];

  it('marks by id and by exact trimmed title, keeps the order, and lists what moved', () => {
    const r = markDeliverables(list, ['a', '  Watch view '], 'done');
    expect(r.deliverables.map((d) => [d.id, d.state])).toEqual([
      ['a', 'done'],
      ['b', 'done'],
      ['c', 'done'],
    ]);
    expect(r.marked).toEqual([
      { id: 'a', title: 'Terminal viewer', from: 'pending', to: 'done' },
      { id: 'b', title: 'Watch view', from: 'in_progress', to: 'done' },
    ]);
    expect(r.unmatched).toEqual([]);
    // The input is untouched.
    expect(list[0]!.state).toBe('pending');
  });

  it('leaves a near miss unmatched, in input order', () => {
    // Case differs, a trailing word, a prefix: none of these is the title.
    const r = markDeliverables(list, ['terminal viewer', 'Watch view now', 'Doc'], 'done');
    expect(r.marked).toEqual([]);
    expect(r.unmatched).toEqual(['terminal viewer', 'Watch view now', 'Doc']);
    expect(r.deliverables).toEqual(list);
  });

  it('never moves a done item back to in_progress, and lists a no-op nowhere', () => {
    const r = markDeliverables(list, ['c', 'b'], 'in_progress');
    expect(r.marked).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(r.deliverables.map((d) => d.state)).toEqual(['pending', 'in_progress', 'done']);
  });

  it('moves a pending item to in_progress from a checkpoint', () => {
    const r = markDeliverables(list, ['Terminal viewer'], 'in_progress');
    expect(r.marked).toEqual([
      { id: 'a', title: 'Terminal viewer', from: 'pending', to: 'in_progress' },
    ]);
  });

  it('prefers the id when a title happens to equal another item’s id', () => {
    const odd = [item('x', 'y'), item('y', 'z')];
    const r = markDeliverables(odd, ['y'], 'done');
    expect(r.marked.map((m) => m.id)).toEqual(['y']);
  });
});

describe('deliveredCount', () => {
  it('counts done over total', () => {
    expect(deliveredCount([])).toEqual({ done: 0, total: 0 });
    expect(deliveredCount([item('a', 'A', 'done'), item('b', 'B')])).toEqual({ done: 1, total: 2 });
  });
});
