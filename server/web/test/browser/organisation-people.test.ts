/**
 * Organisation → People as the owner's "Laika App v3" design draws it
 * (LAI-893), in a real browser: the seat line, the filters with their counts,
 * the search, the sort, each row's figures from `GET /capacity`, the bulk bar,
 * the Pending list, the invite dialog, and the header line's three facts.
 * The API is stubbed; every figure asserted is one the stub served.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until, type ApiStub, type StubCall } from './harness.ts';
import { capacityPerson } from './capacity-org.ts';

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const user = (id: string, name: string, org_role: string, is_active = true) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  user('u1', 'Ada Lovelace', 'owner'),
  user('u2', 'Tomas Nel', 'member'),
  user('u3', 'Priya Raman', 'admin'),
  user('u4', 'Sam Okafor', 'viewer', false),
  user('u5', 'Bea Nkosi', 'member'),
];

const space = (slug: string) => ({
  project_id: `p-${slug}`,
  slug,
  name: slug,
  load: 'light',
  in_progress: 0,
  todo: 0,
  backlog: 0,
  in_review: 0,
  committed: 0,
  overdue: 0,
  due_soon: 0,
  open: 0,
});

const CAPACITY = {
  enabled: true,
  people: [
    capacityPerson({
      user_id: 'u1',
      name: 'Ada Lovelace',
      org_role: 'owner',
      status: 'online',
      last_seen: NOW,
      spaces: [space('a'), space('b'), space('c'), space('d'), space('e')],
      agents: [{ client: 'claude-code', running: true, last_at: NOW }],
    }),
    capacityPerson({
      user_id: 'u2',
      name: 'Tomas Nel',
      status: 'away',
      last_seen: NOW - 18 * MIN,
      spaces: [space('a')],
      agents: [{ client: 'claude-code', running: false, last_at: NOW - HOUR }],
    }),
    capacityPerson({
      user_id: 'u3',
      name: 'Priya Raman',
      org_role: 'admin',
      status: 'offline',
      last_seen: NOW - 2 * HOUR,
      spaces: [space('a'), space('b'), space('c')],
      agents: [],
    }),
    capacityPerson({ user_id: 'u4', name: 'Sam Okafor', status: 'never', last_seen: null }),
    capacityPerson({
      user_id: 'u5',
      name: 'Bea Nkosi',
      status: 'offline',
      last_seen: NOW - 6 * DAY,
      spaces: [space('a'), space('b')],
      agents: [],
    }),
  ],
};

const INVITES = [
  {
    id: 'inv1',
    email: null,
    org_role: 'member',
    project_id: null,
    project_role: null,
    created_by: 'u1',
    created_at: NOW - HOUR,
    expires_at: NOW + 2 * DAY - HOUR,
    email_sent: false,
  },
  {
    id: 'inv2',
    email: 'lindiwe@example.com',
    org_role: 'admin',
    project_id: null,
    project_role: null,
    created_by: 'u3',
    created_at: NOW - DAY,
    expires_at: NOW + 6 * DAY + HOUR,
    email_sent: false,
  },
];

const ORG = {
  id: 'o1',
  name: 'Kvelld Dynamics',
  presence_enabled: true,
  created_at: Date.parse('2026-09-20T00:00:00Z'),
  updated_at: 2,
  ai: { configured: true, provider: 'anthropic', key_last4: '9f2a' },
};

const me = (id: string, org_role: string) => ({
  ...user(id, PEOPLE.find((p) => p.id === id)?.name ?? 'Someone', org_role),
  memberships: [],
});

let issued = 0;

/** Everything the tab reads, with writes answered as the server would. */
function stub(who: { id: string; org_role: string }): ApiStub {
  const routes: Record<string, unknown> = {
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/org': ORG,
    '/api/v1/capacity': CAPACITY,
    '/api/v1/me': me(who.id, who.org_role),
    '/api/v1/invites': (call: StubCall) => {
      if (call.method !== 'POST') return { data: INVITES, next_cursor: null };
      issued += 1;
      const body = call.body as { email: string | null; org_role: string };
      return {
        invite: {
          ...INVITES[1],
          id: `new${String(issued)}`,
          email: body.email,
          org_role: body.org_role,
        },
        accept_url: `http://laika.test/accept/t${String(issued)}`,
      };
    },
    '/api/v1/invites/inv1': () => ({}),
    '/api/v1/invites/inv2': () => ({}),
  };
  for (const p of PEOPLE) {
    routes[`/api/v1/users/${p.id}`] = (call: StubCall) => ({
      ...p,
      ...(call.body as object),
    });
    routes[`/api/v1/users/${p.id}/tokens`] = { data: [], next_cursor: null };
  }
  return routes;
}

