import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { pick } from './dropdown.ts';
import { closeBrowser, until, type ApiStub, type Harness, type StubCall } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { SETTINGS, viewOf, weekData, weekStub } from './my-day-week.ts';

/**
 * The sky behind the hours (LAI-895, D-106): day and night from where the
 * person is, which they set themselves. The clock is pinned to 15:00 UTC and
 * the day's zone is UTC, so New Delhi's sun — up before 02:00 UTC, down
 * between 11:30 and 14:00 UTC the year round — leaves 9 AM in the day and
 * 4 PM in the night on any date.
 */

function stub(place: string | null | undefined, writes?: StubCall[]): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  let settings: Record<string, unknown> = { ...SETTINGS, place };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    settings,
  });
  routes['/api/v1/me/time-settings'] = (call: StubCall) => {
    if (call.method === 'PUT') {
      writes?.push(call);
      settings = { ...settings, ...(call.body as object) };
    }
    return settings;
  };
  return routes;
}

async function myDay(place: string | null | undefined, writes?: StubCall[]): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(place, writes));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-block-id]').first().waitFor({ timeout: 10_000 });
  return h;
}

void after(async () => {
  await closeBrowser();
});

void describe('the sky on the Timeline', () => {
  void test('with a place set: day and night phases, a sun on 9 AM and a moon on 4 PM', async () => {
    const h = await myDay('Asia/Kolkata');
    try {
      await h.page.locator('[data-zoom="1"]').click();
      await until(async () => (await h.page.locator('[data-sky="day"]').count()) === 1);
      assert.equal(await h.page.locator('[data-sky="day"]').count(), 1);
      assert.ok((await h.page.locator('[data-sky="night"]').count()) >= 1, 'no night');
      assert.equal(await h.page.locator('[data-sky="dusk"]').count(), 1, 'no dusk');
      const nine = h.page.locator('.dayline-axis-hour', { hasText: '9 AM' });
      assert.equal(await nine.getAttribute('data-glyph'), 'sun');
      assert.equal(await nine.locator('.dayline-axis-sun').count(), 1);
      const four = h.page.locator('.dayline-axis-hour', { hasText: '4 PM' });
      assert.equal(await four.getAttribute('data-glyph'), 'moon');
      assert.equal(await four.locator('.dayline-axis-moon').count(), 1);
      // Paint only: nothing in the sky takes the pointer.
      assert.equal(
        await h.page
          .locator('[data-sky]')
          .first()
          .evaluate((el) => getComputedStyle(el).pointerEvents),
        'none',
      );
    } finally {
      await h.close();
    }
  });

  void test('with no place and a zone the list does not know: no sky and no glyph', async () => {
    const h = await myDay(null);
    try {
      await h.page.locator('.dayline-axis-hour').first().waitFor();
      assert.equal(await h.page.locator('[data-sky]').count(), 0);
      assert.equal(await h.page.locator('.dayline-axis-sun, .dayline-axis-moon').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Where you are writes the place, and the sky follows the answer', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(null, writes);
    try {
      // Where you are sits in the header's Day settings (LAI-502).
      await h.page.locator('[data-day-settings] > button').click();
      const control = h.page.locator('[data-where-you-are]');
      await control.waitFor();
      assert.equal(await h.page.locator('[data-sky]').count(), 0);
      await pick(control.getByRole('combobox'), 'Asia/Kolkata');
      await until(() => writes.length === 1);
      assert.equal(writes[0]?.method, 'PUT');
      assert.deepEqual(writes[0]?.body, { place: 'Asia/Kolkata' });
      await until(async () => (await h.page.locator('[data-sky]').count()) > 0);
      assert.ok(
        (await h.page.locator('[data-sky="night"]').count()) >= 1,
        'the sky did not follow',
      );
    } finally {
      await h.close();
    }
  });
});
