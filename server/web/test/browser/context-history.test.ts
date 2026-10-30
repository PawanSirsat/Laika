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
