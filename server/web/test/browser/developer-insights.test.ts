/**
 * D-079's switches in a real browser (LAI-751): the organisation's
 * *Developer insights* on Organisation, and on Developer access and Connect
 * what that means for the developer — since D-102 (amended, LAI-964) a plain
 * notice that their organisation collects, never a personal switch — with what
 * is held for them and the delete.
 *
 * Each write is asserted by the request the page sent — method, path and
 * body — and by what the page then shows from the answer, so a switch that
 * only changed its own colour fails.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  everSeen,
  open,
  reply,
  setTheme,
  until,
  watchFor,
  type ApiStub,
  type StubCall,
} from './harness.ts';

const NOW = Date.now();
const DAY = 86_400_000;
const TODAY = new Date(NOW).toISOString().slice(0, 10);
const YESTERDAY = new Date(NOW - DAY).toISOString().slice(0, 10);

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const me = (org_role: string) => ({ ...user('u1', 'Ada Lovelace', org_role), memberships: [] });

const org = (developer_insights: boolean) => ({
  id: 'o1',
  name: 'Kvelld Dynamics',
  presence_enabled: true,
  developer_insights,
  created_at: 1,
  updated_at: 2,
});

const permissions = (org_role: string, actions: readonly string[]) => ({
  org_roles: [],
  project_roles: [],
  permissions: [],
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions,
    projects: [],
  },
});

void after(async () => {
  await closeBrowser();
});

void describe('Organisation: Developer insights', () => {
  void test('an owner turns it on with a switch, and the page shows the server’s answer', async () => {
    let on = false;
    const h = await open('/organisation', {
      '/api/v1/me': me('owner'),
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'owner')], next_cursor: null },
      '/api/v1/invites': { data: [], next_cursor: null },
      '/api/v1/org': (call: StubCall) => {
        if (call.method === 'PATCH')
          on = (call.body as { developer_insights: boolean }).developer_insights;
        return org(on);
      },
    });
    try {
      const fact = h.page.locator('[data-fact="developer-insights"]');
      const toggle = fact.getByRole('switch', { name: 'Developer insights' });
      await toggle.waitFor({ timeout: 20_000 });
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      // D-102 amended (LAI-967): collection follows this switch alone — no developer chooses.
      const note = await fact.innerText();
      assert.match(note, /every connected machine’s local activity is collected/);
      assert.match(note, /each person is told so/);
      assert.match(note, /never prompt text/);
      assert.match(note, /Off stops it for everyone at once\./);
      assert.doesNotMatch(note, /choose|for themselves|turned it on|on Connect/);

      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'true');
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/org');
      assert.deepEqual(patch?.body, { developer_insights: true });
      assert.match(await toggle.innerText(), /On/);

      // And off again, by keyboard.
      await toggle.focus();
      await h.page.keyboard.press('Space');
      await until(async () => (await toggle.getAttribute('aria-checked')) === 'false');
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    } finally {
      await h.close();
    }
  });

  void test('a member reads the setting, with no switch to press', async () => {
    const h = await open('/organisation', {
      '/api/v1/me': me('member'),
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'member')], next_cursor: null },
      '/api/v1/org': org(true),
    });
    try {
      const fact = h.page.locator('[data-fact="developer-insights"]');
      await fact.waitFor({ timeout: 20_000 });
      assert.equal(await fact.getByRole('switch').count(), 0);
      assert.match(await fact.innerText(), /^Developer insights\s*on/i);
    } finally {
      await h.close();
    }
  });

  void test('the editor follows the live grant for admin, member and owner', async () => {
    for (const [role, actions, editable] of [
      ['admin', [], false],
      ['member', ['org.developer_insights.set'], true],
      ['owner', ['org.developer_insights.set'], true],
    ] as const) {
      const h = await open('/organisation', {
        '/api/v1/me': me(role),
        '/api/v1/permissions': permissions(role, actions),
        '/api/v1/projects': { data: [], next_cursor: null },
        '/api/v1/users': { data: [user('u1', 'Ada Lovelace', role)], next_cursor: null },
        '/api/v1/invites': { data: [], next_cursor: null },
        '/api/v1/org': org(true),
      });
      try {
        const fact = h.page.locator('[data-fact="developer-insights"]');
        await fact.waitFor({ timeout: 20_000 });
        await until(async () => (await fact.getByRole('switch').count()) === (editable ? 1 : 0));
        assert.equal(await fact.getByRole('switch').count(), editable ? 1 : 0);
      } finally {
        await h.close();
      }
    }
  });
});

const HELD = {
  start: new Date(NOW - 13 * DAY).toISOString().slice(0, 10),
  end: TODAY,
  tz: 'UTC',
  days: [
    {
      day: TODAY,
      prompts_by_agent: { 'claude-code': 18, 'gemini-cli': 2, other: 1 },
      sessions: 3,
      commits_local: 2,
      pushed_commits: 4,
      tokens: 1_234_567,
      cache_read: 80_000_000,
    },
    {
      day: YESTERDAY,
      prompts_by_agent: {},
      sessions: 0,
      commits_local: 1,
      pushed_commits: 0,
      tokens: 0,
      cache_read: 0,
    },
  ],
  collectors: 1,
  oldest_day: YESTERDAY,
};

const NOTHING = { ...HELD, days: [], collectors: 0, oldest_day: null };

/** D-102 amended (LAI-964): what is collected, on Developer access, Connect and the CLI alike. */
const COLLECTS =
  'Your organisation collects your local activity: per-day counts of your prompts, agent sessions and commits, and your agents’ token counts.';
