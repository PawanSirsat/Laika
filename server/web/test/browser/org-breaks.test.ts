/**
 * The organisation's breaks (D-101, LAI-956), in a real browser: an owner or
 * admin edits the windows on the Organisation screen and saves the whole
 * list; anyone else reads them; and My day's Timeline draws each window whose
 * weekday matches the day as a shaded, labelled band on the You lane — behind
 * the blocks, which stay selectable, and never compared with the day.
 *
 * My day runs on LAI-954's pinned clock: today at 15:00 UTC.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  open as openPage,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open } from './my-day-clock.ts';
import { zoomTo } from './my-day-zoom.ts';
import { SETTINGS, TODAY, viewOf, weekData, weekStub, YESTERDAY } from './my-day-week.ts';

/** Today's ISO weekday, 1 (Monday) – 7: the schedule names today and no other day. */
const ISO_TODAY = ((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Over e2 (12:00–12:30) and the gap after it, up to d3 at 13:00. */
const LUNCH = { label: 'Lunch', start: '12:00', end: '13:00', days: [ISO_TODAY] };

function dayStub(breaks: readonly unknown[]): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  for (const day of [TODAY, YESTERDAY]) {
    routes[`/api/v1/me/time?day=${day}`] = () => ({
      ...(viewOf(day, data) as object),
      settings: { ...SETTINGS, breaks },
    });
  }
  return routes;
}

async function myDay(day: string, breaks: readonly unknown[]): Promise<Harness> {
  const h = await open(`/my-day?day=${day}`, dayStub(breaks));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-block-id]').first().waitFor({ timeout: 10_000 });
  return h;
}

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const settings = (breaks: readonly unknown[]) => ({
  org_mode: 'manual',
  draft_my_time: false,
  drafting: false,
  min_sync_interval_s: 300,
  breaks,
});

function orgStub(role: string, breaks: readonly unknown[], extra: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': { ...user('u1', 'Ada Lovelace', role), memberships: [] },
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/users': { data: [user('u1', 'Ada Lovelace', 'owner')], next_cursor: null },
    '/api/v1/invites': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Kvelld Dynamics',
      presence_enabled: true,
      developer_insights: true,
      created_at: 1,
      updated_at: 2,
    },
    '/api/v1/me/time-settings': settings(breaks),
    ...extra,
  };
}

const permissions = (role: string, actions: readonly string[]) => ({
  org_roles: [],
  project_roles: [],
  permissions: [],
  me: {
    org_role: role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions,
    projects: [],
  },
});

async function organisation(stub: ApiStub): Promise<Harness> {
  const h = await openPage('/organisation', stub);
  await h.page.locator('[data-fact="time"]').waitFor({ timeout: 20_000 });
  return h;
}

void after(async () => {
  await closeBrowser();
});

