/**
 * Dragging a board column into a new place (LAI-266).
 *
 * **The first drag test in this repo.** Nothing exercised `onDragStart` /
 * `onDrop` before — the only drag-adjacent assertion was `sprint-strip.test.ts`
 * checking that the keyboard fallback was clipped until focused.
 *
 * ## What this proves, and what it does not
 *
 * Playwright's `dragTo()` drives mouse events, which do **not** reliably produce
 * HTML5 `dragstart`/`drop` in Chromium. So the events are dispatched directly,
 * sharing one real `DataTransfer` built in the page — synthetic in *input*, real
 * in *code path*: `onDragStart`, `onDragOver`, `onDrop`, `setData` and
 * `getData` all run exactly as they do for a person.
 *
 * **It therefore proves the handlers, not the pointer.** The same honesty
 * `harness.ts` states about jsdom: a browser is what makes geometry testable,
 * and this file is not testing geometry. A drag that fails because the grip is
 * two pixels tall would pass here.
 *
 * ## The two crossover cases are the point
 *
 * Cards and columns use different MIME types precisely so one cannot be
 * mistaken for the other, and that mistake has no visible symptom — the drop
 * handler reads an id, misses in its map, and returns. Both directions are
 * asserted, or the separation is a claim nobody checks.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, type ApiStub, type Harness } from './harness.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const FULL_PROJECT = {
  ...PROJECT,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'A task that must not be reordered by a column drag',
  description_md: null,
  acceptance_md: null,
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: true,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
};

function column(id: string, name: string, position: number, statuses: string[]) {
  return {
    id,
    project_id: 'p1',
    name,
    position,
    hidden: false,
    statuses,
    primary_status: statuses[0] ?? null,
  };
}

const COLUMNS = [
  column('c1', 'To do', 0, ['todo', 'backlog']),
  column('c2', 'In progress', 1, ['in_progress']),
  column('c3', 'Review', 2, ['review']),
  column('c4', 'Done', 3, ['done']),
];

function stub(over: Partial<ApiStub> = {}): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/projects': { data: [FULL_PROJECT], next_cursor: null },
    '/api/v1/projects/laika-core': FULL_PROJECT,
    '/api/v1/projects/laika-core/board-columns': { columns: COLUMNS },
    /*
     * **Echoes the order it was sent**, because the real endpoint returns the
     * board it just wrote and `useColumns` takes that as the answer rather than
     * keeping its optimistic guess. A static fixture here would make a correct
     * implementation look broken — the board would revert every drag.
     */
    '/api/v1/projects/laika-core/board-columns/reorder': (call: { body: unknown }) => {
      const ids = (call.body as { column_ids: string[] }).column_ids;
      return {
        columns: ids.map((id, position) => {
          const found = COLUMNS.find((c) => c.id === id);
          return { ...found, position };
        }),
      };
    },
    '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 }],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/presence': { data: [], next_cursor: null },
    ...over,
  };
}

async function board(h: Harness): Promise<void> {
  await h.page.waitForSelector('.lane-title');
}

async function titles(h: Harness): Promise<string[]> {
  return h.page.locator('.lane-title').allTextContents();
}

/**
 * Dispatch a real HTML5 drag sequence between two elements, sharing one
 * `DataTransfer` so `setData` on the source is readable by `getData` on the
 * target — which is what makes this exercise the real code path rather than a
 * pair of disconnected events.
 */
async function drag(h: Harness, from: string, to: string): Promise<void> {
  await h.page.evaluate(
    ([fromSelector, toSelector]) => {
      const source = document.querySelector(fromSelector);
      const target = document.querySelector(toSelector);
      if (source === null || target === null) throw new Error('drag endpoints not found');

      const transfer = new DataTransfer();
      const fire = (node: Element, type: string): void => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        node.dispatchEvent(event);
      };

      fire(source, 'dragstart');
      fire(target, 'dragover');
      fire(target, 'drop');
      fire(source, 'dragend');
    },
    [from, to] as const,
  );
}

after(async () => {
  await closeBrowser();
});

