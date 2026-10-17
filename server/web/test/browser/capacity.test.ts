/**
 * The Capacity screen renders (LAI-439) — M5's exit criterion. **One global
 * page in the sidebar since LAI-754**, with its unlisted-work list moved to
 * `/unlisted` (owner, 2026-10-15).
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
import { closeBrowser, open, refuse, type ApiStub, setTheme, until } from './harness.ts';

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
  parent_task_id: null,
  due_on: null,
  planned_start: null,
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
        client: 'claude-code',
        clients: ['claude-code', 'cursor'],
        last_seen: now,
      },
      // LAI-438: present, location withheld. repo/branch absent; the other two null/[].
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        matched_task_id: null,
        project_ids: [],
        is_agent: false,
        client: null,
        clients: [],
        last_seen: now - 60000,
      },
      // LAI-736: an MCP-only agent session — no heartbeat, so no repo at all.
      {
        user_id: 'u3',
        name: 'Priya Raman',
        matched_task_id: null,
        project_ids: [],
        is_agent: true,
        client: 'codex',
        clients: ['codex'],
        last_seen: now - 30000,
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
      // Decided: promoted notes are listed by default and must not count as open.
      {
        id: 'n2',
        user_id: 'u1',
        token_id: 'tok1',
        repo: 'PawanSirsat/Laika',
        note: 'Already a task.',
        promoted_task_id: 't3',
        dismissed_at: null,
        created_at: now - 7200000,
      },
    ],
    next_cursor: null,
  },
};

/** A reader who may not triage unlisted work: no link, no sidebar entry, no request. */
const MEMBER_ME = {
  id: 'u2',
  email: 'm@example.com',
  name: 'Tomas Nel',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

void after(async () => {
  await closeBrowser();
});

void describe('the capacity screen', () => {
  void test('a person with no visible repo renders as a person, in both themes', async () => {
    const h = await open('/capacity', STUB);
    try {
      /*
       * **The card, not the old presence row** (LAI-275). Capacity is now one
       * card per person in the design's four panels; the property under test is
       * unchanged — a person whose location is withheld renders as a person,
       * with a sentence, and leaks nothing.
       */
      await h.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });

      // The probe must see every card, or "the withheld one is fine" is vacuous.
      assert.ok((await h.page.locator('.cap-card').count()) >= 2);

      const withheld = h.page.locator('.cap-card', { hasText: 'Tomas Nel' });
      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
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
      const agent = h.page.locator('.cap-card', { hasText: 'Ada Lovelace' });
      await agent.waitFor({ timeout: 20_000 });
      // LAI-411's treatment, reused — the word `agent`, not a colour alone.
      assert.equal(await agent.locator('.marker-agent').count(), 1);
      assert.match(await agent.locator('.marker-agent').innerText(), /agent/i);

      const human = h.page.locator('.cap-card', { hasText: 'Tomas Nel' });
      assert.equal(
        await human.locator('.marker-agent').count(),
        0,
        'a human is badged as an agent',
      );
    } finally {
      await h.close();
    }
  });

  void test('an agent session names its agent; an MCP-only one says which, not a repo (LAI-737)', async () => {
    const h = await open('/capacity', STUB);
    try {
      const ada = h.page.locator('.cap-card', { hasText: 'Ada Lovelace' });
      await ada.waitFor({ timeout: 20_000 });
      const clients = await ada.locator('.cap-client').allInnerTexts();
      assert.deepEqual(
        clients.map((c) => c.trim()),
        ['Claude Code', 'Cursor'],
      );
      assert.equal(await ada.locator('.agent-mark').count(), 2);

      const priya = h.page.locator('.cap-card', { hasText: 'Priya Raman' });
      const text = await priya.innerText();
      assert.match(text, /connected via Codex/, 'the MCP-only session does not say which agent');
      assert.doesNotMatch(text, /undefined|null/i);

      // CONTROL: the person in the browser is still just a person.
      const tomas = h.page.locator('.cap-card', { hasText: 'Tomas Nel' });
      assert.equal(await tomas.locator('.cap-client').count(), 0);
      assert.match(await tomas.innerText(), /working elsewhere/);
    } finally {
      await h.close();
    }
  });

  // The chip is the space bar's, not Capacity's: since LAI-754 Capacity has no
  // space frame, so this is asserted on a space tab with the same presence.
  void test('the Agents chip says what its number counts, and which agents (LAI-737)', async () => {
    const h = await open('/activity?project=laika-core', STUB);
    try {
      const chip = h.page.locator('.space-agents-start');
      await chip.locator('.agent-mark').first().waitFor({ timeout: 20_000 });
      const text = (await chip.textContent()) ?? '';
      // Two people have agent sessions (Ada, Priya); three agents are live.
      assert.match(text, /2 people with agent sessions/, text);
      assert.match(text, /Claude Code, Cursor, Codex/, text);
    } finally {
      await h.close();
    }
  });

  void test('at 390px nothing is clipped or pushes the page sideways (LAI-737)', async () => {
    const h = await open('/capacity', STUB);
    try {
      await h.page.setViewportSize({ width: 390, height: 900 });
      await h.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });
      // Measure the page as drawn, not a guess at when it is (LAI-765): the
      // chips' titles land last, in one batch after the spaces' read, so once
      // one is drawn every chip and the summary's scope are; and the widths
      // are the self-hosted font's, not the fallback's.
      await h.page.locator('.cap-chip-title').first().waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      const wide = await h.page.evaluate(() => ({
        page: document.documentElement.scrollWidth > window.innerWidth,
        cut: [...document.querySelectorAll('.cap-card, .cap-card *')]
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible',
          )
          .map((el) => el.className),
      }));
      const strip = await h.page.evaluate(() => {
        const box = document.querySelector('.cap-summary')?.getBoundingClientRect();
        if (box === undefined) return ['no .cap-summary'];
        return [...document.querySelectorAll('.cap-summary > *')]
          .filter((el) => el.getBoundingClientRect().right > box.right + 1)
          .map((el) => el.className);
      });
      assert.deepEqual(strip, [], `the summary strip spills: ${strip.join(', ')}`);
      assert.equal(wide.page, false, 'the page scrolls sideways');
      assert.deepEqual(wide.cut, [], `clipped: ${wide.cut.join(', ')}`);
    } finally {
      await h.close();
    }
  });

  void test('task ids are resolved to keys and titles, never shown raw', async () => {
    const h = await open('/capacity', STUB);
    try {
      // `.cap-chip` since LAI-275 — the design's in-progress chips. Same
      // property: an id must never reach the screen in place of a key.
      await h.page.locator('.cap-chip').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.cap-chip-title').first().waitFor({ timeout: 20_000 });
      const chips = await h.page.locator('.cap-chip').allInnerTexts();
      assert.ok(chips.length >= 3, `only ${String(chips.length)} task chips`);
      for (const chip of chips) {
        assert.match(chip, /LAI-\d+/, `a chip shows no key: ${chip}`);
        assert.doesNotMatch(chip, /^t\d+$/, `a chip shows a raw id: ${chip}`);
      }
      // LAI-754: the owner's chips read only a dot and `…`. Key **and** title,
      // with the whole title in the tooltip.
      const ada = h.page.locator('.cap-card', { hasText: 'Ada Lovelace' });
      const heartbeat = ada.locator('.cap-chip', { hasText: 'LAI-12' });
      assert.match(await heartbeat.innerText(), /LAI-12\s*Heartbeat retention job/);
      assert.match(
        (await heartbeat.getAttribute('title')) ?? '',
        /LAI-12 · Heartbeat retention job/,
      );
    } finally {
      await h.close();
    }
  });

  void test('no unlisted list on Capacity — a count that links to its page (LAI-754)', async () => {
    const h = await open('/capacity', STUB);
    try {
      await h.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });
      const link = h.page.locator('.cap-fig-link');
      await link.waitFor({ timeout: 10_000 });
      // One pending note; the promoted one is decided and not counted.
      assert.match(await link.innerText(), /UNLISTED\s*1/);
      assert.equal(await link.getAttribute('href'), '/unlisted');

      // The owner's two complaints, each named: the amber strip in a person's
      // card, and the long list of cards under the people.
      assert.equal(await h.page.locator('.cap-unlisted-strip').count(), 0, 'the amber strip');
      assert.equal(await h.page.locator('.unl-list, .unl-row').count(), 0, 'the unlisted list');
      assert.doesNotMatch(
        await h.page.locator('.cap').innerText(),
        /migration runner logs a warning/,
        'a note is still printed on Capacity',
      );

      // The sidebar carries the same count beside Unlisted work.
      const entry = h.page.locator('#sidebar .sidebar-link', { hasText: 'Unlisted work' });
      assert.match(await entry.innerText(), /Unlisted work\s*1/);

      await link.click();
      await h.page.waitForURL((url) => url.pathname === '/unlisted', { timeout: 10_000 });
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

  void test('a reader who may not triage gets no link, no entry and no request', async () => {
    // `unlisted` is withheld from capacity for a reader without
    // `audit_log.export`, and `GET /unlisted` refuses them — so nothing on the
    // page may mention the queue, and the client must not ask for it.
    const member = {
      ...STUB,
      '/api/v1/me': MEMBER_ME,
      '/api/v1/unlisted': refuse(403, 'forbidden', 'Admins only.'),
    };
    const h = await open('/capacity', member);
    try {
      await h.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });
      await h.page.locator('#sidebar .sidebar-link', { hasText: 'Capacity' }).waitFor();
      assert.equal(await h.page.locator('.cap-fig-unlisted').count(), 0, 'the link is drawn');
      assert.equal(
        await h.page.locator('#sidebar .sidebar-link', { hasText: 'Unlisted work' }).count(),
        0,
        'the sidebar offers Unlisted work to a member',
      );
      assert.deepEqual(
        h.calls.filter((c) => c.path === '/api/v1/unlisted'),
        [],
        'the client asked for the queue on behalf of a member',
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
      assert.equal(await h.page.locator('.cap-card').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('three chips and +N more; only drawn tasks are asked for (LAI-754)', async () => {
    const many = {
      ...STUB,
      '/api/v1/capacity': {
        enabled: true,
        people: [
          {
            user_id: 'u1',
            name: 'Ada Lovelace',
            active_sessions: 1,
            in_progress_tasks: ['t1', 't2', 't4', 't5', 't6'],
            oldest_in_progress_ms: 3600000,
            tasks_in_review: ['t3'],
            last_seen: now,
            unlisted: [],
          },
        ],
      },
      '/api/v1/tasks/t4': task('t4', 'LAI-20', 'Fourth task', 'in_progress'),
      '/api/v1/tasks/t5': task('t5', 'LAI-21', 'Fifth task', 'in_progress'),
      '/api/v1/tasks/t6': task('t6', 'LAI-22', 'Sixth task', 'in_progress'),
    };
    const h = await open('/capacity', many);
    try {
      const card = h.page.locator('.cap-card', { hasText: 'Ada Lovelace' });
      await card.locator('.cap-chip-title').first().waitFor({ timeout: 20_000 });
      assert.equal(await card.locator('.cap-chip').count(), 3);
      assert.equal((await card.locator('.cap-chip-more').innerText()).trim(), '+2 more');
      assert.match(await card.locator('.cap-wip-count').innerText(), /5/);

      await h.page.waitForTimeout(500);
      const asked = h.calls
        .map((c) => c.path)
        .filter((p) => p.startsWith('/api/v1/tasks/'))
        .sort();
      // t1 is also the session's matched task; t3 is in review and t5, t6 are
      // behind "+2 more" — none of those three is drawn, so none is read.
      assert.deepEqual(asked, ['/api/v1/tasks/t1', '/api/v1/tasks/t2', '/api/v1/tasks/t4']);
    } finally {
      await h.close();
    }
  });

  void test('a chip that failed to resolve is asked for again on the next poll (LAI-754)', async () => {
    let tries = 0;
    const flaky = {
      ...STUB,
      '/api/v1/tasks/t2': () => {
        tries += 1;
        return tries === 1
          ? refuse(503, 'unavailable', 'Try again.')
          : task('t2', 'LAI-12', 'Heartbeat retention job', 'in_progress');
      },
    };
    const h = await open('/capacity', flaky, {
      before: async (page) => {
        await page.clock.install();
      },
    });
    try {
      const card = h.page.locator('.cap-card', { hasText: 'Ada Lovelace' });
      await card.locator('.cap-chip', { hasText: 'LAI-9' }).waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(300);
      // Positive control: the first read failed, so the chip is still waiting.
      assert.equal(tries, 1);
      assert.equal(await card.locator('.cap-chip', { hasText: 'LAI-12' }).count(), 0);

      await h.page.clock.fastForward(21_000);
      await card.locator('.cap-chip', { hasText: 'LAI-12' }).waitFor({ timeout: 10_000 });
      assert.equal(tries, 2);
    } finally {
      await h.close();
    }
  });

  void test('an old space-tab link opens the one global page (LAI-754)', async () => {
    const h = await open('/capacity?project=laika-core', STUB);
    try {
      await h.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });
      await h.page.waitForURL((url) => url.pathname === '/capacity' && url.search === '', {
        timeout: 10_000,
      });
      assert.equal(await h.page.locator('.view-tab').count(), 0, 'the space tabs are drawn');
      assert.match(await h.page.locator('.screen-bar-title').innerText(), /Capacity/);
      // The scope, in words: every space this reader can see. The spaces are
      // their own read, apart from the cards' (LAI-765): until it lands the
      // note says how often it refreshes, so wait for the scope, then assert it.
      const note = h.page.locator('.cap-summary-note');
      await until(async () => (await note.innerText()).includes('across 1 space'), 10_000);
      assert.match(await note.innerText(), /across 1 space/);
    } finally {
      await h.close();
    }
  });

  /*
   * LAI-755. Capacity spans every space, so a chip's task is usually in a
   * space other than the one last opened. The chip used to go to
   * `/board?q=<KEY>` with no `?project=`, so the board fell back to the last
   * space and searched it for a key it does not hold: an empty board.
   */
  void test('a chip opens its task in the task’s own space, not the last one opened (LAI-755)', async () => {
    const WEB = { ...P, id: 'p2', slug: 'laika-web', name: 'Laika Web', prefix: 'LW' };
    const lw1 = {
      ...task('t9', 'LW-1', 'Toolbar reads its own width', 'in_progress'),
      project_id: 'p2',
    };
    const board = (slug: string, tasks: unknown[]): ApiStub => ({
      [`/api/v1/projects/${slug}/tasks`]: { data: tasks, next_cursor: null },
      [`/api/v1/projects/${slug}/members`]: { members: [] },
      [`/api/v1/projects/${slug}/sprints`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${slug}/activity`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${slug}/tags`]: { tags: [] },
      [`/api/v1/projects/${slug}/mentionable`]: { users: [] },
    });
    const twoSpaces: ApiStub = {
      ...STUB,
      ...board('laika-core', []),
      ...board('laika-web', [lw1]),
      '/api/v1/me': {
        ...(STUB['/api/v1/me'] as object),
        memberships: [
          { project_id: 'p1', role: 'lead' },
          { project_id: 'p2', role: 'lead' },
        ],
      },
      '/api/v1/projects': { data: [P, WEB], next_cursor: null },
      '/api/v1/projects/laika-web': WEB,
      '/api/v1/org': {
        id: 'o',
        name: 'Borealis Labs',
        presence_enabled: true,
        created_at: 1,
        updated_at: 1,
      },
      '/api/v1/capacity': {
        enabled: true,
        people: [
          {
            user_id: 'u1',
            name: 'Ada Lovelace',
            active_sessions: 1,
            in_progress_tasks: ['t9'],
            oldest_in_progress_ms: 3600000,
            tasks_in_review: [],
            last_seen: now,
            unlisted: [],
          },
        ],
      },
      '/api/v1/tasks/t9': lw1,
      '/api/v1/tasks/t9/comments': { data: [], next_cursor: null },
      '/api/v1/tasks/t9/watchers': { watchers: [] },
    };

    // Laika Core is the space last opened.
    const h = await open('/board?project=laika-core', twoSpaces);
    try {
      await h.page.locator('.board-bar').waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => {
        history.pushState({}, '', '/capacity');
        dispatchEvent(new PopStateEvent('popstate'));
      });

      const chip = h.page.locator('.cap-chip', { hasText: 'LW-1' });
      await chip.locator('.cap-chip-title').waitFor({ timeout: 20_000 });
      await chip.click();

      await h.page.waitForURL((url) => url.pathname === '/board', { timeout: 10_000 });
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('project'), 'laika-web', 'not the task’s own space');
      assert.equal(url.searchParams.get('task'), 't9', 'the task is not opened by id');

      // `.drawer` is a frame whose slot the task panel fills afterwards, so it
      // exists empty first (LAI-765: GitHub's runner read '' here). Wait for
      // the content, then assert it.
      const drawer = h.page.locator('.drawer');
      await drawer.waitFor({ timeout: 10_000 });
      await until(async () => {
        const text = await drawer.innerText();
        return text.includes('LW-1') && text.includes('Toolbar reads its own width');
      }, 10_000);
      assert.match(await drawer.innerText(), /LW-1/);
      assert.match(await drawer.innerText(), /Toolbar reads its own width/);
    } finally {
      await h.close();
    }
  });
});