async function openPeople(who = { id: 'u1', org_role: 'owner' }) {
  const h = await open('/organisation?tab=people', stub(who));
  await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator('.org-person').count()) === PEOPLE.length);
  return h;
}

const rowOf = (h: Awaited<ReturnType<typeof openPeople>>, name: string) =>
  h.page.locator('.org-person', { hasText: name });

void after(async () => {
  await closeBrowser();
});

void describe('the People tab (LAI-893)', () => {
  void test('the seat line, the filters with their counts, the columns from capacity, and the order', async () => {
    const h = await openPeople();
    try {
      assert.equal(
        (await h.page.locator('[data-seat-line]').innerText()).trim(),
        '4 members · 1 admin · 2 pending invites',
      );
      const filters = await h.page
        .locator('[data-people-filter]')
        .evaluateAll((els) =>
          els.map(
            (el) =>
              `${el.getAttribute('data-people-filter') ?? ''}=${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}`,
          ),
        );
      assert.deepEqual(filters, [
        'all=All 5',
        'owner=Owner 1',
        'admin=Admin 1',
        'member=Member 2',
        // LAI-999: LAI-987's Deactivated filter, shown when anyone is.
        'off=Deactivated 1',
        'pending=Pending 2',
      ]);

      // The reader first; then by last seen; deactivated last.
      const order = await h.page.locator('.org-person .org-person-name').allInnerTexts();
      assert.deepEqual(
        order.map((t) => t.replace(/\s*(YOU|DEACTIVATED)\s*/g, '').trim()),
        ['Ada Lovelace', 'Tomas Nel', 'Priya Raman', 'Bea Nkosi', 'Sam Okafor'],
      );

      const ada = rowOf(h, 'Ada Lovelace');
      assert.equal(await ada.locator('[data-online]').count(), 1, 'no presence dot');
      assert.equal((await ada.locator('[data-spaces]').innerText()).trim(), '5');
      assert.equal((await ada.locator('[data-agents]').innerText()).trim(), '1');
      assert.equal(await ada.locator('.org-agent-dot-on').count(), 1, 'no running dot');
      assert.equal((await ada.locator('[data-last-active]').innerText()).trim(), 'Active now');
      assert.equal(await ada.locator('.org-person-role-owner').innerText(), 'Owner');
      assert.equal(await ada.locator('.org-chip-you').count(), 1);
      // The own row has no controls, as ever.
      assert.equal(await ada.locator('button, input').count(), 0);

      const tomas = rowOf(h, 'Tomas Nel');
      assert.equal((await tomas.locator('[data-last-active]').innerText()).trim(), '18m ago');
      assert.equal((await tomas.locator('[data-spaces]').innerText()).trim(), '1');
      assert.equal(await tomas.locator('[data-online]').count(), 0);
      assert.equal(
        (await rowOf(h, 'Priya Raman').locator('[data-last-active]').innerText()).trim(),
        '2h ago',
      );
      assert.equal(
        (await rowOf(h, 'Bea Nkosi').locator('[data-last-active]').innerText()).trim(),
        '6d ago',
      );
      const sam = rowOf(h, 'Sam Okafor');
      assert.equal((await sam.locator('[data-last-active]').innerText()).trim(), 'Deactivated');
      assert.equal(await sam.locator('.org-chip-off').count(), 1);
      assert.equal(await sam.locator('.org-reactivate').count(), 1);

      // Sort cycles; by name puts Ada's own row first still, then the alphabet.
      await h.page.locator('[data-people-sort]').click();
      await until(async () => (await h.page.locator('[data-people-sort="name"]').count()) === 1);
      const byName = await h.page.locator('.org-person .org-person-name').allInnerTexts();
      assert.deepEqual(
        byName.map((t) => t.replace(/\s*(YOU|DEACTIVATED)\s*/g, '').trim()),
        ['Ada Lovelace', 'Bea Nkosi', 'Priya Raman', 'Tomas Nel', 'Sam Okafor'],
      );
      assert.equal(
        (await h.page.locator('[data-people-shown]').innerText()).trim(),
        'Showing 5 of 5',
      );

      // The header line: three facts, each its own span.
      const facts = await h.page.locator('.org-context-fact').allInnerTexts();
      // The date is in the browser's own locale: the shape, not the words.
      assert.equal(facts.length, 3);
      assert.equal(facts[0], 'Owner · Ada Lovelace');
      assert.match(facts[1] ?? '', /^Created \S.*2026$/);
      assert.equal(facts[2], '5 people · 4 active');
    } finally {
      await h.close();
    }
  });

  void test('a filter and a search narrow the rows; an empty search offers to invite', async () => {
    const h = await openPeople();
    try {
      await h.page.locator('[data-people-filter="member"]').click();
      await until(async () => (await h.page.locator('.org-person').count()) === 2);
      await h.page.locator('[data-people-search]').fill('nkosi');
      await until(async () => (await h.page.locator('.org-person').count()) === 1);
      assert.match(await h.page.locator('.org-person').innerText(), /Bea Nkosi/);
      await h.page.locator('[data-people-search]').fill('zed@example.com');
      await h.page.locator('[data-people-empty]').waitFor({ timeout: 5_000 });
      assert.match(
        await h.page.locator('[data-people-empty]').innerText(),
        /No one matches “zed@example.com”/,
      );
      await h.page.locator('[data-people-empty] button').click();
      const dialog = h.page.locator('[data-invite-dialog]');
      await dialog.waitFor({ timeout: 5_000 });
      assert.equal(await dialog.locator('[data-invite-emails]').inputValue(), 'zed@example.com');
      assert.equal(await dialog.getByRole('button', { name: 'Send invite' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('ticked rows get a bar; Make Admin PATCHes each one, in order', async () => {
    const h = await openPeople();
    try {
      assert.equal(await h.page.locator('[data-people-bulk]').count(), 0);
      await h.page.locator('[data-people-tick="u2"]').check();
      await h.page.locator('[data-people-tick="u5"]').check();
      const bar = h.page.locator('[data-people-bulk]');
      await bar.waitFor({ timeout: 5_000 });
      assert.match(await bar.innerText(), /^2 selected/);
      await bar.getByRole('button', { name: 'Make Admin' }).click();
      // LAI-999: a role change asks first (LAI-987), the bulk one included.
      const confirm = h.page.locator('[data-confirm-dialog]');
      await confirm.waitFor({ timeout: 5_000 });
      assert.match(await confirm.innerText(), /Make 2 people admins\?/);
      assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 0);
      await confirm.locator('[data-confirm-ok] button').click();
      await until(() => h.calls.filter((c) => c.method === 'PATCH').length === 2);
      const patches = h.calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body]);
      assert.deepEqual(patches, [
        ['/api/v1/users/u2', { org_role: 'admin' }],
        ['/api/v1/users/u5', { org_role: 'admin' }],
      ]);
      await until(async () => (await h.page.locator('[data-people-bulk]').count()) === 0);
      // The header box ticks every editable row shown: never the reader, never the owner.
      await h.page.locator('[data-people-tick-all]').check();
      await until(async () => (await h.page.locator('[data-people-tick]:checked').count()) === 2);
    } finally {
      await h.close();
    }
  });

  void test('Tokens opens that person’s tokens on Security', async () => {
    const h = await openPeople();
    try {
      await rowOf(h, 'Tomas Nel').getByRole('button', { name: 'Tokens' }).click();
      await until(() => new URL(h.page.url()).search === '?tab=security');
      await h.page.locator('#tokens-u2').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('Invite people: a link with no address, N POSTs for N addresses, the links shown once', async () => {
    const h = await openPeople();
    try {
      await h.page.locator('[data-invite-open]').click();
      const dialog = h.page.locator('[data-invite-dialog]');
      await dialog.waitFor({ timeout: 5_000 });
      assert.match(await dialog.innerText(), /Invite people[\s\S]*to Kvelld Dynamics/);
      assert.equal(await dialog.getByRole('button', { name: 'Create link' }).count(), 1);
      await dialog.locator('[data-invite-emails]').fill('one@example.com, two@example.com');
      const send = dialog.getByRole('button', { name: 'Send 2 invites' });
      await send.waitFor({ timeout: 5_000 });
      await dialog.locator('[data-invite-role="admin"]').click();
      await send.click();
      await until(() => h.calls.filter((c) => c.method === 'POST').length === 2);
      assert.deepEqual(
        h.calls.filter((c) => c.method === 'POST').map((c) => c.body),
        [
          { email: 'one@example.com', org_role: 'admin' },
          { email: 'two@example.com', org_role: 'admin' },
        ],
      );
      const done = dialog.getByRole('button', { name: 'Done' });
      await done.waitFor({ timeout: 5_000 });
      const said = await dialog.innerText();
      assert.match(said, /2 invites created/);
      assert.match(said, /http:\/\/laika\.test\/accept\/t\d+/);
      assert.match(said, /send each link yourself/);
      await done.click();
      await until(async () => (await h.page.locator('[data-invite-dialog]').count()) === 0);

      // No address: one POST with none, a link.
      await h.page.locator('[data-invite-open]').click();
      await dialog.waitFor({ timeout: 5_000 });
      await dialog.getByRole('button', { name: 'Create link' }).click();
      await until(() => h.calls.filter((c) => c.method === 'POST').length === 3);
      assert.deepEqual(h.calls.filter((c) => c.method === 'POST').at(-1)?.body, {
        email: null,
        org_role: 'member',
      });
      await dialog.getByRole('button', { name: 'Done' }).waitFor({ timeout: 5_000 });
      assert.match(await dialog.innerText(), /Invite link created/);
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator('[data-invite-dialog]').count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('Pending lists the invites with who, when and the expiry; Revoke DELETEs', async () => {
    const h = await openPeople();
    try {
      await h.page.locator('[data-people-filter="pending"]').click();
      const pending = h.page.locator('[data-people-pending]');
      await pending.waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('[data-people-sort]').count(), 0, 'sort shown for invites');
      const link = pending.locator('[data-invite="inv1"]');
      assert.match(
        await link.innerText(),
        /Anyone with the link[\s\S]*MEMBER[\s\S]*expires tomorrow · not emailed/,
      );
      const emailed = pending.locator('[data-invite="inv2"]');
      assert.match(
        await emailed.innerText(),
        /lindiwe@example\.com[\s\S]*ADMIN[\s\S]*invited 1d ago by Priya Raman · expires in 6 days/,
      );
      await link.getByRole('button', { name: 'Revoke' }).click();
      await until(() =>
        h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/invites/inv1'),
      );
    } finally {
      await h.close();
    }
  });

  void test('a member sees the table and its figures, with no controls and no Pending', async () => {
    const h = await openPeople({ id: 'u2', org_role: 'member' });
    try {
      assert.equal(
        (await h.page.locator('[data-seat-line]').innerText()).trim(),
        '4 members · 1 admin',
      );
      assert.equal(await h.page.locator('[data-people-filter="pending"]').count(), 0);
      assert.equal(await h.page.locator('.org-person button, .org-person input').count(), 0);
      assert.equal(await h.page.locator('[data-invite-open]').count(), 0);
      assert.equal(
        (await rowOf(h, 'Ada Lovelace').locator('[data-spaces]').innerText()).trim(),
        '5',
      );
      // The reader's own row first, YOU on it.
      assert.match(await h.page.locator('.org-person').first().innerText(), /Tomas Nel[\s\S]*YOU/);
    } finally {
      await h.close();
    }
  });
});
