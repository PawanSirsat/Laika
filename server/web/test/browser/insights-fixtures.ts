/**
 * Insights as an owner sees it (LAI-1216): every tab's endpoints in one stub —
 * Capacity (`/capacity`, `/presence`, `/review`), Usage & cost (`/usage`),
 * Time (`/time/report`, answered by `page.route` so the query is visible) and
 * Availability (`/people/availability`). Shaped as the server answers; each
 * test file that owns a tab keeps its own richer fixtures, and this one is
 * for what reads across the tabs: the shared header, the lead figures, the
 * series colours, the address and the phone layout.
 *
 * A `zero` variant answers every tab with nothing in it, for the honest empty
 * states.
 */

import type { Page, Route } from 'playwright';
import type { TimeReport, TimeReportRow } from '../../src/api/time.ts';
import { capacityFor, LAIKA, ONROUTE, PRESENCE, TASKS, NOW as CAP_NOW } from './capacity-org.ts';
import type { ApiStub } from './harness.ts';

const DAY_MS = 86_400_000;

/** Today in UTC, as the pinned clock (`my-day-clock.ts`) counts it. */
const TODAY = new Date().toISOString().slice(0, 10);
const dayOf = (back: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - back * DAY_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export type Fill = 'full' | 'zero';

const ME = {
  id: 'u1',
  email: 'ada@kvelld.example',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

const PERMISSIONS = {
  org_roles: ['owner', 'admin', 'member', 'viewer'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [],
  me: {
    org_role: 'owner',
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: 'lead',
    actions: [
      'project.read',
      'task.watch',
      'time.report.read',
      'people.analytics.read',
      'audit_log.export',
      'usage.read_org',
    ],
    projects: [],
  },
};

const cost = (usd: number) => ({
  usd,
  unpriced_tokens: 0,
  unpriced_models: [],
  unconfirmed_models: [],
});

const figures = (tokens: number, cacheRead: number, attributed: number) => ({
  tokens,
  input: Math.round(tokens * 0.01),
  output: Math.round(tokens * 0.2),
  cache_write: tokens - Math.round(tokens * 0.01) - Math.round(tokens * 0.2),
  cache_read: cacheRead,
  attributed_tokens: attributed,
  cost: cost(Math.round(tokens * 1.2e-5 * 100) / 100),
});

/** `GET /usage?days=N` for the whole organisation. */
export function usageFor(days: number, fill: Fill = 'full'): unknown {
  const zero = fill === 'zero';
  // A function of the day, not of its place in the read, so a read of 60 days
  // ends with exactly the 30 a read of 30 returns — as the server's would.
  const trend = Array.from({ length: days }, (_, i) => {
    const back = days - 1 - i;
    const tokens = zero ? 0 : back % 7 === 2 ? 0 : 9_000_000 - back * 100_000;
    return { day: dayOf(back), tokens, cache_read: tokens * 60 };
  });
  const total = trend.reduce((n, d) => n + d.tokens, 0);
  return {
    from: dayOf(days - 1),
    to: dayOf(0),
    tz: 'UTC',
    days,
    project: null,
    totals: figures(total, total * 60, zero ? 0 : 12_000_000),
    trend,
    by_developer: zero
      ? []
      : [
          {
            user_id: 'u1',
            name: 'Ada Lovelace',
            tokens: Math.round(total * 0.7),
            cache_read: total * 40,
            attributed_tokens: 0,
            cost: cost(2_400),
          },
          {
            user_id: 'u2',
            name: 'Bea Nkosi',
            tokens: total - Math.round(total * 0.7),
            cache_read: total * 20,
            attributed_tokens: 12_000_000,
            cost: cost(659.68),
          },
        ],
    by_agent: zero
      ? []
      : [
          { agent: 'claude-code', tokens: total - 36_057, cache_read: total * 59 },
          { agent: 'codex', tokens: 36_057, cache_read: 6_307_361 },
        ],
    by_model: zero
      ? []
      : [
          {
            model: 'claude-opus-5-5',
            tokens: Math.round(total * 0.9),
            cache_read: total * 55,
            cost: 2_210.5,
          },
          {
            model: 'claude-fable-5-1',
            tokens: total - Math.round(total * 0.9),
            cache_read: total * 5,
            cost: 849.18,
          },
        ],
    by_project: zero
      ? []
      : [
          {
            project: { slug: 'laika', name: 'Laika' },
            tokens: 9_000_000,
            cache_read: 600_000_000,
            cost: cost(108.5),
            share: 9_000_000 / total,
          },
          {
            project: { slug: 'onroute', name: 'Onroute' },
            tokens: 3_000_000,
            cache_read: 200_000_000,
            cost: cost(36.2),
            share: 3_000_000 / total,
          },
        ],
    top_tasks: zero
      ? []
      : [
          {
            task_id: 't1',
            key: 'LAI-769',
            title: 'Token usage, phase 1',
            project_slug: 'laika',
            tokens: 12_000_000,
            cache_read: 800_000_000,
          },
        ],
    no_token_data: [],
    org_totals: null,
    rework: [],
    telemetry: null,
    cache: zero ? { share: 0, saving_usd: 0 } : { share: 0.984, saving_usd: 41_520.3 },
    cache_by_project: [],
    accepted: { by_project: [], by_agent: [], agents_withheld: 0 },
    budgets: zero
      ? []
      : [
          {
            scope: 'project',
            id: 'p1',
            project: { slug: 'laika', name: 'Laika' },
            label: 'Laika',
            title: null,
            source: 'set',
            tokens: 15_000_000,
            period: { from: dayOf(29), to: dayOf(0) },
            used: 12_000_000,
            share: 0.8,
            state: 'warn',
            crossed: [{ threshold: 80, at: 1 }],
          },
        ],
    runaway: [],
  };
}

const ADA = { id: 'u1', name: 'Ada Lovelace', deactivated: false };
const BEA = { id: 'u2', name: 'Bea Nkosi', deactivated: false };
const SPACE_A = { id: LAIKA.id, slug: LAIKA.slug, name: LAIKA.name };
const SPACE_B = { id: ONROUTE.id, slug: ONROUTE.slug, name: ONROUTE.name };

const ROWS: readonly TimeReportRow[] = [
  {
    project: SPACE_A,
    user: BEA,
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
    user: ADA,
    task: null,
    untied: false,
    kind: 'meeting',
    confirmed_minutes: 120,
    drafted_minutes: 30,
  },
];

/** `GET /time/report` as the server answers `url`, filtered as it would. */
export function timeReportFor(url: URL, fill: Fill = 'full'): TimeReport {
  const from = url.searchParams.get('from') ?? TODAY;
  const to = url.searchParams.get('to') ?? TODAY;
  const members = url.searchParams.get('members')?.split(',');
  const kinds = url.searchParams.get('kinds')?.split(',');
  const spaces = url.searchParams.get('spaces')?.split(',');
  const withDrafts = url.searchParams.get('drafts') === 'include';
  let rows = (fill === 'zero' ? [] : ROWS).filter(
    (r) =>
      (members === undefined || members.includes(r.user.id)) &&
      (spaces === undefined || (r.project !== null && spaces.includes(r.project.slug))) &&
      (kinds === undefined || (r.kind !== null && kinds.includes(r.kind))),
  );
  if (!withDrafts) rows = rows.map((r) => ({ ...r, drafted_minutes: 0 }));
  const c = rows.reduce((n, r) => n + r.confirmed_minutes, 0);
  const d = rows.reduce((n, r) => n + r.drafted_minutes, 0);
  const all: string[] = [];
  for (let x = from; x <= to; x = addDays(x, 1)) all.push(x);
  const active = all.filter((x) => x <= TODAY).slice(-5);
  const by_day = all.map((day) => {
    const i = active.indexOf(day);
    if (i < 0) return { day, confirmed_minutes: 0, drafted_minutes: 0 };
    const share = (t: number) =>
      i === active.length - 1
        ? t - Math.floor(t / active.length) * (active.length - 1)
        : Math.floor(t / active.length);
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
    agent_minutes: null,
    by_day,
    rows,
  };
}

/** Answer `/time/report` on `page`, recording each URL asked into `asked`. */
export async function routeTimeReport(
  page: Page,
  asked: URL[] = [],
  fill: Fill = 'full',
): Promise<void> {
  await page.route('**/api/v1/time/report?**', async (route: Route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(timeReportFor(url, fill)),
    });
  });
}

const ref = (p: { id: string; slug: string; name: string }) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
});

