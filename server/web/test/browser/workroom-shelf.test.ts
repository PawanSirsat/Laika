/**
 * The Workroom and the shelves (LAI-1358): Archive and Delete… in the full
 * page's header, the page read-only once the task is put away, and
 * `/task/:key` opening a task that is archived or in Trash rather than
 * saying *No task*.
 *
 * One state behind the stub: which of LC-1 is live, archived or in Trash. The
 * live set, both shelves and `/tasks/t1` all answer from it, as the server
 * does, so archiving from the page moves LC-1 from the set to its shelf.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { answerConfirm, confirmSettled } from './confirm.ts';
import { closeBrowser, open, type ApiStub, type Harness, type StubCall } from './harness.ts';
import { STUB, T1 } from './workroom-fixtures.ts';

type Place = 'live' | 'archived' | 'trash';

const LIVE_LIST = '/api/v1/projects/laika-core/tasks';
const EVERY_TASK = (STUB[LIVE_LIST] as { data: readonly { id: string }[] }).data;

function shelved(place: Place = 'live'): ApiStub {
  let where: Place = place;
  const t1 = () => ({
    ...T1,
    archived_at: where === 'archived' ? Date.UTC(2026, 10, 3, 12) : null,
    archived_by: where === 'archived' ? 'u1' : null,
    deleted_at: where === 'trash' ? Date.now() : null,
    deleted_by: where === 'trash' ? 'u1' : null,
  });
  const list = (shelf: Place) => () => ({
    data: EVERY_TASK.map((t) => (t.id === 't1' ? t1() : t)).filter(
      (t) => t.id !== 't1' || where === shelf,
    ),
    next_cursor: null,
  });
  return {
    ...STUB,
    [LIVE_LIST]: undefined,
    [`${LIVE_LIST}?fields=slim`]: list('live'),
    [`${LIVE_LIST}?fields=slim&archived=only`]: list('archived'),
    [`${LIVE_LIST}?fields=slim&trash=only`]: list('trash'),
    '/api/v1/tasks/t1': (call: StubCall) => {
      if (call.method === 'PATCH') {
        const to = (call.body as { archived?: boolean }).archived;
        if (to === true) where = 'archived';
        if (to === false) where = 'live';
      }
      if (call.method === 'DELETE') where = 'trash';
      return t1();
    },
    '/api/v1/tasks/t1/restore': () => {
      where = 'live';
      return t1();
    },
  };
}

async function workroom(stub: ApiStub): Promise<Harness> {
  const h = await open('/task/LC-1', stub);
  try {
    await h.page.setViewportSize({ width: 1440, height: 900 });
    await h.page.locator('.wr-title').waitFor({ timeout: 20_000 });
  } catch (error) {
    // A page that never draws the task must still close, or the run hangs.
    await h.close();
    throw error;
  }
  return h;
}

const writes = (calls: readonly StubCall[]) =>
  calls
    .filter((c) => c.method !== 'GET' && c.path.startsWith('/api/v1/tasks/t1'))
    .map((c) => [c.method, c.path, c.body ?? null]);

void after(async () => {
  await closeBrowser();
});

void describe('the Workroom and the shelves (LAI-1358)', () => {
  void test('Archive from the header keeps the page on the task, read-only, with Restore', async () => {
    const h = await workroom(shelved());
    try {
      const archive = h.page.locator('.wr-head [data-archive-action="archive"]');
      await archive.waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.wr-head [data-trash-action="delete"]').count(), 1);
      // Live, the description and acceptance are editable: the check below means something.
      const editable = h.page.locator('.doc-field-can');
      assert.ok((await editable.count()) > 0, 'nothing is editable on the live task');
      await archive.click();

      await h.page.locator('[data-toast]', { hasText: 'LC-1 and' }).waitFor({ timeout: 10_000 });
      assert.deepEqual(writes(h.calls), [['PATCH', '/api/v1/tasks/t1', { archived: true }]]);
      // The page found LC-1 on its shelf and stayed on it.
      const banner = h.page.locator('[data-archived-banner]');
      await banner.waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-state="not-found"]').count(), 0);
      assert.equal(await archive.count(), 0, 'Archive is still offered on an archived task');
      await h.page.locator('[data-archived-composer]').waitFor({ timeout: 10_000 });
      assert.equal(await editable.count(), 0, 'the archived task is still editable');

      await banner.getByRole('button', { name: 'Restore' }).click();
      await banner.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(writes(h.calls).at(-1), ['PATCH', '/api/v1/tasks/t1', { archived: false }]);
      await archive.waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('Delete… asks first, then the page shows the Trash banner', async () => {
    const h = await workroom(shelved());
    try {
      await h.page.locator('.wr-head [data-trash-action="delete"]').click({ timeout: 10_000 });
      await confirmSettled(h.page);
      assert.deepEqual(writes(h.calls), []);
      assert.match(await answerConfirm(h.page, true), /Move LC-1 to Trash\?/);

      await h.page.locator('[data-trash-banner]').waitFor({ timeout: 10_000 });
      assert.deepEqual(writes(h.calls), [['DELETE', '/api/v1/tasks/t1', null]]);
      assert.equal(await h.page.locator('.wr-head [data-trash-action]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('opens a task in Trash by its URL, with its banner, not "No task"', async () => {
    const h = await workroom(shelved('trash'));
    try {
      const banner = h.page.locator('[data-trash-banner]');
      await banner.waitFor({ timeout: 10_000 });
      assert.match(await banner.innerText(), /Moved to Trash by Ada Lovelace .+ 30 days left/);
      assert.equal(await h.page.locator('[data-state="not-found"]').count(), 0);
      assert.equal(await h.page.locator('.wr-head [data-archive-action]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('opens an archived task by its URL, read-only', async () => {
    const h = await workroom(shelved('archived'));
    try {
      await h.page.locator('[data-archived-banner]').waitFor({ timeout: 10_000 });
      // The description reads as text, with no way into the editor.
      assert.equal(await h.page.locator('.doc-field-can').count(), 0);
      assert.equal(await h.page.getByRole('button', { name: /^Edit description$/ }).count(), 0);
    } finally {
      await h.close();
    }
  });
});
