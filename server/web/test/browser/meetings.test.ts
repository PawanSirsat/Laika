/**
 * The Meetings page (LAI-1312) in a real browser, against a stubbed API.
 *
 * What only a browser can show: the list grouped by the reader's day with its
 * chips, the filter and search landing in the address, the transcript asked
 * for when its tab opens and not a moment before, each action ending in the
 * shared toast — *Open* to the review, *Undo* through the server's own undo —
 * the not-found and sync-off states, the sidebar offering Meetings only where
 * the instance syncs them, and the page fitting a 390px phone in both themes.
 *
 * Every page is pinned to 15:00 UTC today (`my-day-clock.ts`), so *today*,
 * *missed* and *upcoming* do not depend on the hour the suite runs.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  defaultPermissions,
  refuse,
  reply,
  setTheme,
  until,
  withHeaders,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { NOW, TODAY, open } from './my-day-clock.ts';

const HOUR = 3_600_000;
const MIN = 60_000;
/** A UTC time on today's date, as the pinned page counts it. */
const at = (hhmm: string, dayOffset = 0): number =>
  Date.parse(`${TODAY}T${hhmm}:00Z`) + dayOffset * 24 * HOUR;

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};
const OWNER = { ...ME, org_role: 'owner' };

const PROJECT = {
  id: 'p1',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const absent = { invited: true, joined_at: null, left_at: null, minutes: 0, time_entry_id: null };

function summary(id: string, title: string, start: number, over: Record<string, unknown> = {}) {
  return {
    id,
    title,
    organiser_email: 'grace@example.com',
    organiser_name: 'Grace Hopper',
    scheduled_start: start,
    scheduled_end: start + 30 * MIN,
    actual_start: null,
    actual_end: null,
    is_online: true,
    join_url: null,
    has_transcript: false,
    project: null,
    my_attendance: absent,
    ...over,
  };
}

/** Today 10:00, attended 10:04–10:41, a transcript, linked to Laika Core. */
const STANDUP = summary('m1', 'Daily stand-up', at('10:00'), {
  actual_start: at('10:02'),
  actual_end: at('10:41'),
  has_transcript: true,
  project: { id: 'p1', slug: 'laika-core', name: 'Laika Core' },
  my_attendance: {
    invited: true,
    joined_at: at('10:04'),
    left_at: at('10:41'),
    minutes: 37,
    time_entry_id: null,
  },
});
/** Today 09:00, invited, never joined: missed. */
const MISSED = summary('m2', 'Budget sync', at('09:00'));
/** Tomorrow, with a join link. */
const PLANNING = summary('m3', 'Sprint planning', at('11:00', 1), {
  join_url: 'https://teams.microsoft.com/l/meetup-join/abc',
});
/** Yesterday, attended, no space. */
const RETRO = summary('m4', 'Retro', at('14:00', -1), {
  my_attendance: {
    invited: true,
    joined_at: at('14:00', -1),
    left_at: at('14:30', -1),
    minutes: 30,
    time_entry_id: null,
  },
});

const LIST = [PLANNING, STANDUP, MISSED, RETRO];

function detail(row: ReturnType<typeof summary>, over: Record<string, unknown> = {}) {
  return {
    ...row,
    attendees: [
      {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        user_id: 'u1',
        invited: true,
        joined_at: row.my_attendance.joined_at,
        left_at: row.my_attendance.left_at,
        minutes: row.my_attendance.minutes,
        is_organiser: false,
        is_me: true,
      },
      {
        email: 'grace@example.com',
        name: 'Grace Hopper',
        user_id: null,
        invited: true,
        joined_at: at('10:02'),
        left_at: at('10:41'),
        minutes: 39,
        is_organiser: true,
        is_me: false,
      },
      {
        email: 'tomas@example.com',
        name: 'Tomas Nel',
        user_id: null,
        invited: true,
        joined_at: null,
        left_at: null,
        minutes: 0,
        is_organiser: false,
        is_me: false,
      },
    ],
    can_read_transcript: row.my_attendance.joined_at !== null,
    review: null,
    ...over,
  };
}

const ENTRY = {
  id: 'e1',
  day: TODAY,
  tz: 'UTC',
  started_at: at('10:04'),
  ended_at: at('10:41'),
  minutes: 37,
  source: 'manual',
  task: null,
  project: null,
  note: null,
  kind: 'meeting',
  title: 'Daily stand-up',
  description: null,
  revision: 1,
  created_at: NOW,
  updated_at: NOW,
};

function stub(over: ApiStub = {}, me: Record<string, unknown> = ME): ApiStub {
  const perms = defaultPermissions(me) as { me: { actions: string[] } };
  return {
    '/api/v1/setup/status': {
      setup_required: false,
      sign_in: 'microsoft',
      system: { database: 'SQLite · WAL', migrations_applied: 1, smtp_configured: false },
    },
    '/api/v1/me': me,
    '/api/v1/permissions': perms,
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/me/meetings': { enabled: true, data: LIST, next_cursor: null },
    '/api/v1/meetings/m1': detail(STANDUP),
    '/api/v1/meetings/m3': detail(PLANNING),
    '/api/v1/meetings/m1/transcript': {
      meeting_id: 'm1',
      lines: [
        { at_ms: 4_000, speaker: 'Grace Hopper', text: 'Morning. Board first.' },
        { at_ms: 247_000, speaker: 'Ada Lovelace', text: 'The release goes out today.' },
      ],
    },
    ...over,
  };
}

const rows = (h: Harness) => h.page.locator('.meetings-row');
const toastText = (h: Harness) => h.page.locator('[data-toast]').last().innerText();

async function ready(h: Harness): Promise<void> {
  await rows(h).first().waitFor({ timeout: 20_000 });
  await until(async () => (await rows(h).count()) === LIST.length);
}

void after(async () => {
  await closeBrowser();
});

void describe('the list', () => {
  void test('grouped by the reader’s day, each row with its time and chips', async () => {
    const h = await open('/meetings', stub());
    try {
      await ready(h);
      assert.deepEqual(await h.page.locator('.meetings-group-title').allInnerTexts(), [
        'TODAY',
        'YESTERDAY',
        'UPCOMING',
      ]);
      // Today reads next-first: 9:00 before 10:00.
      const today = h.page.locator('[data-group="today"] .meetings-row-title');
      assert.deepEqual(await today.allInnerTexts(), ['Budget sync', 'Daily stand-up']);

      const standup = h.page.locator('[data-meeting="m1"]');
      assert.match(await standup.innerText(), /10:00–10:30 AM/);
      assert.equal(
        await standup.locator('[data-chip="attended"]').innerText(),
        'Attended 10:04–10:41 AM',
      );
      assert.equal(await standup.locator('[data-chip="transcript"]').innerText(), 'Transcript');
      assert.equal(await standup.getByRole('img', { name: 'Teams meeting' }).count(), 1);
      assert.equal(
        await h.page.locator('[data-meeting="m2"] [data-chip="missed"]').innerText(),
        'Missed',
      );
      // Still to come is not missed.
      assert.equal(await h.page.locator('[data-meeting="m3"] [data-chip]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the sidebar offers Meetings beside My day, on ⌥2, where meetings sync', async () => {
    const h = await open('/my-day', stub());
    try {
      const link = h.page.locator('#sidebar .sidebar-link', { hasText: 'Meetings' });
      await link.waitFor({ timeout: 20_000 });
      const labels = await h.page.locator('#sidebar .sidebar-link').allInnerTexts();
      const at = (label: string) => labels.findIndex((l) => l.includes(label));
      assert.ok(at('My day') < at('Meetings') && at('Meetings') < at('Inbox'), labels.join('|'));
      await h.page.locator('body').click({ position: { x: 5, y: 5 } });
      await h.page.keyboard.press('Alt+Digit2');
      await h.page.waitForURL(/\/meetings/, { timeout: 5_000 });
      await ready(h);
    } finally {
      await h.close();
    }
  });

  void test('the filter and the search land in the address and in the request', async () => {
    const h = await open('/meetings', stub());
    try {
      await ready(h);
      await h.page.locator('[role="radio"][data-filter="attended"]').click();
      await h.page.waitForURL(/filter=attended/, { timeout: 5_000 });
      assert.equal(
        await h.page.locator('[role="radio"][data-filter="attended"]').getAttribute('aria-checked'),
        'true',
      );
      await until(() => h.requests.some((r) => r.url.includes('filter=attended')));
      assert.ok(h.requests.some((r) => r.url === '/api/v1/me/meetings?filter=attended'));

      await h.page.locator('.meetings-search-input').fill('stand');
      await h.page.waitForURL(/q=stand/, { timeout: 5_000 });
      await until(() => h.requests.some((r) => r.url.includes('q=stand')));
      assert.ok(
        h.requests.some((r) => r.url === '/api/v1/me/meetings?filter=attended&q=stand'),
        h.requests.map((r) => r.url).join('\n'),
      );
    } finally {
      await h.close();
    }
  });

  void test('arrows move through the list and Enter opens the row', async () => {
    const h = await open('/meetings', stub());
    try {
      await ready(h);
      await rows(h).first().focus();
      await h.page.keyboard.press('ArrowDown');
      const focused = await h.page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset.meeting,
      );
      assert.equal(focused, 'm1');
      await h.page.keyboard.press('Enter');
      await h.page.waitForURL(/meeting=m1/, { timeout: 5_000 });
      await h.page.locator('#meeting-title').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('one meeting', () => {
  void test('header, attendance you first, and the transcript asked for only when opened', async () => {
    const h = await open('/meetings?meeting=m1', stub());
    try {
      await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('#meeting-title').innerText(), 'Daily stand-up');
      const meta = await h.page.locator('.meetings-detail-meta').innerText();
      assert.match(meta, /Organised by Grace Hopper/);
      assert.match(meta, /Scheduled 10:00–10:30 AM · ran 10:02–10:41 AM/);

      const people = h.page.locator('.meetings-attendance tbody tr');
      assert.equal(await people.count(), 3);
      assert.match(await people.nth(0).innerText(), /Ada Lovelace\s*You/);
      assert.match(await people.nth(0).innerText(), /37 min/);
      assert.match(await people.nth(2).innerText(), /Didn’t join/);

      // Nothing has asked for the transcript yet.
      await h.page.waitForTimeout(300);
      assert.equal(h.calls.filter((c) => c.path.endsWith('/transcript')).length, 0);

      await h.page.locator('#meeting-tab-transcript').click();
      await h.page.locator('.meetings-line').first().waitFor({ timeout: 5_000 });
      assert.equal(h.calls.filter((c) => c.path.endsWith('/transcript')).length, 1);
      assert.match(
        await h.page.locator('.meetings-transcript-note').innerText(),
        /Only people in the meeting can read this/,
      );
      const first = await h.page.locator('.meetings-line').first().innerText();
      assert.match(first, /0:04/);
      assert.match(first, /Grace Hopper/);
      await h.page.locator('.meetings-transcript-search input').fill('release');
      await until(async () => (await h.page.locator('.meetings-line').count()) === 1);
      assert.match(await h.page.locator('.meetings-line').innerText(), /4:07/);

      // The Review tab, with no review yet, offers the action.
      await h.page.locator('#meeting-tab-review').click();
      await h.page.locator('.meetings-review-none').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('a refused transcript says why in words, keyed by the server’s reason', async () => {
    const refusal = (status: number, code: string, reason: string) =>
      reply(status, { error: { code, message: 'Refused', details: { reason } } });
    for (const [status, code, reason, words] of [
      [403, 'forbidden', 'not_attended', /Only people in the meeting can read this/],
      [404, 'not_found', 'no_transcript', /No transcript/],
      [503, 'unavailable', 'meetings_sync_off', /Meetings sync is off/],
    ] as const) {
      const h = await open(
        '/meetings?meeting=m1',
        stub({ '/api/v1/meetings/m1/transcript': refusal(status, code, reason) }),
      );
      try {
        await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
        await h.page.locator('#meeting-tab-transcript').click();
        const state = h.page.locator(`.meetings-transcript[data-transcript="${reason}"]`);
        await state.waitFor({ timeout: 5_000 });
        assert.match(await state.innerText(), words);
      } finally {
        await h.close();
      }
    }
  });

  void test('Review with AI ends in a toast whose Open goes to the review', async () => {
    let reviewed = false;
    const h = await open(
      '/meetings?meeting=m1',
      stub({
        '/api/v1/meetings/m1': () =>
          detail(
            STANDUP,
            reviewed
              ? {
                  review: {
                    id: 'r1',
                    status: 'pending',
                    proposals: 6,
                    created_at: NOW,
                    project_slug: 'laika-core',
                  },
                }
              : {},
          ),
        '/api/v1/meetings/m1/review': () => {
          reviewed = true;
          return { review_id: 'r1', proposals: 6, project_slug: 'laika-core' };
        },
      }),
    );
    try {
      await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
      await h.page
        .locator('.meetings-actions')
        .getByRole('button', { name: 'Review with AI' })
        .click();
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });
      assert.match(await toastText(h), /Review ready — 6 proposals/);
      assert.ok(
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/meetings/m1/review'),
      );
      // The Review tab shows it once read again.
      await h.page.locator('.meetings-review[data-review="r1"]').waitFor({ timeout: 5_000 });
      assert.match(await h.page.locator('.meetings-review').innerText(), /6 proposals/);

      await h.page.locator('[data-toast]').getByRole('button', { name: 'Open' }).click();
      await h.page.waitForURL(/\/meeting-review\?project=laika-core/, { timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('Review with AI waits for a space, and says why', async () => {
    const h = await open(
      '/meetings?meeting=m1',
      stub({ '/api/v1/meetings/m1': detail({ ...STANDUP, project: null }) }),
    );
    try {
      await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
      const button = h.page
        .locator('.meetings-actions')
        .getByRole('button', { name: 'Review with AI' });
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      assert.match(await h.page.locator('.meetings-actions').innerText(), /Link a space first/);
    } finally {
      await h.close();
    }
  });

  void test('Add to My day ends in a toast whose Undo is the server’s undo', async () => {
    const h = await open(
      '/meetings?meeting=m1',
      stub({
        '/api/v1/meetings/m1/log-time': withHeaders(ENTRY, { 'X-Undo-Id': 'undo-1' }),
        '/api/v1/me/time/undo': { ok: true },
      }),
    );
    try {
      await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Add to My day' }).click();
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });
      assert.match(await toastText(h), /Added 37 min to My day/);
      const sent = h.calls.find((c) => c.path === '/api/v1/meetings/m1/log-time');
      assert.equal(sent?.method, 'POST');
      assert.equal((sent?.body as { tz: string }).tz, 'UTC');

      await h.page.locator('[data-toast]').getByRole('button', { name: 'Undo' }).click();
      await until(() => h.calls.some((c) => c.path === '/api/v1/me/time/undo'));
      const undone = h.calls.find((c) => c.path === '/api/v1/me/time/undo');
      assert.deepEqual(undone, {
        method: 'POST',
        path: '/api/v1/me/time/undo',
        body: { id: 'undo-1' },
      });
    } finally {
      await h.close();
    }
  });

  void test('an error is a toast that stays, with the server’s sentence', async () => {
    const h = await open(
      '/meetings?meeting=m1',
      stub({
        '/api/v1/meetings/m1/log-time': refuse(
          409,
          'conflict',
          'This meeting is already on your day',
        ),
      }),
    );
    try {
      await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Add to My day' }).click();
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });
      const text = await toastText(h);
      assert.match(text, /Couldn’t add it to My day/);
      assert.match(text, /This meeting is already on your day/);
    } finally {
      await h.close();
    }
  });

  void test('an upcoming meeting opens in Teams; a past one does not offer it', async () => {
    const h = await open('/meetings?meeting=m3', stub());
    try {
      await h.page.locator('#meeting-title').waitFor({ timeout: 20_000 });
      const join = h.page.getByRole('link', { name: 'Open in Teams' });
      assert.equal(await join.getAttribute('href'), PLANNING.join_url);
      assert.equal(await join.getAttribute('target'), '_blank');
      assert.equal(await h.page.getByRole('button', { name: 'Add to My day' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a meeting the reader was not on is not found', async () => {
    const h = await open(
      '/meetings?meeting=nope',
      stub({ '/api/v1/meetings/nope': refuse(404, 'not_found', 'No such meeting') }),
    );
    try {
      await h.page.locator('.meetings-detail[data-missing]').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.meetings-detail').innerText(), /No such meeting/);
    } finally {
      await h.close();
    }
  });
});

void describe('an instance that does not sync meetings', () => {
  const off = { '/api/v1/me/meetings': { enabled: false, data: [], next_cursor: null } };

  void test('a member is told it is the organisation’s to turn on, and the rail has no entry', async () => {
    const h = await open('/meetings', stub(off));
    try {
      await h.page.locator('[data-sync-off="member"]').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.meetings-off').innerText(),
        /Your organisation hasn’t turned on Teams meetings/,
      );
      await h.page.locator('#sidebar .sidebar-link', { hasText: 'My day' }).waitFor();
      await h.page.waitForTimeout(300);
      assert.equal(
        await h.page.locator('#sidebar .sidebar-link', { hasText: 'Meetings' }).count(),
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('an owner is told how, with the permissions the instance names', async () => {
    const h = await open(
      '/meetings',
      stub(
        {
          ...off,
          '/api/v1/org/sso': {
            sign_in: 'microsoft',
            microsoft: {
              tenant_id: 't',
              client_id: 'c',
              redirect_uri: 'https://laika.example/api/v1/auth/microsoft/callback',
              directory_sync: { enabled: false, every_minutes: 60, last_run: null },
              meetings_sync: {
                enabled: false,
                every_minutes: 15,
                permissions: ['Calendars.Read', 'OnlineMeetingTranscript.Read.All'],
                last_run: null,
              },
            },
          },
        },
        OWNER,
      ),
    );
    try {
      await h.page.locator('[data-sync-off="owner"]').waitFor({ timeout: 20_000 });
      await h.page.locator('.meetings-off-steps').waitFor({ timeout: 5_000 });
      const text = await h.page.locator('.meetings-off').innerText();
      assert.match(text, /LAIKA_MICROSOFT_MEETINGS_SYNC=true/);
      assert.match(text, /Calendars\.Read/);
      assert.match(text, /OnlineMeetingTranscript\.Read\.All/);
    } finally {
      await h.close();
    }
  });

  void test('on a password instance nobody asks about meetings at all', async () => {
    const h = await open(
      '/my-day',
      stub({
        '/api/v1/setup/status': {
          setup_required: false,
          sign_in: 'email',
          system: { database: 'SQLite · WAL', migrations_applied: 1, smtp_configured: false },
        },
      }),
    );
    try {
      await h.page.locator('#sidebar .sidebar-link', { hasText: 'My day' }).waitFor({
        timeout: 20_000,
      });
      await h.page.waitForTimeout(500);
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/me/meetings').length, 0);
      assert.equal(
        await h.page.locator('#sidebar .sidebar-link', { hasText: 'Meetings' }).count(),
        0,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a phone', () => {
  void test('at 390px the list and the meeting stack, nothing scrolls sideways, in both themes', async () => {
    const h = await open('/meetings', stub(), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
      },
    });
    try {
      await ready(h);
      const overflow = () =>
        h.page.evaluate(() => {
          const main = document.getElementById('main');
          const doc = document.documentElement;
          return Math.max(
            doc.scrollWidth - doc.clientWidth,
            main === null ? 0 : main.scrollWidth - main.clientWidth,
          );
        });
      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        assert.equal(await overflow(), 0, `${theme}: the list scrolls sideways`);
        assert.equal(await h.page.locator('.meetings-detail-pane').isVisible(), false);

        await rows(h).nth(1).click();
        await h.page.locator('#meeting-title').waitFor({ timeout: 5_000 });
        assert.equal(
          await rows(h).first().isVisible(),
          false,
          `${theme}: the list stayed beside it`,
        );
        assert.equal(await overflow(), 0, `${theme}: the meeting scrolls sideways`);
        // Text has a colour in this theme, not the transparent of a missing token.
        const colour = await h.page
          .locator('#meeting-title')
          .evaluate((el) => getComputedStyle(el).color);
        assert.notEqual(colour, 'rgba(0, 0, 0, 0)');

        await h.page.getByRole('button', { name: 'All meetings' }).click();
        await rows(h).first().waitFor({ state: 'visible', timeout: 5_000 });
      }
    } finally {
      await h.close();
    }
  });
});
