/**
 * The Time report in a real browser (D-130, LAI-1138), on the pinned clock:
 *
 *  - Insights → Time for an owner: the organisation's report, people A–Z,
 *    the Member filter narrowing the read on the server, drafts asked for
 *    only when the reader turns them on (D-088 items 2–3), the bars walked
 *    with the arrow keys, and the CSV fetched from the server;
 *  - a space admin's weeks (D-136, D-138): one space, whole weeks, a withheld
 *    week said in words, and no table, donut or drafts switch;
 *  - a member: no Time tab, and a link to it refused;
 *  - every state — loading, empty, nothing matching, nothing confirmed,
 *    drafts only, the server's sentence on an error, and too many rows;
 *  - both themes at 1440 and 390, nothing wider than the page, and none of the
 *    design's sample data on it.
 *
 * Screenshots of each scope and state land in `LAIKA_SHOTS` when it is set.
 *
 * `/time/report` is answered by `page.route`, which sees the whole query —
 * the stub server matches paths, and the query is what this report is about.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page, Route } from 'playwright';
import type { SpaceWeeksReport, TimeReport, TimeReportRow } from '../../src/api/time.ts';
import { TIME_REPORT_SAMPLES } from '../helpers/prototype-samples.ts';
import { closeBrowser, refuse, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { NOW, open, TODAY } from './my-day-clock.ts';
import { LAIKA, ONROUTE } from './capacity-org.ts';
import { addDays, reportRoutes, weekData, weekStub } from './my-day-week.ts';

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const ADA = { id: 'u1', name: 'Ada Lovelace', deactivated: false };
const ZOE = { id: 'u3', name: 'Zoe Zimmer', deactivated: false };
const BEN = { id: 'u4', name: 'Ben Achebe', deactivated: false };
const SPACE_A = { id: LAIKA.id, slug: LAIKA.slug, name: LAIKA.name };
const SPACE_B = { id: ONROUTE.id, slug: ONROUTE.slug, name: ONROUTE.name };

const ME = (role: string) => ({
  id: 'u1',
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  org_role: role,
  is_active: true,
  memberships: [{ project_id: 'p1', role: role === 'member' ? 'member' : 'lead' }],
});

function permissions(role: string, actions: readonly string[], lead: boolean): unknown {
  return {
    org_roles: ['owner', 'admin', 'member', 'viewer'],
    project_roles: ['lead', 'member', 'viewer'],
    permissions: [],
    me: {
      org_role: role,
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: null,
      actions: ['project.read', 'task.watch', ...actions],
      projects: [
        {
          project_id: 'p1',
          role: lead ? 'lead' : 'member',
          actions: lead ? ['project.read', 'time.report.read_project'] : ['project.read'],
        },
      ],
    },
  };
}

function base(role: string, actions: readonly string[], lead: boolean): ApiStub {
  return {
    '/api/v1/me': ME(role),
    '/api/v1/permissions': permissions(role, actions, lead),
    '/api/v1/projects': { data: [LAIKA, ONROUTE], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/unlisted': { data: [], next_cursor: null },
  };
}

const OWNER_STUB = (): ApiStub =>
  base('owner', ['time.report.read', 'people.analytics.read', 'audit_log.export'], true);
const LEAD_STUB = (): ApiStub => base('member', [], true);
const MEMBER_STUB = (): ApiStub => base('member', [], false);

const days = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** The organisation's rows: Zoe logs the most, and must still be listed last. */
const ORG_ROWS: readonly TimeReportRow[] = [
  {
    project: SPACE_A,
    user: ZOE,
    task: { id: 't1', key: 'LAI-1', title: 'Search matches keys' },
    untied: false,
    kind: 'work',
    confirmed_minutes: 900,
    drafted_minutes: 60,
  },
  {
    project: SPACE_A,
    user: ADA,
    task: { id: 't2', key: 'LAI-2', title: 'Webhook retries back off' },
    untied: false,
    kind: 'review',
    confirmed_minutes: 240,
    drafted_minutes: 0,
  },
  {
    project: SPACE_B,
    user: BEN,
    task: null,
    untied: false,
    kind: 'meeting',
    confirmed_minutes: 120,
    drafted_minutes: 30,
  },
  {
    project: null,
    user: ADA,
    task: null,
    untied: true,
    kind: null,
    confirmed_minutes: 0,
    drafted_minutes: 45,
  },
];