void describe('My day: the organisation’s breaks on the Timeline', () => {
  void test('on a weekday the schedule names: a labelled band behind the blocks, and no gap under it', async () => {
    const h = await myDay(TODAY, [LUNCH]);
    try {
      const band = h.page.locator('[data-scheduled-break]');
      await band.first().waitFor({ timeout: 10_000 });
      assert.equal(await band.count(), 1);
      assert.match(await band.innerText(), /Lunch/);
      assert.match(
        (await band.getAttribute('aria-label')) ?? '',
        /^Lunch, 12:00–1:00 PM — the organisation’s break$/,
      );
      // Nothing to press on the band; the pill on it says what was worked
      // (D-105): e2 is 12:00–12:30, half the window.
      assert.equal(await band.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
      assert.equal(await band.locator('button, a, [tabindex]').count(), 0);
      await zoomTo(h.page, 1);
      const pill = band.locator('[data-scheduled-pill]');
      await until(async () => (await pill.locator('[data-scheduled-worked]').count()) === 1);
      assert.equal(await pill.getAttribute('data-worked'), '30');
      assert.equal(await pill.locator('[data-scheduled-worked]').innerText(), '30m worked');
      assert.equal(await pill.locator('[data-break-kind="meal"]').count(), 1, 'Lunch has no fork');
      assert.match((await pill.getAttribute('title')) ?? '', /30 min off, 30 min worked/);
      // Its bar: worked first, then off, half each.
      const segs = pill.locator('.dayline-scheduled-seg');
      assert.equal(await segs.count(), 2);
      assert.ok((await segs.nth(0).evaluate((el: Element) => el.className)).includes('seg-work'));
      // And e2's half inside the window is hatched, over the block, catching nothing.
      const bite = h.page.locator('[data-scheduled-bite="e2"]');
      assert.equal(await bite.count(), 1);
      assert.equal(await bite.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');

      // e2 (12:00–12:30) sits over the band, whole and on top.
      const e2 = h.page.locator('[data-block-select="e2"]');
      const box = await e2.boundingBox();
      assert.ok(box !== null, 'e2 is drawn');
      const hit = await h.page.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-block-select]')
            ?.getAttribute('data-block-select'),
        [box.x + box.width / 2, box.y + box.height / 2] as const,
      );
      assert.equal(hit, 'e2', 'the block, not the band, is under the pointer');
      await e2.click();
      await until(async () => (await e2.getAttribute('aria-pressed')) === 'true');
      assert.equal(await e2.getAttribute('aria-pressed'), 'true');

      // 12:30–13:00 was a gap between e2 and d3; inside lunch it is not.
      assert.equal(await h.page.locator('[data-gap-start="750"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a window nothing was worked in says offline; one a block covers says worked through', async () => {
    const h = await myDay(TODAY, [
      { label: 'Tea break', start: '16:30', end: '17:00', days: [ISO_TODAY] },
      { label: 'Stand-up', start: '13:00', end: '13:45', days: [ISO_TODAY] },
    ]);
    try {
      await zoomTo(h.page, 2);
      const tea = h.page.locator('[data-scheduled-break="990"] [data-scheduled-pill]');
      await until(async () => (await tea.locator('[data-scheduled-worked]').count()) === 1);
      assert.equal(await tea.locator('[data-scheduled-worked]').innerText(), 'offline');
      assert.equal(await tea.getAttribute('data-worked'), '0');
      assert.equal(await tea.locator('[data-break-kind="cup"]').count(), 1, 'Tea has no cup');
      assert.equal(await h.page.locator('[data-scheduled-bite]').count(), 1, 'only d3 is hatched');
      // 13:00–13:45 lies inside d3 (13:00–14:50).
      const standup = h.page.locator('[data-scheduled-break="780"] [data-scheduled-pill]');
      await until(async () => (await standup.locator('[data-scheduled-worked]').count()) === 1);
      assert.equal(await standup.locator('[data-scheduled-worked]').innerText(), 'worked through');
      assert.equal(await standup.locator('[data-break-kind="people"]').count(), 1);
      assert.equal(await h.page.locator('[data-scheduled-bite="d3"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('the same day with no schedule still has its 12:30 gap — the band is what took it', async () => {
    const h = await myDay(TODAY, []);
    try {
      await h.page.locator('[data-gap-start="750"]').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-scheduled-break]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('on a weekday it does not name: no band', async () => {
    const h = await myDay(YESTERDAY, [LUNCH]);
    try {
      assert.equal(await h.page.locator('[data-scheduled-break]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('light and dark at 1440 and 390: the band is drawn and the page never scrolls sideways', async () => {
    const h = await myDay(TODAY, [LUNCH]);
    try {
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          const spill = () =>
            h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          await until(async () => (await spill()) <= 0);
          assert.ok((await spill()) <= 0, `${theme} at ${String(width)}: sideways`);
          const band = h.page.locator('[data-scheduled-break]');
          assert.equal(await band.count(), 1, `${theme} at ${String(width)}: one band`);
          const shade = await band.evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.notEqual(shade, 'rgba(0, 0, 0, 0)', `${theme} at ${String(width)}: shaded`);
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('Organisation: the break schedule', () => {
  void test('an owner adds a window, edits one, removes one, and saves the whole list', async () => {
    const writes: StubCall[] = [];
    const h = await organisation(
      orgStub('owner', [LUNCH, { label: 'Tea', start: '16:00', end: '16:15', days: [1, 2] }], {
        '/api/v1/org/time/breaks': (call: StubCall) => {
          writes.push(call);
          return settings((call.body as { breaks: unknown[] }).breaks);
        },
      }),
    );
    try {
      const fact = h.page.locator('[data-fact="breaks"]');
      await fact.waitFor({ timeout: 10_000 });
      await fact.getByRole('button', { name: 'Edit breaks' }).click();
      const rows = fact.locator('[data-break-row]');
      await until(async () => (await rows.count()) === 2);
      assert.equal(await rows.count(), 2);

      // Remove Tea; rename Lunch; add a morning stand-up on Monday only.
      await rows
        .nth(1)
        .getByRole('button', { name: /Remove/ })
        .click();
      await rows.nth(0).getByLabel('Label').fill('Lunch break');
      await fact.getByRole('button', { name: 'Add your own' }).click();
      const added = rows.nth(1);
      await added.getByLabel('Label').fill('Stand-up');
      await added.getByLabel('Starts').fill('09:30');
      await added.getByLabel('Ends').fill('09:45');
      for (const day of ['Tue', 'Wed', 'Thu', 'Fri']) {
        await added.getByRole('checkbox', { name: day }).uncheck();
      }
      await fact.getByRole('button', { name: 'Save breaks' }).click();
      await until(() => writes.length === 1);
      assert.equal(writes[0]?.method, 'PUT');
      assert.deepEqual(writes[0]?.body, {
        breaks: [
          { label: 'Lunch break', start: '12:00', end: '13:00', days: [ISO_TODAY] },
          { label: 'Stand-up', start: '09:30', end: '09:45', days: [1] },
        ],
      });
      // The answer redraws the schedule, read-only again.
      await until(
        async () => (await fact.getByRole('button', { name: 'Edit breaks' }).count()) === 1,
      );
      const text = await fact.innerText();
      assert.match(text, /Lunch break/);
      assert.match(text, /Stand-up/);
      assert.doesNotMatch(text, /Tea/);
    } finally {
      await h.close();
    }
  });

  void test('a usual break is one click, with its glyph, and is not offered twice', async () => {
    const writes: StubCall[] = [];
    const h = await organisation(
      orgStub('owner', [LUNCH], {
        '/api/v1/org/time/breaks': (call: StubCall) => {
          writes.push(call);
          return settings((call.body as { breaks: unknown[] }).breaks);
        },
      }),
    );
    try {
      const fact = h.page.locator('[data-fact="breaks"]');
      await fact.waitFor({ timeout: 10_000 });
      // Read-only: Lunch wears the fork.
      assert.equal(await fact.locator('.org-break [data-break-kind="meal"]').count(), 1);
      await fact.getByRole('button', { name: 'Edit breaks' }).click();
      const lunch = fact.locator('[data-break-preset="lunch"]');
      await lunch.waitFor();
      assert.equal(await lunch.isDisabled(), true, 'Lunch is offered although it is in the list');
      await fact.locator('[data-break-preset="tea"]').click();
      const rows = fact.locator('[data-break-row]');
      await until(async () => (await rows.count()) === 2);
      assert.equal(await rows.nth(1).getByLabel('Label').inputValue(), 'Tea break');
      assert.equal(await rows.nth(1).locator('[data-break-kind="cup"]').count(), 1);
      assert.equal(await fact.locator('[data-break-preset="tea"]').isDisabled(), true);
      // Renaming the row changes its glyph.
      await rows.nth(1).getByLabel('Label').fill('Afternoon walk');
      await until(
        async () => (await rows.nth(1).locator('[data-break-kind="walk"]').count()) === 1,
      );
      await fact.getByRole('button', { name: 'Save breaks' }).click();
      await until(() => writes.length === 1);
      assert.deepEqual(writes[0]?.body, {
        breaks: [
          { label: 'Lunch', start: '12:00', end: '13:00', days: [ISO_TODAY] },
          { label: 'Afternoon walk', start: '16:00', end: '16:15', days: [1, 2, 3, 4, 5] },
        ],
      });
    } finally {
      await h.close();
    }
  });

  void test('a refused window carries the server’s message, on the window it names', async () => {
    const h = await organisation(
      orgStub('admin', [], {
        '/api/v1/org/time/breaks': reply(422, {
          error: {
            code: 'unprocessable',
            message: 'Invalid request body',
            details: {
              issues: [
                {
                  path: 'breaks.1',
                  message: 'overlaps breaks.0 (Lunch) on a day they share',
                  code: 'custom',
                },
              ],
            },
          },
        }),
      }),
    );
    try {
      const fact = h.page.locator('[data-fact="breaks"]');
      await fact.waitFor({ timeout: 10_000 });
      await fact.getByRole('button', { name: 'Edit breaks' }).click();
      await fact.getByRole('button', { name: 'Add your own' }).click();
      await fact.getByRole('button', { name: 'Add your own' }).click();
      const rows = fact.locator('[data-break-row]');
      await rows.nth(0).getByLabel('Label').fill('Lunch');
      await rows.nth(1).getByLabel('Label').fill('Late lunch');
      await fact.getByRole('button', { name: 'Save breaks' }).click();
      const issue = rows.nth(1).locator('[role="alert"]');
      await issue.waitFor({ timeout: 5_000 });
      assert.match(await issue.innerText(), /overlaps breaks\.0 \(Lunch\) on a day they share/);
      assert.equal(await rows.nth(0).locator('[role="alert"]').count(), 0);
      // Still editing: nothing was lost.
      assert.equal(await rows.count(), 2);
    } finally {
      await h.close();
    }
  });

  void test('a member reads the schedule and has nothing to change', async () => {
    const h = await organisation(orgStub('member', [LUNCH]));
    try {
      const fact = h.page.locator('[data-fact="breaks"]');
      await fact.waitFor({ timeout: 10_000 });
      assert.match(await fact.innerText(), /Lunch/);
      assert.equal(await fact.getByRole('button').count(), 0);
      assert.equal(await fact.locator('input').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a member, with no schedule: nothing is shown', async () => {
    const h = await organisation(orgStub('member', []));
    try {
      // The Time fact is drawn from the same answer, so the page has read it.
      await until(async () => (await h.page.locator('[data-fact="time"] dd').count()) === 1);
      assert.equal(await h.page.locator('[data-fact="breaks"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Time and breaks editors follow the live grant, with owner unchanged', async () => {
    for (const [role, actions, editable] of [
      ['admin', [], false],
      ['member', ['org.time.set'], true],
      ['owner', ['org.time.set'], true],
    ] as const) {
      const h = await organisation(
        orgStub(role, [LUNCH], { '/api/v1/permissions': permissions(role, actions) }),
      );
      try {
        const fact = h.page.locator('[data-fact="breaks"]');
        await fact.waitFor({ timeout: 10_000 });
        await until(
          async () =>
            (await fact.getByRole('button', { name: 'Edit breaks' }).count()) ===
            (editable ? 1 : 0),
        );
        assert.equal(
          await fact.getByRole('button', { name: 'Edit breaks' }).count(),
          editable ? 1 : 0,
        );
      } finally {
        await h.close();
      }
    }
  });

  void test('light and dark at 1440 and 390, editing: the page never scrolls sideways', async () => {
    const h = await organisation(orgStub('owner', [LUNCH]));
    try {
      const fact = h.page.locator('[data-fact="breaks"]');
      await fact.waitFor({ timeout: 10_000 });
      await fact.getByRole('button', { name: 'Edit breaks' }).click();
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          const spill = () =>
            h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          await until(async () => (await spill()) <= 0);
          assert.ok((await spill()) <= 0, `${theme} at ${String(width)}: sideways`);
        }
      }
    } finally {
      await h.close();
    }
  });
});