/** Who can see it, from the owner's grants (LAI-971): the defaults give admins *See everyone's analytics*. */
const NOTICE = `${COLLECTS} The owner and admins can see it, and you can see who looked.`;

/** `GET /api/v1/org/permissions` (LAI-958), the capability that decides the audience. */
const orgPermissions = (
  analytics: Readonly<Record<string, boolean>>,
  settings: Readonly<Record<string, boolean>> = { admin: true },
) => ({
  roles: ['admin', 'member', 'viewer'],
  capabilities: [
    { id: 'see_people_analytics', label: 'See everyone’s analytics', actions: [] },
    { id: 'manage_people', label: 'Manage people', actions: [] },
    { id: 'change_org_settings', label: 'Change organisation settings', actions: [] },
  ],
  grants: Object.fromEntries(
    ['admin', 'member', 'viewer'].map((role) => [
      role,
      {
        see_people_analytics: analytics[role] ?? false,
        manage_people: role === 'admin',
        change_org_settings: settings[role] ?? false,
      },
    ]),
  ),
  owner_locked: [],
  updated_at: null,
  updated_by: null,
});

const DEFAULT_GRANTS = { admin: true, member: false, viewer: false };

function connect(
  state: { org: boolean; enabled: boolean; scope: string },
  held: { value: unknown },
  role = 'owner',
  analytics: Readonly<Record<string, boolean>> | null = DEFAULT_GRANTS,
  settings: Readonly<Record<string, boolean>> = { admin: true },
  actions: readonly string[] = role === 'owner' || role === 'admin'
    ? ['org.developer_insights.set', 'user.invite']
    : [],
): ApiStub {
  return {
    ...(analytics === null
      ? {}
      : { '/api/v1/org/permissions': orgPermissions(analytics, settings) }),
    '/api/v1/permissions': permissions(role, actions),
    '/api/v1/me': me(role),
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/org': org(state.org),
    '/api/v1/me/activity-sharing': (call: StubCall) => {
      if (call.method === 'PUT') {
        // LAI-963: the server refuses `enabled` outright.
        if ((call.body as Record<string, unknown>).enabled !== undefined) {
          return reply(403, {
            code: 'forbidden',
            message: 'Local activity is collected by your organisation',
            details: { reason: 'organisation_controlled', org_enabled: state.org },
          });
        }
        Object.assign(state, call.body);
      }
      return {
        org_enabled: state.org,
        enabled: state.org,
        person_can_opt_out: false,
        scope: state.scope,
        min_sync_interval_s: 600,
      };
    },
    '/api/v1/me/local-activity': (call: StubCall) => {
      if (call.method === 'DELETE') {
        held.value = NOTHING;
        return reply(204, null);
      }
      return held.value;
    },
  };
}