type Shape = 'full' | 'empty' | 'drafts-only';

function orgReport(url: URL, shape: Shape = 'full'): TimeReport {
  const from = url.searchParams.get('from') ?? TODAY;
  const to = url.searchParams.get('to') ?? TODAY;
  const members = url.searchParams.get('members')?.split(',');
  const kinds = url.searchParams.get('kinds')?.split(',');
  const spaces = url.searchParams.get('spaces')?.split(',');
  let rows = ORG_ROWS.filter(
    (r) =>
      (members === undefined || members.includes(r.user.id)) &&
      (spaces === undefined || (r.project !== null && spaces.includes(r.project.slug))) &&
      (kinds === undefined || (r.kind !== null && kinds.includes(r.kind))),
  );
  if (shape === 'empty') rows = [];
  // As the server: drafts only on request (SPEC §6.4, `drafts=exclude` by default).
  const withDrafts = url.searchParams.get('drafts') === 'include';
  if (shape === 'drafts-only')
    rows = rows.map((r) => ({
      ...r,
      confirmed_minutes: 0,
      drafted_minutes: r.drafted_minutes + 30,
    }));
  if (!withDrafts) {
    rows = rows.map((r) => ({ ...r, drafted_minutes: 0 })).filter((r) => r.confirmed_minutes > 0);
  }
  const c = rows.reduce((n, r) => n + r.confirmed_minutes, 0);
  const d = rows.reduce((n, r) => n + r.drafted_minutes, 0);
  const span = days(from, to).filter((x) => x <= TODAY);
  // Spread the totals over the last five days so far, a remainder on today.
  const active = span.slice(-5);
  const by_day = days(from, to).map((day) => {
    const i = active.indexOf(day);
    if (i < 0) return { day, confirmed_minutes: 0, drafted_minutes: 0 };
    const share = (total: number) =>
      i === active.length - 1
        ? total - Math.floor(total / active.length) * (active.length - 1)
        : Math.floor(total / active.length);
    return { day, confirmed_minutes: share(c), drafted_minutes: share(d) };
  });
  return {
    from,
    to,
    days: by_day.length,
    scope: 'people',
    include_drafts: withDrafts,
    totals: {
      confirmed_minutes: c,
      drafted_minutes: d,
      meeting_minutes: rows
        .filter((r) => r.kind === 'meeting')
        .reduce((n, r) => n + r.confirmed_minutes, 0),
      manual_minutes: 0,
      active_days: by_day.filter((x) => x.confirmed_minutes + x.drafted_minutes > 0).length,
      people: new Set(rows.map((r) => r.user.id)).size,
    },
    agent_minutes:
      members === undefined && kinds === undefined && spaces === undefined ? 135 : null,
    by_day,
    rows,
  };
}

function weeksReport(url: URL): SpaceWeeksReport {
  const from = url.searchParams.get('from') ?? TODAY;
  const to = url.searchParams.get('to') ?? TODAY;
  const all = days(from, to);
  const weeks = [];
  for (let i = 0; i < all.length; i += 7) {
    weeks.push({
      from: all[i] ?? '',
      to: all[i + 6] ?? '',
      // Every other week is under the floor.
      confirmed_minutes: (i / 7) % 2 === 0 ? 1500 + i * 10 : null,
      people: (i / 7) % 2 === 0 ? 5 : 2,
    });
  }
  return { from, to, scope: 'space_totals', project: SPACE_A, weeks };
}

type Answer = (url: URL) => { status: number; body: unknown; headers?: Record<string, string> };

