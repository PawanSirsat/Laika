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
import { deflateSync } from 'node:zlib';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  everSeen,
  navigateInApp,
  open,
  refuse,
  reply,
  setTheme,
  until,
  watchFor,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { pick } from './dropdown.ts';
import { boardAction } from './board-menu.ts';
import { answerConfirm } from './confirm.ts';

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
      // The key as a chip, the repository beside it (LAI-1211).
      assert.equal(await h.page.locator('[data-key-chip]').innerText(), 'LAIKA');
      assert.equal(await h.page.locator('.ss-repo').innerText(), 'PawanSirsat/Laika');
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
        await h.page.locator('.ss-open-board-wide').getAttribute('href'),
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
      // An editable setting is a `Field` in its row layout since LAI-1204.
      const help = await h.page
        .locator('.field-row', { has: h.page.locator('#ss-prefix') })
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
        // The refusal takes the focus to the field it names (LAI-1204), not
        // leaving it on Save, below and out of sight of the problem.
        await until(async () => h.page.evaluate(() => document.activeElement?.id === 'ss-prefix'));
        assert.equal(
          await h.page.evaluate(() => document.activeElement?.id),
          'ss-prefix',
          'focus did not move to the refused field',
        );
        assert.ok(
          ((await h.page.locator('#ss-prefix').getAttribute('aria-describedby')) ?? '')
            .split(' ')
            .includes('ss-prefix-error'),
          'the field is not described by its error',
        );
        // The typed key stays, so it can be corrected rather than retyped.
        assert.equal(await h.page.locator('#ss-prefix').inputValue(), 'ONR');
      } finally {
        await h.close();
      }
    });
  }

  // A value the client's own check accepts (LAI-1211 catches `9X` before any
  // request), so this is the server's refusal arriving, in the server's words.
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
      await h.page.locator('#ss-prefix').fill('XY');
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
        /Anyone in Kvelld can find it, read its board and join it themselves\./,
      );

      // Who can create tasks.
      await h.page.locator('[data-create="lead"]').click();
      await until(
        async () =>
          (await h.page.locator('[data-create="lead"]').getAttribute('aria-checked')) === 'true',
      );
      // Coding tools may work here (was *Agent sessions*, LAI-1058).
      const agents = h.page.getByRole('switch', { name: 'Coding tools may work here' });
      // The help's wording per mode is the next test's; this stub does not
      // name the compatibility endpoint, so the harness answers classic.
      await h.page.getByRole('link', { name: 'Developer access · Projects' }).waitFor();
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

  /**
   * The switch stops **every** token writing here, a personal credential for
   * scripts too (`agentsMay`, D-103 item 7), and the help says so in every
   * mode. Per-tool grants are named only where V3 sets them, and the link
   * names the tab as that mode's bar does (LAI-1058).
   */
  for (const [mode, label, href, perTool] of [
    ['classic', 'Developer access · Projects', '/developer?tab=projects', false],
    ['preview', 'Developer access · Project setup', '/developer?tab=projects&setup=v3', true],
    ['v3', 'Developer access · Project setup', '/developer?tab=projects', true],
  ] as const) {
    void test(`${mode}: the switch's help says what it stops, and links to ${label}`, async () => {
      const h = await open(
        `${SETTINGS}?tab=access`,
        stub(ME, {
          '/api/v1/developer/compatibility': {
            server: { version: '0.1.0', build_commit: null },
            protocol: { current: 1, min_client: 1 },
            features: {
              developer_access: mode,
              device_pairing: false,
              tool_setup_exchange: false,
              client_reports: false,
              project_setups: false,
            },
            cli: {},
            release_notes: { ref: null, whats_new: [] },
          },
        }),
      );
      try {
        await settled(h);
        const link = h.page.getByRole('link', { name: label });
        await link.waitFor({ timeout: 10_000 });
        assert.equal(await link.getAttribute('href'), href);
        const help = (await h.page.locator('#ss-agents-help').innerText()).replace(/\s+/g, ' ');
        assert.match(
          help,
          /While this is off, any token — including a personal credential for scripts — can read but not change anything here\./,
        );
        if (perTool) {
          assert.match(help, /Each registered tool also needs its own project access — set in /);
        } else {
          assert.doesNotMatch(help, /its own project access/);
          assert.match(help, /To point a tool at this space’s repository, see /);
        }
      } finally {
        await h.close();
      }
    });
  }

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
      await h.page.getByRole('switch', { name: 'Coding tools may work here' }).click();
      const error = h.page.locator('[data-error="agents_allowed"]');
      await error.waitFor({ timeout: 5_000 });
      assert.equal(await error.innerText(), 'Not saved: You may not change this space');
      assert.equal(
        await h.page
          .getByRole('switch', { name: 'Coding tools may work here' })
          .getAttribute('aria-checked'),
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
        await h.page.locator('[data-consequences="archive"]').innerText(),
        /Its board becomes read-only[\s\S]*Agents stop picking up its work[\s\S]*Nothing is deleted[\s\S]*restored at any time/,
      );
      assert.equal(await h.page.getByText(/\bdelete\b/i).count(), 0, 'a delete row is drawn');
      await h.page.locator('[data-action="archive"]').click();
      // The typed confirmation (LAI-1211): Archive waits for the key.
      const confirmArchive = h.page.locator('[data-action="confirm-archive"]');
      assert.equal(await confirmArchive.getAttribute('aria-disabled'), 'true');
      // Pressed anyway — it stays focusable so its reason is read — and does nothing.
      await confirmArchive.click({ force: true });
      assert.equal(
        h.calls.filter((c) => c.method === 'PATCH').length,
        0,
        'archived without the key typed',
      );
      await h.page.locator('#ss-archive-key').fill('laika');
      await confirmArchive.click();
      await h.page.locator('[data-action="restore"]').waitFor({ timeout: 5_000 });
      assert.match(
        await h.page.locator('[data-danger-result="archived"]').innerText(),
        /Laika is archived[\s\S]*Spaces › Archived/,
      );
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
      // Demoting yourself asks first, because the controls go with it (LAI-1211).
      assert.match(await answerConfirm(h.page, true), /stop being a space admin of Laika/);
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