void describe('Developer access: Share local activity', () => {
  for (const [role, guidance] of [
    ['owner', 'You can turn them on in Organisation.'],
    ['admin', 'You can turn them on in Organisation.'],
    ['member', 'Only the owner and admins can turn them on.'],
  ] as const) {
    void test(`${role}: explains who can enable organisation insights`, async () => {
      const h = await open(
        '/developer?tab=activity',
        connect({ org: false, enabled: false, scope: 'agent-repos' }, { value: NOTHING }, role),
      );
      try {
        const section = h.page.locator('.dev-sharing');
        await section.getByRole('heading', { name: 'Share local activity' }).waitFor({
          timeout: 20_000,
        });
        const notice = section.locator('[data-state="org-off"]');
        assert.match(await notice.innerText(), /Developer insights are off for this organisation/);
        assert.equal((await notice.innerText()).includes(guidance), true);
        assert.equal(await section.getByRole('switch').count(), 0);
        assert.equal(
          await section.locator('a[href="/organisation?tab=overview"]').count(),
          role === 'owner' || role === 'admin' ? 1 : 0,
        );
      } finally {
        await h.close();
      }
    });
  }

  for (const [role, guidance, organisationLink] of [
    ['owner', 'You can turn Developer insights off in Organisation.', 1],
    ['admin', 'You can turn Developer insights off in Organisation.', 1],
    ['member', 'Only the owner and admins can turn it off.', 0],
  ] as const) {
    void test(`${role}: with organisation insights on, is told plainly — no switch of their own (D-102)`, async () => {
      // `enabled: false` is what this person last chose under D-079; it no longer decides anything.
      const state = { org: true, enabled: false, scope: 'agent-repos' };
      const h = await open('/developer?tab=activity', connect(state, { value: HELD }, role));
      try {
        const section = h.page.locator('.dev-sharing');
        const notice = section.locator('[data-state="org-collects"]');
        await notice.waitFor({ timeout: 20_000 });
        const text = await notice.innerText();
        assert.equal(text.includes(NOTICE), true, text);
        assert.equal(text.includes(guidance), true, text);
        assert.equal(await section.getByRole('switch').count(), 0);
        assert.doesNotMatch(await section.innerText(), /Share my local activity/);

        // Their own data, on this page, and their own time until *Who looked* lands (LAI-959).
        const own = notice.locator('a[href="#share-held"]');
        assert.equal(await own.count(), 1);
        assert.equal(await section.locator('#share-held').count(), 1);
        assert.equal(await notice.locator('a[href="/my-day"]').count(), 1);
        assert.equal(
          await notice.locator('a[href="/organisation?tab=overview"]').count(),
          organisationLink,
        );

        // The scope is still theirs, and the page never sends `enabled`.
        const narrow = section.locator('input[name="share-scope"][value="laika-repos"]');
        await narrow.click();
        await until(() => narrow.isChecked());
        const puts = h.calls.filter(
          (call) => call.method === 'PUT' && call.path === '/api/v1/me/activity-sharing',
        );
        assert.deepEqual(
          puts.map((call) => call.body),
          [{ scope: 'laika-repos' }],
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('the reused section fits laptop and phone in light and dark', async () => {
    const h = await open(
      '/developer?tab=activity',
      connect({ org: true, enabled: true, scope: 'agent-repos' }, { value: HELD }),
    );
    try {
      const section = h.page.locator('.dev-sharing');
      await section.locator('[data-state="org-collects"]').waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        for (const width of [1440, 390]) {
          await h.page.setViewportSize({ width, height: 900 });
          assert.equal(await section.isVisible(), true);
          if (width === 390) {
            const internals = section.locator('.share-list, [data-state="org-collects"]');
            assert.equal(await internals.count(), 3);
            for (const internal of await internals.all()) {
              assert.deepEqual(
                await internal.evaluate((element) => {
                  const rect = element.getBoundingClientRect();
                  return {
                    fitsContent: element.scrollWidth <= element.clientWidth,
                    withinViewport:
                      rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
                  };
                }),
                { fitsContent: true, withinViewport: true },
              );
            }
          }
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('Share local activity: who can see it follows the owner’s grants (LAI-971)', () => {
  for (const [name, analytics, audience] of [
    ['the defaults', DEFAULT_GRANTS, 'The owner and admins can see it'],
    [
      'admins’ grant revoked',
      { admin: false, member: false, viewer: false },
      'The owner can see it',
    ],
    [
      'members granted',
      { admin: true, member: true, viewer: false },
      'The owner, admins and members can see it',
    ],
    [
      'every role granted',
      { admin: true, member: true, viewer: true },
      'The owner, admins, members and viewers can see it',
    ],
    ['the grants unreadable', null, 'The owner and anyone they grant access can see it'],
  ] as const) {
    void test(`${name}: “${audience}”`, async () => {
      const h = await open(
        '/developer?tab=activity',
        connect(
          { org: true, enabled: true, scope: 'agent-repos' },
          { value: HELD },
          'member',
          analytics,
        ),
      );
      try {
        const notice = h.page.locator('.dev-sharing [data-state="org-collects"]');
        await notice.waitFor({ timeout: 20_000 });
        const text = await notice.innerText();
        assert.equal(
          text.includes(`${COLLECTS} ${audience}, and you can see who looked.`),
          true,
          text,
        );
        // Asked of the server, never assumed (D-102 rule 6).
        assert.equal(
          h.calls.some((c) => c.method === 'GET' && c.path === '/api/v1/org/permissions'),
          true,
        );
        // No fixed role list survives anywhere on the panel.
        assert.doesNotMatch(await h.page.locator('.dev-sharing').innerText(), /Owners and admins/);
      } finally {
        await h.close();
      }
    });
  }

  void test('turn-off guidance follows withdrawn and granted change-org-settings permissions', async () => {
    for (const [role, settings, actions, guidance, linked] of [
      ['admin', { admin: false }, [], 'Only the owner can turn it off.', false],
      [
        'member',
        { member: true },
        ['org.developer_insights.set'],
        'You can turn Developer insights off in Organisation.',
        true,
      ],
      [
        'owner',
        { admin: false },
        ['org.developer_insights.set'],
        'You can turn Developer insights off in Organisation.',
        true,
      ],
    ] as const) {
      const h = await open(
        '/developer?tab=activity',
        connect(
          { org: true, enabled: true, scope: 'agent-repos' },
          { value: HELD },
          role,
          DEFAULT_GRANTS,
          settings,
          actions,
        ),
      );
      try {
        const notice = h.page.locator('.dev-sharing [data-state="org-collects"]');
        await notice.waitFor({ timeout: 20_000 });
        assert.match(await notice.innerText(), new RegExp(guidance.replace(/[.]/g, '\\.'), 'i'));
        assert.equal(
          await notice.locator('a[href="/organisation?tab=overview"]').count(),
          linked ? 1 : 0,
        );
      } finally {
        await h.close();
      }
    }
  });
});

void describe('Activity tab: Share local activity (the wizard’s Optional entry until LAI-507)', () => {
  void test('with the organisation’s switch off, says so and offers nothing to turn on', async () => {
    const h = await open(
      '/developer?tab=activity',
      connect({ org: false, enabled: false, scope: 'agent-repos' }, { value: NOTHING }),
    );
    try {
      const panel = h.page.locator('.share-activity');
      await panel.locator('.share-list').first().waitFor({ timeout: 20_000 });
      assert.match(await panel.innerText(), /Developer insights are off for this organisation/);
      // LAI-967: nothing waits on the person — off means nothing is collected.
      assert.match(await panel.innerText(), /so nothing is collected from your machine\./);
      assert.doesNotMatch(await panel.innerText(), /nothing to turn on/);
      assert.equal(await panel.getByRole('switch').count(), 0);
      await until(
        async () => (await panel.locator('a[href="/organisation?tab=overview"]').count()) === 1,
      );
      assert.equal(await panel.locator('a[href="/organisation?tab=overview"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('says the organisation collects, narrows the scope, shows the command, what is sent and never sent', async () => {
    const state = { org: true, enabled: false, scope: 'agent-repos' };
    const h = await open('/developer?tab=activity', connect(state, { value: HELD }, 'member'));
    try {
      const panel = h.page.locator('.share-activity');
      const notice = panel.locator('[data-state="org-collects"]');
      await notice.waitFor({ timeout: 20_000 });
      assert.equal((await notice.innerText()).includes(NOTICE), true);
      assert.equal(await panel.getByRole('switch').count(), 0);
      assert.equal(await notice.locator('a[href="#share-held"]').count(), 1);
      assert.equal(await notice.locator('a[href="/my-day"]').count(), 1);
      const text = await panel.innerText();
      assert.match(text, /How many prompts you sent, per agent/);
      assert.match(text, /Prompt text, or anything an agent wrote/);
      assert.match(text, /Commit messages, author emails or commit ids/);
      assert.match(text, /merge commits never count/);

      // The radio follows the server's answer, so click and wait for it —
      // `check()` would assert before the PUT has returned.
      const puts = () =>
        h.calls.filter((c) => c.method === 'PUT' && c.path === '/api/v1/me/activity-sharing');
      const narrow = panel.locator('input[name="share-scope"][value="laika-repos"]');
      await narrow.click();
      await until(() => puts().length === 1);
      assert.deepEqual(puts()[0]?.body, { scope: 'laika-repos' });
      await until(() => narrow.isChecked());
      assert.equal(await narrow.isChecked(), true);

      // The collector's command; the OpenTelemetry block below is its own (LAI-773).
      assert.equal(
        (
          await panel.locator('pre.conn-pre[aria-labelledby="share-command-label"]').innerText()
        ).trim(),
        'laika activity on',
      );
    } finally {
      await h.close();
    }
  });

  void test('offers OpenTelemetry, metrics only: this board’s address, no token, a copy (LAI-773, LAI-867)', async () => {
    const state = { org: true, enabled: true, scope: 'agent-repos' };
    const h = await open('/developer?tab=activity', connect(state, { value: HELD }));
    try {
      const block = h.page.locator('.share-activity [data-block="otel"]');
      await block.waitFor({ timeout: 20_000 });
      // The heading is drawn in capitals; the words are the same.
      assert.match(await block.innerText(), /OpenTelemetry \(optional\)/i);
      assert.match(await block.innerText(), /Metrics only/);
      // LAI-867: `laika activity on` writes it; no one is sent to a shell profile.
      assert.match(await block.innerText(), /laika activity on/);
      assert.doesNotMatch(await block.innerText(), /laika activity otel|In the shell/);
      const shown = JSON.parse(await block.locator('pre[data-otel]').innerText()) as {
        env: Record<string, string>;
        otelHeadersHelper: string;
      };
      assert.deepEqual(shown, {
        env: {
          CLAUDE_CODE_ENABLE_TELEMETRY: '1',
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${h.origin}/api/v1/otlp/v1/metrics`,
          OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
          OTEL_LOGS_EXPORTER: 'none',
        },
        otelHeadersHelper: '~/.laika/otel-headers',
      });
      await until(async () => (await block.getByRole('button', { name: /Copy/ }).count()) === 1);
      assert.equal(await block.getByRole('button', { name: /Copy/ }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('says the year of the oldest day held when it is not this one (LAI-751)', async () => {
    // 370 days back is always last year or before.
    const old = new Date(NOW - 370 * DAY);
    const oldest = old.toISOString().slice(0, 10);
    const h = await open(
      '/developer?tab=activity',
      connect(
        { org: true, enabled: true, scope: 'agent-repos' },
        { value: { ...HELD, oldest_day: oldest } },
      ),
    );
    try {
      const note = h.page.locator('.share-activity .conn-note', { hasText: 'Held since' });
      await note.waitFor({ timeout: 20_000 });
      const day = old.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
      assert.match(
        await note.innerText(),
        new RegExp(`Held since ${day} ${String(old.getUTCFullYear())} ·`),
      );
      // This year's days stay short: today's row has no year.
      const today = await h.page.locator('table.share-table tbody tr').first().innerText();
      assert.doesNotMatch(today, new RegExp(String(new Date(NOW).getUTCFullYear())));
    } finally {
      await h.close();
    }
  });

  void test('previews what is held, by agent name, and deletes it after a confirmation', async () => {
    const held = { value: HELD as unknown };
    const h = await open(
      '/developer?tab=activity',
      connect({ org: true, enabled: true, scope: 'agent-repos' }, held),
    );
    try {
      const panel = h.page.locator('.share-activity');
      const table = panel.locator('table.share-table');
      await table.waitFor({ timeout: 20_000 });
      // Wait for the rows it counts, not the table (LAI-715).
      await until(async () => (await table.locator('tbody tr').count()) === 2);
      const rows = await table.locator('tbody tr').allInnerTexts();
      assert.equal(rows.length, 2);
      assert.match(rows[0] ?? '', /Claude Code 18, Gemini CLI 2, Other agent 1\s+3\s+2\s+4/);
      // Token counts are named in what is held (D-084 item 4), cache reads apart.
      assert.match(rows[0] ?? '', /\b4\s+1\.23M$/);

      // Declining the confirmation deletes nothing.
      h.page.once('dialog', (dialog) => {
        void dialog.dismiss();
      });
      await panel.getByRole('button', { name: 'Delete my local-activity history' }).click();
      await h.page.waitForTimeout(150);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);

      h.page.once('dialog', (dialog) => {
        assert.match(dialog.message(), /cannot be undone/);
        void dialog.accept();
      });
      await panel.getByRole('button', { name: 'Delete my local-activity history' }).click();
      await panel.locator('[data-state="nothing-held"]').waitFor();
      assert.equal(
        h.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/v1/me/local-activity')
          .length,
        1,
      );
      assert.match(
        await panel.innerText(),
        /Deleted\. Nothing held for you in these 14 days, and nothing older\./,
      );
      assert.equal(
        await panel.getByRole('button', { name: 'Delete my local-activity history' }).count(),
        0,
      );
    } finally {
      await h.close();
    }
  });
});

/**
 * Connect and Developer access draw the same Share local activity, and must
 * ask it the same question (LAI-970): Connect passed `user.invite` where
 * Developer access asked `org.developer_insights.set`, so an admin who kept
 * people and lost settings was offered the Organisation link on one page and
 * not the other.
 */
void describe('the Activity tab says who may turn insights on (one panel since LAI-507)', () => {
  const LINK = 'a[href="/organisation?tab=overview"]';
  for (const [who, role, actions, linked] of [
    [
      'an admin who keeps people and loses settings',
      'admin',
      ['user.invite', 'user.deactivate'],
      false,
    ],
    [
      'a member granted settings only',
      'member',
      ['org.developer_insights.set', 'org.time.set'],
      true,
    ],
  ] as const) {
    void test(who, async () => {
      const state = { org: false, enabled: false, scope: 'agent-repos' };
      const counts: number[] = [];
      for (const path of ['/developer?tab=activity']) {
        const h = await open(
          path,
          connect(state, { value: NOTHING }, role, DEFAULT_GRANTS, { admin: true }, actions),
          { before: (page) => watchFor(page, [`.share-activity ${LINK}`]) },
        );
        try {
          const panel = h.page.locator('.share-activity');
          await panel.locator('[data-state="org-off"]').waitFor({ timeout: 20_000 });
          await until(() => h.calls.some((c) => c.path === '/api/v1/permissions'));
          if (linked) await panel.locator(LINK).waitFor({ timeout: 10_000 });
          else await new Promise((resolve) => setTimeout(resolve, 600));
          counts.push(await panel.locator(LINK).count());
          assert.equal(
            await everSeen(h.page, `.share-activity ${LINK}`),
            linked,
            `${path} ${linked ? 'never offered' : 'offered'} the Organisation link`,
          );
        } finally {
          await h.close();
        }
      }
      assert.deepEqual(counts, linked ? [1] : [0]);
    });
  }
});