/** Answer `/time/report` from `answer`, recording every URL asked. */
async function routeReport(page: Page, asked: URL[], answer: Answer): Promise<void> {
  await page.route('**/api/v1/time/report?**', async (route: Route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const a = answer(url);
    const csv = url.searchParams.get('format') === 'csv';
    await route.fulfill({
      status: a.status,
      contentType: csv && a.status === 200 ? 'text/csv; charset=utf-8' : 'application/json',
      headers: a.headers ?? {},
      body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body),
    });
  });
}

const ok = (body: unknown) => ({ status: 200, body });

async function openWith(
  path: string,
  stub: ApiStub,
  asked: URL[],
  answer: Answer,
  width = 1440,
): Promise<Harness> {
  return open(path, stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 1000 });
      await routeReport(page, asked, answer);
    },
  });
}

async function done(h: Harness): Promise<void> {
  // A route still holding a request when the page closes fails the run (memory: unrouteAll first).
  await h.page.unrouteAll({ behavior: 'ignoreErrors' });
  await h.close();
}

async function noSideways(page: Page, width: number): Promise<void> {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= width, `the page is ${String(wide)}px wide at ${String(width)}`);
}

async function noSamples(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  assert.deepEqual(
    TIME_REPORT_SAMPLES.filter((n) => text.includes(n)),
    [],
    'the design’s sample data is on the page',
  );
}

after(async () => {
  await closeBrowser();
});

