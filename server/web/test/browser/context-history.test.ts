/**
 * The project context's revision history, comparison and stale-save path
 * (LAI-556, SPEC §4.68, §6.4).
 *
 * Driven through the real Projects screen against stubbed endpoints shaped as
 * §6.4 answers them. Screenshots go to `$EVIDENCE_DIR` when it is set.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  fakeStream,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { answerConfirm } from './confirm.ts';
import { pick } from './dropdown.ts';

const NOW = Date.now();
const SLUG = 'laika-core';

const SPACE = {
  id: 'p1',
  slug: SLUG,
  prefix: 'LAI',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [
    { user_id: 'u1', name: 'Reader Lead', role: 'lead' },
    { user_id: 'u2', name: 'Ada Writer', role: 'member' },
  ],
  last_activity_at: null,
};

const R1 = '# Laika\n\nSQLite only.';
const R2 = '# Laika\n\nSQLite only.\nNo ORM but Drizzle.';
const R3 = '# Laika\n\nSQLite only.\nNo ORM but Drizzle.\nTests are node:test.';

const SUMMARIES = [
  { revision: 3, length: R3.length, author_id: 'u2', agent_id: null, created_at: NOW - 60_000 },
  { revision: 2, length: R2.length, author_id: 'u1', agent_id: 'a1', created_at: NOW - 3_600_000 },
  { revision: 1, length: R1.length, author_id: null, agent_id: null, created_at: NOW - 86_400_000 },
];

const MY_AGENT = {
  id: 'a1',
  owner_user_id: 'u1',
  display_name: 'Polly',
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
};

/** `GET …/context/deliveries` as §6.4 answers it (LAI-1003). */
function deliveries(
  revision: number | null,
  data: readonly unknown[],
  next_cursor: string | null = null,
) {
  return { scope: 'latest_per_session', revision, current_revision: 3, data, next_cursor };
}

const DELIVERIES = `/api/v1/projects/${SLUG}/context/deliveries`;

/** The default: nothing delivered yet, for every revision and for the project. */
const NO_DELIVERIES: ApiStub = {
  [`${DELIVERIES}?limit=200`]: deliveries(null, []),
  [`${DELIVERIES}?limit=200&revision=1`]: deliveries(1, []),
  [`${DELIVERIES}?limit=200&revision=2`]: deliveries(2, []),
  [`${DELIVERIES}?limit=200&revision=3`]: deliveries(3, []),
};

function doc(revision: number, body: string) {
  return {
    context_md: body,
    revision,
    length: body.length,
    limit: 100_000,
    updated_at: NOW - 60_000,
    updated_by: 'u2',
  };
}

/** A lead on Laika Core, with the context and history endpoints stubbed. */
function world(overrides: ApiStub = {}): ApiStub {
  const base = `/api/v1/projects/${SLUG}/context`;
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'lead@example.com',
      name: 'Reader Lead',
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: SPACE.id, role: 'lead' }],
    },
    '/api/v1/projects': { data: [SPACE], next_cursor: null },
    '/api/v1/permissions': {
      org_roles: [],
      project_roles: [],
      permissions: [],
      me: {
        org_role: 'member',
        credential: 'session',
        project_scope: 'all',
        implicit_project_role: null,
        actions: [],
        projects: [{ project_id: SPACE.id, role: 'lead', actions: ['project.settings.edit'] }],
      },
    },
    '/api/v1/agents': { data: [MY_AGENT], next_cursor: null },
    [base]: doc(3, R3),
    [`${base}/revisions`]: SUMMARIES,
    [`${base}/revisions/1`]: { ...SUMMARIES[2], body: R1 },
    [`${base}/revisions/2`]: { ...SUMMARIES[1], body: R2 },
    [`${base}/revisions/3`]: { ...SUMMARIES[0], body: R3 },
    [`${base}/diff?from=2&to=3`]: {
      from_revision: 2,
      to_revision: 3,
      current_revision: 3,
      diff: '@@ -2,3 +2,4 @@\n \n SQLite only.\n No ORM but Drizzle.\n+Tests are node:test.',
      added: 1,
      removed: 0,
      truncated: false,
      hint: null,
    },
    [`${base}/diff?from=1&to=3`]: {
      from_revision: 1,
      to_revision: 3,
      current_revision: 3,
      diff: '',
      added: null,
      removed: null,
      truncated: true,
      hint: 'More than 2,000 lines changed between revision 1 and 3, so no diff is sent.',
    },
    ...NO_DELIVERIES,
    ...overrides,
  };
}

async function openPanel(stub: ApiStub, stream = false): Promise<Harness> {
  const h = await open('/projects', stub, stream ? { before: fakeStream } : {});
  const card = h.page.locator('.project-card', { hasText: 'Laika Core' });
  await card.getByRole('button', { name: 'Context' }).click({ timeout: 20_000 });
  await h.page.locator('.ctx-editor').waitFor({ timeout: 20_000 });
  return h;
}

