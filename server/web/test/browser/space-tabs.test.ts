/**
 * Dashboard, Sprints and Timeline against the interaction contract (LAI-1195).
 *
 * The visual audit found dead metric cards, a red Delete on every sprint row,
 * a confirm that took no focus, a sprint key that read as a size chip, and a
 * Timeline whose zoom only a mouse could change. These tests hold each fix to
 * what a person does: follow a figure, create and edit a sprint and be told
 * what happened, zoom from the keyboard, and recover from a failed request.
 *
 * Expected values are counted from `space-tabs-fixture.ts` here, never by
 * calling the app's own derivations.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, reply, until, type StubCall } from './harness.ts';
import { at, METRICS_DAYS, SPRINTS, TASKS, spaceStub } from './space-tabs-fixture.ts';

void after(async () => {
  await closeBrowser();
});

const params = (href: string | null): URLSearchParams => {
  assert.ok(href !== null, 'a link with no href');
  const url = new URL(href, 'http://x');
  return url.searchParams;
};

const pathOf = (page: Page): string => new URL(page.url()).pathname;

/* ------------------------------------------------------------------ dashboard */

void describe('every dashboard figure opens the work it counts (LAI-1195)', () => {
  void test('four stat cards, four links, each to the List filtered as the figure is', async () => {
    const h = await open('/dashboard?project=expense', spaceStub());
    try {
      await h.page.locator('.dash-stat-link').first().waitFor({ timeout: 20_000 });
      const cards = h.page.locator('.dash-stats > .dash-stat');
      assert.equal(await cards.count(), 4, 'four stat cards');
      // No dead card: each has exactly one link that names its figure.
      for (const kind of ['done', 'touched', 'created', 'due']) {
        assert.equal(
          await h.page.locator(`.dash-stat-${kind} .dash-stat-link`).count(),
          1,
          `the ${kind} card has no link`,
        );
      }

      const done = params(
        await h.page.locator('.dash-stat-done .dash-stat-link').getAttribute('href'),
      );
      assert.equal(done.get('project'), 'expense');
      assert.equal(done.get('status'), 'done');
      assert.equal(done.get('updated'), '7d', 'the default range is the last 7 days');
      assert.equal(done.get('sprint'), 'all', 'the dashboard counts the whole space');

      const touched = params(
        await h.page.locator('.dash-stat-touched .dash-stat-link').getAttribute('href'),
      );
      assert.equal(touched.get('updated'), '7d');
      assert.equal(touched.get('sort'), 'updated');
      assert.equal(touched.get('status'), null, 'touched is every status');

      const created = params(
        await h.page.locator('.dash-stat-created .dash-stat-link').getAttribute('href'),
      );
      assert.equal(created.get('sort'), 'created');
      assert.equal(created.get('dir'), 'desc');

      const overdue = params(await h.page.locator('.dash-stat-overdue').getAttribute('href'));
      assert.equal(overdue.get('overdue'), 'true');
      // Overdue in the fixture: open work with a date before today.
      const today = at(0);
      const expectOverdue = TASKS.filter(
        (t) =>
          t.status !== 'done' && t.status !== 'cancelled' && t.due_on !== null && t.due_on < today,
      ).length;
      assert.equal(
        ((await h.page.locator('.dash-stat-overdue').textContent()) ?? '').trim(),
        `${String(expectOverdue)} overdue`,
      );

      // The range follows: All time drops the window from the links.
      await h.page.getByRole('button', { name: 'All time', exact: true }).click();
      await until(async () => {
        const href = await h.page.locator('.dash-stat-done .dash-stat-link').getAttribute('href');
        return !params(href).has('updated');
      });
      assert.equal(
        params(await h.page.locator('.dash-stat-done .dash-stat-link').getAttribute('href')).get(
          'updated',
        ),
        null,
        'all time has no updated window',
      );

      // And a click goes there in the app, without a reload.
      await h.page.locator('.dash-stat-touched .dash-stat-link').click();
      await until(() => pathOf(h.page) === '/list');
      assert.equal(pathOf(h.page), '/list');
      assert.equal(new URL(h.page.url()).searchParams.get('sort'), 'updated');
    } finally {
      await h.close();
    }
  });

  void test('throughput: each day is a keyboard stop and the readout names it', async () => {
    const h = await open('/dashboard?project=expense', spaceStub());
    try {
      const bars = h.page.locator('.dash-tp-bars > .dash-tp-bar');
      await bars.first().waitFor({ timeout: 20_000 });
      assert.equal(await bars.count(), METRICS_DAYS.length, 'one bar per day');
      // Every bar is focusable and named by its count.
      for (let i = 0; i < METRICS_DAYS.length; i += 1) {
        const bar = bars.nth(i);
        assert.equal(await bar.getAttribute('tabindex'), '0');
        assert.match(
          (await bar.getAttribute('aria-label')) ?? '',
          new RegExp(`: ${String(METRICS_DAYS[i])} completed$`),
        );
      }
      // The busiest day, focused from the keyboard: Tab from the bar before it.
      const peakAt = METRICS_DAYS.indexOf(Math.max(...METRICS_DAYS));
      await bars.nth(peakAt - 1).focus();
      await h.page.keyboard.press('Tab');
      assert.equal(
        await bars.nth(peakAt).evaluate((el) => el === document.activeElement),
        true,
        'Tab moves to the next day',
      );
      const readout = h.page.locator('.dash-tp-readout');
      await until(async () =>
        ((await readout.textContent()) ?? '').includes(`${String(METRICS_DAYS[peakAt])} completed`),
      );
      const said = (await readout.textContent()) ?? '';
      const label = (await bars.nth(peakAt).getAttribute('aria-label')) ?? '';
      assert.equal(said.replace(/\s+/g, ' ').trim(), label, 'the readout says the focused day');
    } finally {
      await h.close();
    }
  });

  void test('a failed throughput says so and Retry brings it back', async () => {
    const stub = spaceStub();
    const good = stub['/api/v1/projects/expense/metrics'];
    let fail = true;
    const h = await open('/dashboard?project=expense', {
      ...stub,
      '/api/v1/projects/expense/metrics': () =>
        fail ? refuse(503, 'unavailable', 'metrics are down') : good,
    });
    try {
      const alert = h.page.locator('.dash-throughput [role="alert"]');
      await alert.waitFor({ timeout: 20_000 });
      assert.match((await alert.textContent()) ?? '', /could not be loaded/);
      // The rest of the page is still there.
      assert.equal(await h.page.locator('.dash-stat-link').count(), 4);
      fail = false;
      await alert.getByRole('button', { name: 'Retry' }).click();
      await h.page.locator('.dash-tp-bars > .dash-tp-bar').first().waitFor({ timeout: 5_000 });
      assert.equal(await alert.count(), 0, 'the error is gone after a good retry');
    } finally {
      await h.close();
    }
  });
});