void describe('Insights → Time, an owner (frames 1g–1i)', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: the organisation's report, people A–Z, nothing sideways`, async () => {
        const asked: URL[] = [];
        const h = await openWith(
          '/insights?tab=time',
          OWNER_STUB(),
          asked,
          (u) => ok(orgReport(u)),
          width,
        );
        try {
          await setTheme(h.page, theme);
          const tr = h.page.locator('[data-time-report="org"]');
          await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
          assert.equal(
            await h.page
              .locator('nav[aria-label="Insights sections"] a[aria-current="page"]')
              .innerText(),
            'Time',
          );
          // The last 30 days, everyone, and nobody's drafts (D-088 items 2–3).
          const first = asked[0];
          assert.ok(first !== undefined);
          assert.equal(
            first.searchParams.get('members'),
            null,
            'the organisation is not asked by name',
          );
          assert.equal(first.searchParams.get('drafts'), null, 'drafts were asked for unasked');
          assert.equal(await tr.locator('[data-tr-day]').count(), 30);
          assert.match(
            await tr.locator('[data-tr-caption]').innerText(),
            /^Everyone in Borealis Labs · /,
          );
          // Space → Member: Laika first, its people A–Z though Zoe logged the most.
          const kids = await tr
            .locator('[data-tr-row="p1"] [data-tr-child]')
            .evaluateAll((els) => els.map((el) => el.getAttribute('data-tr-child')));
          assert.deepEqual(kids, ['u1', 'u3'], 'people are not listed A–Z');
          assert.match(await tr.locator('[data-tr-total]').innerText(), /21:00/);
          assert.match(await tr.locator('[data-tr-stat="drafts"]').innerText(), /—/);
          assert.match(
            await tr.locator('[data-tr-agent]').innerText(),
            /135 min on cards — beside people’s hours, never added to them/,
          );
          // No ranking, no utilisation, no money.
          const text = await tr.innerText();
          assert.doesNotMatch(text, /utili[sz]|\$|€|£|rank/i);
          await noSideways(h.page, width);
          await noSamples(h.page);
          await shoot(h.page, `org-${theme}-${String(width)}`);
        } finally {
          await done(h);
        }
      });
    }
  }

  void test('drafts: none asked for until Include drafts, then asked; the Member filter narrows on the server', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) => ok(orgReport(u)));
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      // Confirmed only to start: no drafts param, no drafted figure or column.
      assert.equal(
        await tr.locator('[data-tr-drafts="exclude"]').getAttribute('aria-checked'),
        'true',
      );
      assert.ok(asked.length > 0);
      assert.ok(
        asked.every((u) => !u.searchParams.has('drafts')),
        'a read asked for drafts before the reader did',
      );
      assert.match(await tr.locator('[data-tr-stat="tracked"]').innerText(), /\n21 h\n/);
      assert.match(await tr.locator('[data-tr-stat="drafts"]').innerText(), /\n—\n/);
      assert.equal(
        await tr.locator('.trep-row-head [role="columnheader"]').count(),
        2,
        'a Drafted column with nothing asked',
      );
      // Include drafts: now, and only now, the read asks for them.
      await tr.locator('[data-tr-drafts="include"]').click();
      await until(() => asked.some((u) => u.searchParams.get('drafts') === 'include'));
      assert.ok(asked.some((u) => u.searchParams.get('drafts') === 'include'));
      await until(async () =>
        (await tr.locator('[data-tr-stat="tracked"]').innerText()).includes('23 h 15 min'),
      );
      assert.match(await tr.locator('[data-tr-stat="tracked"]').innerText(), /23 h 15 min/);
      assert.match(await tr.locator('[data-tr-stat="drafts"]').innerText(), /2 h 15 min/);
      assert.equal(await tr.locator('.trep-row-head [role="columnheader"]').count(), 4);
      // A draft with no kind is its own row under Kind, never Work's.
      await tr.locator('[data-tr-group="first"]').click();
      await tr.locator('[data-tr-group-option="kind"]').click();
      await tr.locator('[data-tr-row="no-kind"]').waitFor({ timeout: 5_000 });
      assert.match(await tr.locator('[data-tr-row="no-kind"]').innerText(), /No kind yet/);
      assert.match(await tr.locator('[data-tr-row="work"]').innerText(), /15:00/);
      await tr.locator('[data-tr-drafts="exclude"]').click();

      // Member: Ben only — asked by id, and the agent line goes (it cannot be split).
      await tr.locator('[data-tr-chip="member"]').click();
      await tr.locator('[data-tr-option="u4"] input').check();
      await until(() => asked.some((u) => u.searchParams.get('members') === 'u4'));
      await until(async () => (await tr.locator('[data-tr-row]').count()) === 1);
      assert.equal(await tr.locator('[data-tr-agent]').count(), 0);
      // Escape closes the panel and gives focus back to the chip.
      await h.page.keyboard.press('Escape');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-tr-chip')),
        'member',
      );
    } finally {
      await done(h);
    }
  });

  void test('the bars: arrow keys move one day, Home and End the ends, each says its day', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) => ok(orgReport(u)));
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      const bars = tr.locator('[data-tr-day]');
      assert.equal(
        await tr.locator('[data-tr-day][tabindex="0"]').count(),
        1,
        'not one roving stop',
      );
      await tr.locator(`[data-tr-day="${TODAY}"]`).focus();
      await h.page.keyboard.press('ArrowLeft');
      const focused = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-tr-day'));
      assert.equal(await focused(), addDays(TODAY, -1));
      // Confirmed only: a bar says nothing of drafts.
      assert.match(
        (await bars.nth(28).getAttribute('aria-label')) ?? '',
        /tracked, [^,]* confirmed$/,
      );
      await h.page.keyboard.press('Home');
      assert.equal(await focused(), addDays(TODAY, -29));
      await h.page.keyboard.press('End');
      assert.equal(await focused(), TODAY);
      // A table says the same for a screen reader.
      assert.equal(await tr.locator('[data-tr-day-table] tbody tr').count(), 30);
      assert.doesNotMatch(await tr.locator('.trep-legend').innerText(), /Drafted/);
      // Drafts asked for: each bar names them, and the legend says how they are drawn.
      await tr.locator('[data-tr-drafts="include"]').click();
      await until(async () =>
        ((await bars.nth(28).getAttribute('aria-label')) ?? '').endsWith('drafted'),
      );
      assert.match(
        (await bars.nth(28).getAttribute('aria-label')) ?? '',
        /tracked, .* confirmed, .* drafted$/,
      );
      assert.match(await tr.locator('.trep-legend').innerText(), /Drafted/);
    } finally {
      await done(h);
    }
  });

  void test('Group by: Swap turns Space → Member into Member → Space; Escape closes the menu', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) => ok(orgReport(u)));
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-row]').first().waitFor({ timeout: 20_000 });
      await tr.locator('[data-tr-swap]').click();
      const rows = await tr
        .locator('[data-tr-row]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-tr-row')));
      assert.deepEqual(rows, ['u1', 'u4', 'u3'], 'people are not A–Z');
      assert.match(await tr.locator('.trep-quiet.trep-small').innerText(), /People are listed A–Z/);
      await tr.locator('[data-tr-group="second"]').click();
      await tr.locator('[role="menu"]').waitFor();
      await h.page.keyboard.press('Escape');
      assert.equal(await tr.locator('[role="menu"]').count(), 0);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-tr-group')),
        'second',
      );
    } finally {
      await done(h);
    }
  });

  void test('Export CSV downloads the server’s file for the same report', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) =>
      u.searchParams.get('format') === 'csv'
        ? {
            status: 200,
            body: 'day,space,task_key,task_title,person,kind,confirmed_minutes,drafted_minutes\n',
            headers: { 'content-disposition': 'attachment; filename="server-named.csv"' },
          }
        : ok(orgReport(u)),
    );
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      const download = h.page.waitForEvent('download');
      await tr.locator('[data-tr-export]').click();
      const file = await download;
      // The server's name, exactly — not one the browser made up.
      assert.equal(file.suggestedFilename(), 'server-named.csv');
      const csv = asked.find((u) => u.searchParams.get('format') === 'csv');
      const json = asked.find((u) => !u.searchParams.has('format'));
      assert.ok(csv !== undefined, 'the server’s CSV was not asked for');
      assert.ok(json !== undefined);
      // The same report: the same stretch, and drafts only as the screen counts them.
      assert.equal(csv.searchParams.get('from'), json.searchParams.get('from'));
      assert.equal(csv.searchParams.get('to'), json.searchParams.get('to'));
      assert.equal(csv.searchParams.get('drafts'), null);
    } finally {
      await done(h);
    }
  });
});