void describe('the icon (D-152, LAI-1311; held, framed — LAI-1321)', () => {
  /**
   * A real PNG, `width` × `height`, every pixel `pixel(x, y)` — written here
   * so a test can pick an image larger than the frame without a fixture file.
   */
  function png(
    width: number,
    height: number,
    pixel: (x: number, y: number) => readonly [number, number, number, number],
  ): Buffer {
    const table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (bytes: Buffer): number => {
      let c = 0xffffffff;
      for (const b of bytes) c = (table[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'ascii');
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y += 1) {
      raw[y * (width * 4 + 1)] = 0;
      for (let x = 0; x < width; x += 1) {
        const at = y * (width * 4 + 1) + 1 + x * 4;
        const [r, g, b, a] = pixel(x, y);
        raw[at] = r;
        raw[at + 1] = g;
        raw[at + 2] = b;
        raw[at + 3] = a;
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(6, 9);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  /** 800 × 400, red on the left half and blue on the right — wider than the frame. */
  const WIDE = png(800, 400, (x) => (x < 400 ? [220, 30, 30, 255] : [30, 60, 220, 255]));
  const ID = '01M7NB3PN15NBHEPSNB8VPBTZJ';
  const IMAGE = { url: `/api/v1/projects/${SLUG}/icon?v=9`, updated_at: 9 };

  /**
   * The space as the server answers it: `PATCH`'s `icon_emoji`, `DELETE
   * /icon`, the ask and the complete. `served` says what the server holds, so
   * a test can show nothing changed there until Save.
   */
  function iconStub(
    me: Record<string, unknown>,
    attachments: { max_bytes: number } | null,
    options: {
      /** The space's icon to start with. */
      readonly icon?: Record<string, unknown> | null;
      /** Refuse completing an image, or removing the icon, with this. */
      readonly refuseComplete?: boolean;
      readonly refuseDelete?: boolean;
    } = {},
  ): { stub: ApiStub; served: () => Record<string, unknown> } {
    let current: Record<string, unknown> = { ...PROJECT, icon: options.icon ?? null };
    const storeDown = () => refuse(503, 'unavailable', 'The file store could not be reached');
    const base = stub(me);
    return {
      served: () => current,
      stub: {
        ...base,
        '/api/v1/org': { ...(base['/api/v1/org'] as object), attachments },
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) => {
          if (call.method === 'PATCH') {
            const body = call.body as Record<string, unknown>;
            current = { ...current, ...body };
            if ('icon_emoji' in body) {
              const emoji = body.icon_emoji as string | null;
              current = { ...current, icon: emoji === null ? null : { emoji } };
              delete current.icon_emoji;
            }
          }
          return current;
        },
        [`/api/v1/projects/${SLUG}/icon`]: (call: StubCall) => {
          if (call.method === 'DELETE') {
            if (options.refuseDelete === true) return storeDown();
            current = { ...current, icon: null };
            return current;
          }
          // A mark reading the saved image: these tests are about what was sent.
          if (call.method === 'GET') return refuse(404, 'not_found', 'No image in this stub');
          return reply(201, {
            upload_id: ID,
            upload: {
              url: `/store/p/p1/icon/${ID}`,
              method: 'PUT',
              headers: {
                'content-type': (call.body as { content_type: string }).content_type,
                'content-disposition': 'inline',
              },
              expires_at: Date.now() + 600_000,
            },
            max_bytes: 1_048_576,
          });
        },
        [`/api/v1/projects/${SLUG}/icon/complete`]: () => {
          if (options.refuseComplete === true) return storeDown();
          current = { ...current, icon: IMAGE };
          return current;
        },
      },
    };
  }

  /** The store, which the stub API is not: every `PUT` kept, by path. */
  async function fakeStore(page: Page, puts: Map<string, Buffer>, delayMs = 0): Promise<void> {
    await page.route('**/store/**', async (route) => {
      const request = route.request();
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (request.method() === 'PUT') {
        puts.set(new URL(request.url()).pathname, request.postDataBuffer() ?? Buffer.alloc(0));
      }
      await route.fulfill({ status: 200, body: '' });
    });
  }

  /** Pick `buffer` as a PNG, wait for the frame, and press Use this. */
  async function frameAndUse(h: Harness, buffer: Buffer): Promise<void> {
    await h.page.locator('[data-action="icon-upload"]').waitFor({ timeout: 5_000 });
    await h.page.locator('[data-icon-file]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer,
    });
    await h.page.locator('[data-frame]').waitFor({ timeout: 5_000 });
    await until(
      async () => (await h.page.locator('[data-action="frame-use"]').isDisabled()) === false,
    );
    await h.page.locator('[data-action="frame-use"]').click();
  }

  const header = (h: Harness) => h.page.locator('.ss-avatar');
  const preview = (h: Harness) => h.page.locator('[data-icon-section] .project-mark').first();
  const save = (h: Harness) => h.page.getByRole('button', { name: 'Save changes' });
  const icons = (h: Harness) =>
    h.calls.filter(
      (c) => c.path.includes('/icon') || (c.method === 'PATCH' && c.path.endsWith(SLUG)),
    );

  /** Whether a `beforeunload` now would ask: some listener prevented it. */
  const leavingAsks = (h: Harness) =>
    h.page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

  void test('an emoji is held until Save changes; Save sends it, and every mark changes', async () => {
    const { stub: answers, served } = iconStub(ME, null);
    const h = await open(SETTINGS, answers);
    try {
      await settled(h);
      const section = h.page.locator('[data-icon-section]');
      await section.waitFor({ timeout: 5_000 });
      // No file store on this board: no Upload, and the help says why.
      assert.equal(await h.page.locator('[data-action="icon-upload"]').count(), 0);
      assert.match(await section.innerText(), /no file store, so images are off/);
      assert.equal(await save(h).isDisabled(), true);
      assert.equal(await leavingAsks(h), false);

      await h.page.locator('[data-action="icon-emoji"]').click();
      await h.page.locator('[data-emoji="🚀"]').click();
      // Held: the preview shows it, Save is on, and nothing has gone to the server.
      await until(async () => (await preview(h).getAttribute('data-glyph')) === '🚀');
      assert.equal(await h.page.locator('[data-icon-held]').count(), 1);
      assert.equal(await save(h).isDisabled(), false);
      assert.deepEqual(icons(h), []);
      assert.equal(served().icon, null);
      // The page's other marks still show what is saved.
      assert.equal(await header(h).getAttribute('data-mark'), 'letter');
      assert.equal(await leavingAsks(h), true);

      await save(h).click();
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      assert.deepEqual(h.calls.find((c) => c.method === 'PATCH')?.body, { icon_emoji: '🚀' });
      await until(async () => (await header(h).getAttribute('data-glyph')) === '🚀');
      assert.equal(await h.page.locator('[data-icon-held]').count(), 0);
      assert.equal(await save(h).isDisabled(), true);
      assert.equal(await leavingAsks(h), false);

      // Remove is held the same way, and sent as DELETE on Save.
      await h.page.locator('[data-action="icon-remove"]').click();
      await until(async () => (await preview(h).getAttribute('data-mark')) === 'letter');
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);
      await save(h).click();
      await until(() => h.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/icon')));
      await until(async () => (await header(h).getAttribute('data-glyph')) === 'L');
    } finally {
      await h.close();
    }
  });

  void test('Discard drops a held icon: nothing is sent, and leaving no longer asks', async () => {
    const { stub: answers } = iconStub(ME, null);
    const h = await open(SETTINGS, answers);
    try {
      await settled(h);
      await h.page.locator('[data-action="icon-emoji"]').click();
      await h.page.locator('[data-emoji="🎯"]').click();
      await until(async () => (await save(h).isDisabled()) === false);
      assert.equal(await leavingAsks(h), true);

      await h.page.getByRole('button', { name: 'Discard' }).click();
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 0);
      assert.equal(await preview(h).getAttribute('data-mark'), 'letter');
      assert.equal(await save(h).isDisabled(), true);
      assert.equal(await leavingAsks(h), false);
      assert.deepEqual(icons(h), []);
    } finally {
      await h.close();
    }
  });

  void test('an image is framed, staged at once, completed only on Save — square, its corner the chosen background', async () => {
    const { stub: answers, served } = iconStub(ME, { max_bytes: 26_214_400 });
    const puts = new Map<string, Buffer>();
    const h = await open(SETTINGS, answers, {
      before: (page) => fakeStore(page, puts),
    });
    try {
      await settled(h);
      await h.page.locator('[data-action="icon-upload"]').waitFor({ timeout: 5_000 });

      // An SVG is refused before any editor or request.
      await h.page.locator('[data-icon-file]').setInputFiles({
        name: 'logo.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      });
      await until(async () => (await h.page.locator('[data-icon-error]').count()) === 1);
      assert.equal(await h.page.locator('[data-frame]').count(), 0);

      await h.page.locator('[data-icon-file]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: WIDE,
      });
      const frame = h.page.locator('[data-frame]');
      await frame.waitFor({ timeout: 5_000 });
      await until(
        async () => (await h.page.locator('[data-action="frame-use"]').isDisabled()) === false,
      );

      // Zoom with the slider, then drag down and right with the pointer.
      await h.page.locator('[data-frame-zoom]').fill('1.5');
      await until(async () => (await frame.getAttribute('data-zoom')) === '1.50');
      const box = await frame.boundingBox();
      assert.ok(box !== null);
      await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await h.page.mouse.down();
      await h.page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 30, {
        steps: 5,
      });
      await h.page.mouse.up();
      assert.equal(await frame.getAttribute('data-x'), '20.0');
      assert.equal(await frame.getAttribute('data-y'), '30.0');

      // A box drawn at half the frame's size: the image still follows the
      // pointer, so 10 pixels of drag is 20 of frame (LAI-1321 review).
      await frame.evaluate((el) => {
        (el as HTMLElement).style.width = '120px';
        (el as HTMLElement).style.height = '120px';
      });
      const half = await frame.boundingBox();
      assert.ok(half !== null);
      await h.page.mouse.move(half.x + 60, half.y + 60);
      await h.page.mouse.down();
      await h.page.mouse.move(half.x + 70, half.y + 60, { steps: 4 });
      await h.page.mouse.up();
      assert.equal(await frame.getAttribute('data-x'), '40.0');
      await frame.evaluate((el) => {
        (el as HTMLElement).style.width = '';
        (el as HTMLElement).style.height = '';
      });

      await h.page.locator('[data-frame-background="black"]').click();
      await h.page.locator('[data-action="frame-use"]').click();

      // Staged: asked and put, previewed and held — never completed.
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 1);
      assert.equal(await h.page.locator('[data-frame]').count(), 0);
      const ask = h.calls.find((c) => c.method === 'POST' && c.path.endsWith('/icon'));
      assert.ok(ask !== undefined, 'nothing was asked for');
      assert.equal(puts.size, 1);
      assert.equal(
        h.calls.some((c) => c.path.endsWith('/icon/complete')),
        false,
      );
      assert.equal(served().icon, null, 'the icon changed before Save');
      assert.equal(await preview(h).getAttribute('data-mark'), 'image');
      assert.match((await preview(h).locator('img').getAttribute('src')) ?? '', /^data:image\//);

      await save(h).click();
      await until(() => h.calls.some((c) => c.path.endsWith('/icon/complete')));
      const complete = h.calls.find((c) => c.path.endsWith('/icon/complete'));
      const stored = puts.get(`/store/p/p1/icon/${ID}`);
      assert.ok(stored !== undefined);
      assert.deepEqual(complete?.body, {
        upload_id: ID,
        content_type: (ask.body as { content_type: string }).content_type,
        size_bytes: stored.length,
      });
      assert.deepEqual(served().icon, IMAGE);

      // What went to the store is a square, its top-left corner the black background.
      const read = await h.page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (ctx === null) return null;
        ctx.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          corner: [...ctx.getImageData(0, 0, 1, 1).data],
        };
      }, stored.toString('base64'));
      assert.ok(read !== null);
      assert.equal(read.width, read.height, 'the stored icon is not square');
      assert.ok(read.width <= 512);
      assert.deepEqual(read.corner, [0, 0, 0, 255]);
    } finally {
      await h.close();
    }
  });

  void test('the frame works from the keyboard alone: arrows, +, the background, Use this', async () => {
    const { stub: answers } = iconStub(ME, { max_bytes: 26_214_400 });
    const puts = new Map<string, Buffer>();
    const h = await open(SETTINGS, answers, { before: (page) => fakeStore(page, puts) });
    try {
      await settled(h);
      await h.page.locator('[data-action="icon-upload"]').waitFor({ timeout: 5_000 });
      await h.page.locator('[data-icon-file]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: WIDE,
      });
      const frame = h.page.locator('[data-frame]');
      await frame.waitFor({ timeout: 5_000 });
      await until(
        async () => (await h.page.locator('[data-action="frame-use"]').isDisabled()) === false,
      );

      // Into the frame by Tab, as a keyboard user reaches it.
      for (
        let i = 0;
        i < 6 && !(await frame.evaluate((el) => el === document.activeElement));
        i += 1
      ) {
        await h.page.keyboard.press('Tab');
      }
      assert.equal(await frame.evaluate((el) => el === document.activeElement), true);
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', '+', '+']) {
        await h.page.keyboard.press(key);
      }
      assert.equal(await frame.getAttribute('data-zoom'), '1.20');
      // Three steps right and one down at zoom 1, scaled ×1.2 by the two zooms.
      assert.equal(await frame.getAttribute('data-x'), '14.4');
      assert.equal(await frame.getAttribute('data-y'), '4.8');
      // Said, too: a polite live region with the zoom and the offset.
      const status = h.page.locator('[data-frame-status]');
      assert.equal(await status.getAttribute('aria-live'), 'polite');
      assert.equal(await status.innerText(), 'Zoom 1.2×, 14 right, 5 down.');
      // Focus is drawn, not just held.
      assert.notEqual(
        await frame.evaluate((el) => getComputedStyle(el).outlineStyle),
        'none',
        'the frame shows no focus',
      );

      await h.page.keyboard.press('0');
      assert.equal(await frame.getAttribute('data-zoom'), '1.00');

      // The background radio group, then Use this — by keys only.
      await h.page.locator('[data-frame-background="transparent"]').focus();
      await h.page.keyboard.press('ArrowRight');
      assert.equal(
        await h.page.locator('[data-frame-background="white"]').getAttribute('aria-checked'),
        'true',
      );
      await h.page.locator('[data-action="frame-use"]').focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 1);
      assert.equal(puts.size, 1);
    } finally {
      await h.close();
    }
  });

  void test('a refused complete after the fields saved: the fields count as saved, only the icon stays held', async () => {
    const { stub: answers, served } = iconStub(
      ME,
      { max_bytes: 26_214_400 },
      { refuseComplete: true },
    );
    const puts = new Map<string, Buffer>();
    const h = await open(SETTINGS, answers, { before: (page) => fakeStore(page, puts) });
    try {
      await settled(h);
      await h.page.locator('#ss-name').fill('Laika Two');
      await h.page.locator('#ss-prefix').fill('LKT');
      await frameAndUse(h, WIDE);
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 1);

      await save(h).click();
      await until(async () => (await h.page.locator('.ss-foot-error').count()) === 1);
      assert.match(
        await h.page.locator('.ss-foot-error').innerText(),
        /^Saved\. The icon was not saved: .+\. Try Save again\.$/,
      );
      // The server has the new name and key; the page counts them as saved.
      assert.equal(served().name, 'Laika Two');
      await until(
        async () => (await h.page.locator('.screen-page-title').innerText()) === 'Laika Two',
      );
      assert.equal(await h.page.locator('#ss-name').inputValue(), 'Laika Two');
      // Only the icon is still held, and Save is still on for it.
      assert.equal(await h.page.locator('[data-icon-held]').count(), 1);
      assert.equal(await save(h).isDisabled(), false);

      // Discard drops only the icon: the saved name stays.
      await h.page.getByRole('button', { name: 'Discard' }).click();
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 0);
      assert.equal(await h.page.locator('#ss-name').inputValue(), 'Laika Two');
      assert.equal(await h.page.locator('#ss-prefix').inputValue(), 'LKT');
      assert.equal(await save(h).isDisabled(), true);
    } finally {
      await h.close();
    }
  });

  void test('a refused remove after the fields saved: the fields count as saved, the removal stays held', async () => {
    const { stub: answers, served } = iconStub(ME, null, {
      icon: { emoji: '🚀' },
      refuseDelete: true,
    });
    const h = await open(SETTINGS, answers);
    try {
      await settled(h);
      await h.page.locator('#ss-name').fill('Laika Two');
      await h.page.locator('[data-action="icon-remove"]').click();
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 1);

      await save(h).click();
      await until(async () => (await h.page.locator('.ss-foot-error').count()) === 1);
      assert.match(
        await h.page.locator('.ss-foot-error').innerText(),
        /^Saved\. The icon was not saved/,
      );
      assert.equal(served().name, 'Laika Two');
      assert.deepEqual(served().icon, { emoji: '🚀' });
      assert.equal(await h.page.locator('[data-icon-held]').count(), 1);

      await h.page.getByRole('button', { name: 'Discard' }).click();
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 0);
      assert.equal(await h.page.locator('#ss-name').inputValue(), 'Laika Two');
      assert.equal(await preview(h).getAttribute('data-glyph'), '🚀');
    } finally {
      await h.close();
    }
  });

  void test('Save stays off while an image uploads, and the image it then sends is that one', async () => {
    const { stub: answers, served } = iconStub(ME, { max_bytes: 26_214_400 });
    const puts = new Map<string, Buffer>();
    // The store takes a second and a half: long enough to press Save during it.
    const h = await open(SETTINGS, answers, { before: (page) => fakeStore(page, puts, 1_500) });
    try {
      await settled(h);
      await h.page.locator('#ss-name').fill('Laika Two');
      assert.equal(await save(h).isDisabled(), false);
      await frameAndUse(h, WIDE);
      // Uploading: Save is off, and a press does nothing.
      await until(async () => (await save(h).isDisabled()) === true);
      await save(h).click({ force: true });
      assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 0);
      assert.equal(puts.size, 0);

      // Uploaded: held, and Save is back.
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 1, 10_000);
      assert.equal(await save(h).isDisabled(), false);
      await save(h).click();
      await until(() => h.calls.some((c) => c.path.endsWith('/icon/complete')));
      assert.deepEqual(
        (h.calls.find((c) => c.path.endsWith('/icon/complete'))?.body as { upload_id: string })
          .upload_id,
        ID,
      );
      assert.equal(served().name, 'Laika Two');
      assert.deepEqual(served().icon, IMAGE);
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('a picture over 40 megapixels is refused from its header, before it is decoded', async () => {
    const { stub: answers } = iconStub(ME, { max_bytes: 26_214_400 });
    const h = await open(SETTINGS, answers);
    try {
      await settled(h);
      await h.page.locator('[data-action="icon-upload"]').waitFor({ timeout: 5_000 });
      // A PNG's signature and IHDR saying 10 000 × 5 000 — and nothing a decoder could use.
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(10_000, 0);
      ihdr.writeUInt32BE(5_000, 4);
      const header = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
        Buffer.from('IHDR'),
        ihdr,
        Buffer.alloc(4),
      ]);
      await h.page.locator('[data-icon-file]').setInputFiles({
        name: 'huge.png',
        mimeType: 'image/png',
        buffer: header,
      });
      await until(async () => (await h.page.locator('[data-icon-error]').count()) === 1);
      assert.match(
        await h.page.locator('[data-icon-error]').innerText(),
        /10000 × 5000 — too large to work with\. 40 megapixels at most\./,
      );
      assert.equal(await h.page.locator('[data-frame]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a board whose file limit is small still takes an icon, made smaller, and says so', async () => {
    const LIMIT = 12_000;
    const { stub: answers } = iconStub(ME, { max_bytes: LIMIT });
    const puts = new Map<string, Buffer>();
    const h = await open(SETTINGS, answers, { before: (page) => fakeStore(page, puts) });
    try {
      await settled(h);
      // Noise does not compress: at 512 pixels it is far over the limit.
      let seed = 7;
      const noise = png(600, 600, () => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        return [seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255];
      });
      await frameAndUse(h, noise);
      await until(async () => (await h.page.locator('[data-icon-held]').count()) === 1, 10_000);
      assert.match(await h.page.locator('[data-icon-note]').innerText(), /Made smaller to fit/);
      const stored = [...puts.values()][0];
      assert.ok(stored !== undefined);
      assert.ok(
        stored.length <= LIMIT,
        `${String(stored.length)} bytes is over the board's ${String(LIMIT)}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('Cancel in the frame leaves the icon as it was, with nothing sent', async () => {
    const { stub: answers } = iconStub(ME, { max_bytes: 26_214_400 });
    const puts = new Map<string, Buffer>();
    const h = await open(SETTINGS, answers, { before: (page) => fakeStore(page, puts) });
    try {
      await settled(h);
      await h.page.locator('[data-action="icon-upload"]').waitFor({ timeout: 5_000 });
      await h.page.locator('[data-icon-file]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: WIDE,
      });
      await h.page.locator('[data-frame]').waitFor({ timeout: 5_000 });
      await h.page.locator('[data-action="frame-cancel"]').click();
      await until(async () => (await h.page.locator('[data-frame]').count()) === 0);
      assert.equal(await h.page.locator('[data-icon-held]').count(), 0);
      assert.equal(await save(h).isDisabled(), true);
      assert.deepEqual(icons(h), []);
      assert.equal(puts.size, 0);
    } finally {
      await h.close();
    }
  });

  void test('a black-square logo is measured once it loads, and ringed in the dark themes only', async () => {
    // The owner's logo: a white figure on a black square — its edge is the dark page's colour.
    const blackSquare = png(96, 96, (x, y) =>
      Math.abs(x - 48) < 20 && Math.abs(y - 48) < 30 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    const saved = { ...PROJECT, icon: IMAGE };
    const h = await open(
      SETTINGS,
      { ...stub(ME), [`/api/v1/projects/${SLUG}`]: saved },
      {
        before: async (page) => {
          await page.route(`**/api/v1/projects/${SLUG}/icon?v=9`, (route) =>
            route.fulfill({ status: 200, contentType: 'image/png', body: blackSquare }),
          );
        },
      },
    );
    try {
      await settled(h);
      await until(async () => (await header(h).getAttribute('data-plate')) === 'ring-in-dark');
      const outline = () => header(h).evaluate((el) => getComputedStyle(el).outlineStyle);
      await setTheme(h.page, 'dark');
      assert.equal(await outline(), 'solid', 'no ring on a dark theme');
      await setTheme(h.page, 'light');
      assert.equal(await outline(), 'none', 'a ring on the light theme, which needs none');
      // The black theme is a dark one: ringed there too.
      await h.page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'black');
      });
      assert.equal(await outline(), 'solid', 'no ring on the black theme');
    } finally {
      await h.close();
    }
  });

  void test('a space admin who is not an org owner or admin is never shown the Icon row', async () => {
    const lead = { ...MEMBER_ME, memberships: [{ project_id: 'p1', role: 'lead' }] };
    const h = await open(SETTINGS, iconStub(lead, { max_bytes: 26_214_400 }).stub);
    try {
      await settled(h);
      // They may edit the space's settings — the form is there — but not its icon.
      await h.page.locator('#ss-name').waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('[data-icon-section]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('ways in', () => {
  void test('the space bar’s Space settings opens it, and View settings links there instead of Visibility', async () => {
    const h = await open(`/board?project=${SLUG}`, {
      ...stub(ME),
      [`/api/v1/projects/${SLUG}/tasks`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${SLUG}/sprints`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${SLUG}/activity`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${SLUG}/tags`]: { tags: [] },
      '/api/v1/presence': { data: [], next_cursor: null },
    });
    try {
      // Its own toolbar button again (LAI-1230), named.
      await boardAction(h.page, 'View settings');
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

      // In front, not behind a ⋯ (LAI-1234): a gear and the words, one press.
      assert.equal(await h.page.getByRole('button', { name: 'Space menu' }).count(), 0);
      const item = h.page.locator('.space-bar').getByRole('link', { name: 'Space settings' });
      assert.equal(await item.getAttribute('href'), SETTINGS);
      assert.equal(await item.locator('svg[data-icon="gear"]').count(), 1, 'the gear is missing');
      assert.equal((await item.innerText()).trim(), 'Space settings');
      await item.click();
      await until(() => new URL(h.page.url()).pathname === SETTINGS);
      await settled(h);
    } finally {
      await h.close();
    }
  });
});