/* -------------------------------------------------------------------- sprints */

/** A sprints stub that records writes and answers them as the server would. */
function sprintsWorld(options: { readonly patchRefusal?: boolean } = {}) {
  const list = SPRINTS.map((s) => ({ ...s }));
  const writes: StubCall[] = [];
  const stub = {
    ...spaceStub(),
    '/api/v1/projects/expense/sprints': (call: StubCall) => {
      if (call.method === 'POST') {
        writes.push(call);
        const body = call.body as { name: string; starts_on: number; ends_on: number };
        const made = {
          ...SPRINTS[2]!,
          id: 's9',
          name: body.name,
          goal: null,
          starts_on: body.starts_on,
          ends_on: body.ends_on,
          status: 'planned',
        };
        list.push(made);
        return reply(201, made);
      }
      return { data: list, next_cursor: null };
    },
    '/api/v1/sprints/s3': (call: StubCall) => {
      writes.push(call);
      if (call.method === 'PATCH') {
        if (options.patchRefusal === true) {
          return refuse(409, 'conflict', 'Sprint 15 overlaps Sprint 14 — Receipts.');
        }
        const row = list.find((s) => s.id === 's3')!;
        Object.assign(row, call.body);
        return row;
      }
      return reply(204, null);
    },
  };
  return { stub, writes };
}

async function openSprints(stub: ReturnType<typeof sprintsWorld>['stub'], width = 1440) {
  const h = await open('/sprints?project=expense', stub);
  await h.page.setViewportSize({ width, height: 900 });
  await h.page.locator('.sprint-card').first().waitFor({ timeout: 20_000 });
  return h;
}