void describe('a space admin’s weeks (D-136, D-138)', () => {
  for (const [theme, width] of [
    ['dark', 1440],
    ['light', 1440],
    ['dark', 390],
  ] as const) {
    void test(`${theme} at ${String(width)}: one space, whole weeks, a withheld week said — no table, no donut`, async () => {
      const asked: URL[] = [];
      const h = await openWith(
        '/insights?tab=time',
        LEAD_STUB(),
        asked,
        (u) => ok(weeksReport(u)),
        width,
      );
      try {
        await setTheme(h.page, theme);
        const tr = h.page.locator('[data-time-report="space"]');
        await tr.locator('[data-tr-week]').first().waitFor({ timeout: 20_000 });
        const q = asked[0];
        assert.ok(q !== undefined);
        assert.equal(q.searchParams.get('spaces'), 'laika');
        assert.equal(q.searchParams.get('members'), null);
        assert.equal(q.searchParams.get('drafts'), null);
        assert.equal(new Date(`${q.searchParams.get('from') ?? ''}T00:00:00Z`).getUTCDay(), 1);
        assert.equal(new Date(`${q.searchParams.get('to') ?? ''}T00:00:00Z`).getUTCDay(), 0);
        assert.ok((await tr.locator('[data-tr-withheld]').count()) > 0);
        assert.match(
          await tr.locator('[data-tr-withheld]').first().innerText(),
          /withheld — fewer than 3 others/,
        );
        assert.match(await tr.locator('[data-tr-space-banner]').innerText(), /no per-person split/);
        for (const gone of [
          '[data-tr-table]',
          '[data-tr-donut]',
          '[data-tr-drafts]',
          '[data-tr-chip="member"]',
          '[data-tr-chip="kind"]',
          '[data-tr-range="day"]',
        ]) {
          assert.equal(await tr.locator(gone).count(), 0, `${gone} is drawn for a space admin`);
        }
        await noSideways(h.page, width);
        await shoot(h.page, `space-${theme}-${String(width)}`);
      } finally {
        await done(h);
      }
    });
  }
});

