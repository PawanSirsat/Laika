/**
 * The Members screen (`/members?project=`) says how each action went in the
 * app's toast (LAI-1310): a role change names the person and the role, a
 * removal offers Undo that adds them back with the role they had, and a
 * refusal is a persistent error toast carrying the server's sentence —
 * against the real built SPA and a stubbed API.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type ApiStub, type StubCall } from './harness.ts';
import { pick } from './dropdown.ts';

void after(async () => {
  await closeBrowser();
});

const SLUG = 'kites';

const PROJECT = {
  id: 'p1',
  slug: SLUG,
  name: 'Kites',
  prefix: 'KITE',
  description: '',
  repo: null,
  visibility: 'private',
  color: 'violet',
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [] as string[],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const member = (user_id: string, name: string, role: string) => ({
  user_id,
  name,
  email: `${user_id}@example.com`,
  role,
  created_at: 1,
});

const ME = {
  id: 'u1',
  email: 'u1@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

/** The space and its members; `writes` sees every change, `answer` decides it. */
function stub(writes: StubCall[], answer: (call: StubCall) => unknown): ApiStub {
  let members = [member('u1', 'Ada Lovelace', 'lead'), member('u2', 'Tomas Nel', 'member')];
  const change = (call: StubCall): unknown => {
    writes.push(call);
    const said = answer(call);
    if (said !== undefined) return said;
    if (call.method === 'DELETE') members = members.filter((m) => m.user_id !== 'u2');
    if (call.method === 'PATCH') {
      const { role } = call.body as { role: string };
      members = members.map((m) => (m.user_id === 'u2' ? { ...m, role } : m));
    }
    return { members };
  };
  return {
    '/api/v1/me': ME,
    '/api/v1/org': { id: 'o1', name: 'Kvelld', created_at: 1, updated_at: 1 },
    '/api/v1/projects': { data: [], next_cursor: null },
    [`/api/v1/projects/${SLUG}`]: PROJECT,
    [`/api/v1/projects/${SLUG}/members`]: (call: StubCall) => {
      if (call.method === 'GET') return { members };
      writes.push(call);
      const { user_id, role } = call.body as { user_id: string; role: string };
      members = [...members, member(user_id, 'Tomas Nel', role)];
      return { members };
    },
    [`/api/v1/projects/${SLUG}/members/u2`]: change,
  };
}

const ready = async (h: Awaited<ReturnType<typeof open>>): Promise<void> => {
  await h.page.locator('.member', { hasText: 'Tomas Nel' }).waitFor({ timeout: 20_000 });
};

void describe('Members: every action ends in a toast (LAI-1310)', () => {
  void test('a role change names the person and the new role', async () => {
    const writes: StubCall[] = [];
    const h = await open(
      `/members?project=${SLUG}`,
      stub(writes, () => undefined),
    );
    try {
      await ready(h);
      const row = h.page.locator('.member', { hasText: 'Tomas Nel' });
      await pick(row.getByRole('combobox'), 'viewer');
      await until(() => writes.length === 1);
      assert.deepEqual(writes[0]?.body, { role: 'viewer' });
      const toast = h.page.locator('[data-toast][data-members-result]');
      await toast.waitFor({ timeout: 5_000 });
      assert.equal(await toast.getAttribute('data-tone'), 'success');
      assert.equal(
        (await toast.locator('.toast-text').innerText()).trim(),
        'Tomas Nel is now Viewer',
      );
    } finally {
      await h.close();
    }
  });

  void test('a removal offers Undo, which adds them back with the role they had', async () => {
    const writes: StubCall[] = [];
    const h = await open(
      `/members?project=${SLUG}`,
      stub(writes, () => undefined),
    );
    try {
      await ready(h);
      const row = h.page.locator('.member', { hasText: 'Tomas Nel' });
      await row.getByRole('button', { name: 'Remove' }).click();
      await row.getByRole('button', { name: 'Yes, remove' }).click();
      const toast = h.page.locator('[data-toast][data-members-result]');
      await toast.waitFor({ timeout: 5_000 });
      assert.equal((await toast.locator('.toast-text').innerText()).trim(), 'Tomas Nel removed');
      await until(
        async () => (await h.page.locator('.member', { hasText: 'Tomas Nel' }).count()) === 0,
      );

      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => writes.length === 2);
      assert.equal(writes[0]?.method, 'DELETE');
      assert.equal(writes[1]?.method, 'POST');
      assert.deepEqual(writes[1]?.body, { user_id: 'u2', role: 'member' });
      await until(async () => (await toast.locator('.toast-text').innerText()).includes('is back'));
      assert.match(await toast.innerText(), /Tomas Nel is back, as Member/);
    } finally {
      await h.close();
    }
  });

  void test('a refusal is a persistent error toast with the server’s sentence', async () => {
    const writes: StubCall[] = [];
    const h = await open(
      `/members?project=${SLUG}`,
      stub(writes, () => refuse(409, 'conflict', 'A space needs at least one space admin')),
    );
    try {
      await ready(h);
      const row = h.page.locator('.member', { hasText: 'Tomas Nel' });
      await pick(row.getByRole('combobox'), 'lead');
      const toast = h.page.locator('[data-toast][data-members-result]');
      await toast.waitFor({ timeout: 5_000 });
      assert.equal(await toast.getAttribute('data-tone'), 'error');
      assert.equal(await toast.locator('[role="alert"]').count(), 1);
      assert.equal(
        await toast.locator('.toast-detail').innerText(),
        'A space needs at least one space admin',
      );
      assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});
