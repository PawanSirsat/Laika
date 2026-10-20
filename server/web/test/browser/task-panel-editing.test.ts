/**
 * The task panel edits in place, as Jira's issue view does (LAI-827).
 *
 * The owner, with Jira's KAN-10 beside Laika's ONR-516: hovering the title or
 * the description shows a soft background and nothing else; a click turns it
 * into an editor in place — the title into a field of the same type, the
 * description into a rich editor with a toolbar and Save / Cancel under it.
 *
 * **Markdown stays what is stored.** These tests read what goes over the wire
 * — the `PATCH` body — because a toolbar that looks right and writes the wrong
 * markdown is the failure that matters. And they hold the promises that keep
 * an agent's text safe from a person who only opened it: a document the editor
 * cannot write back exactly opens as Markdown and says why, an unchanged Save
 * sends nothing, a save over a newer version is refused, and a paste keeps
 * text, lists, links and tables and nothing else.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  fakeStream,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.now();

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

/** What an agent writes: headings, a table, code, a checklist, a link. */
const DESCRIPTION = [
  '## Context',
  '',
  'The console loads **every trip of the day** before it draws, so a depot waits ~9 s. Set `next_cursor` and keep p95 < 1 s -> done.',
  '',
  '| Surface | p50 |',
  '|---|---|',
  '| Trip list | 2.4 s |',
  '',
  '- first point',
  '- second point',
  '',
  '```ts',
  'const page = await trips.list({ cursor });',
  '```',
  '',
  '- [x] measured',
  '- [ ] paged',
  '',
  'See [the RFC](https://example.com/rfc/42).',
].join('\n');

const ACCEPTANCE = '- [ ] the first row draws in under 1 s\n- [ ] filters survive a reload';

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'in_progress',
    priority: 'p2',
    position: null,
    assignee_id: 'u1',
    created_by: 'u1',
    created_via: 'mcp',
    created_by_client: 'claude-code',
    sprint_id: null,
    tags: ['console'],
    ready: false,
    comment_count: 0,
    blocked_by: [],
    blocks: [],
    send_back: null,
    size: {
      level: 'M',
      computed: 'M',
      overridden: false,
      weight: 1,
      build_p50_ms: 25 * MIN,
      build_p80_ms: 50 * MIN,
      subtasks: 0,
    },
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    created_at: NOW - 48 * HOUR,
    updated_at: NOW - HOUR,
    started_at: NOW - 3 * HOUR,
    completed_at: null,
    ...over,
  });

const OTHER = task({ id: 't1', key: 'LC-1', number: 1, title: 'Page the trip list' });

const ESTIMATE = {
  task_id: 't3',
  size: task({}).size,
  why: {
    early: false,
    method: 'text',
    typical: { words: 200, build_ms: 30 * MIN },
    factors: [],
    similar: [],
    model_version: 'abc',
    computed_at: NOW - HOUR,
  },
  override: null,
  at_start: null,
  actual: {
    build_ms: null,
    review_wait_ms: 0,
    rework_ms: 0,
    finishes: 0,
    first_finish_at: null,
  },
  tokens: { p50: null, p80: null, learned_from: 0, forecasts_after: 10 },
  actual_tokens: null,
  claim_estimate: null,
  scope_grew: null,
  split: null,
  history: [],
};

const ACCURACY = {
  project_id: 'laika-core',
  finished: 42,
  forecasts_after: 10,
  live: { n: 12, typical_error: 1.7, bias: 1.1, p80_hit_rate: 0.75 },
  backtest: {
    n: 30,
    method_error: 1.68,
    median_error: 2.1,
    p80_hit_rate: 0.78,
    beats_median: true,
  },
  by_client: [],
  tokens: {
    learned_from: 14,
    forecasts_after: 10,
    live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null },
    backtest: {
      n: 4,
      method_error: 1.9,
      median_error: 2.3,
      p80_hit_rate: 0.75,
      beats_median: true,
    },
  },
  agent: {
    size: { n: 0, agent_error: null, median_error: null, model_error: null, weight: 0 },
    confidence: [],
  },
  model_version: 'abc123',
};

/** The task under test, as the server holds it; a test changes it to model a write elsewhere. */
interface Server {
  t3: ReturnType<typeof task>;
}

