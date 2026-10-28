/**
 * The Dashboard feed and Organisation → Activity name **which** agent wrote a
 * row (LAI-570), with the drawer's rule and the drawer's words (LAI-538):
 *
 * - an agent the reader may name: *Ada Lovelace via Claude Code · Belka*;
 * - a legacy token, whose rows carry no `agent_id`: *via agent (unregistered
 *   token)*;
 * - an agent the reader may not see: *via a registered agent* — never a guess.
 *
 * The badge, the chip and the screen-reader text stay as they were; the name
 * is added beside them. Both themes, at 1440 and 390.
 *
 * With `LAIKA_SHOTS` set, each screen lands there light and dark at both
 * widths.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const NOW = Date.now();

/** The reader's own agent: `GET /agents` answers it, so it may be named. */
const MINE = {
  id: 'ag-mine',
  owner_user_id: 'u1',
  display_name: 'Claude Code · Belka',
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [{ project_id: 'laika-core', scope: 'full' }],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: NOW,
};

const NAMED = 'Ada Lovelace via Claude Code · Belka';
const LEGACY = 'via agent (unregistered token)';
const UNSEEN = 'via a registered agent';

/** Three agent rows and a person's, newest first: mine, a legacy token's, someone else's agent. */
const EVENT = (
  seq: number,
  actor: string,
  kind: 'user' | 'agent',
  agentId: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: `e${String(seq)}`,
  seq,
  project_id: 'laika-core',
  task_id: null,
  actor_id: actor,
  actor_kind: kind,
  actor_token_id: null,
  agent_id: agentId,
  type: 'task.updated',
  payload: null,
  created_at: NOW - seq * 60_000,
  ...extra,
});

const EVENTS = [
  EVENT(1, 'u1', 'agent', 'ag-mine'),
  EVENT(2, 'u1', 'agent', null),
  EVENT(3, 'u2', 'agent', 'ag-theirs'),
  EVENT(4, 'u1', 'user', null),
];

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const ME = {
  id: 'u1',
  email: 'u1@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  created_at: 1,
  updated_at: 1,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

const COMMON: ApiStub = {
  '/api/v1/me': ME,
  '/api/v1/agents': { data: [MINE], next_cursor: null },
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 2,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

const DASHBOARD: ApiStub = {
  ...COMMON,
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' },
      { user_id: 'u2', name: 'Grace Hopper', email: 'u2@example.com', role: 'member' },
    ],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
  '/api/v1/projects/laika-core/activity': { data: EVENTS, next_cursor: null },
  '/api/v1/projects/laika-core/metrics': { since: 1, throughput: [], cycle_time: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const ORGANISATION: ApiStub = {
  ...COMMON,
  '/api/v1/users': {
    data: [person('u1', 'Ada Lovelace', 'owner'), person('u2', 'Grace Hopper', 'member')],
    next_cursor: null,
  },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/permissions': {
    org_roles: [],
    project_roles: [],
    permissions: [],
    me: {
      org_role: 'owner',
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: null,
      actions: ['audit_log.export', 'token.list_any'],
      projects: [],
    },
  },
  '/api/v1/activity/history?limit=50': { data: EVENTS, next_cursor: null },
};

/** Each row's text, whitespace folded, in the order the screen shows them. */
const rowTexts = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()));

async function shoot(page: Page, name: string, ready: () => Promise<void>): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await setTheme(page, theme);
      // The theme is switched from the user menu, which opens a phone's
      // sidebar; a fresh load shows the screen as a reader lands on it.
      await page.reload();
      await ready();
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}-${String(width)}.png`) });
    }
  }
}

void after(async () => {
  await closeBrowser();
});

void describe('the Dashboard feed names the agent (LAI-570)', () => {
  void test('mine by name, a legacy token as unregistered, another’s as a registered agent — in both themes', async () => {
    const h = await open('/dashboard?project=laika-core', DASHBOARD);
    try {
      const rows = '.dash-event .dash-what';
      await h.page.locator('.dash-event').first().waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        // `GET /agents` answers after the feed may have drawn: wait for the name.
        await until(async () => ((await rowTexts(h.page, rows))[0] ?? '').startsWith(NAMED));
        const [mine, legacy, theirs, persons] = await rowTexts(h.page, rows);
        assert.ok(mine?.startsWith(NAMED), `${theme}: ${String(mine)}`);
        assert.ok(legacy?.startsWith(`Ada Lovelace ${LEGACY}`), `${theme}: ${String(legacy)}`);
        assert.ok(theirs?.startsWith(`Grace Hopper ${UNSEEN}`), `${theme}: ${String(theirs)}`);
        assert.doesNotMatch(persons ?? '', / via /, `${theme}: a person’s row names an agent`);
        assert.ok(await h.page.locator('.dash-via').first().isVisible());
      }
      // The mark and the hidden words are still there, on agent rows only.
      assert.equal(await h.page.locator('.dash-event .dash-avatar-bot').count(), 3);
      assert.equal(
        await h.page.locator('.dash-event .visually-hidden', { hasText: '(by an agent)' }).count(),
        3,
      );
      await shoot(h.page, 'dashboard-feed', async () => {
        await h.page.locator('.dash-via').first().scrollIntoViewIfNeeded();
      });
    } finally {
      await h.close();
    }
  });
});

void describe('Organisation → Activity names the agent (LAI-570)', () => {
  void test('mine by name, a legacy token as unregistered, another’s as a registered agent — in both themes', async () => {
    const h = await open('/organisation?tab=activity', ORGANISATION);
    try {
      await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
      /** Each row's who: the person, what follows them, and whether the chip is there. */
      const whos = () =>
        h.page.locator('.oh-row .oh-who').evaluateAll((els) =>
          els.map((el) => {
            const rest = el.cloneNode(true) as HTMLElement;
            for (const part of rest.querySelectorAll('.oh-via, .org-chip')) part.remove();
            return {
              person: (rest.textContent ?? '').trim(),
              via: el.querySelector('.oh-via')?.textContent ?? null,
              chip: el.querySelector('.org-chip')?.textContent ?? null,
            };
          }),
        );
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        await until(async () => (await whos())[0]?.via === 'via Claude Code · Belka');
        const [mine, legacy, theirs, persons] = await whos();
        const line = (who: typeof mine) => `${String(who?.person)} ${String(who?.via)}`;
        assert.equal(line(mine), NAMED, theme);
        assert.equal(line(legacy), `Ada Lovelace ${LEGACY}`, theme);
        assert.equal(line(theirs), `Grace Hopper ${UNSEEN}`, theme);
        for (const who of [mine, legacy, theirs]) assert.equal(who?.chip, 'Agent', theme);
        assert.deepEqual(
          persons,
          { person: 'Ada Lovelace', via: null, chip: null },
          `${theme}: a person’s row names an agent`,
        );
        assert.ok(await h.page.locator('.oh-via').first().isVisible());
      }
      assert.equal(await h.page.locator('.oh-row .org-chip', { hasText: 'Agent' }).count(), 3);
      await shoot(h.page, 'organisation-activity', async () => {
        await h.page.locator('.oh-via').first().scrollIntoViewIfNeeded();
      });
    } finally {
      await h.close();
    }
  });
});