void describe('a space admin’s file (D-136)', () => {
  void test('Export CSV asks for one space, whole weeks, and nothing to narrow it by', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', LEAD_STUB(), asked, (u) =>
      u.searchParams.get('format') === 'csv'
        ? {
            status: 200,
            body: 'week_start,week_end,space,people,confirmed_minutes\n',
            headers: { 'content-disposition': 'attachment; filename="weeks.csv"' },
          }
        : ok(weeksReport(u)),
    );
    try {
      const tr = h.page.locator('[data-time-report="space"]');
      await tr.locator('[data-tr-week]').first().waitFor({ timeout: 20_000 });
      const download = h.page.waitForEvent('download');
      await tr.locator('[data-tr-export]').click();
      assert.equal((await download).suggestedFilename(), 'weeks.csv');
      const csv = asked.find((u) => u.searchParams.get('format') === 'csv');
      assert.ok(csv !== undefined, 'the CSV was not asked for');
      assert.equal(csv.searchParams.get('spaces'), 'laika');
      for (const none of ['drafts', 'members', 'kinds']) {
        assert.equal(csv.searchParams.get(none), null, `${none} sent for a space admin`);
      }
      assert.equal(new Date(`${csv.searchParams.get('from') ?? ''}T00:00:00Z`).getUTCDay(), 1);
      assert.equal(new Date(`${csv.searchParams.get('to') ?? ''}T00:00:00Z`).getUTCDay(), 0);
    } finally {
      await done(h);
    }
  });
});

void describe('before the answer, and when a read fails', () => {
  void test('Time asked for before permissions settle waits — Capacity is not opened in its place', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const asked: URL[] = [];
    const h = await open('/insights?tab=time', OWNER_STUB(), {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await routeReport(page, asked, (u) => ok(orgReport(u)));
        await page.route('**/api/v1/permissions', async (route) => {
          await held;
          await route.fallback();
        });
      },
    });
    try {
      await h.page
        .locator('.skeleton-list', { hasText: 'Loading the Time report' })
        .waitFor({ state: 'attached', timeout: 20_000 });
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/capacity' || c.path === '/api/v1/presence')
          .length,
        0,
        'Capacity was read while Time waited',
      );
      assert.equal(await h.page.locator('[data-time-report]').count(), 0);
      release();
      await h.page
        .locator('[data-time-report="org"] [data-tr-stat="tracked"]')
        .waitFor({ timeout: 20_000 });
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/capacity').length, 0);
    } finally {
      release();
      await done(h);
    }
  });

  void test('a space admin whose spaces cannot be read is told so, not that they lead none', async () => {
    const asked: URL[] = [];
    const h = await openWith(
      '/insights?tab=time',
      {
        ...LEAD_STUB(),
        '/api/v1/projects': refuse(500, 'internal', 'The spaces could not be read.'),
      },
      asked,
      (u) => ok(weeksReport(u)),
    );
    try {
      await h.page.getByText('The spaces could not be read.').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-tr-no-space]').count(), 0);
      assert.deepEqual(asked, []);
    } finally {
      await done(h);
    }
  });
});

void describe('a member', () => {
  void test('is not offered Time, and a link to it is refused, asking nothing', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', MEMBER_STUB(), asked, (u) => ok(orgReport(u)));
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.state-forbidden').innerText(), /the Time report/);
      const tabs = await h.page.locator('nav[aria-label="Insights sections"] a').allInnerTexts();
      assert.ok(!tabs.some((t) => t.trim() === 'Time'), `Time is offered: ${tabs.join(', ')}`);
      assert.deepEqual(asked, []);
      await shoot(h.page, 'member-refused-dark-1440');
    } finally {
      await done(h);
    }
  });
});

