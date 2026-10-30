/**
 * Space settings (D-103, LAI-977): `/spaces/<slug>/settings`, the owner's four
 * tabs, against the real built SPA and a stubbed API.
 *
 * **Every control follows the server's grants, never the role** (LAI-970).
 * The two readers that prove it are a member with no settings grant, who
 * must see every value and no control, and an admin whose *Open every
 * project* the owner withdrew — an org role that would have managed the
 * space, and whose answer from `/permissions` says no. Both are watched from
 * before the app boots (`watchFor`), so a control drawn for one frame fails.
 *
 * And the refusals are the product: a prefix another space holds or held,
 * and the last space admin leaving, are `409`s whose message is the
 * instruction. Each is asserted by its words, not by "an error appeared".
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  defaultPermissions,
  everSeen,
  navigateInApp,
  open,
  refuse,
  reply,
  until,
  watchFor,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { pick } from './dropdown.ts';

const SLUG = 'laika';
const SETTINGS = `/spaces/${SLUG}/settings`;

const PROJECT = {
  id: 'p1',
  slug: SLUG,
  name: 'Laika',
  prefix: 'LAIKA',
  description: 'The board humans and agents share.',
  repo: 'PawanSirsat/Laika',
  visibility: 'private',
  color: 'violet',
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [] as string[],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null as number | null,
  created_at: 1,
  updated_at: 1,
};

/** The list's summary of the same space: 720 tasks, so the next is LAIKA-721. */
const SUMMARY = {
  ...PROJECT,
  task_counts: { backlog: 20, todo: 100, in_progress: 0, review: 0, done: 600, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [
    { user_id: 'u1', name: 'Pawan Sirsat' },
    { user_id: 'u2', name: 'Tomas Nel' },
  ],
  last_activity_at: 2,
};

const OTHER = {
  ...SUMMARY,
  id: 'p2',
  slug: 'onroute',
  name: 'Onroute',
  prefix: 'ONR',
  color: 'teal',
};

const member = (user_id: string, name: string, role: string) => ({
  user_id,
  name,
  email: `${user_id}@example.com`,
  role,
  created_at: 1,
});

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const ME = {
  id: 'u1',
  email: 'u1@example.com',
  name: 'Pawan Sirsat',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

/** The org, the space, its members and the people in the org; `/me` per test. */
function stub(
  me: Record<string, unknown>,
  overrides: ApiStub = {},
  project: Record<string, unknown> = PROJECT,
): ApiStub {
  return {
    '/api/v1/me': me,
    '/api/v1/org': {
      id: 'o1',
      name: 'Kvelld',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/projects': { data: [{ ...SUMMARY, ...project }, OTHER], next_cursor: null },
    [`/api/v1/projects/${SLUG}`]: project,
    [`/api/v1/projects/${SLUG}/members`]: {
      members: [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'member')],
    },
    '/api/v1/projects/onroute/members': {
      members: [member('u2', 'Tomas Nel', 'member'), member('u3', 'Priya Raman', 'viewer')],
    },
    '/api/v1/users': {
      data: [
        user('u1', 'Pawan Sirsat', 'owner'),
        user('u2', 'Tomas Nel', 'member'),
        user('u3', 'Priya Raman', 'member'),
        user('u4', 'Sam Okafor', 'viewer'),
      ],
      next_cursor: null,
    },
    ...overrides,
  };
}

/** A member of the space, as a member, with the default grants: reads, never configures. */
const MEMBER_ME = {
  ...ME,
  id: 'u2',
  name: 'Tomas Nel',
  org_role: 'member',
  memberships: [{ project_id: 'p1', role: 'member' }],
};

/**
 * An org admin whose *Open every project* the owner withdrew (D-102 rule 6):
 * a role that manages every space by default, and a `/permissions` answer
 * that holds nothing for this one. Not a member.
 */
const WITHDRAWN_ADMIN = { ...ME, id: 'u5', name: 'Ruth Admin', org_role: 'admin', memberships: [] };
const WITHDRAWN_PERMISSIONS = {
  org_roles: ['owner', 'admin', 'member', 'viewer'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [],
  me: {
    org_role: 'admin',
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    // Everything an admin holds in the org, still — only the project grant went.
    actions: (defaultPermissions({ org_role: 'admin' }) as { me: { actions: string[] } }).me
      .actions,
    projects: [],
  },
};

/** Every control the page draws for somebody who may change the space. */
const CONTROLS = [
  '#ss-name',
  '#ss-prefix',
  '#ss-description',
  '#ss-repo',
  '[data-swatch]',
  '[data-visibility][role="radio"]',
  '[data-create]',
  '[role="switch"]:not([disabled])',
  '[data-action="archive"]',
  '[data-action="remove"]',
  '[data-add-role]',
  '[data-action="copy-members"]',
];

async function settled(h: Harness): Promise<void> {
  await h.page.locator('.ss-reader').waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator('.ss-reader').innerText()) !== 'Space settings');
}

async function tab(h: Harness, id: string): Promise<void> {
  await h.page.locator(`.page-tab[data-tab="${id}"]`).click();
  await until(
    async () =>
      (await h.page.locator(`.page-tab[data-tab="${id}"]`).getAttribute('aria-current')) === 'page',
  );
}

after(async () => {
  await closeBrowser();
});

void describe('the route', () => {
  void test('/spaces/<slug>/settings opens the space, and a bad slug is the server’s 404', async () => {
    const h = await open(SETTINGS, stub(ME));
    try {
      await settled(h);
      assert.equal(await h.page.locator('.screen-page-title').innerText(), 'Laika');
      assert.equal(await h.page.title(), 'Space settings · Laika');
      assert.equal(await h.page.locator('.ss-key').innerText(), 'LAIKA · PawanSirsat/Laika');
      assert.equal(await h.page.locator('.ss-badge').first().innerText(), 'PRIVATE');
      assert.equal(await h.page.locator('.ss-avatar').getAttribute('data-color'), 'violet');
      assert.equal(
        await h.page.locator('.ss-reader').innerText(),
        'Space settings · you manage this space as organisation Owner',
      );
      const tabs = await h.page.locator('.page-tab').allInnerTexts();
      assert.deepEqual(
        tabs.map((t) => t.replace(/\s+/g, ' ').trim()),
        ['General', 'Members 2 people', 'Access', 'Danger zone'],
      );
      // Open board, and ← Spaces.
      assert.equal(
        await h.page.locator('.ss-open-board').getAttribute('href'),
        '/board?project=laika',
      );
      assert.equal(await h.page.locator('.ss-back').getAttribute('href'), '/projects');
    } finally {
      await h.close();
    }
  });

  void test('a space the reader cannot open says so, rather than drawing an empty form', async () => {
    const h = await open('/spaces/nope/settings', {
      ...stub(ME),
      '/api/v1/projects/nope': refuse(404, 'not_found', 'Project not found'),
      '/api/v1/projects/nope/members': refuse(404, 'not_found', 'Project not found'),
    });
    try {
      await h.page.locator('.state').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('#ss-name').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('General', () => {
  void test('shows every field, the next key, and Save waits for a change', async () => {
    const h = await open(SETTINGS, stub(ME));
    try {
      await settled(h);
      assert.equal(await h.page.locator('#ss-name').inputValue(), 'Laika');
      assert.equal(await h.page.locator('#ss-prefix').inputValue(), 'LAIKA');
      assert.equal(await h.page.locator('#ss-repo').inputValue(), 'PawanSirsat/Laika');
      await until(async () => (await h.page.locator('[data-next-key]').count()) === 1);
      assert.equal(await h.page.locator('[data-next-key]').innerText(), 'Next task: LAIKA-721');
      const help = await h.page
        .locator('.ss-row', { has: h.page.locator('#ss-prefix') })
        .innerText();
      assert.match(help, /Existing tasks keep their numbers\./);
      assert.match(help, /Old keys keep working\./);
      assert.equal(await h.page.locator('[data-swatch]').count(), 8);
      assert.equal(
        await h.page.locator('[data-swatch][aria-checked="true"]').getAttribute('data-swatch'),
        'violet',
      );

      const save = h.page.getByRole('button', { name: 'Save changes' });
      const discard = h.page.getByRole('button', { name: 'Discard' });
      assert.equal(await save.isDisabled(), true, 'Save is live before anything changed');
      assert.equal(await discard.isDisabled(), true);

      // Typing a new key moves the preview with it, before anything is saved.
      await h.page.locator('#ss-prefix').fill('lk');
      assert.equal(await h.page.locator('[data-next-key]').innerText(), 'Next task: LK-721');
      assert.equal(await save.isDisabled(), false);

      // Discard puts it back and Save goes quiet again.
      await discard.click();
      assert.equal(await h.page.locator('#ss-prefix').inputValue(), 'LAIKA');
      assert.equal(await save.isDisabled(), true);
      assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 0, 'Discard sent something');
    } finally {
      await h.close();
    }
  });

  void test('Save sends only what changed, and the page shows the server’s answer', async () => {
    let current: Record<string, unknown> = { ...PROJECT };
    const h = await open(
      SETTINGS,
      stub(ME, {
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) => {
          if (call.method === 'PATCH') current = { ...current, ...(call.body as object) };
          return current;
        },
      }),
    );
    try {
      await settled(h);
      await h.page.locator('#ss-name').fill('Laika Board');
      await h.page.locator('[data-swatch="teal"]').click();
      await h.page.getByRole('button', { name: 'Save changes' }).click();
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      const patch = h.calls.find((c) => c.method === 'PATCH');
      assert.deepEqual(patch?.body, { name: 'Laika Board', color: 'teal' });
      await until(
        async () => (await h.page.locator('.screen-page-title').innerText()) === 'Laika Board',
      );
      assert.equal(await h.page.locator('.ss-avatar').getAttribute('data-color'), 'teal');
      assert.equal(await h.page.getByRole('button', { name: 'Save changes' }).isDisabled(), true);
    } finally {
      await h.close();
    }
  });

  for (const [why, message, details] of [
    [
      'held by another space now',
      'A project with prefix "ONR" already exists',
      { field: 'prefix' },
    ],
    [
      'held by another space before',
      '"OLD" was another space\'s prefix, and its old keys still lead there — pick another',
      { field: 'prefix', reason: 'former' },
    ],
  ] as const) {
    void test(`a prefix ${why} is refused under the Key field, in the server’s words`, async () => {
      const h = await open(
        SETTINGS,
        stub(ME, {
          [`/api/v1/projects/${SLUG}`]: (call: StubCall) =>
            call.method === 'PATCH'
              ? reply(409, { error: { code: 'conflict', message, details } })
              : PROJECT,
        }),
      );
      try {
        await settled(h);
        await h.page.locator('#ss-prefix').fill('ONR');
        await h.page.getByRole('button', { name: 'Save changes' }).click();
        const error = h.page.locator('#ss-prefix-error');
        await error.waitFor({ timeout: 5_000 });
        assert.equal(await error.innerText(), message);
        assert.equal(await h.page.locator('#ss-prefix').getAttribute('aria-invalid'), 'true');
        // The typed key stays, so it can be corrected rather than retyped.
        assert.equal(await h.page.locator('#ss-prefix').inputValue(), 'ONR');
      } finally {
        await h.close();
      }
    });
  }

  void test('a 422 lands on its field', async () => {
    const h = await open(
      SETTINGS,
      stub(ME, {
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) =>
          call.method === 'PATCH'
            ? reply(422, {
                error: {
                  code: 'unprocessable',
                  message: 'Invalid request body',
                  details: {
                    issues: [
                      {
                        path: 'prefix',
                        message: 'A prefix is 2-8 letters and digits, starting with a letter',
                        code: 'invalid_string',
                      },
                    ],
                  },
                },
              })
            : PROJECT,
      }),
    );
    try {
      await settled(h);
      await h.page.locator('#ss-prefix').fill('9X');
      await h.page.getByRole('button', { name: 'Save changes' }).click();
      const error = h.page.locator('#ss-prefix-error');
      await error.waitFor({ timeout: 5_000 });
      assert.equal(
        await error.innerText(),
        'A prefix is 2-8 letters and digits, starting with a letter',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Members', () => {
  void test('lists people with YOU, role names, and adds several at once as one role', async () => {
    const added: unknown[] = [];
    const list = [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'member')];
    const h = await open(
      `${SETTINGS}?tab=members`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}/members`]: (call: StubCall) => {
          if (call.method === 'POST') {
            added.push(call.body);
            const body = call.body as { user_id: string; role: string };
            list.push(
              member(body.user_id, body.user_id === 'u3' ? 'Priya Raman' : 'Sam Okafor', body.role),
            );
            return reply(201, { members: list });
          }
          return { members: list };
        },
      }),
    );
    try {
      await settled(h);
      await h.page.locator('.ss-member').first().waitFor();
      const first = await h.page.locator('.ss-member').first().innerText();
      assert.match(first, /Pawan Sirsat/);
      assert.match(first, /YOU/);
      assert.match(
        await h.page.locator('.ss-card-head').innerText(),
        /Space admins change settings and members/,
      );
      assert.match(
        await h.page.locator('.ss-card-foot').innerText(),
        /granted “Open every project” can manage every\s+space without being a member/,
      );

      const search = h.page.getByRole('searchbox', { name: 'Add people from Kvelld' });
      await search.click();
      await h.page.locator('[data-person="u3"]').click();
      await search.fill('sam');
      await h.page.locator('[data-person="u4"]').click();
      await h.page.locator('[data-add-role="viewer"]').click();
      await h.page.locator('[data-action="add-people"]').click();
      await until(() => added.length === 2);
      assert.deepEqual(added, [
        { user_id: 'u3', role: 'viewer' },
        { user_id: 'u4', role: 'viewer' },
      ]);
      await until(async () => (await h.page.locator('.ss-member').count()) === 4);
      assert.match(await h.page.locator('[data-toast]').innerText(), /Added 2 people as Viewer/);
    } finally {
      await h.close();
    }
  });

  void test('removing asks first, then Undo puts them back with the role they had', async () => {
    const calls: string[] = [];
    let list = [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'member')];
    const h = await open(
      `${SETTINGS}?tab=members`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}/members/u2`]: (call: StubCall) => {
          calls.push(call.method);
          list = list.filter((m) => m.user_id !== 'u2');
          return { members: list };
        },
        [`/api/v1/projects/${SLUG}/members`]: (call: StubCall) => {
          if (call.method === 'POST') {
            calls.push(`POST ${JSON.stringify(call.body)}`);
            list = [...list, member('u2', 'Tomas Nel', (call.body as { role: string }).role)];
            return reply(201, { members: list });
          }
          return { members: list };
        },
      }),
    );
    try {
      await settled(h);
      const row = h.page.locator('[data-member="u2"]');
      await row.locator('[data-action="remove"]').click();
      assert.equal(calls.length, 0, 'removed without asking');
      // The offboarding dialog asks (LAI-988); Tomas holds no open work, so one confirm.
      await h.page.locator('[data-action="offboard-confirm"]').click();
      await until(() => calls.includes('DELETE'));
      await h.page.locator('[data-member="u2"]').waitFor({ state: 'detached' });
      const toast = h.page.locator('[data-toast]');
      assert.match(await toast.innerText(), /Removed Tomas Nel from Laika\./);
      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => calls.some((c) => c.startsWith('POST')));
      assert.equal(calls.at(-1), 'POST {"user_id":"u2","role":"member"}');
      await h.page.locator('[data-member="u2"]').waitFor();
    } finally {
      await h.close();
    }
  });

  void test('Copy members from another space adds the people not already here, with their roles there', async () => {
    const added: unknown[] = [];
    const h = await open(
      `${SETTINGS}?tab=members`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}/members`]: (call: StubCall) => {
          if (call.method === 'POST') {
            added.push(call.body);
            return reply(201, {
              members: [
                member('u1', 'Pawan Sirsat', 'lead'),
                member('u2', 'Tomas Nel', 'member'),
                member('u3', 'Priya Raman', 'viewer'),
              ],
            });
          }
          return {
            members: [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'member')],
          };
        },
      }),
    );
    try {
      await settled(h);
      await h.page.locator('[data-action="copy-members"]').click();
      await pick(h.page.locator('.ss-copy [role="combobox"]'), 'onroute');
      const preview = h.page.locator('[data-copy-preview]');
      await preview.waitFor({ timeout: 5_000 });
      // Tomas is here already; only Priya comes, as the viewer she is there.
      assert.equal(await preview.innerText(), 'Adds Priya Raman (Viewer).');
      await h.page.locator('[data-action="confirm-copy"]').click();
      await until(() => added.length === 1);
      assert.deepEqual(added, [{ user_id: 'u3', role: 'viewer' }]);
    } finally {
      await h.close();
    }
  });

  void test('the last space admin leaving is told why, in the server’s words', async () => {
    const message =
      'You are the last space admin here — make someone else a space admin, then leave';
    const h = await open(
      `${SETTINGS}?tab=members`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}/leave`]: reply(409, {
          error: { code: 'conflict', message, details: { field: 'role', reason: 'last_lead' } },
        }),
      }),
    );
    try {
      await settled(h);
      await h.page.locator('[data-action="leave"]').click();
      await h.page.locator('[data-action="confirm-leave"]').click();
      const error = h.page.locator('[data-error="leave"]');
      await error.waitFor({ timeout: 5_000 });
      assert.equal(await error.innerText(), message);
      assert.equal(new URL(h.page.url()).pathname, SETTINGS, 'left the page on a refusal');
    } finally {
      await h.close();
    }
  });

  void test('an owner who leaves is told they can still open it, and stays', async () => {
    const notice =
      'You left Laika, and can still open it: your organisation role holds “Open every project”.';
    let left = false;
    const h = await open(
      `${SETTINGS}?tab=members`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}/leave`]: () => {
          left = true;
          return { slug: SLUG, implicit_access: true, notice };
        },
        [`/api/v1/projects/${SLUG}/members`]: () => ({
          members: left
            ? [member('u2', 'Tomas Nel', 'lead')]
            : [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'lead')],
        }),
      }),
    );
    try {
      await settled(h);
      await h.page.locator('[data-action="leave"]').click();
      await h.page.locator('[data-action="confirm-leave"]').click();
      await h.page.locator('[data-left-notice]').waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('[data-left-notice]').innerText(), notice);
      assert.equal(new URL(h.page.url()).pathname, SETTINGS);
    } finally {
      await h.close();
    }
  });
});

void describe('Access', () => {
  void test('each change saves at once; sign-off is locked on; no Join without approval', async () => {
    let current: Record<string, unknown> = { ...PROJECT };
    const h = await open(
      `${SETTINGS}?tab=access`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) => {
          if (call.method === 'PATCH') current = { ...current, ...(call.body as object) };
          return current;
        },
      }),
    );
    try {
      await settled(h);
      // Access & rules is the first card; the hand-off policy is the second (LAI-550).
      assert.match(
        await h.page.locator('.ss-card-head').first().innerText(),
        /Changes save immediately/,
      );
      assert.match(
        await h.page.locator('[data-visibility="public"]').innerText(),
        /Anyone in Kvelld can find it and join\./,
      );

      // Who can create tasks.
      await h.page.locator('[data-create="lead"]').click();
      await until(
        async () =>
          (await h.page.locator('[data-create="lead"]').getAttribute('aria-checked')) === 'true',
      );
      // Agent sessions.
      const agents = h.page.getByRole('switch', { name: 'Agent sessions' });
      await agents.click();
      await until(async () => (await agents.getAttribute('aria-checked')) === 'false');
      // Public asks first.
      await h.page.locator('[data-visibility="public"]').click();
      await h.page.getByRole('button', { name: 'Make public' }).click();
      await until(
        async () =>
          (await h.page.locator('[data-visibility="public"]').getAttribute('aria-checked')) ===
          'true',
      );

      const patches = h.calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
      assert.deepEqual(patches, [
        { task_create_min_role: 'lead' },
        { agents_allowed: false },
        { visibility: 'public' },
      ]);

      const signoff = h.page.getByRole('switch', { name: 'Person sign-off for Done' });
      assert.equal(await signoff.getAttribute('aria-checked'), 'true');
      assert.equal(await signoff.isDisabled(), true);
      assert.match(
        await h.page.locator('#ss-signoff-lock').innerText(),
        /Laika’s rule, not a setting/,
      );
      assert.equal(await h.page.getByText(/without approval/i).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a refused change says so beside the control, and the control keeps the stored value', async () => {
    const h = await open(
      `${SETTINGS}?tab=access`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) =>
          call.method === 'PATCH'
            ? refuse(403, 'forbidden', 'You may not change this space')
            : PROJECT,
      }),
    );
    try {
      await settled(h);
      await h.page.getByRole('switch', { name: 'Agent sessions' }).click();
      const error = h.page.locator('[data-error="agents_allowed"]');
      await error.waitFor({ timeout: 5_000 });
      assert.equal(await error.innerText(), 'Not saved: You may not change this space');
      assert.equal(
        await h.page.getByRole('switch', { name: 'Agent sessions' }).getAttribute('aria-checked'),
        'true',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Danger zone', () => {
  void test('Archive asks, then archives; an archived space offers Restore; there is no delete', async () => {
    let current: Record<string, unknown> = { ...PROJECT };
    const h = await open(
      `${SETTINGS}?tab=danger`,
      stub(ME, {
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) => {
          if (call.method === 'PATCH') {
            const body = call.body as { archived: boolean };
            current = { ...current, archived_at: body.archived ? 5 : null };
          }
          return current;
        },
      }),
    );
    try {
      await settled(h);
      assert.equal(await h.page.locator('.ss-danger-title').innerText(), 'Danger zone');
      assert.match(
        await h.page.locator('.ss-danger').innerText(),
        /The board becomes read-only\. Members keep access to its history\./,
      );
      assert.equal(await h.page.getByText(/delete/i).count(), 0, 'a delete row is drawn');
      await h.page.locator('[data-action="archive"]').click();
      assert.equal(
        h.calls.filter((c) => c.method === 'PATCH').length,
        0,
        'archived without asking',
      );
      await h.page.locator('[data-action="confirm-archive"]').click();
      await h.page.locator('[data-action="restore"]').waitFor({ timeout: 5_000 });
      assert.match(await h.page.locator('.screen-page').innerText(), /ARCHIVED/);
      await h.page.locator('[data-action="restore"]').click();
      await h.page.locator('[data-action="archive"]').waitFor({ timeout: 5_000 });
      assert.deepEqual(
        h.calls.filter((c) => c.method === 'PATCH').map((c) => c.body),
        [{ archived: true }, { archived: false }],
      );
    } finally {
      await h.close();
    }
  });

  void test('a space admin who is not an org admin may not archive, and is told who can', async () => {
    const lead = {
      ...ME,
      id: 'u2',
      org_role: 'member',
      memberships: [{ project_id: 'p1', role: 'lead' }],
    };
    const h = await open(`${SETTINGS}?tab=danger`, stub(lead));
    try {
      await settled(h);
      assert.equal(
        await h.page.locator('.ss-reader').innerText(),
        'Space settings · you manage this space as space admin',
      );
      assert.equal(await h.page.locator('[data-action="archive"]').count(), 0);
      assert.match(
        await h.page.locator('.ss-danger').innerText(),
        /To archive a space you need to be its Space admin and\s+hold “Create and archive spaces” in your organisation role\./,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a change to the reader’s own membership reaches their controls', () => {
  void test('a space admin who makes themselves a member loses the admin controls at once', async () => {
    // Space admin by membership alone — no org role to fall back on — so only
    // a fresh `/permissions` can say they are now a member.
    const lead = {
      ...ME,
      id: 'u2',
      name: 'Tomas Nel',
      org_role: 'member',
      memberships: [{ project_id: 'p1', role: 'lead' }],
    };
    let role: 'lead' | 'member' = 'lead';
    const grants = (r: string) =>
      defaultPermissions({ ...lead, memberships: [{ project_id: 'p1', role: r }] });
    const h = await open(
      `${SETTINGS}?tab=members`,
      stub(lead, {
        '/api/v1/permissions': () => grants(role),
        [`/api/v1/projects/${SLUG}/members`]: () => ({
          members: [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', role)],
        }),
        [`/api/v1/projects/${SLUG}/members/u2`]: (call: StubCall) => {
          if (call.method === 'PATCH') role = (call.body as { role: 'lead' | 'member' }).role;
          return {
            members: [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', role)],
          };
        },
      }),
    );
    try {
      await settled(h);
      const remove = h.page.locator('[data-action="remove"]');
      await remove.first().waitFor({ timeout: 20_000 });
      const before = h.calls.filter((c) => c.path === '/api/v1/permissions').length;

      await pick(h.page.locator('[data-member="u2"] [role="combobox"]'), 'member');
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      await until(() => h.calls.filter((c) => c.path === '/api/v1/permissions').length > before);
      await remove.first().waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await h.page.locator('[data-add-role]').count(), 0);
      assert.equal(await h.page.locator('[data-member] [role="combobox"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('readers who may not change the space never see a control', () => {
  for (const [who, me, permissions] of [
    ['a member of the space', MEMBER_ME, undefined],
    ['an admin whose Open every project was withdrawn', WITHDRAWN_ADMIN, WITHDRAWN_PERMISSIONS],
  ] as const) {
    void test(`${who}: every tab shows its values, read only`, async () => {
      const h = await open(
        SETTINGS,
        stub(me, permissions === undefined ? {} : { '/api/v1/permissions': permissions }),
        { before: (page) => watchFor(page, CONTROLS) },
      );
      try {
        await settled(h);
        assert.equal(
          await h.page.locator('.ss-reader').innerText(),
          'Space settings · read only — space admins change these',
        );
        assert.match(await h.page.locator('.ss-card').innerText(), /PawanSirsat\/Laika/);
        for (const id of ['members', 'access', 'danger']) {
          await tab(h, id);
          await h.page.locator('.ss-card').first().waitFor();
        }
        await navigateInApp(h.page, SETTINGS);
        await new Promise((resolve) => setTimeout(resolve, 300));
        for (const selector of CONTROLS) {
          assert.equal(await everSeen(h.page, selector), false, `${who} was shown ${selector}`);
        }
        assert.equal(await h.page.getByRole('button', { name: 'Save changes' }).count(), 0);
      } finally {
        await h.close();
      }
    });
  }

  void test('the member reads Access as words, and sign-off still says it is locked', async () => {
    const h = await open(`${SETTINGS}?tab=access`, stub(MEMBER_ME));
    try {
      await settled(h);
      // Access & rules is the first card; the hand-off policy is the second (LAI-550).
      const text = await h.page.locator('.ss-card').first().innerText();
      assert.match(text, /Members/);
      assert.match(text, /On/);
      assert.equal(
        await h.page.getByRole('switch', { name: 'Person sign-off for Done' }).isDisabled(),
        true,
      );
      // A member of the space may still leave it.
      await tab(h, 'members');
      await h.page.locator('[data-action="leave"]').waitFor({ timeout: 5_000 });
      assert.equal(
        await h.page.locator('.ss-member-role-static').first().innerText(),
        'Space admin',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('ways in', () => {
  void test('the space bar’s ⋯ opens Space settings, and View settings links there instead of Visibility', async () => {
    const h = await open(`/board?project=${SLUG}`, {
      ...stub(ME),
      [`/api/v1/projects/${SLUG}/tasks`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${SLUG}/sprints`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${SLUG}/activity`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${SLUG}/tags`]: { tags: [] },
      '/api/v1/presence': { data: [], next_cursor: null },
    });
    try {
      const trigger = h.page.locator('.bt-icon[title="View settings"]');
      await trigger.waitFor({ timeout: 20_000 });
      await trigger.click();
      const panel = h.page.getByRole('dialog', { name: 'View settings' });
      await panel.waitFor();
      assert.equal(
        await panel.locator('input[name="vs-visibility"]').count(),
        0,
        'Visibility is still in View settings',
      );
      const link = panel.locator('.vs-settings-link');
      assert.equal(await link.getAttribute('href'), SETTINGS);
      await h.page.keyboard.press('Escape');

      await h.page.getByRole('button', { name: 'Space menu' }).click();
      const item = h.page.getByRole('menuitem', { name: 'Space settings' });
      assert.equal(await item.getAttribute('href'), SETTINGS);
      await item.click();
      await until(() => new URL(h.page.url()).pathname === SETTINGS);
      await settled(h);
    } finally {
      await h.close();
    }
  });
});