void describe('sprints: create and edit say what happened (LAI-1195)', () => {
  void test('create validates, focuses the field to fix, then reports the new sprint', async () => {
    const w = sprintsWorld();
    const h = await openSprints(w.stub);
    try {
      await h.page.getByRole('button', { name: 'New sprint' }).first().click();
      const name = h.page.locator('.sprint-form input[name="name"]');
      await until(() => name.evaluate((el) => el === document.activeElement));
      assert.equal(
        await name.evaluate((el) => el === document.activeElement),
        true,
        'opens on Name',
      );

      // Nothing filled: refused here, nothing sent, focus on the first problem.
      await h.page.getByRole('button', { name: 'Create sprint' }).click();
      await h.page.locator('#sprint-name-error').waitFor({ timeout: 5_000 });
      assert.equal(await name.getAttribute('aria-invalid'), 'true');
      assert.equal(await name.getAttribute('aria-describedby'), 'sprint-name-error');
      await until(() => name.evaluate((el) => el === document.activeElement));
      assert.equal(await name.evaluate((el) => el === document.activeElement), true);
      assert.equal(w.writes.length, 0, 'an invalid form sent a request');

      const start = new Date(at(30)).toISOString().slice(0, 10);
      const end = new Date(at(43)).toISOString().slice(0, 10);
      await name.fill('Sprint 16 — Reports');
      await h.page.locator('.sprint-form input[name="startsOn"]').fill(start);
      await h.page.locator('.sprint-form input[name="endsOn"]').fill(end);
      await h.page.getByRole('button', { name: 'Create sprint' }).click();

      const notice = h.page.locator('.sprint-notice[role="status"]');
      await notice.waitFor({ timeout: 5_000 });
      assert.match((await notice.textContent()) ?? '', /^Created Sprint 16 — Reports · /);
      assert.equal(w.writes.length, 1);
      assert.equal(w.writes[0]!.method, 'POST');
      assert.equal((w.writes[0]!.body as { name: string }).name, 'Sprint 16 — Reports');
      assert.equal(await h.page.locator('.sprint-form').count(), 0, 'the form closes on success');
      await until(async () => (await h.page.locator('.sprint-card').count()) === 4);
      assert.equal(await h.page.locator('.sprint-card').count(), 4, 'the new sprint is listed');
    } finally {
      await h.close();
    }
  });

  void test('edit saves and says so; a refusal keeps the form and shows the server', async () => {
    for (const refusal of [false, true]) {
      const w = sprintsWorld({ patchRefusal: refusal });
      const h = await openSprints(w.stub);
      try {
        await h.page.getByRole('button', { name: 'Edit Sprint 15 — Approvals' }).click();
        const name = h.page.locator('.sprint-form input[name="name"]');
        assert.equal(await name.inputValue(), 'Sprint 15 — Approvals', 'the form is prefilled');
        await name.fill('Sprint 15 — Approvals v2');
        await h.page.getByRole('button', { name: 'Save changes' }).click();
        await until(() => w.writes.length > 0);
        assert.equal(w.writes[0]?.method, 'PATCH');

        if (refusal) {
          const alert = h.page.locator('.sprint-alert[role="alert"]');
          await alert.waitFor({ timeout: 5_000 });
          assert.match((await alert.textContent()) ?? '', /overlaps Sprint 14/);
          assert.equal(await h.page.locator('.sprint-form').count(), 1, 'the form stays open');
          assert.equal(await h.page.locator('.sprint-notice').count(), 0, 'no success claimed');
        } else {
          const notice = h.page.locator('.sprint-notice[role="status"]');
          await notice.waitFor({ timeout: 5_000 });
          assert.match((await notice.textContent()) ?? '', /^Saved Sprint 15 — Approvals v2 · /);
          assert.equal(await h.page.locator('.sprint-form').count(), 0);
        }
      } finally {
        await h.close();
      }
    }
  });

  void test('delete asks first: the confirm takes focus, Escape keeps the sprint', async () => {
    const w = sprintsWorld();
    const h = await openSprints(w.stub);
    try {
      const del = h.page.getByRole('button', { name: 'Delete Sprint 15 — Approvals' });
      // Quiet on the row — not the danger style the confirm uses.
      assert.equal(
        await del.evaluate((el) => el.classList.contains('sprint-button-danger')),
        false,
      );
      await del.click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.waitFor({ timeout: 5_000 });
      const keep = dialog.getByRole('button', { name: 'Keep it' });
      await until(() => keep.evaluate((el) => el === document.activeElement));
      assert.equal(await keep.evaluate((el) => el === document.activeElement), true, 'focus moved');
      await h.page.keyboard.press('Escape');
      await until(async () => (await dialog.count()) === 0);
      assert.equal(await dialog.count(), 0, 'Escape closes the confirm');
      await until(() => del.evaluate((el) => el === document.activeElement));
      assert.equal(
        await del.evaluate((el) => el === document.activeElement),
        true,
        'focus returns',
      );
      assert.equal(w.writes.length, 0, 'nothing was deleted');
    } finally {
      await h.close();
    }
  });

  void test('the sprint key is named "Sprint N" and is not a bare letter chip', async () => {
    const h = await openSprints(sprintsWorld().stub);
    try {
      const keys = h.page.locator('.sprint-card .sprint-key');
      assert.deepEqual(await keys.allInnerTexts(), ['S1', 'S2', 'S3']);
      assert.equal(await keys.nth(1).getAttribute('aria-label'), 'Sprint 2');
      assert.equal(await keys.nth(1).locator('svg').count(), 1, 'the flag marks it as a sprint');
      // The header names the count, not the space's URL slug.
      assert.equal(await h.page.getByText('expense ·').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('at 390px every card fits the screen', async () => {
    const h = await openSprints(sprintsWorld().stub, 390);
    try {
      await until(async () =>
        h.page.evaluate(() =>
          [...document.querySelectorAll('.sprint-card *')].every(
            (el) => el.getBoundingClientRect().right <= window.innerWidth + 0.5,
          ),
        ),
      );
      const over = await h.page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.sprint-card *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
          .map((el) => el.className || el.tagName),
      );
      assert.deepEqual(over, [], 'something on a sprint card runs past a 390px screen');
    } finally {
      await h.close();
    }
  });
});

/* ------------------------------------------------------------------- timeline */

void describe('timeline: zoom from the keyboard, recover from a failure (LAI-1195)', () => {
  void test('+ and − on the focused chart change the zoom, and the buttons agree', async () => {
    const h = await open('/timeline?project=expense', spaceStub({ timeline: true }));
    try {
      await h.page.locator('.tlx-bar').first().waitFor({ timeout: 20_000 });
      const pressed = () => h.page.locator('.tlx-zoom-option[aria-pressed="true"]').textContent();
      assert.equal(await pressed(), 'Months', 'opens on Months');
      // The chart says how to use it.
      assert.equal(await h.page.locator('.tlx').getAttribute('aria-describedby'), 'tlx-keys');

      await h.page.locator('.tlx').focus();
      await h.page.keyboard.press('+');
      await until(async () => (await pressed()) === 'Weeks');
      assert.equal(await pressed(), 'Weeks');
      assert.equal(new URL(h.page.url()).searchParams.get('zoom'), 'weeks');

      await h.page.locator('.tlx').focus();
      await h.page.keyboard.press('-');
      await h.page.keyboard.press('-');
      await until(async () => (await pressed()) === 'Quarters');
      assert.equal(await pressed(), 'Quarters');
      // Out past the widest does nothing.
      await h.page.keyboard.press('-');
      assert.equal(await pressed(), 'Quarters');
      // The zoom group is labelled by its visible word.
      assert.equal(
        await h.page.locator('.tlx-zoom').getAttribute('aria-labelledby'),
        'tlx-zoom-label',
      );
    } finally {
      await h.close();
    }
  });

  void test('a failed sprint list offers Try again, and it works', async () => {
    const stub = spaceStub({ timeline: true });
    const good = stub['/api/v1/projects/expense/sprints'];
    let fail = true;
    const h = await open('/timeline?project=expense', {
      ...stub,
      '/api/v1/projects/expense/sprints': () =>
        fail ? refuse(503, 'unavailable', 'sprints are down') : good,
    });
    try {
      const retry = h.page.getByRole('button', { name: 'Try again' });
      await retry.waitFor({ timeout: 20_000 });
      fail = false;
      await retry.click();
      await h.page.locator('.tlx-bar').first().waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('.tlx-bar').count(), SPRINTS.length);
    } finally {
      await h.close();
    }
  });

  void test('at 390px the chart says it scrolls, and the page does not', async () => {
    const h = await open('/timeline?project=expense', spaceStub({ timeline: true }));
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('.tlx-bar').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.tlx-frame[data-more-right]').count()) === 1);
      assert.equal(
        await h.page.locator('.tlx-frame[data-more-right]').count(),
        1,
        'no cue that there is more to the right',
      );
      const overflow = await h.page.evaluate(() => {
        const main = document.querySelector('.shell-main') ?? document.scrollingElement!;
        return main.scrollWidth - main.clientWidth;
      });
      assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);
      // Later scrolls the chart, from a labelled button.
      const later = h.page.getByRole('button', { name: /^Later/ });
      const before = await h.page.locator('.tlx').evaluate((el) => el.scrollLeft);
      await later.click();
      await until(
        async () => (await h.page.locator('.tlx').evaluate((el) => el.scrollLeft)) > before,
      );
      assert.ok(
        (await h.page.locator('.tlx').evaluate((el) => el.scrollLeft)) > before,
        'Later did not scroll',
      );
    } finally {
      await h.close();
    }
  });
});