function subject(over: Record<string, unknown> = {}): ReturnType<typeof task> {
  return task({
    id: 't3',
    key: 'LC-3',
    number: 3,
    title: 'Operator console: page the trip list',
    description_md: DESCRIPTION,
    acceptance_md: ACCEPTANCE,
    ...over,
  });
}

function stub(server: Server, role: 'lead' | 'viewer' = 'lead'): ApiStub {
  return {
    '/api/v1/me': {
      id: role === 'lead' ? 'u1' : 'u2',
      email: role === 'lead' ? 'ada@example.com' : 'grace@example.com',
      name: role === 'lead' ? 'Ada Lovelace' : 'Grace Hopper',
      org_role: role === 'lead' ? 'owner' : 'viewer',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role }],
    },
    '/api/v1/health': { status: 'ok', version: '0.1.0', uptime_ms: 1 },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 0, in_progress: 2, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?limit=200': () => ({
      data: [OTHER, server.t3],
      next_cursor: null,
    }),
    '/api/v1/tasks/t3': (call: { method: string; body: unknown }) => {
      if (call.method === 'PATCH') {
        server.t3 = {
          ...server.t3,
          ...(call.body as Record<string, unknown>),
          updated_at: Date.now(),
        };
      }
      return server.t3;
    },
    '/api/v1/tasks/t3/comments': (call: { method: string; body: unknown }) =>
      call.method === 'POST'
        ? {
            id: 'c9',
            task_id: 't3',
            author_id: 'u1',
            body_md: (call.body as { body_md?: string } | undefined)?.body_md ?? '',
            created_via: 'web',
            edited_at: null,
            sent_back: false,
            created_at: Date.now(),
            updated_at: Date.now(),
          }
        : { data: [], next_cursor: null },
    '/api/v1/tasks/t3/watchers': { watchers: ['u1'] },
    '/api/v1/tasks/t3/estimate': ESTIMATE,
    '/api/v1/projects/laika-core/estimates/accuracy': ACCURACY,
    '/api/v1/projects/laika-core/members': {
      members: [
        {
          user_id: 'u1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'lead',
          created_at: 1,
        },
        {
          user_id: 'u2',
          name: 'Grace Hopper',
          email: 'grace@example.com',
          role: 'viewer',
          created_at: 1,
        },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': {
      users: [
        { id: 'u1', name: 'Ada Lovelace' },
        { id: 'u2', name: 'Grace Hopper' },
      ],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
  };
}

const URL = '/board?project=laika-core&task=t3';

async function panel(server: Server, role: 'lead' | 'viewer' = 'lead'): Promise<Harness> {
  const h = await open(URL, stub(server, role), { before: fakeStream });
  await h.page.locator('[data-section="description"] .md h2').waitFor({ timeout: 20_000 });
  return h;
}

const description = (h: Harness): Locator => h.page.locator('[data-section="description"]');
const acceptance = (h: Harness): Locator => h.page.locator('[data-section="acceptance"]');
const patches = (h: Harness): { method: string; path: string; body: unknown }[] =>
  h.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');

/** Click the description's text and wait for the rich editor to open on it. */
async function openEditor(h: Harness, where: Locator = description(h)): Promise<Locator> {
  await where
    .locator('.md')
    .first()
    .click({ position: { x: 4, y: 4 } });
  const editor = where.locator('.rich-editor');
  await editor.waitFor({ timeout: 10_000 });
  return editor;
}

/** The editable surface inside an open editor. */
const content = (editor: Locator): Locator => editor.locator('.ProseMirror');

async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+A');
}

/** The background a box shows, read from the browser. */
async function background(target: Locator): Promise<string> {
  return target.evaluate((el) => getComputedStyle(el).backgroundColor);
}

void after(async () => {
  await closeBrowser();
});