void describe('dragging a column', () => {
  void test('moves it, and sends the whole new order', async () => {
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      assert.deepEqual(await titles(h), ['To do', 'In progress', 'Review', 'Done']);

      // Grip of the last lane onto the first.
      await drag(h, '.lane:nth-of-type(4) .lane-grip', '.lane:nth-of-type(1)');
      await h.page.waitForTimeout(150);

      assert.deepEqual(
        await titles(h),
        ['Done', 'To do', 'In progress', 'Review'],
        'the lane did not move',
      );

      const sent = h.calls.find((c) => c.path.endsWith('/board-columns/reorder'));
      assert.ok(sent !== undefined, 'no reorder was sent');
      assert.deepEqual(
        (sent.body as { column_ids: string[] }).column_ids,
        ['c4', 'c1', 'c2', 'c3'],
        'the whole order must go, so a stale client cannot drop a lane',
      );
    } finally {
      await h.close();
    }
  });

  void test('snaps back and names the reason when the server refuses', async () => {
    const h = await open(
      '/board?project=laika-core',
      stub({
        '/api/v1/projects/laika-core/board-columns/reorder': refuse(
          403,
          'forbidden',
          'Only a project lead may configure columns',
        ),
      }),
    );

    try {
      await board(h);
      await drag(h, '.lane:nth-of-type(4) .lane-grip', '.lane:nth-of-type(1)');
      await h.page.waitForTimeout(250);

      assert.deepEqual(
        await titles(h),
        ['To do', 'In progress', 'Review', 'Done'],
        'a refused reorder must not leave the optimistic order on screen',
      );

      const alert = await h.page.locator('.board-alert').first().textContent();
      assert.match(
        alert ?? '',
        /Only a project lead may configure columns/,
        'the server’s own sentence, not one invented here',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the two drags cannot be confused', () => {
  void test('dragging a card does not reorder a column', async () => {
    // Without separate MIME types this passes silently in the wrong direction:
    // the lane's drop handler reads a task id as a column id, misses, returns.
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      const before = await titles(h);

      await drag(h, '.card', '.lane:nth-of-type(3)');
      await h.page.waitForTimeout(150);

      assert.deepEqual(await titles(h), before, 'a card drag moved a column');
      assert.equal(
        h.calls.filter((c) => c.path.endsWith('/board-columns/reorder')).length,
        0,
        'a card drag sent a reorder',
      );
    } finally {
      await h.close();
    }
  });

  void test('dragging a column does not move a task', async () => {
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);

      await drag(h, '.lane:nth-of-type(1) .lane-grip', '.lane:nth-of-type(3)');
      await h.page.waitForTimeout(150);

      // **Not `endsWith('/status')`** — `/api/v1/setup/status` is a boot call
      // that ends the same way, and counting it made this assertion fail for a
      // reason that had nothing to do with dragging.
      assert.equal(
        h.calls.filter((c) => c.path.includes('/tasks/') && c.path.endsWith('/status')).length,
        0,
        'a column drag changed a task status',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the keyboard route', () => {
  void test('reorders with no drag events at all', async () => {
    // The whole point: everything above could work and a keyboard user still be
    // locked out of rearranging their own board.
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);

      await h.page.locator('.lane:nth-of-type(3) .lane-order-select').selectOption('1');
      await h.page.waitForTimeout(150);

      assert.deepEqual(await titles(h), ['Review', 'To do', 'In progress', 'Done']);

      const sent = h.calls.find((c) => c.path.endsWith('/board-columns/reorder'));
      assert.ok(sent !== undefined, 'the keyboard path sent nothing');
      assert.deepEqual((sent.body as { column_ids: string[] }).column_ids, [
        'c3',
        'c1',
        'c2',
        'c4',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('stays out of the way until it is focused', async () => {
    // Copied from `sprint-strip.test.ts`'s check on `.lane-move`, because this
    // control lives under the same rule: it must not cost a row of chrome on
    // every lane, and it must be reachable.
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      const control = h.page.locator('.lane-order').first();

      const clipped = await control.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(clipped <= 2, `expected the control to be clipped, got ${String(clipped)}px`);

      await h.page.locator('.lane-order-select').first().focus();
      const focused = await control.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(focused > clipped, 'focusing did not bring the control back');
    } finally {
      await h.close();
    }
  });
});