void describe('the states (frames 1j–1m)', () => {
  void test('loading: bones, said once to a screen reader', async () => {
    const asked: URL[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const h = await open('/insights?tab=time', OWNER_STUB(), {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.route('**/api/v1/time/report?**', async (route) => {
          asked.push(new URL(route.request().url()));
          await held;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(orgReport(new URL(route.request().url()))),
          });
        });
      },
    });
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-loading]').waitFor({ timeout: 20_000 });
      assert.equal(await tr.getAttribute('aria-busy'), 'true');
      assert.match(
        await tr.locator('[role="status"]').innerText(),
        /Reading the time for this range…/,
      );
      await shoot(h.page, 'state-loading-dark-1440');
      release();
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 10_000 });
    } finally {
      release();
      await done(h);
    }
  });

  void test('empty: no time in this range, and the last 30 days one click away', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) =>
      ok(orgReport(u, 'empty')),
    );
    try {
      await setTheme(h.page, 'light');
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-empty="empty"]').waitFor({ timeout: 20_000 });
      assert.match(await tr.locator('[data-tr-empty]').innerText(), /No time in this range/);
      assert.equal(await tr.locator('[data-tr-table]').count(), 0);
      assert.equal(await tr.locator('[data-tr-day]').count(), 30, 'every day is still drawn');
      assert.ok(await tr.locator('[data-tr-export]').isDisabled(), 'an empty file is offered');
      await shoot(h.page, 'state-empty-light-1440');
    } finally {
      await done(h);
    }
  });

  void test('nothing matching the filters: said, with Clear filters', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) =>
      ok(orgReport(u, u.searchParams.has('kinds') ? 'empty' : 'full')),
    );
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
      await tr.locator('[data-tr-chip="kind"]').click();
      await tr.locator('[data-tr-option="admin"] input').check();
      await h.page.keyboard.press('Escape');
      await tr.locator('[data-tr-empty="filtered"]').waitFor({ timeout: 10_000 });
      await tr.locator('[data-tr-empty="filtered"] button').click();
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 10_000 });
    } finally {
      await done(h);
    }
  });

  void test('drafts only: nothing said until Include drafts, then the note; Confirmed only names no drafts', async () => {
    const asked: URL[] = [];
    const h = await openWith(
      '/insights?tab=time',
      OWNER_STUB(),
      asked,
      (u) => ok(orgReport(u, 'drafts-only')),
      390,
    );
    try {
      await setTheme(h.page, 'light');
      const tr = h.page.locator('[data-time-report="org"]');
      // Not asked for: nothing confirmed reads as no time, and no drafted figure is named.
      await tr.locator('[data-tr-empty="empty"]').waitFor({ timeout: 20_000 });
      assert.doesNotMatch(await tr.innerText(), /drafts are waiting/);
      await tr.locator('[data-tr-drafts="include"]').click();
      await tr.locator('[data-tr-partial]').waitFor({ timeout: 10_000 });
      assert.match(await tr.locator('[data-tr-partial]').innerText(), /Drafts only\./);
      await shoot(h.page, 'state-partial-light-390');
      await tr.locator('[data-tr-drafts="exclude"]').click();
      await tr.locator('[data-tr-empty="empty"]').waitFor({ timeout: 10_000 });
      assert.doesNotMatch(await tr.innerText(), /drafts are waiting/);
      await noSideways(h.page, 390);
    } finally {
      await done(h);
    }
  });

  void test('an error is the server’s sentence, with Retry; too many rows says what to do', async () => {
    const asked: URL[] = [];
    let fail = 2;
    const h = await openWith('/insights?tab=time', OWNER_STUB(), asked, (u) => {
      if (fail === 2) {
        fail -= 1;
        return {
          status: 503,
          body: { error: { code: 'internal', message: 'The server did not answer in time.' } },
        };
      }
      if (fail === 1) {
        fail -= 1;
        return {
          status: 422,
          body: {
            error: {
              code: 'unprocessable',
              message: 'too many',
              details: { reason: 'report_too_large', max_rows: 5000 },
            },
          },
        };
      }
      return ok(orgReport(u));
    });
    try {
      const tr = h.page.locator('[data-time-report="org"]');
      await tr.locator('[data-tr-error]').waitFor({ timeout: 20_000 });
      assert.match(
        await tr.locator('[data-tr-error]').innerText(),
        /This range could not be read\. The server did not answer in time\. Nothing on the board changed\./,
      );
      await shoot(h.page, 'state-error-dark-1440');
      await tr.locator('[data-tr-retry]').click();
      await until(async () =>
        (await tr.locator('[data-tr-error]').innerText()).includes('Narrow the range'),
      );
      assert.match(
        await tr.locator('[data-tr-error]').innerText(),
        /Export CSV still has every row/,
      );
      await tr.locator('[data-tr-retry]').click();
      await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 10_000 });
      assert.equal(asked.length, 3);
    } finally {
      await done(h);
    }
  });
});