/** Hover each editable part and say what changed. */
async function assertHoverAffordance(h: Harness): Promise<void> {
  const editable = h.page.locator('.panel [data-editable]');
  await until(async () => (await editable.count()) >= 10, 5_000);
  const names = await editable.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-editable')),
  );
  for (const expected of [
    'title',
    'description',
    'acceptance',
    'assignee',
    'priority',
    'due',
    'labels',
    'sprint',
    'start',
    'effort',
  ]) {
    assert.ok(names.includes(expected), `${expected} is not marked editable: ${names.join()}`);
  }

  for (const name of ['title', 'description', 'acceptance', 'priority', 'effort']) {
    const part = h.page.locator(`.panel [data-editable="${name}"]`).first();
    await h.page.mouse.move(0, 0);
    await h.page.waitForTimeout(150);
    const resting = await background(part);
    await part.hover({ position: { x: 3, y: 3 } });
    await h.page.waitForTimeout(150);
    const hovered = await background(part);
    assert.notEqual(hovered, resting, `${name} shows nothing on hover`);
    assert.notEqual(hovered, 'rgba(0, 0, 0, 0)', `${name} has no hover background`);
    const cursor = await part.evaluate((el) => getComputedStyle(el).cursor);
    assert.ok(['text', 'pointer'].includes(cursor), `${name} has cursor ${cursor}`);
  }
}

void describe('what may be edited says so on hover, and only for an editor', () => {
  void test('an editor sees a soft background and a cursor on each part; a reader sees none and gets no editor', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      await assertHoverAffordance(h);
    } finally {
      await h.close();
    }

    const r = await panel({ t3: subject() }, 'viewer');
    try {
      // Positive control: the text is there to read.
      assert.equal(await description(r).locator('.md h2').innerText(), 'Context');
      assert.equal(await r.page.locator('.panel [data-editable]').count(), 0);

      const text = description(r).locator('.md').first();
      const resting = await background(text);
      await text.hover({ position: { x: 3, y: 3 } });
      await r.page.waitForTimeout(150);
      assert.equal(await background(text), resting, 'a reader sees a hover');

      await text.click({ position: { x: 4, y: 4 } });
      await r.page.waitForTimeout(400);
      assert.equal(await r.page.locator('.rich-editor, .panel-main textarea').count(), 0);
    } finally {
      await r.close();
    }
  });

  void test('the same affordance in dark', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      await setTheme(h.page, 'dark');
      await assertHoverAffordance(h);
    } finally {
      await h.close();
    }
  });
});

void describe('the title edits in place (LAI-827)', () => {
  void test('same type as the heading; Escape cancels, Enter saves, empty is refused', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      const heading = h.page.locator('.panel-title');
      const shown = h.page.locator('.panel-title [data-editable="title"]');
      const size = await heading.evaluate((el) => getComputedStyle(el).fontSize);

      await shown.click();
      const field = h.page.locator('.panel-title .inline-edit-field');
      await field.waitFor({ timeout: 5_000 });
      assert.equal(await field.evaluate((el) => getComputedStyle(el).fontSize), size);
      assert.equal(
        await field.evaluate((el) => getComputedStyle(el).fontWeight),
        await heading.evaluate((el) => getComputedStyle(el).fontWeight),
      );

      await field.fill('Thrown away');
      await field.press('Escape');
      await h.page.waitForTimeout(300);
      assert.equal(patches(h).length, 0, 'Escape saved');
      assert.match(await heading.innerText(), /Operator console/);

      await shown.click();
      await field.fill('   ');
      await field.press('Enter');
      const refusal = h.page.locator('.panel-title .inline-edit-error');
      await refusal.waitFor({ timeout: 5_000 });
      assert.equal(patches(h).length, 0, 'an empty title was sent');
      assert.match(await refusal.innerText(), /title/i);

      await field.fill('Page the trip list by cursor');
      await field.press('Enter');
      await until(() => patches(h).length > 0, 5_000);
      assert.deepEqual(patches(h)[0]?.body, { title: 'Page the trip list by cursor' });
    } finally {
      await h.close();
    }
  });
});

