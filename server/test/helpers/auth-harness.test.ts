import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INTERVAL_MS } from '../../src/services/activity-feed.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from './auth.ts';

/**
 * The harness disposes of what it creates (LAI-231).
 *
 * `authHarness` closed its database and left the activity feed's poll timer
 * armed. 250 ms later the timer fired, read a closed handle, and threw out of a
 * `setInterval` callback with nothing above it to catch it. Vitest reported it
 * as an unhandled error and failed the run — **while every assertion in the
 * suite passed.** The root gate exited 1 on `master` for a day and was read as
 * green, because `Tests 1685 passed` and `Failed` are adjacent lines and the
 * gate command printed one of them.
 *
 * That is why this file exists and why the second test below has no assertion
 * about a timer. A leaked timer is invisible to assertions — that is the whole
 * property. The only instrument that sees it is letting the clock run.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

beforeEach(async () => {
  h = authHarness();
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
});

afterEach(() => {
  h.close();
});

/** An SSE subscriber, opened the way a test that is not thinking about it does. */
async function openStream(): Promise<void> {
  const res = await h.app.request('/api/v1/events', {
    headers: jsonHeaders({ Cookie: cookie }),
  });
  expect(res.status).toBe(200);
}

describe('closing the harness', () => {
  it('disarms the poll timer and drops the subscriber', async () => {
    await openStream();

    // Without this the rest is vacuous: a harness that never armed a timer
    // "passes" the assertions below while proving nothing. This is the
    // precondition the original defect needed, stated so it cannot go missing.
    expect(h.activityFeed.isPolling(), 'no timer was armed, so nothing is being proved').toBe(true);
    expect(h.activityFeed.subscriberCount()).toBe(1);

    h.close();

    expect(h.activityFeed.isPolling()).toBe(false);
    expect(h.activityFeed.subscriberCount()).toBe(0);
  });

  it('survives the poll interval afterwards', async () => {
    await openStream();
    expect(h.activityFeed.isPolling(), 'no timer was armed, so nothing is being proved').toBe(true);

    h.close();

    // **No assertion follows on purpose.** If the timer is still armed it fires
    // during this wait, reads the closed handle, and throws from a callback with
    // no caller — which vitest reports as an unhandled error and fails the file
    // on. An assertion here would be testing something else.
    //
    // Three intervals rather than one: the timer is `unref`'d and the margin is
    // 750 ms against a 250 ms period, so a slow machine cannot turn a real leak
    // into a pass.
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_INTERVAL_MS * 3));
  });
});
