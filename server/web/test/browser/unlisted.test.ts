/**
 * The compact Unlisted work page (LAI-754).
 *
 * The owner, looking at the card list on Capacity: *"this Unlisted work list
 * is too big, I don't know why we added it there."* It left Capacity for its
 * own page, one line per note — repo, who, when, the first line — newest
 * first, a click to read the rest, and Promote and Dismiss under it.
 *
 * What only a browser can show: that a line **is** one line, that the rest of
 * a note is hidden until asked for, and that the sidebar's count follows a
 * triage done here.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, reply, type ApiStub, type StubCall } from './harness.ts';

const now = Date.now();
const HOUR = 3_600_000;

interface Note {
  id: string;
  user_id: string;
  token_id: string | null;
  repo: string;
  note: string;
  promoted_task_id: string | null;
  dismissed_at: number | null;
  created_at: number;
}

const note = (id: string, ageHours: number, text: string, over: Partial<Note> = {}): Note => ({
  id,
  user_id: 'u2',
  token_id: 'tok1',
  repo: 'PawanSirsat/Laika',
  note: text,
  promoted_task_id: null,
  dismissed_at: null,
  created_at: now - ageHours * HOUR,
  ...over,
});

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

/** A server whose queue changes when it is triaged, so a re-read can be seen. */
function server(notes: Note[]): { stub: ApiStub; notes: Note[] } {
  const state = { notes };
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': {
      data: [
        { id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', org_role: 'owner' },
        { id: 'u2', name: 'Tomas Nel', email: 't@example.com', org_role: 'member' },
      ],
      next_cursor: null,
    },
    '/api/v1/unlisted': () => ({
      data: state.notes.filter((n) => n.dismissed_at === null),
      next_cursor: null,
    }),
    '/api/v1/unlisted/n2/promote': (call: StubCall) => {
      const body = call.body as { project_slug: string; title: string };
      state.notes = state.notes.map((n) =>
        n.id === 'n2' ? { ...n, promoted_task_id: 'task-7' } : n,
      );
      return {
        unlisted: state.notes.find((n) => n.id === 'n2'),
        task: { id: 'task-7', key: 'LAI-7', title: body.title },
      };
    },
    '/api/v1/unlisted/n3': () => {
      state.notes = state.notes.map((n) => (n.id === 'n3' ? { ...n, dismissed_at: now } : n));
      return reply(204, undefined);
    },
  };
  return { stub, notes: state.notes };
}

const QUEUE = [
  note('n1', 30, 'The oldest note.'),
  note('n2', 1, 'The newest note, first line.\nA second line only an open row shows.'),
  note('n3', 5, 'A note to dismiss.', { user_id: 'u1', token_id: null }),
];

void after(async () => {
  await closeBrowser();
});

