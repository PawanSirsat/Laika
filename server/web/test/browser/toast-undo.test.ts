/**
 * The app's one toast, SaveStatus and InlineConfirm in a real browser
 * (LAI-1129): Review's Accept posts at once (D-146) and reports the server's answer, with no
 * Undo it cannot honour; *Open on board* leaves a modified click to the
 * browser; Space settings says *Saving… / Saved / Couldn't save — Retry* and
 * guards unsaved General changes; the inline confirm takes focus in and gives
 * it back; a toast is dismissed from the keyboard, pauses under the pointer,
 * never takes focus, and does not animate for someone who asked for less
 * motion.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { answerConfirm } from './confirm.ts';

void after(async () => {
  await closeBrowser();
});

// ------------------------------------------------------------------ Review

const NOW = Date.now();

const PROJECT_REF = { id: 'laika-core', slug: 'laika-core', name: 'Laika Core', prefix: 'LC' };

function reviewTask(id: string, key: string, title: string) {
  return {
    id,
    key,
    title,
    project_id: 'laika-core',
    status: 'review',
    status_id: 'st-review',
    status_name: 'Review',
    assignee_id: 'u1',
    send_back: null,
    updated_at: NOW,
    acceptance_md: '',
  };
}

function reviewStub(seen: StubCall[]): ApiStub {
  let rows = [reviewTask('t2', 'LC-2', 'Worked task')];
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/review': () => ({
      tasks: rows.map((task) => ({
        task,
        project: PROJECT_REF,
        assignee_name: 'Ada Lovelace',
        waiting_since: NOW - 3_600_000,
        round: null,
        finished_by_name: null,
        can_decide: true,
        cue: null,
      })),
      truncated: false,
    }),
    '/api/v1/tasks/t2/rounds': { rounds: [], send_back: null },
    '/api/v1/tasks/t2/accept': (call: StubCall) => {
      seen.push(call);
      const row = rows[0];
      rows = [];
      return { ...row, status: 'done', status_id: 'st-done', status_name: 'Shipped' };
    },
  };
}

async function openRow(h: Harness): Promise<void> {
  await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
  await h.page.locator('.rev-line', { hasText: 'LC-2' }).click();
}

void describe('Review: Accept is honest about what it can take back', () => {
  void test('Accept posts at once (D-146), then the toast says the server’s answer — and offers no Undo', async () => {
    const seen: StubCall[] = [];
    const h = await open('/inbox?tab=review', reviewStub(seen));
    try {
      await openRow(h);
      const dialog = h.page.locator('[data-dialog="review"]');
      await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
      // No yes-or-no in front of a decision queue's Accept (LAI-1169).
      assert.equal(await h.page.locator('[data-confirm-dialog]').count(), 0, 'Accept asked first');
      await until(() => seen.length === 1);
      const toast = h.page.locator('[data-toast][data-review-accepted]');
      await toast.waitFor({ timeout: 5_000 });
      // The status the server answered with, not one the client assumed.
      assert.equal(
        await toast.locator('[role="status"]').innerText(),
        'Accepted LC-2 — it is in Shipped now.',
      );
      assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 0, 'a fake Undo');
      assert.deepEqual(
        seen.map((c) => [c.method, c.path]),
        [['POST', '/api/v1/tasks/t2/accept']],
      );
    } finally {
      await h.close();
    }
  });

  void test('Open on board: a plain click navigates in the app; a cmd/ctrl/shift click is left to the browser', async () => {
    const h = await open('/inbox?tab=review', reviewStub([]));
    try {
      await openRow(h);
      // Whether the app swallowed the click, read after every handler ran.
      await h.page.evaluate(() => {
        document.addEventListener('click', (event) => {
          (window as unknown as { lastPrevented: boolean }).lastPrevented = event.defaultPrevented;
          // The test is about the app's handler, not about opening tabs.
          event.preventDefault();
        });
      });
      const link = h.page.locator('.rev-open');
      const prevented = () =>
        h.page.evaluate(() => (window as unknown as { lastPrevented: boolean }).lastPrevented);
      for (const modifier of ['Meta', 'Control', 'Shift'] as const) {
        await link.click({ modifiers: [modifier] });
        assert.equal(await prevented(), false, `${modifier}-click was taken over by the app`);
        assert.match(h.page.url(), /\/inbox\?tab=review/);
      }
      await link.click();
      assert.equal(await prevented(), true, 'a plain click was not handled in the app');
      await until(() => h.page.url().includes('/board?project=laika-core&task=t2'));
      assert.match(h.page.url(), /\/board\?project=laika-core&task=t2/);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------ Space settings

const SLUG = 'laika';
const SETTINGS = `/spaces/${SLUG}/settings`;

const PROJECT = {
  id: 'p1',
  slug: SLUG,
  name: 'Laika',
  prefix: 'LAIKA',
  description: 'The board humans and agents share.',
  repo: null,
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

const member = (user_id: string, name: string, role: string) => ({
  user_id,
  name,
  email: `${user_id}@example.com`,
  role,
  created_at: 1,
});

function settingsStub(overrides: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'u1@example.com',
      name: 'Pawan Sirsat',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/org': {
      id: 'o1',
      name: 'Kvelld',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/projects': {
      data: [
        {
          ...PROJECT,
          task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    [`/api/v1/projects/${SLUG}`]: PROJECT,
    [`/api/v1/projects/${SLUG}/members`]: {
      members: [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'member')],
    },
    '/api/v1/users': { data: [], next_cursor: null },
    ...overrides,
  };
}

async function settled(h: Harness): Promise<void> {
  await h.page.locator('.ss-reader').waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator('.ss-reader').innerText()) !== 'Space settings');
}

const statusOf = (h: Harness) => h.page.locator('.ss-card-foot [data-save-status]');

void describe('Space settings: SaveStatus', () => {
  void test('General: Saving… then Saved only on the server’s answer; a failure says Couldn’t save — Retry, and Retry sends it again', async () => {
    let patches = 0;
    let release: (() => void) | undefined;
    let current: Record<string, unknown> = { ...PROJECT };
    const h = await open(
      SETTINGS,
      settingsStub({
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) => {
          if (call.method !== 'PATCH') return current;
          patches += 1;
          if (patches === 1) return refuse(500, 'internal', 'The database is busy');
          current = { ...current, ...(call.body as object) };
          return current;
        },
      }),
      {
        // The first save is held in the browser, so *Saving…* can be seen before the answer.
        before: async (page) => {
          let held = false;
          await page.route(`**/api/v1/projects/${SLUG}`, async (route) => {
            if (route.request().method() === 'PATCH' && !held) {
              held = true;
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            }
            await route.continue();
          });
        },
      },
    );
    try {
      await settled(h);
      const status = statusOf(h);
      assert.equal(await status.getAttribute('data-save-status'), 'idle');
      // The live region is mounted before anything is said, so the first news is heard.
      assert.equal(await status.locator('[role="status"]').getAttribute('aria-live'), 'polite');

      await h.page.locator('#ss-name').fill('Laika Board');
      await h.page.getByRole('button', { name: 'Save changes' }).click();
      await until(async () => (await status.getAttribute('data-save-status')) === 'saving');
      assert.equal(await status.innerText(), 'Saving…');
      assert.notEqual(await status.getAttribute('data-save-status'), 'saved', 'Saved before 2xx');

      await until(() => release !== undefined);
      release?.();
      await until(async () => (await status.getAttribute('data-save-status')) === 'failed');
      assert.match(await status.innerText(), /Couldn’t save —\s*Retry/);
      const retry = status.getByRole('button', { name: 'Retry' });
      await retry.click();
      await until(async () => (await status.getAttribute('data-save-status')) === 'saved');
      assert.equal(patches, 2, 'Retry did not send the save again');
      assert.match(await status.locator('[role="status"]').innerText(), /Saved/);
      assert.equal(await h.page.locator('.screen-page-title').innerText(), 'Laika Board');
    } finally {
      await h.close();
    }
  });

  void test('a refusal of the values (422) says Couldn’t save without a Retry that would only be refused again', async () => {
    const h = await open(
      SETTINGS,
      settingsStub({
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) =>
          call.method === 'PATCH'
            ? reply(422, {
                error: { code: 'unprocessable', message: 'Too long', details: { field: 'name' } },
              })
            : PROJECT,
      }),
    );
    try {
      await settled(h);
      await h.page.locator('#ss-name').fill('x');
      await h.page.getByRole('button', { name: 'Save changes' }).click();
      const status = statusOf(h);
      await until(async () => (await status.getAttribute('data-save-status')) === 'failed');
      assert.equal(await status.getByRole('button', { name: 'Retry' }).count(), 0);
      // The refusal itself is said beside the form, in the server's words.
      await h.page.locator('.ss-field-error', { hasText: 'Too long' }).waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('Access: a change that saves says Saved in the card head', async () => {
    let current: Record<string, unknown> = { ...PROJECT };
    const h = await open(
      `${SETTINGS}?tab=access`,
      settingsStub({
        [`/api/v1/projects/${SLUG}`]: (call: StubCall) => {
          if (call.method === 'PATCH') current = { ...current, ...(call.body as object) };
          return current;
        },
        [`/api/v1/projects/${SLUG}/handoff-policy`]: { policy: null },
      }),
    );
    try {
      await settled(h);
      await h.page.locator('[data-create="lead"]').click();
      const status = h.page.locator('.ss-immediate-wrap [data-save-status]');
      await until(async () => (await status.getAttribute('data-save-status')) === 'saved');
      assert.equal(await status.innerText(), '✓ Saved');
    } finally {
      await h.close();
    }
  });
});

void describe('Space settings: unsaved General changes are guarded (B11)', () => {
  void test('a tab switch asks first: Keep editing keeps the draft; Discard changes leaves; the browser warns before unload', async () => {
    const h = await open(SETTINGS, settingsStub());
    try {
      await settled(h);
      // Nothing typed yet: no warning armed, and a tab switch does not ask.
      const unloadBlocked = () =>
        h.page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        });
      assert.equal(await unloadBlocked(), false, 'warned with nothing unsaved');

      await h.page.locator('#ss-name').fill('Half typed');
      assert.equal(await unloadBlocked(), true, 'no beforeunload warning with changes unsaved');

      await h.page.locator('.page-tab[data-tab="members"]').click();
      const said = await answerConfirm(h.page, false);
      assert.match(said, /Discard your changes\?/);
      assert.equal(await h.page.locator('#ss-name').inputValue(), 'Half typed', 'draft lost');
      assert.doesNotMatch(h.page.url(), /tab=members/);

      await h.page.locator('.page-tab[data-tab="members"]').click();
      await answerConfirm(h.page, true);
      await until(() => h.page.url().includes('tab=members'));
      assert.match(h.page.url(), /tab=members/);
      await h.page.locator('[data-member="u2"]').waitFor({ timeout: 10_000 });
      assert.equal(await unloadBlocked(), false, 'the warning outlived the form');
    } finally {
      await h.close();
    }
  });
});

void describe('InlineConfirm (B12)', () => {
  void test('Archive: focus moves in to Cancel, the question names the group, Escape cancels and returns focus to Archive', async () => {
    const h = await open(`${SETTINGS}?tab=danger`, settingsStub());
    try {
      await settled(h);
      await h.page.locator('[data-action="archive"]').click();
      const box = h.page.locator('[data-inline-confirm]');
      await box.waitFor({ timeout: 5_000 });
      assert.equal(await box.getAttribute('role'), 'group');
      const name = await box.evaluate((el) => {
        const id = el.getAttribute('aria-labelledby') ?? '';
        return document.getElementById(id)?.textContent ?? '';
      });
      assert.match(name, /Archive Laika\? Its board becomes read-only/);
      await until(() =>
        h.page.evaluate(() => document.activeElement?.hasAttribute('data-inline-cancel') === true),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent),
        'Cancel',
        'focus did not move into the question',
      );

      await h.page.keyboard.press('Escape');
      await box.waitFor({ state: 'detached', timeout: 5_000 });
      await until(() =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-action') === 'archive'),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-action')),
        'archive',
        'focus was not given back to the trigger',
      );
      assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('Leave space: Cancel returns focus to Leave space', async () => {
    const h = await open(`${SETTINGS}?tab=members`, settingsStub());
    try {
      await settled(h);
      await h.page.locator('[data-action="leave"]').click();
      await h.page.locator('[data-inline-confirm] [data-inline-cancel]').click();
      await until(() =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-action') === 'leave'),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-action')),
        'leave',
      );
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------------ The toast

/** Members › Remove, through the offboarding dialog: the toast with a real Undo. */
function removable(calls: string[]): ApiStub {
  let list = [member('u1', 'Pawan Sirsat', 'lead'), member('u2', 'Tomas Nel', 'member')];
  return settingsStub({
    [`/api/v1/projects/${SLUG}/members/u2`]: () => {
      calls.push('DELETE');
      list = list.filter((m) => m.user_id !== 'u2');
      return { members: list };
    },
    [`/api/v1/projects/${SLUG}/members`]: (call: StubCall) => {
      if (call.method === 'POST') {
        calls.push('POST');
        list = [...list, member('u2', 'Tomas Nel', 'member')];
        return reply(201, { members: list });
      }
      return { members: list };
    },
  });
}

async function removeTomas(h: Harness): Promise<void> {
  await settled(h);
  await h.page.locator('[data-member="u2"] [data-action="remove"]').click();
  await h.page.locator('[data-action="offboard-confirm"]').click();
  await h.page.locator('[data-toast]').waitFor({ timeout: 10_000 });
}

void describe('the toast', () => {
  void test('it never takes focus; Tab reaches it, Escape dismisses it, and focus goes back where it was', async () => {
    const h = await open(`${SETTINGS}?tab=members`, removable([]));
    try {
      await removeTomas(h);
      const toast = h.page.locator('[data-toast]');
      assert.equal(
        await h.page.evaluate(() =>
          document.querySelector('[data-toast-stack]')?.contains(document.activeElement),
        ),
        false,
        'the toast took focus',
      );
      // Start from a known control, then reach the toast by keyboard alone.
      await h.page.locator('[data-action="leave"]').focus();
      for (let i = 0; i < 60; i += 1) {
        const inside = await h.page.evaluate(() =>
          document.querySelector('[data-toast-stack]')?.contains(document.activeElement),
        );
        if (inside === true) break;
        await h.page.keyboard.press('Tab');
      }
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.closest('[data-toast]') !== null),
        true,
        'the toast is not reachable by Tab',
      );
      // Focus inside pauses it.
      assert.equal(await h.page.locator('[data-toast-stack]').getAttribute('data-paused'), '');
      await h.page.keyboard.press('Escape');
      await toast.waitFor({ state: 'detached', timeout: 5_000 });
      const back = await h.page.evaluate(() => document.activeElement?.tagName ?? 'none');
      assert.notEqual(back, 'BODY', 'focus fell to the page after dismissing');
    } finally {
      await h.close();
    }
  });

  void test('Undo is a real button that runs the reversing call, and the same toast says the answer', async () => {
    const calls: string[] = [];
    const h = await open(`${SETTINGS}?tab=members`, removable(calls));
    try {
      await removeTomas(h);
      const toast = h.page.locator('[data-toast]');
      assert.match(await toast.locator('[role="status"]').innerText(), /Removed Tomas Nel/);
      assert.match((await toast.locator('[data-toast-count]').innerText()).trim(), /^\d+s$/);
      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => calls.includes('POST'));
      await until(async () => (await toast.innerText()).includes('is back'));
      assert.match(await toast.locator('[role="status"]').innerText(), /Tomas Nel is back/);
      assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 0);
      assert.deepEqual(calls, ['DELETE', 'POST']);
    } finally {
      await h.close();
    }
  });

  void test('the pointer on it pauses the countdown', async () => {
    const h = await open(`${SETTINGS}?tab=members`, removable([]));
    try {
      await removeTomas(h);
      const toast = h.page.locator('[data-toast]');
      await toast.hover();
      await until(
        async () => (await h.page.locator('[data-toast-stack]').getAttribute('data-paused')) === '',
      );
      const before = await toast.locator('[data-toast-count]').innerText();
      await h.page.waitForTimeout(2_200);
      assert.equal(
        await toast.locator('[data-toast-count]').innerText(),
        before,
        'it kept counting',
      );
      await h.page.mouse.move(0, 0);
      await until(
        async () =>
          (await h.page.locator('[data-toast-stack]').getAttribute('data-paused')) === null,
      );
    } finally {
      await h.close();
    }
  });

  for (const reduce of [false, true]) {
    void test(`${reduce ? 'reduced motion: it appears without animating' : 'it slides in when motion is welcome'}`, async () => {
      const h = await open(
        `${SETTINGS}?tab=members`,
        removable([]),
        reduce
          ? {
              before: async (page) => {
                await page.emulateMedia({ reducedMotion: 'reduce' });
              },
            }
          : {},
      );
      try {
        await removeTomas(h);
        const name = await h.page
          .locator('[data-toast]')
          .evaluate((el) => getComputedStyle(el).animationName);
        assert.equal(name, reduce ? 'none' : 'toast-in');
      } finally {
        await h.close();
      }
    });
  }

  void test('it sits above an open dialog', async () => {
    const h = await open(`${SETTINGS}?tab=members`, removable([]));
    try {
      await removeTomas(h);
      const z = await h.page.evaluate(() => {
        const stack = document.querySelector('[data-toast-stack]');
        return stack === null ? 0 : Number(getComputedStyle(stack).zIndex);
      });
      // The confirm dialog's layer is 80 (`confirm-dialog.css`).
      assert.ok(z > 80, `toast layer ${String(z)} is not above the dialog's`);
    } finally {
      await h.close();
    }
  });
});