void describe('the description opens a rich editor in place (LAI-827)', () => {
  void test('no floating Edit button over the text, and the reading size is the reading token', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      const md = description(h).locator('.md').first();
      // 15px on 1.6 until LAI-828 raises the scale (the task's own fallback).
      assert.equal(await md.evaluate((el) => getComputedStyle(el).fontSize), '15px');
      assert.equal(await md.evaluate((el) => getComputedStyle(el).lineHeight), '24px');

      const button = description(h).getByRole('button', { name: 'Edit description' });
      assert.equal(await button.count(), 1, 'the keyboard lost its way in');
      await md.hover();
      await h.page.waitForTimeout(150);
      // Kept for the keyboard, never drawn over the text for the mouse: a
      // visually hidden box is 1px, the floating button was a word wide.
      const box = await button.boundingBox();
      assert.ok(
        box === null || (box.width <= 1 && box.height <= 1),
        `the Edit button floats over the text: ${JSON.stringify(box)}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('a toolbar, Bold and a list, saved as markdown; Cancel sends nothing', async () => {
    const server: Server = { t3: subject({ description_md: 'Plain words to start.' }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md p').waitFor({ timeout: 20_000 });
      const editor = await openEditor(h);
      const toolbar = editor.getByRole('toolbar', { name: 'Formatting' });
      for (const name of [
        'Text style',
        'Bold',
        'Italic',
        'Strikethrough',
        'Inline code',
        'Bulleted list',
        'Numbered list',
        'Checklist',
        'Quote',
        'Code block',
        'Link',
        'Table',
        'Mention someone',
        'Link a card',
        'Undo',
        'Redo',
        'Markdown',
      ]) {
        assert.equal(
          await toolbar
            .getByRole(name === 'Text style' ? 'combobox' : 'button', { name, exact: true })
            .count(),
          1,
          `the toolbar has no ${name}`,
        );
      }
      // No image upload and no colour: Laika has no uploads, markdown no colour.
      assert.equal(await toolbar.getByRole('button', { name: /image|colou?r/i }).count(), 0);

      // Cancel first: nothing goes out.
      await content(editor).click();
      await h.page.keyboard.type(' More.');
      await editor.getByRole('button', { name: 'Cancel' }).click();
      const discard = h.page.getByRole('button', { name: 'Discard changes' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
      await editor.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(patches(h).length, 0, 'Cancel saved');

      const again = await openEditor(h);
      await content(again).click();
      await h.page.keyboard.press('End');
      await h.page.keyboard.press('Enter');
      await again.getByRole('button', { name: 'Bold' }).click();
      await h.page.keyboard.type('Loud');
      await again.getByRole('button', { name: 'Bold' }).click();
      await h.page.keyboard.press('Enter');
      await again.getByRole('button', { name: 'Bulleted list' }).click();
      await h.page.keyboard.type('one');
      await h.page.keyboard.press('Enter');
      await h.page.keyboard.type('two');
      await again.getByRole('button', { name: 'Save' }).click();

      await until(() => patches(h).length > 0, 5_000);
      assert.deepEqual(patches(h)[0]?.body, {
        description_md: 'Plain words to start.\n\n**Loud**\n\n- one\n- two',
      });
      await again.waitFor({ state: 'detached', timeout: 5_000 });
      // What is shown after saving is the safe renderer's.
      assert.equal(await description(h).locator('.md strong').innerText(), 'Loud');
      assert.equal(await description(h).locator('.md ul li').count(), 2);
    } finally {
      await h.close();
    }
  });

  void test('⌘/Ctrl+Enter saves and Escape asks before throwing away a change', async () => {
    const server: Server = { t3: subject({ description_md: 'Plain words to start.' }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md p').waitFor({ timeout: 20_000 });
      const editor = await openEditor(h);
      await content(editor).click();
      await h.page.keyboard.press('End');
      await h.page.keyboard.type(' Typed.');
      await h.page.keyboard.press('Escape');
      const ask = h.page.getByRole('alertdialog');
      await ask.waitFor({ timeout: 5_000 });
      await ask.getByRole('button', { name: 'Keep editing' }).click();
      assert.equal(await editor.count(), 1, 'Keep editing closed the editor');

      await h.page.keyboard.press('ControlOrMeta+Enter');
      await until(() => patches(h).length > 0, 5_000);
      assert.deepEqual(patches(h)[0]?.body, { description_md: 'Plain words to start. Typed.' });
    } finally {
      await h.close();
    }
  });

  void test('an unchanged Save sends nothing', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      const editor = await openEditor(h);
      // Opened in the rich view: the agent's document round-trips.
      assert.equal(await content(editor).isVisible(), true, 'the agent document did not open rich');
      await editor.getByRole('button', { name: 'Save' }).click();
      await editor.waitFor({ state: 'detached', timeout: 5_000 });
      await h.page.waitForTimeout(300);
      assert.equal(patches(h).length, 0, 'an unchanged Save sent a PATCH');
    } finally {
      await h.close();
    }
  });

  void test('the Markdown toggle shows the source, and an untouched one is the text as stored', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      const editor = await openEditor(h);
      await editor.getByRole('button', { name: 'Markdown' }).click();
      const source = editor.locator('textarea.rich-editor-source');
      await source.waitFor({ timeout: 5_000 });
      assert.equal(await source.inputValue(), DESCRIPTION);
      assert.equal(
        await editor.getByRole('button', { name: 'Markdown' }).getAttribute('aria-pressed'),
        'true',
      );
    } finally {
      await h.close();
    }
  });

  void test('a table is inserted and grows by a row and a column', async () => {
    const server: Server = { t3: subject({ description_md: 'Before the table.' }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md p').waitFor({ timeout: 20_000 });
      const editor = await openEditor(h);
      await content(editor).click();
      await h.page.keyboard.press('End');
      await editor.getByRole('button', { name: 'Table' }).click();
      assert.equal(await content(editor).locator('table tr').count(), 3);
      await editor.getByRole('button', { name: 'Add row below' }).click();
      await editor.getByRole('button', { name: 'Add column after' }).click();
      assert.equal(await content(editor).locator('table tr').count(), 4);
      assert.equal(await content(editor).locator('table tr').first().locator('th').count(), 4);
      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() => patches(h).length > 0, 5_000);
      const sent = (patches(h)[0]?.body as { description_md: string }).description_md;
      assert.match(sent, /^Before the table\.\n\n\|/);
      assert.equal(sent.split('\n').filter((line) => line.startsWith('|')).length, 5);
    } finally {
      await h.close();
    }
  });

  void test('@ offers the people who can be told, and inserts the handle the server reads', async () => {
    const server: Server = { t3: subject({ description_md: 'Ask' }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md p').waitFor({ timeout: 20_000 });
      const editor = await openEditor(h);
      await content(editor).click();
      await h.page.keyboard.press('End');
      await h.page.keyboard.type(' @gra');
      const options = h.page.locator('.rich-editor-picker [role="option"]');
      await options.first().waitFor({ timeout: 5_000 });
      assert.deepEqual(await options.allTextContents(), ['Grace Hopper @grace']);
      await h.page.keyboard.press('Enter');

      // A card, by key.
      await editor.getByRole('button', { name: 'Link a card' }).click();
      const find = h.page.getByRole('combobox', { name: 'Find a card by key or title' });
      await find.fill('LC-1');
      await h.page.locator('.rich-editor-picker [role="option"]', { hasText: 'LC-1' }).click();

      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() => patches(h).length > 0, 5_000);
      assert.deepEqual(patches(h)[0]?.body, {
        description_md: 'Ask @grace [LC-1](/board?project=laika-core&task=t1)',
      });
    } finally {
      await h.close();
    }
  });
});

void describe('nothing an agent wrote is silently rewritten (LAI-827)', () => {
  void test('a document the editor cannot write back exactly opens as Markdown and says why', async () => {
    const written = [
      'Notes from the agent:',
      '',
      '* a star bullet',
      '* another',
      '',
      '<details><summary>raw</summary>kept as written</details>',
    ].join('\n');
    const server: Server = { t3: subject({ description_md: written }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md ul').waitFor({ timeout: 20_000 });
      await description(h).locator('.md p').first().click();
      const editor = description(h).locator('.rich-editor');
      await editor.waitFor({ timeout: 10_000 });
      const source = editor.locator('textarea.rich-editor-source');
      await source.waitFor({ timeout: 5_000 });
      assert.equal(await source.inputValue(), written, 'the source is not the text as stored');
      assert.equal(await content(editor).isVisible(), false, 'the rich view opened anyway');
      const why = editor.locator('.rich-editor-notice');
      assert.match(await why.innerText(), /Markdown/);
      assert.match(await why.innerText(), /HTML|rewrite/i);

      // And it stays the person's text: a change to one word sends exactly that.
      await source.fill(written.replace('another', 'another one'));
      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() => patches(h).length > 0, 5_000);
      assert.deepEqual(patches(h)[0]?.body, {
        description_md: written.replace('another', 'another one'),
      });
    } finally {
      await h.close();
    }
  });
});

void describe('the stale-text protection of LAI-795 holds in the editor', () => {
  void test('a save begun on a version someone has since replaced is refused, and the draft kept', async () => {
    const server: Server = { t3: subject({ description_md: 'The **first** version.' }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md strong').waitFor({ timeout: 20_000 });
      const editor = await openEditor(h);
      await content(editor).click();
      await h.page.keyboard.press('End');
      await h.page.keyboard.type(' My addition.');

      server.t3 = {
        ...server.t3,
        description_md: 'Rewritten by **someone else**.',
        updated_at: Date.now(),
      };
      const landed = h.page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/tasks/t3') && r.request().method() === 'GET',
      );
      await h.page.evaluate(() => {
        (
          window as unknown as {
            __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
          }
        ).__laikaStream.emit(
          'task.updated',
          {
            id: 'e70',
            seq: 70,
            type: 'task.updated',
            project_id: 'laika-core',
            task_id: 't3',
            actor_id: 'u2',
            actor_kind: 'agent',
            actor_token_id: null,
            payload: {},
            created_at: Date.now(),
          },
          '70',
        );
      });
      await landed;
      await h.page.waitForTimeout(300);

      await editor.getByRole('button', { name: 'Save' }).click();
      const refusal = editor.locator('.rich-editor-error');
      await until(async () => (await refusal.count()) > 0 || patches(h).length > 0, 5_000);
      assert.equal(patches(h).length, 0, 'the edit was saved over the newer version');
      assert.match(await refusal.innerText(), /changed/i);
      assert.match(await content(editor).innerText(), /My addition\./, 'the draft was thrown away');
    } finally {
      await h.close();
    }
  });

  void test('while the text is read, nothing opens an editor', async () => {
    const server: Server = { t3: subject() };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open(URL, stub(server), {
      before: async (page) => {
        await fakeStream(page);
        await page.route('**/api/v1/tasks/t3', async (route) => {
          if (route.request().method() === 'GET') await gate;
          await route.continue();
        });
      },
    });
    try {
      const pending = description(h).locator('[data-loading="description"]');
      await pending.waitFor({ timeout: 20_000 });
      assert.equal(await description(h).locator('[data-editable]').count(), 0);
      await pending.click();
      await h.page.waitForTimeout(300);
      assert.equal(await h.page.locator('.rich-editor').count(), 0);
      release();
      await description(h).locator('.md h2').waitFor({ timeout: 10_000 });
      assert.equal(await description(h).locator('[data-editable="description"]').count(), 1);
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('a paste keeps text, lists, links and tables, and nothing else', () => {
  void test('HTML from another page is reduced before the editor sees it', async () => {
    const server: Server = { t3: subject({ description_md: 'Replace me.' }) };
    const h = await open(URL, stub(server), { before: fakeStream });
    try {
      await description(h).locator('.md p').waitFor({ timeout: 20_000 });
      const editor = await openEditor(h);
      await content(editor).click();
      await selectAll(h.page);
      const html = [
        '<meta charset="utf-8"><style>p{color:red}</style>',
        '<h1>Pasted heading</h1>',
        '<p>Some <b>bold</b> and <span style="color:red">red</span> words.</p>',
        '<script>window.__pwned = true</script>',
        '<img src="/api/v1/tracker.png" onerror="window.__pwned = true">',
        '<iframe src="/api/v1/frame"></iframe>',
        '<ul><li>one</li><li>two</li></ul>',
        '<p><a href="https://example.com/ok">a good link</a> and <a href="javascript:window.__pwned=true">a bad one</a></p>',
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
      ].join('');
      await content(editor).evaluate((el, pasted) => {
        const data = new DataTransfer();
        data.setData('text/html', pasted);
        data.setData('text/plain', 'plain fallback');
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, html);
      await h.page.waitForTimeout(300);

      const doc = content(editor);
      assert.equal(await doc.locator('img, iframe, script, style, h1, strong, b').count(), 0);
      assert.equal(await doc.locator('ul li').count(), 2);
      assert.equal(await doc.locator('table td').count(), 2);
      assert.equal(await doc.locator('a[href="https://example.com/ok"]').count(), 1);
      assert.equal(await doc.locator('a[href^="javascript"]').count(), 0);
      assert.match(await doc.innerText(), /Pasted heading/);
      assert.match(await doc.innerText(), /a bad one/);
      assert.equal(
        await h.page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
        undefined,
      );
      assert.ok(!h.calls.some((c) => c.path.includes('tracker') || c.path.includes('frame')));

      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() => patches(h).length > 0, 5_000);
      const sent = (patches(h)[0]?.body as { description_md: string }).description_md;
      assert.match(sent, /Pasted heading/);
      assert.match(sent, /^- one$/m);
      assert.match(sent, /\[a good link\]\(https:\/\/example\.com\/ok\)/);
      assert.match(sent, /^\| A/m);
      assert.doesNotMatch(sent, /\*\*|<|javascript|^#/m);
    } finally {
      await h.close();
    }
  });
});

void describe('acceptance edits in place like the description', () => {
  void test('a click opens the same editor, and Save sends acceptance_md', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      await acceptance(h).locator('.md li').first().waitFor({ timeout: 10_000 });
      const editor = await openEditor(h, acceptance(h));
      await content(editor).locator('li').last().click();
      await h.page.keyboard.press('End');
      await h.page.keyboard.press('Enter');
      await h.page.keyboard.type('the map is unchanged');
      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() => patches(h).length > 0, 5_000);
      assert.deepEqual(patches(h)[0]?.body, {
        acceptance_md: `${ACCEPTANCE}\n- [ ] the map is unchanged`,
      });
    } finally {
      await h.close();
    }
  });
});

void describe('the comment composer is the same editor', () => {
  void test('toolbar, mention and Markdown toggle; Comment posts markdown', async () => {
    const server: Server = { t3: subject() };
    const h = await panel(server);
    try {
      await h.page.getByRole('button', { name: /Add a comment/ }).click();
      const editor = h.page.locator('.panel-composer .rich-editor');
      await editor.waitFor({ timeout: 10_000 });
      const toolbar = editor.getByRole('toolbar', { name: 'Formatting' });
      for (const name of ['Bold', 'Mention someone', 'Link a card', 'Markdown']) {
        assert.equal(
          await toolbar.getByRole('button', { name, exact: true }).count(),
          1,
          `no ${name}`,
        );
      }
      await content(editor).click();
      await toolbar.getByRole('button', { name: 'Bold' }).click();
      await h.page.keyboard.type('Done');
      await toolbar.getByRole('button', { name: 'Bold' }).click();
      await h.page.keyboard.type(' for @ad');
      await h.page
        .locator('.rich-editor-picker [role="option"]')
        .first()
        .waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Enter');
      await editor.getByRole('button', { name: 'Comment' }).click();
      await until(
        () => h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/tasks/t3/comments'),
        5_000,
      );
      const post = h.calls.find(
        (c) => c.method === 'POST' && c.path === '/api/v1/tasks/t3/comments',
      );
      assert.deepEqual(post?.body, { body_md: '**Done** for @ada' });
    } finally {
      await h.close();
    }
  });
});

void describe('the editor is not part of the board (LAI-827)', () => {
  void test('the Board does not download it; the first edit does', async () => {
    const server: Server = { t3: subject() };
    const scripts: string[] = [];
    const h = await open('/board?project=laika-core', stub(server), {
      before: async (page) => {
        await fakeStream(page);
        page.on('request', (r) => {
          const path = new globalThis.URL(r.url()).pathname;
          if (path.endsWith('.js')) scripts.push(path);
        });
      },
    });
    try {
      await h.page
        .locator('.card', { hasText: 'Operator console' })
        .first()
        .click({ timeout: 20_000 });
      await description(h).locator('.md h2').waitFor({ timeout: 10_000 });
      await h.page.waitForTimeout(300);
      assert.ok(scripts.length > 0, 'positive control: no script was seen at all');
      assert.deepEqual(
        scripts.filter((s) => s.includes('RichEditor')),
        [],
        'the editor loaded before anyone edited',
      );
      const styles = await h.page.evaluate(() => document.querySelectorAll('style').length);

      await openEditor(h);
      assert.equal(scripts.filter((s) => s.includes('RichEditor')).length, 1, 'no editor chunk');
      // CSP: style-src-elem 'self' — the editor must not inject a <style>.
      assert.equal(await h.page.evaluate(() => document.querySelectorAll('style').length), styles);
    } finally {
      await h.close();
    }
  });
});