const evidence = process.env.EVIDENCE_DIR;
async function shot(h: Harness, name: string): Promise<void> {
  if (evidence === undefined || evidence === '') return;
  mkdirSync(evidence, { recursive: true });
  await h.page.screenshot({ path: join(evidence, `${name}.png`), fullPage: false });
}

void after(async () => {
  await closeBrowser();
});

void describe('the revision history', () => {
  void test('lists every revision with who saved it, when and how long it was', async () => {
    const h = await openPanel(world());
    try {
      const rows = h.page.locator('.ctx-revision');
      await rows.first().waitFor({ timeout: 10_000 });
      assert.equal(await rows.count(), 3);

      const r3 = await rows.nth(0).innerText();
      assert.match(r3, /r3/);
      assert.match(r3, /Current/);
      assert.match(r3, /Ada Writer/);
      assert.match(r3, new RegExp(`${String(R3.length)} characters`));

      // r2 was written through the reader's own agent: the person and the
      // agent, both named.
      const r2 = rows.nth(1);
      assert.match(await r2.innerText(), /Reader Lead/);
      assert.equal(await r2.locator('[data-agent-chip]').count(), 1);
      // Named by harness and device (D-120): one agent, so no mark, and
      // never the name it was registered with.
      assert.equal(
        (await r2.locator('[data-agent-chip]').innerText()).trim(),
        'Claude Code · Belka',
      );
      assert.doesNotMatch(await r2.innerText(), /Polly/);

      // r1 predates revisions: no author recorded, said plainly.
      assert.match(await rows.nth(2).innerText(), /Author not recorded/);
    } finally {
      await h.close();
    }
  });

  void test('an agent that is not the reader’s own is said to be an agent, not named', async () => {
    const h = await openPanel(world({ '/api/v1/agents': { data: [], next_cursor: null } }));
    try {
      const r2 = h.page.locator('.ctx-revision[data-revision="2"]');
      await r2.waitFor({ timeout: 10_000 });
      assert.match(await r2.innerText(), /through an agent/);
      assert.equal(await r2.locator('[data-agent-chip]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a revision opens whole from the keyboard, and focus follows', async () => {
    const h = await openPanel(world());
    try {
      const view = h.page.getByRole('button', { name: 'View r2' });
      await view.waitFor({ timeout: 10_000 });
      await view.focus();
      await h.page.keyboard.press('Enter');

      const body = h.page.locator('.ctx-revision-body');
      await body.waitFor({ timeout: 10_000 });
      assert.equal(await body.innerText(), R2);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.className),
        'ctx-viewer-title',
        'focus stayed on the button rather than moving to what it opened',
      );
    } finally {
      await h.close();
    }
  });

  void test('Hide hands focus back to the control that opened the viewer', async () => {
    const h = await openPanel(world());
    try {
      const changes = h.page.getByRole('button', { name: 'Changes in r3' });
      await changes.waitFor({ timeout: 10_000 });
      await changes.focus();
      await h.page.keyboard.press('Enter');
      await h.page.locator('[data-diff-line="added"]').first().waitFor({ timeout: 10_000 });

      await h.page.locator('[data-context-viewer]').getByRole('button', { name: 'Hide' }).click();
      await h.page.locator('[data-context-viewer]').waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Changes in r3',
        'focus fell to the page when Hide removed itself',
      );
    } finally {
      await h.close();
    }
  });

  void test('Hide after “Open in full” returns focus to Compare, not the gone button', async () => {
    const h = await openPanel(world());
    try {
      const form = h.page.locator('.ctx-compare');
      await form.waitFor({ timeout: 10_000 });
      await pick(form.getByRole('combobox', { name: 'From revision' }), '1');
      await pick(form.getByRole('combobox', { name: 'To revision' }), '3');
      const compare = form.getByRole('button', { name: 'Compare' });
      await compare.focus();
      await h.page.keyboard.press('Enter');

      const open = h.page.getByRole('button', { name: 'Open r3 in full' });
      await open.waitFor({ timeout: 10_000 });
      await open.focus();
      await h.page.keyboard.press('Enter');
      await h.page.locator('.ctx-revision-body').waitFor({ timeout: 10_000 });

      await h.page.locator('[data-context-viewer]').getByRole('button', { name: 'Hide' }).click();
      await h.page.locator('[data-context-viewer]').waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(
        await h.page.evaluate(() => {
          const el = document.activeElement;
          return el instanceof HTMLButtonElement && el.closest('.ctx-compare') !== null
            ? el.textContent
            : (el?.tagName ?? null);
        }),
        'Compare',
        'focus was lost: Hide returned it to the unmounted “Open r3 in full” button',
      );
    } finally {
      await h.close();
    }
  });

  void test('“Changes” draws the bounded diff, marked added and removed', async () => {
    const h = await openPanel(world());
    try {
      await h.page.getByRole('button', { name: 'Changes in r3' }).click({ timeout: 10_000 });
      const added = h.page.locator('[data-diff-line="added"]');
      await added.first().waitFor({ timeout: 10_000 });
      assert.equal(await added.count(), 1);
      assert.match(await added.innerText(), /Tests are node:test\./);
      assert.match(await h.page.locator('.ctx-diff-count').innerText(), /1 added · 0 removed/);
    } finally {
      await h.close();
    }
  });

  void test('a truncated comparison says so and opens the revision whole', async () => {
    const h = await openPanel(world());
    try {
      const form = h.page.locator('.ctx-compare');
      await form.waitFor({ timeout: 10_000 });
      await pick(form.getByRole('combobox', { name: 'From revision' }), '1');
      await pick(form.getByRole('combobox', { name: 'To revision' }), '3');
      await form.getByRole('button', { name: 'Compare' }).click();

      const truncated = h.page.locator('[data-diff-truncated]');
      await truncated.waitFor({ timeout: 10_000 });
      assert.match(await truncated.innerText(), /Too many lines changed between r1 and r3/);
      // Never an empty diff that reads as "nothing changed".
      assert.equal(await h.page.locator('[data-diff-none]').count(), 0);
      await truncated.scrollIntoViewIfNeeded();
      await shot(h, 'compare-truncated');

      await truncated.getByRole('button', { name: 'Open r3 in full' }).click();
      await h.page.locator('.ctx-revision-body').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.ctx-revision-body').innerText(), R3);
    } finally {
      await h.close();
    }
  });

  void test('no revisions yet is an empty state, not an empty list', async () => {
    const h = await openPanel(
      world({
        [`/api/v1/projects/${SLUG}/context`]: { ...doc(0, ''), updated_at: null, updated_by: null },
        [`/api/v1/projects/${SLUG}/context/revisions`]: [],
      }),
    );
    try {
      await h.page.locator('[data-history-empty]').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.ctx-compare').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a refused history is the permission-denied state', async () => {
    const h = await openPanel(
      world({
        [`/api/v1/projects/${SLUG}/context/revisions`]: refuse(403, 'forbidden', 'No'),
      }),
    );
    try {
      const denied = h.page.locator('.ctx-history .state-forbidden');
      await denied.waitFor({ timeout: 10_000 });
      assert.match(await denied.innerText(), /You do not have access to the revision history/);
    } finally {
      await h.close();
    }
  });
});

/**
 * The context endpoint as a tiny server: a current revision, `PATCH` refused
 * as stale unless it names it, and a log of every read and write in order.
 * `raceAfterRead` makes somebody else save straight after the next read.
 */
function contextServer(start: { revision: number; body: string }) {
  const state = { ...start, raceAfterRead: false };
  const log: string[] = [];
  const route = (call: StubCall) => {
    if (call.method !== 'PATCH') {
      log.push(`GET r${String(state.revision)}`);
      const answer = doc(state.revision, state.body);
      if (state.raceAfterRead) {
        state.raceAfterRead = false;
        state.revision += 1;
        state.body = `${state.body}\nSomebody else, again.`;
      }
      return answer;
    }
    const { base_revision: base, context_md: text } = call.body as {
      base_revision: number;
      context_md: string;
    };
    log.push(`PATCH base ${String(base)}`);
    if (base !== state.revision) {
      return reply(409, {
        error: {
          code: 'conflict',
          message: `The context document is at revision ${String(state.revision)}, not ${String(base)}`,
          details: {
            reason: 'stale_context_revision',
            base_revision: base,
            current_revision: state.revision,
          },
        },
      });
    }
    state.revision += 1;
    state.body = text;
    return doc(state.revision, text);
  };
  return { state, log, route };
}

/** Open at r2, then somebody saves r3, then the reader saves: refused. */
async function refusedSave(server: ReturnType<typeof contextServer>) {
  const h = await openPanel(world({ [`/api/v1/projects/${SLUG}/context`]: server.route }));
  const editor = h.page.locator('.ctx-editor');
  const mine = `${R2}\nMy change.`;
  await editor.fill(mine);
  server.state.revision = 3;
  server.state.body = R3;
  await h.page.locator('.ctx-save').click();
  const conflict = h.page.locator('[data-context-conflict="stale"]');
  await conflict.waitFor({ timeout: 10_000 });
  return { h, editor, mine, conflict };
}

void describe('a stale save', () => {
  void test('keeps the text, offers the comparison, and saves over only when asked', async () => {
    const server = contextServer({ revision: 2, body: R2 });
    const { h, editor, mine, conflict } = await refusedSave(server);
    try {
      assert.match(
        await conflict.getByRole('alert').innerText(),
        /Not saved: somebody saved a newer version \(r3\) while you were editing r2\. Your text is still here\./,
      );
      assert.equal(await editor.inputValue(), mine, 'the refused text was not kept');

      await conflict.getByRole('button', { name: 'Compare with the newer version' }).click();
      await conflict.locator('[data-diff-line="added"]').first().waitFor({ timeout: 10_000 });
      assert.match(await conflict.innerText(), /Tests are node:test\./);
      assert.equal(await editor.inputValue(), mine, 'comparing replaced the text');
      await conflict.scrollIntoViewIfNeeded();
      await shot(h, 'stale-save-compare');

      // Read the newest, then ask, then write exactly what was asked about.
      const before = server.log.length;
      await conflict.getByRole('button', { name: 'Save mine over r3' }).click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.deepEqual(
        server.log.slice(before),
        ['GET r3'],
        'the confirmation was shown before the newest revision was read, or after a write',
      );
      const said = await answerConfirm(h.page, true);
      assert.match(said, /Replace r3 with your text\?/);

      await until(() => server.log.length === before + 2);
      assert.deepEqual(server.log.slice(before), ['GET r3', 'PATCH base 3']);
      await conflict.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await editor.inputValue(), mine);
      assert.equal(server.state.revision, 4);
    } finally {
      await h.close();
    }
  });

  void test('a save that lands between the read and the write is refused again, not retried', async () => {
    const server = contextServer({ revision: 2, body: R2 });
    const { h, editor, mine, conflict } = await refusedSave(server);
    try {
      const before = server.log.length;
      server.state.raceAfterRead = true;
      await conflict.getByRole('button', { name: 'Save mine over r3' }).click();
      const said = await answerConfirm(h.page, true);
      assert.match(
        said,
        /Replace r3 with your text\?/,
        'the confirmation named the wrong revision',
      );

      const again = h.page.locator('[data-context-conflict="stale"]');
      await until(async () => {
        const text = await again
          .getByRole('alert')
          .innerText()
          .catch(() => '');
        return text.includes('(r4)');
      });
      assert.match(
        await again.getByRole('alert').innerText(),
        /somebody saved a newer version \(r4\)/,
      );
      // Give a retry loop the chance to show itself, then count the writes.
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(server.log.slice(before), ['GET r3', 'PATCH base 3']);
      assert.equal(await editor.inputValue(), mine, 'the refused text was not kept');
    } finally {
      await h.close();
    }
  });
});

void describe('live updates', () => {
  void test('a save elsewhere is announced without moving focus or touching the text', async () => {
    let current = doc(2, R2);
    let summaries = SUMMARIES.slice(1);
    const h = await openPanel(
      world({
        [`/api/v1/projects/${SLUG}/context`]: () => current,
        [`/api/v1/projects/${SLUG}/context/revisions`]: () => summaries,
      }),
      true,
    );
    try {
      const editor = h.page.locator('.ctx-editor');
      await h.page.locator('.ctx-revision').first().waitFor({ timeout: 10_000 });
      await editor.click();
      await h.page.keyboard.type(' typing');
      const typed = await editor.inputValue();

      current = doc(3, R3);
      summaries = SUMMARIES;
      await until(() =>
        h.page.evaluate(
          () =>
            (
              window as unknown as { __laikaStream: { count: () => number } }
            ).__laikaStream.count() > 0,
        ),
      );
      await h.page.evaluate(() => {
        (
          window as unknown as {
            __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
          }
        ).__laikaStream.emit('project.context_updated', { type: 'project.context_updated' }, '9');
      });

      const notice = h.page.locator('[data-context-conflict="live"]');
      await notice.waitFor({ timeout: 10_000 });
      assert.match(
        await notice.getByRole('status').innerText(),
        /Somebody saved r3 since you opened r2\./,
      );
      await h.page.locator('.ctx-revision[data-revision="3"]').waitFor({ timeout: 10_000 });

      assert.equal(
        await h.page.evaluate(() => document.activeElement?.id),
        'ctx-editor',
        'the live update took focus from the editor',
      );
      assert.equal(await editor.inputValue(), typed);
      await shot(h, 'live-update-notice');
    } finally {
      await h.close();
    }
  });
});

void describe('wording, themes and a phone', () => {
  void test('the panel never says read or understood about a revision', async () => {
    const h = await openPanel(world());
    try {
      await h.page.locator('.ctx-revision').first().waitFor({ timeout: 10_000 });
      const text = await h.page.locator('.ctx-history').innerText();
      assert.doesNotMatch(text, /understood|\bread\b/i);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 1280]) {
      void test(`${theme} at ${String(width)} px: legible, no sideways scroll`, async () => {
        const h = await openPanel(world());
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          await h.page.getByRole('button', { name: 'Changes in r3' }).click({ timeout: 10_000 });
          await h.page.locator('[data-diff-line="added"]').first().waitFor({ timeout: 10_000 });

          const panel = h.page.locator('.ctx');
          assert.ok(
            await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
            'the panel scrolls sideways',
          );
          const [ink, ground] = await h.page
            .locator('[data-diff-line="added"]')
            .first()
            .evaluate((el) => {
              const style = getComputedStyle(el);
              return [style.color, style.backgroundColor];
            });
          assert.notEqual(ink, ground, 'an added line is the colour of its ground');

          // On the screen, edge to edge: the panel's own scroll width cannot
          // see a box that is itself wider than the viewport, or pushed off it.
          const [left, right, viewport] = await panel.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return [box.left, box.right, document.documentElement.clientWidth];
          });
          assert.ok(left >= 0, `the panel starts ${String(-left)} px off the screen`);
          assert.ok(right <= viewport, `the panel ends ${String(right - viewport)} px past it`);
          await h.page.locator('.ctx-history').scrollIntoViewIfNeeded();
          await shot(h, `history-${theme}-${String(width)}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});

// ------------------------------------------------------------ Delivered to

/** The reader's own agent's session, sent r3 two minutes ago. */
const MINE_ON_3 = {
  session_id: '01SESSIONMINEAAAAAA3XK2P',
  revision: 3,
  delivered_at: NOW - 120_000,
  session_ended_at: null,
  agent: {
    id: 'a1',
    harness: 'claude-code',
    device_label: 'Belka',
    display_name: 'Polly',
    status: 'active',
  },
};
/** Another person's agent's session, sent r3 an hour ago: no id, no label. */
const THEIRS_ON_3 = {
  session_id: '01SESSIONTHEIRSBBBBB9QW7',
  revision: 3,
  delivered_at: NOW - 3_600_000,
  session_ended_at: null,
  agent: null,
};
/** The reader's own agent's earlier session, still on r2 and since ended. */
const MINE_ON_2 = {
  session_id: '01SESSIONOLDCCCCCCCC4MN8',
  revision: 2,
  delivered_at: NOW - 7_200_000,
  session_ended_at: NOW - 7_000_000,
  agent: MINE_ON_3.agent,
};

const DELIVERED: ApiStub = {
  [`${DELIVERIES}?limit=200`]: deliveries(null, [MINE_ON_3, THEIRS_ON_3, MINE_ON_2]),
  [`${DELIVERIES}?limit=200&revision=3`]: deliveries(3, [MINE_ON_3, THEIRS_ON_3]),
  [`${DELIVERIES}?limit=200&revision=2`]: deliveries(2, [MINE_ON_2]),
};

async function viewRevision(h: Harness, revision: number) {
  await h.page
    .getByRole('button', { name: `View r${String(revision)}` })
    .click({ timeout: 10_000 });
  await h.page.locator('[data-delivered-to]').waitFor({ timeout: 10_000 });
}

void describe('Delivered to', () => {
  void test('lists the sessions a revision reached, newest first, each received and when', async () => {
    const h = await openPanel(world(DELIVERED));
    try {
      await viewRevision(h, 3);
      const panel = h.page.locator('[data-delivered-to]');
      const rows = panel.locator('ul[aria-label="Sessions that received r3"] > [data-delivery]');
      await rows.first().waitFor({ timeout: 10_000 });
      assert.deepEqual(await rows.evaluateAll((els) => els.map((el) => el.dataset.delivery)), [
        MINE_ON_3.session_id,
        THEIRS_ON_3.session_id,
      ]);

      const mine = rows.nth(0);
      assert.equal(
        (await mine.locator('[data-agent-chip]').innerText()).trim(),
        'Claude Code · Belka',
      );
      assert.match(await mine.innerText(), /session …A3XK2P/);
      assert.match(await mine.innerText(), /received 2 min ago/);
      // The registered name is never the label (D-120).
      assert.doesNotMatch(await panel.innerText(), /Polly/);

      const theirs = rows.nth(1);
      assert.equal(await theirs.locator('[data-agent-chip]').count(), 0);
      assert.match(await theirs.innerText(), /Another person’s agent/);
      assert.match(await theirs.innerText(), /received 1 h ago/);

      // The absolute time is there for hover and for a screen reader.
      const when = mine.locator('time');
      assert.ok(((await when.getAttribute('title')) ?? '').length > 10);
      assert.equal(
        await when.getAttribute('datetime'),
        new Date(MINE_ON_3.delivered_at).toISOString(),
      );

      // A session still on an older revision says which one it has.
      const older = panel.locator('[data-delivered-older] [data-delivery]');
      assert.equal(await older.count(), 1);
      assert.equal(await older.first().getAttribute('data-delivery'), MINE_ON_2.session_id);
      assert.match(await older.first().innerText(), /has r2/);
      assert.match(await older.first().innerText(), /session ended/);
    } finally {
      await h.close();
    }
  });

  void test('says delivered and received, never read, and that a session moves on', async () => {
    const h = await openPanel(world(DELIVERED));
    try {
      await viewRevision(h, 3);
      const panel = h.page.locator('[data-delivered-to]');
      await panel.locator('[data-delivery]').first().waitFor({ timeout: 10_000 });
      const text = await panel.innerText();
      assert.match(text, /Delivered to/);
      assert.match(text, /received/);
      assert.match(text, /listed under the latest revision it was sent/);
      assert.match(text, /moves there/);
      assert.doesNotMatch(text, /\bread\b|\bseen\b|understood/i);
    } finally {
      await h.close();
    }
  });

  void test('a revision sent to nobody is the empty state', async () => {
    const h = await openPanel(world());
    try {
      await viewRevision(h, 1);
      const empty = h.page.locator('[data-delivered-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.equal(await empty.innerText(), 'Not delivered to any agent session yet.');
      assert.equal(await h.page.locator('[data-delivered-older]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a refused read is the error state, and Retry reads again', async () => {
    let refused = true;
    const h = await openPanel(
      world({
        [`${DELIVERIES}?limit=200&revision=3`]: () =>
          refused ? refuse(500, 'internal', 'boom') : deliveries(3, [MINE_ON_3]),
      }),
    );
    try {
      await viewRevision(h, 3);
      const panel = h.page.locator('[data-delivered-to]');
      const retry = panel.getByRole('button', { name: /retry|try again/i });
      await retry.waitFor({ timeout: 10_000 });
      refused = false;
      await retry.click();
      await panel.locator(`[data-delivery="${MINE_ON_3.session_id}"]`).waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('switching revision never shows the list of the one before (crossing reads)', async () => {
    // r3's answer is held until r2's has landed; then it is let go.
    const held: (() => void)[] = [];
    const h = await openPanel(world(DELIVERED));
    try {
      await h.page.route('**/context/deliveries?*revision=3*', async (route) => {
        await new Promise<void>((resolve) => {
          held.push(resolve);
        });
        await route.fallback();
      });
      await h.page.getByRole('button', { name: 'View r3' }).click({ timeout: 10_000 });
      await until(() => held.length > 0, 10_000);
      assert.equal(held.length, 1, 'r3’s read was never sent');

      await viewRevision(h, 2);
      const panel = h.page.locator('[data-delivered-to]');
      await panel.locator(`[data-delivery="${MINE_ON_2.session_id}"]`).waitFor({ timeout: 10_000 });
      held.forEach((release) => {
        release();
      });
      // Long enough for r3's answer to land and render, were it going to.
      await h.page.waitForTimeout(500);
      assert.equal(await panel.locator(`[data-delivery="${MINE_ON_3.session_id}"]`).count(), 0);
      assert.equal(await panel.locator(`[data-delivery="${THEIRS_ON_3.session_id}"]`).count(), 0);
      assert.match(await panel.innerText(), /sent r2 to/);
      assert.equal(
        await panel.locator('ul[aria-label="Sessions that received r2"] > [data-delivery]').count(),
        1,
      );
      // And r3 reads again when it is opened again: no list kept from before.
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await viewRevision(h, 3);
      await panel.locator(`[data-delivery="${MINE_ON_3.session_id}"]`).waitFor({ timeout: 10_000 });
      assert.equal(
        await panel.locator('ul[aria-label="Sessions that received r3"] > *').count(),
        2,
      );
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  // ------------------------------------------- two reads, one row a session

  /** A session sent r2, then r3 between the panel's two reads (#164 review). */
  const MOVER_ON_2 = {
    session_id: '01SESSIONMOVERDDDDDD5ZT1',
    revision: 2,
    delivered_at: NOW - 600_000,
    session_ended_at: null,
    agent: MINE_ON_3.agent,
  };
  const MOVER_ON_3 = { ...MOVER_ON_2, revision: 3, delivered_at: NOW - 60_000 };

  /**
   * Holds every deliveries read matching `held` until the other read has been
   * **answered** — fetched from the stub and handed to the page — so the two
   * answers are, provably, two moments.
   */
  async function holdBehindTheOther(h: Harness, held: (url: URL) => boolean) {
    const state = { otherAnswered: false, release: [] as (() => void)[] };
    await h.page.route('**/context/deliveries?*', async (route) => {
      if (held(new URL(route.request().url()))) {
        await new Promise<void>((resolve) => {
          state.release.push(resolve);
        });
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({ response });
      state.otherAnswered = true;
    });
    return state;
  }

  void test('a session sent r3 between the reads is listed once, under r3 — never also as on r2', async () => {
    // The project-wide read answers first and still has the session on r2;
    // r3's read, held until then, has it on r3.
    const h = await openPanel(
      world({
        [`${DELIVERIES}?limit=200`]: deliveries(null, [MOVER_ON_2, MINE_ON_2]),
        [`${DELIVERIES}?limit=200&revision=3`]: deliveries(3, [MOVER_ON_3]),
      }),
    );
    try {
      const hold = await holdBehindTheOther(h, (url) => url.searchParams.get('revision') === '3');
      await h.page.getByRole('button', { name: 'View r3' }).click({ timeout: 10_000 });
      await until(() => hold.otherAnswered && hold.release.length > 0, 10_000);
      assert.ok(hold.otherAnswered, 'the project-wide read was never answered');
      assert.equal(hold.release.length, 1, 'r3’s read was never sent');
      hold.release.forEach((release) => {
        release();
      });

      const panel = h.page.locator('[data-delivered-to]');
      const on = panel.locator('ul[aria-label="Sessions that received r3"] > [data-delivery]');
      await on.first().waitFor({ timeout: 10_000 });
      assert.deepEqual(await on.evaluateAll((els) => els.map((el) => el.dataset.delivery)), [
        MOVER_ON_3.session_id,
      ]);
      assert.equal(await panel.locator(`[data-delivery="${MOVER_ON_2.session_id}"]`).count(), 1);
      const older = panel.locator('[data-delivered-older] [data-delivery]');
      assert.deepEqual(await older.evaluateAll((els) => els.map((el) => el.dataset.delivery)), [
        MINE_ON_2.session_id,
      ]);
      assert.equal(await panel.locator('[data-delivery-has]').count(), 1);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a session r2’s read still has, that the later read has on r3, is not listed under r2', async () => {
    // The other order: r2's read answers first with the session on r2; the
    // project-wide read, held until then, has it on r3. It is r3's now.
    const h = await openPanel(
      world({
        [`${DELIVERIES}?limit=200`]: deliveries(null, [MOVER_ON_3, MINE_ON_2]),
        [`${DELIVERIES}?limit=200&revision=2`]: deliveries(2, [MOVER_ON_2, MINE_ON_2]),
      }),
    );
    try {
      const hold = await holdBehindTheOther(h, (url) => !url.searchParams.has('revision'));
      await h.page.getByRole('button', { name: 'View r2' }).click({ timeout: 10_000 });
      await until(() => hold.otherAnswered && hold.release.length > 0, 10_000);
      assert.ok(hold.otherAnswered, 'r2’s read was never answered');
      assert.equal(hold.release.length, 1, 'the project-wide read was never sent');
      hold.release.forEach((release) => {
        release();
      });

      const panel = h.page.locator('[data-delivered-to]');
      const on = panel.locator('ul[aria-label="Sessions that received r2"] > [data-delivery]');
      await on.first().waitFor({ timeout: 10_000 });
      assert.deepEqual(await on.evaluateAll((els) => els.map((el) => el.dataset.delivery)), [
        MINE_ON_2.session_id,
      ]);
      assert.equal(await panel.locator(`[data-delivery="${MOVER_ON_2.session_id}"]`).count(), 0);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  // ------------------------------------------------------------- Show more

  /** A third session on r3, only on the second page of r3's read. */
  const EXTRA_ON_3 = {
    ...THEIRS_ON_3,
    session_id: '01SESSIONEXTRAEEEEEE7HV4',
    delivered_at: NOW - 5_000_000,
  };
  const PAGED_ON_3: ApiStub = {
    ...DELIVERED,
    [`${DELIVERIES}?limit=200&revision=3`]: deliveries(3, [MINE_ON_3, THEIRS_ON_3], 'c-on-2'),
    [`${DELIVERIES}?limit=200&revision=3&cursor=c-on-2`]: deliveries(3, [EXTRA_ON_3]),
  };

  /** Holds every read carrying a cursor, counting them. */
  async function holdPages(h: Harness) {
    const pages = { asked: 0, release: [] as (() => void)[] };
    await h.page.route('**/context/deliveries?*cursor=*', async (route) => {
      pages.asked += 1;
      await new Promise<void>((resolve) => {
        pages.release.push(resolve);
      });
      await route.fallback();
    });
    return pages;
  }

  void test('Show more reads the next page with the cursor, one read at a time', async () => {
    const h = await openPanel(world(PAGED_ON_3));
    try {
      const pages = await holdPages(h);
      await viewRevision(h, 3);
      const panel = h.page.locator('[data-delivered-to]');
      const truncated = panel.locator('[data-delivered-truncated="on"]');
      await truncated.waitFor({ timeout: 10_000 });
      assert.match(await truncated.innerText(), /More sessions received r3 than the 2 shown/);

      const more = panel.getByRole('button', { name: 'Show more sessions that received r3' });
      await more.click();
      await until(() => pages.asked > 0, 10_000);
      assert.equal(pages.asked, 1);
      assert.equal(await more.isDisabled(), true, 'Show more is pressable while its read is out');
      assert.equal(await more.getAttribute('aria-busy'), 'true');
      // A second press while the first is out sends nothing.
      await more.dispatchEvent('click');
      await h.page.waitForTimeout(300);
      assert.equal(pages.asked, 1, 'a second page read went out beside the first');

      pages.release.forEach((release) => {
        release();
      });
      await panel
        .locator(`[data-delivery="${EXTRA_ON_3.session_id}"]`)
        .waitFor({ timeout: 10_000 });
      const rows = panel.locator('ul[aria-label="Sessions that received r3"] > [data-delivery]');
      assert.deepEqual(await rows.evaluateAll((els) => els.map((el) => el.dataset.delivery)), [
        MINE_ON_3.session_id,
        THEIRS_ON_3.session_id,
        EXTRA_ON_3.session_id,
      ]);
      // The last page has no cursor: nothing is left out, so nothing says so.
      assert.equal(await truncated.count(), 0);
      assert.equal(await panel.locator('[data-delivered-more]').count(), 0);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('the project-wide read says it is cut short even with no older row, and Show more reads on', async () => {
    const h = await openPanel(
      world({
        ...DELIVERED,
        [`${DELIVERIES}?limit=200`]: deliveries(null, [MINE_ON_3, THEIRS_ON_3], 'c-all-2'),
        [`${DELIVERIES}?limit=200&cursor=c-all-2`]: deliveries(null, [MINE_ON_2]),
      }),
    );
    try {
      await viewRevision(h, 3);
      const panel = h.page.locator('[data-delivered-to]');
      const truncated = panel.locator('[data-delivered-truncated="all"]');
      await truncated.waitFor({ timeout: 10_000 });
      assert.equal(await panel.locator('[data-delivered-older]').count(), 0);
      assert.match(await truncated.innerText(), /Checked the 2 most recent sessions/);

      await panel
        .getByRole('button', { name: 'Show more sessions checked for an older revision' })
        .click();
      const older = panel.locator(
        `[data-delivered-older] [data-delivery="${MINE_ON_2.session_id}"]`,
      );
      await older.waitFor({ timeout: 10_000 });
      assert.match(await older.innerText(), /has r2/);
      assert.equal(await truncated.count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a page that answers after the reader moved to another revision is dropped', async () => {
    const h = await openPanel(world(PAGED_ON_3));
    try {
      const pages = await holdPages(h);
      await viewRevision(h, 3);
      const panel = h.page.locator('[data-delivered-to]');
      await panel
        .getByRole('button', { name: 'Show more sessions that received r3' })
        .click({ timeout: 10_000 });
      await until(() => pages.asked > 0, 10_000);
      assert.equal(pages.asked, 1, 'r3’s next page was never asked for');

      await viewRevision(h, 2);
      await panel.locator(`[data-delivery="${MINE_ON_2.session_id}"]`).waitFor({ timeout: 10_000 });
      pages.release.forEach((release) => {
        release();
      });
      // Long enough for the page to land and render, were it going to.
      await h.page.waitForTimeout(500);
      assert.equal(await panel.locator(`[data-delivery="${EXTRA_ON_3.session_id}"]`).count(), 0);
      assert.equal(
        await panel.locator('ul[aria-label="Sessions that received r2"] > [data-delivery]').count(),
        1,
      );
      assert.equal(await panel.locator('[data-delivered-truncated]').count(), 0);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 1280]) {
      void test(`${theme} at ${String(width)} px: legible, keyboard reachable, no sideways scroll`, async () => {
        const h = await openPanel(world(DELIVERED));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          await viewRevision(h, 3);
          const panel = h.page.locator('[data-delivered-to]');
          await panel.locator('[data-delivery]').first().waitFor({ timeout: 10_000 });

          const ctx = h.page.locator('.ctx');
          const [left, right, viewport, scrolls] = await ctx.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return [
              box.left,
              box.right,
              document.documentElement.clientWidth,
              el.scrollWidth > el.clientWidth ? 1 : 0,
            ];
          });
          assert.equal(scrolls, 0, 'the panel scrolls sideways');
          assert.ok(left >= 0 && right <= viewport, 'the panel runs off the screen');
          for (const row of await panel.locator('[data-delivery]').all()) {
            const box = await row.boundingBox();
            assert.ok(box !== null && box.x >= 0 && box.x + box.width <= viewport + 0.5);
          }
          const [ink, ground] = await panel.locator('.ctx-delivered-note').evaluate((el) => {
            const style = getComputedStyle(el);
            let node: Element | null = el;
            let bg = 'rgba(0, 0, 0, 0)';
            while (node !== null && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
              bg = getComputedStyle(node).backgroundColor;
              node = node.parentElement;
            }
            return [style.color, bg];
          });
          assert.notEqual(ink, ground, 'the note is the colour of its ground');

          // Keyboard: Tab from the viewer's title reaches each received time,
          // and focus shows the absolute time beside the relative one.
          await h.page.locator('.ctx-viewer-title').focus();
          let reached = false;
          for (let i = 0; i < 12 && !reached; i++) {
            await h.page.keyboard.press('Tab');
            reached = await h.page.evaluate(
              () => document.activeElement?.classList.contains('ctx-delivery-when') === true,
            );
          }
          assert.ok(reached, 'no received time is reachable by Tab');
          const after = await h.page.evaluate(() => {
            const el = document.activeElement;
            return el === null ? '' : getComputedStyle(el, '::after').content;
          });
          assert.match(after, /\d{4}/, 'focus does not show the absolute time');

          await panel.scrollIntoViewIfNeeded();
          await shot(h, `delivered-to-${theme}-${String(width)}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});