const AVAILABILITY = [
  {
    user: { id: 'u2', name: 'Bea Nkosi' },
    availability: {
      status: 'open',
      note: 'Happy to pick up front-end work',
      tags: ['Front-end'],
      away: null,
      hours_per_week: 10,
      away_periods: [],
      work_week: null,
      updated_at: CAP_NOW - 3 * DAY_MS,
    },
    spaces: [ref(LAIKA)],
    in_progress: 3,
    last_2_weeks_minutes: 2480,
  },
];

/** Every endpoint the four Insights views read, as an owner is answered. */
export function insightsStub(fill: Fill = 'full'): ApiStub {
  const zero = fill === 'zero';
  const stub: Record<string, unknown> = {
    '/api/v1/me': ME,
    '/api/v1/permissions': PERMISSIONS,
    '/api/v1/projects': { data: [LAIKA, ONROUTE], next_cursor: null },
    '/api/v1/projects/laika': LAIKA,
    '/api/v1/projects/onroute': ONROUTE,
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/unlisted': { data: [], next_cursor: null },
    '/api/v1/presence': zero ? { ...PRESENCE, present: [] } : PRESENCE,
    '/api/v1/capacity': zero ? { enabled: true, people: [] } : capacityFor('owner'),
    '/api/v1/review': { tasks: [], truncated: false },
    '/api/v1/me/plan-limit': {
      plan: null,
      window: null,
      limit_tokens: null,
      week_reset: null,
      tz: 'UTC',
      used: 0,
      rate_per_hour: 0,
      window_start: null,
      window_end: null,
      reaches_limit_at: null,
      reached: false,
      estimate: true,
    },
    '/api/v1/projects/laika/budgets': {
      project_budget: null,
      sprints: [],
      tasks: [],
      can_set: true,
    },
    '/api/v1/projects/onroute/budgets': {
      project_budget: null,
      sprints: [],
      tasks: [],
      can_set: true,
    },
    '/api/v1/me/token-alerts': { alerts: [] },
    '/api/v1/usage?days=7': usageFor(7, fill),
    '/api/v1/usage?days=30': usageFor(30, fill),
    '/api/v1/usage?days=90': usageFor(90, fill),
    // The Tokens figure's previous period (LAI-1216): a read of twice the range.
    '/api/v1/usage?days=14': usageFor(14, fill),
    '/api/v1/usage?days=60': usageFor(60, fill),
    '/api/v1/people/availability': { data: zero ? [] : AVAILABILITY },
  };
  for (const t of TASKS) stub[`/api/v1/tasks/${t.id}`] = t;
  return stub;
}