void describe('the other two places, for the evidence', () => {
  const GRACE = { id: 'u2', name: 'Grace Hopper', deactivated: false };
  const PROFILE = {
    user: {
      id: 'u2',
      name: 'Grace Hopper',
      email: 'g@example.com',
      org_role: 'member',
      is_active: true,
      profile_kind: 'builder',
      created_at: NOW - 200 * 86_400_000,
    },
    window: { weeks: 12, since: NOW - 84 * 86_400_000, until: NOW },
    projects: [],
    review: {
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: [],
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    },
    ratings: [],
    ratings_total: 0,
    activity_sharing: { org_enabled: false, enabled: false },
    queue: { projects_led: 0, waiting: 0, oldest_waiting_since: null, projects: [] },
  };

  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: a person's Time report tab, and My day's week`, async () => {
        const data = weekData();
        const stub: ApiStub = {
          ...weekStub(data),
          ...reportRoutes(data, [], GRACE),
          '/api/v1/permissions': permissions(
            'owner',
            ['time.report.read', 'people.analytics.read', 'profile.read'],
            true,
          ),
          '/api/v1/users/u2/profile': PROFILE,
          '/api/v1/users': {
            data: [
              {
                id: 'u2',
                name: 'Grace Hopper',
                email: 'g@example.com',
                org_role: 'member',
                is_active: true,
              },
            ],
            next_cursor: null,
          },
        };
        const h = await open(`/people?user=u2&tab=time&day=${TODAY}`, stub, {
          before: async (page) => {
            await page.setViewportSize({ width, height: 1000 });
          },
        });
        try {
          await setTheme(h.page, theme);
          const tr = h.page.locator('[data-time-report="person"]');
          await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
          await noSideways(h.page, width);
          await noSamples(h.page);
          await shoot(h.page, `person-${theme}-${String(width)}`);
        } finally {
          await done(h);
        }
        const mine: ApiStub = { ...weekStub(data) };
        const m = await open(`/my-day?day=${TODAY}`, mine, {
          before: async (page) => {
            await page.setViewportSize({ width, height: 1000 });
          },
        });
        try {
          await setTheme(m.page, theme);
          await m.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
          await m.page.locator('[data-overview] [data-ov-scope="week"]').click();
          const tr = m.page.locator('[data-time-report="me"]');
          await tr.locator('[data-tr-stat="tracked"]').waitFor({ timeout: 20_000 });
          assert.equal(
            await tr.locator('[data-tr-lock]').count(),
            0,
            'your own report says who looks',
          );
          assert.deepEqual(m.unmatched, []);
          await noSideways(m.page, width);
          await tr.scrollIntoViewIfNeeded();
          await shoot(m.page, `me-${theme}-${String(width)}`);
        } finally {
          await done(m);
        }
      });
    }
  }
});
