/**
 * The Capacity screen renders (LAI-439) — M5's exit criterion.
 *
 * ## The row this test exists for
 *
 * **An entry with no `repo` is a normal state**: presence tells a reader *where*
 * only when the heartbeat attributes to a project they can read (LAI-438), and
 * the hook fires in every repository a person opens because `LAIKA_URL` lives in
 * user settings (D-046). So *somebody is working, elsewhere* has to look like a
 * person — not a dash, not "unknown", not a skeleton that never resolves.
 *
 * It is also the row most likely to render as broken, and **no source assertion
 * can tell you it did not**: the failure is a blank gap where a name should be.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const now = 1788272050095;
const P = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 2, review: 1, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 3,
  members: [],
  last_activity_at: 2,
};

const task = (id: string, key: string, title: string, status: string) => ({
  id,
  key,
  project_id: 'p1',
  number: Number(key.split('-')[1]),
  title,
  description_md: null,
  acceptance_md: null,
  status,
  priority: 'p2',
  assignee_id: 'u1',
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: now - 5 * 3600000,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
});

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [P], next_cursor: null },
  '/api/v1/projects/laika-core': P,
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        repo: 'git@github.com:PawanSirsat/Laika.git',
        branch: 'lai-9-parity',
        matched_task_id: 't1',
        project_ids: ['p1'],
        is_agent: true,
        last_seen: now,
      },
      // LAI-438: present, location withheld. repo/branch absent; the other two null/[].
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        matched_task_id: null,
        project_ids: [],
        is_agent: false,
        last_seen: now - 60000,
      },
    ],
  },
  '/api/v1/capacity': {
    enabled: true,
    people: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        active_sessions: 2,
        in_progress_tasks: ['t1', 't2'],
        oldest_in_progress_ms: 5 * 3600000,
        tasks_in_review: ['t3'],
        last_seen: now,
        unlisted: ['n1'],
      },
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        active_sessions: 1,
        in_progress_tasks: [],
        oldest_in_progress_ms: null,
        tasks_in_review: [],
        last_seen: now - 60000,
        unlisted: [],
      },
      {
        user_id: 'u3',
        name: 'Priya Raman',
        active_sessions: 0,
        in_progress_tasks: ['t2'],
        oldest_in_progress_ms: 40 * 60000,
        tasks_in_review: [],
        last_seen: null,
        unlisted: [],
      },
    ],
  },
  '/api/v1/tasks/t1': task('t1', 'LAI-9', 'Parity tests for the MCP tools', 'in_progress'),
  '/api/v1/tasks/t2': task('t2', 'LAI-12', 'Heartbeat retention job', 'in_progress'),
  '/api/v1/tasks/t3': task('t3', 'LAI-15', 'Rate limit headers', 'review'),
  '/api/v1/unlisted': {
    data: [
      {
        id: 'n1',
        user_id: 'u1',
        token_id: 'tok1',
        repo: 'PawanSirsat/Laika',
        note: 'The migration runner logs a warning nobody reads on every boot.',
        promoted_task_id: null,
        dismissed_at: null,
        created_at: now - 3600000,
      },
    ],
    next_cursor: null,
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the capacity screen', () => {
  void test('a person with no visible repo renders as a person, in both themes', async () => {
    const h = await open('/capacity', STUB);
    try {
      await h.page.locator('.cap-present-row').first().waitFor({ timeout: 20_000 });

      // The probe must see both rows, or "the withheld one is fine" is vacuous.
      assert.equal(await h.page.locator('.cap-present-row').count(), 2);

      const withheld = h.page.locator('.cap-present-row', { hasText: 'Tomas Nel' });
      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        const text = await withheld.innerText();
        assert.match(text, /Tomas Nel/, `${theme}: the person is missing`);
        assert.match(
          text,
          /working elsewhere/,
          `${theme}: no sentence where the location would be`,
        );
        // The failure modes this row invites, each named.
        assert.doesNotMatch(text, /unknown/i, `${theme}: renders "unknown"`);
        assert.doesNotMatch(text, /undefined|null/i, `${theme}: leaked a placeholder`);
        assert.doesNotMatch(text, /^\s*[-—]\s*$/m, `${theme}: renders a bare dash`);

        const box = await withheld.boundingBox();
        assert.ok(box !== null && box.height > 0, `${theme}: the row has no box`);
        assert.equal(await withheld.locator('.cap-repo').count(), 0, `${theme}: leaked a repo`);
      }
    } finally {
      await h.close();
    }
  });

  void test('an agent session is marked, and a human is not', async () => {
    const h = await open('/capacity', STUB);
    try {
      const agent = h.page.locator('.cap-present-row', { hasText: 'Ada Lovelace' });
      await agent.waitFor({ timeout: 20_000 });
      // LAI-411's treatment, reused — the word `agent`, not a colour alone.
      assert.equal(await agent.locator('.marker-agent').count(), 1);
      assert.match(await agent.locator('.marker-agent').innerText(), /agent/i);

      const human = h.page.locator('.cap-present-row', { hasText: 'Tomas Nel' });
      assert.equal(
        await human.locator('.marker-agent').count(),
        0,
        'a human is badged as an agent',
      );
    } finally {
      await h.close();
    }
  });

  void test('task ids are resolved to keys and titles, never shown raw', async () => {
    const h = await open('/capacity', STUB);
    try {
      await h.page.locator('.cap-task').first().waitFor({ timeout: 20_000 });
      const chips = await h.page.locator('.cap-task').allInnerTexts();
      assert.ok(chips.length >= 3, `only ${String(chips.length)} task chips`);
      for (const chip of chips) {
        assert.match(chip, /LAI-\d+/, `a chip shows no key: ${chip}`);
        assert.doesNotMatch(chip, /^t\d+$/, `a chip shows a raw id: ${chip}`);
      }
    } finally {
      await h.close();
    }
  });

  void test('unlisted work promotes without leaving the screen', async () => {
    const h = await open('/capacity', STUB);
    try {
      const promote = h.page.locator('.unl-promote').first();
      await promote.waitFor({ timeout: 20_000 });
      const before = h.page.url();
      await promote.click();
      await h.page.waitForTimeout(200);

      // AC5: the click may open a form; it must not navigate.
      assert.equal(h.page.url(), before, 'promoting navigated away');
      assert.equal(await h.page.locator('.unl-form').count(), 1, 'no form appeared');
      assert.equal(await h.page.locator('.cap-present-row').count(), 2, 'the screen was replaced');
    } finally {
      await h.close();
    }
  });

  void test('presence ON with nobody working is NOT the disabled state', async () => {
    // **The mutation that found this gap**: reading `people.length === 0`
    // instead of `enabled` passed every test, because the disabled fixture had
    // both true at once. `{ enabled: false }` and an empty list are opposite
    // claims — *this org does not record who is working* against *nobody is* —
    // and since LAI-150 a disabled org stores nothing, so an empty list is the
    // only thing left to infer from. This is the fixture that separates them.
    const quiet = {
      ...STUB,
      '/api/v1/presence': { enabled: true, present: [] },
      '/api/v1/capacity': { enabled: true, people: [] },
    };
    const h = await open('/capacity', quiet);
    try {
      await h.page.locator('.cap').waitFor({ timeout: 20_000 });
      const text = await h.page.locator('.cap').innerText();
      assert.doesNotMatch(text, /presence is off/i, 'an empty org reads as disabled');
      assert.match(text, /no sessions in the last five minutes/i, 'it says nothing at all');
    } finally {
      await h.close();
    }
  });

  void test('`unlisted` absent and `unlisted` empty both render no count', async () => {
    // Absent means *you may not be told*; `[]` means *they have logged nothing*.
    // Neither is a number to show, and `?? []` would collapse the first into the
    // second — which a mutation proved this suite could not see.
    const noKey = {
      ...STUB,
      '/api/v1/capacity': {
        enabled: true,
        people: [
          // No `unlisted` key at all: a reader without `audit_log.export`.
          {
            user_id: 'u1',
            name: 'Ada Lovelace',
            active_sessions: 1,
            in_progress_tasks: [],
            oldest_in_progress_ms: null,
            tasks_in_review: [],
            last_seen: now,
          },
          // Present and empty: they have logged nothing.
          {
            user_id: 'u2',
            name: 'Tomas Nel',
            active_sessions: 0,
            in_progress_tasks: [],
            oldest_in_progress_ms: null,
            tasks_in_review: [],
            last_seen: null,
            unlisted: [],
          },
        ],
      },
    };
    const h = await open('/capacity', noKey);
    try {
      await h.page.locator('.cap-person').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.cap-person').count(), 2);
      assert.equal(
        await h.page.locator('.cap-unlisted-count').count(),
        0,
        'a count was rendered for somebody with no unlisted work to report',
      );
    } finally {
      await h.close();
    }
  });

  void test('presence off is a disabled state, not an empty one', async () => {
    const off = {
      ...STUB,
      '/api/v1/presence': { enabled: false, present: [] },
      '/api/v1/capacity': { enabled: false, people: [] },
    };
    const h = await open('/capacity', off);
    try {
      await h.page.locator('.cap').waitFor({ timeout: 20_000 });
      const text = await h.page.locator('.cap').innerText();
      assert.match(text, /presence is off/i, 'a disabled org reads as empty');
      // AC4: no control here — turning it on is Admin+ on the Organisation
      // screen, and offering a switch most readers cannot use is worse than
      // saying where it lives.
      assert.equal(await h.page.locator('.cap input[type="checkbox"]').count(), 0);
      assert.doesNotMatch(text, /nobody is working/i, 'disabled must not claim nobody is working');
      assert.equal(await h.page.locator('.cap-present-row').count(), 0);
    } finally {
      await h.close();
    }
  });
});