void describe('the compact unlisted page', () => {
  void test('one line per note, newest first, the rest hidden until opened', async () => {
    const h = await open('/unlisted', server(QUEUE).stub);
    try {
      const lines = h.page.locator('.unl-line');
      await lines.first().waitFor({ timeout: 20_000 });
      assert.equal(await lines.count(), 3);

      // Newest first, by when the note was logged.
      const firsts = await h.page.locator('.unl-first').allInnerTexts();
      assert.deepEqual(firsts, [
        'The newest note, first line.',
        'A note to dismiss.',
        'The oldest note.',
      ]);

      // Repo, who and when on the line; the name is the person's, not "Someone".
      const top = lines.first();
      assert.match(await top.innerText(), /PawanSirsat\/Laika/);
      assert.match(await top.innerText(), /Tomas Nel/);
      assert.match(await top.innerText(), /h ago|min ago|just now/);

      // **One line**: no taller than a line of text and its padding.
      const box = await top.boundingBox();
      assert.ok(box !== null && box.height <= 44, `a line is ${String(box?.height)}px tall`);

      // The rest of the note, and the actions, wait for a click.
      assert.equal(await h.page.getByText('A second line only an open row shows.').count(), 0);
      assert.equal(await h.page.locator('.unl-promote').count(), 0);
      assert.equal(await top.getAttribute('aria-expanded'), 'false');

      await top.click();
      assert.equal(await top.getAttribute('aria-expanded'), 'true');
      await h.page
        .locator('.unl-note', { hasText: 'A second line only an open row shows.' })
        .waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('.unl-promote').count(), 1);
      assert.equal(await h.page.locator('.unl-dismiss').count(), 1);

      // The header says how many wait; the sidebar says the same.
      assert.match(await h.page.locator('.screen-bar-context').innerText(), /3 open/);
      const entry = h.page.locator('#sidebar .sidebar-link', { hasText: 'Unlisted work' });
      assert.match(await entry.innerText(), /Unlisted work\s*3/);
      assert.equal(await entry.getAttribute('aria-current'), 'page');
    } finally {
      await h.close();
    }
  });

  void test('promote sends the note to a project, and the sidebar count follows', async () => {
    const h = await open('/unlisted', server([...QUEUE]).stub);
    try {
      const entry = h.page.locator('#sidebar .sidebar-link', { hasText: 'Unlisted work' });
      await h.page.locator('.unl-line').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => (document.querySelector('#sidebar .sidebar-count')?.textContent ?? '').includes('3'),
        undefined,
        { timeout: 10_000 },
      );

      await h.page.locator('.unl-line').first().click();
      await h.page.locator('.unl-promote').click();
      await h.page.locator('.unl-form input').first().fill('laika-core');
      await h.page.locator('.unl-form .bar-control-primary').click();

      await h.page
        .locator('.unl-link', { hasText: 'Open LAI-7' })
        .waitFor({ timeout: 10_000 })
        .catch(() => undefined);
      const posted = h.calls.filter(
        (c) => c.method === 'POST' && c.path === '/api/v1/unlisted/n2/promote',
      );
      assert.equal(posted.length, 1, 'no promote was sent');
      assert.deepEqual(posted[0]?.body, {
        project_slug: 'laika-core',
        title: 'The newest note, first line.',
      });

      // Decided rows say so on the line, and the count drops to what is left.
      await h.page.locator('.unl-tag-promoted').waitFor({ timeout: 10_000 });
      await h.page.waitForFunction(
        () => /\b2\b/.test(document.querySelector('#sidebar .sidebar-count')?.textContent ?? ''),
        undefined,
        { timeout: 10_000 },
      );
      assert.match(await entry.innerText(), /Unlisted work\s*2/);
    } finally {
      await h.close();
    }
  });

  void test('dismiss asks first, then removes the note from the open queue', async () => {
    const h = await open('/unlisted', server([...QUEUE]).stub);
    try {
      await h.page.locator('.unl-line').first().waitFor({ timeout: 20_000 });
      h.page.once('dialog', (dialog) => {
        void dialog.accept();
      });
      await h.page.locator('.unl-line', { hasText: 'A note to dismiss.' }).click();
      await h.page.locator('.unl-dismiss').click();

      await h.page.waitForFunction(
        () => document.querySelectorAll('.unl-line').length === 2,
        undefined,
        { timeout: 10_000 },
      );
      assert.ok(
        h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/unlisted/n3'),
        'no dismiss was sent',
      );
      assert.equal(await h.page.getByText('A note to dismiss.').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a long queue shows a first page and then Show more', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      note(`m${String(i)}`, i + 1, `Note number ${String(i)}`),
    );
    const h = await open('/unlisted', server(many).stub);
    try {
      await h.page.locator('.unl-line').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.unl-line').count(), 25);
      const more = h.page.locator('.unl-more');
      assert.match(await more.innerText(), /Show more\s*5 more/);
      // The count is the queue's, not the page's.
      assert.match(await h.page.locator('.screen-bar-context').innerText(), /30 open/);

      await more.click();
      assert.equal(await h.page.locator('.unl-line').count(), 30);
      assert.equal(await h.page.locator('.unl-more').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('at 390px a line wraps to two short lines and nothing spills', async () => {
    const h = await open('/unlisted', server(QUEUE).stub);
    try {
      await h.page.setViewportSize({ width: 390, height: 900 });
      await h.page.locator('.unl-line').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(200);
      const spills = await h.page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(spills, false, 'the page scrolls sideways');
      const box = await h.page.locator('.unl-line').first().boundingBox();
      assert.ok(box !== null && box.height <= 64, `a line is ${String(box?.height)}px tall`);
    } finally {
      await h.close();
    }
  });
});
