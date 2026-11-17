/**
 * The profile's developer tab, stubbed for the browser (LAI-1217): someone
 * else's setup as an owner reads it (`GET /people/:id/developer-setup`) and
 * your own as Developer access's own reads serve it. Two data shapes — a
 * realistic setup (two live devices, one with a long machine name, four tools,
 * tokens of every age) and a sparse one (nothing set up).
 *
 * Every timestamp is moved onto the real clock, so an age reads as written.
 */

import type { DeveloperSetup } from '../../src/api/developer-setup.ts';
import { defaultPermissions, type ApiStub } from '../browser/harness.ts';
import { DAY, NOW as FIXTURE_NOW, device, setup, token, tool } from './developer-setup-fixture.ts';
import { ownReadsFrom } from './own-setup-fixture.ts';

export const NOW = Date.now();
const WEEK = 7 * DAY;

/** Fixture time → the real clock. */
function onClock<T>(value: T): T {
  const shift = NOW - FIXTURE_NOW;
  return JSON.parse(JSON.stringify(value), (key, v: unknown) =>
    typeof v === 'number' && v > 1e12 && /(_at|^now|^at)$/.test(key) ? v + shift : v,
  ) as T;
}

export const LONG_DEVICE = 'rowans-macbook-pro-16-inch-2023-work-laptop.corp.example';

/** A lived-in setup, built on the fixture's clock and moved onto the real one. */
export function realistic(over: Partial<DeveloperSetup> = {}): DeveloperSetup {
  const base = setup();
  const t = FIXTURE_NOW;
  const onLong = (id: string, harness: string) =>
    tool(id, harness, {
      device_label: LONG_DEVICE,
      device_id: 'd2',
      last_seen_at: t - 2 * DAY,
      tokens: [
        token(`c-${id}`, {
          name: `${harness} · ${LONG_DEVICE}`,
          kind: 'agent',
          agent_id: id,
          last_used_at: t - 2 * DAY,
          last_mcp_at: t - 2 * DAY,
        }),
      ],
    });
  const tools = [...base.tools, onLong('a3', 'cursor'), onLong('a4', 'gemini-cli')];
  const personal = [
    token('p1', { name: 'deploy-key' }),
    token('p4', { name: 'ci-runner', last_used_at: null, created_at: t - 12 * DAY }),
    token('p5', { name: 'backup-script', last_used_at: t - 120 * DAY, created_at: t - 300 * DAY }),
    token('p6', { name: 'demo-laptop', expires_at: t + 4 * DAY, last_used_at: t - 1 * DAY }),
    token('p2', { name: 'gone-key', revoked_at: t - 3 * DAY }),
    token('p3', { name: 'old-key', expires_at: t - 5 * DAY }),
  ];
  return onClock({
    ...base,
    summary: {
      ...base.summary,
      devices_active: 2,
      tools_active: 4,
      tokens_active: 8,
      tokens_inactive: 2,
    },
    devices: [
      ...base.devices.slice(0, 1),
      device('d2', LONG_DEVICE, { agent_ids: ['a3', 'a4'], last_seen_at: t - 2 * DAY }),
      ...base.devices.slice(1),
    ],
    tools,
    tokens: { personal, tool_credentials: tools.flatMap((x) => x.tokens) },
    ...over,
  });
}

/** Nothing set up at all. */
export function sparse(over: Partial<DeveloperSetup> = {}): DeveloperSetup {
  return onClock(
    setup({
      devices: [],
      tools: [],
      pending_pairing: [],
      repositories: [],
      tokens: { personal: [], tool_credentials: [] },
      activity: [],
      summary: {
        devices_active: 0,
        devices_revoked: 0,
        tools_active: 0,
        tools_revoked: 0,
        repositories: 0,
        repositories_hidden: 0,
        tokens_active: 0,
        tokens_inactive: 0,
        pending_pairing: 0,
        last_seen_at: null,
      },
      ...over,
    }),
  );
}

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

export const OWNER = person('u1', 'Ada Owner', 'owner');
export const ROWAN = person('u2', 'Rowan Vale', 'member');

function profile(user: ReturnType<typeof person>) {
  const zeros = Array.from({ length: 12 }, (_, i) => ({
    week_start: NOW - (12 - i) * WEEK,
    accepted: 0,
    sent_back: 0,
  }));
  return {
    user: { ...user, profile_kind: 'builder', created_at: NOW - 100 * DAY },
    window: { weeks: 12, since: NOW - 12 * WEEK, until: NOW },
    projects: [],
    review: {
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: zeros,
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    },
    ratings: [],
    ratings_total: 0,
    activity_sharing: { org_enabled: false, enabled: false },
    current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
    delivery: {
      accepted_per_week: zeros.map((w) => ({ week_start: w.week_start, accepted: 0 })),
      accepted: 0,
      sent_back: 0,
      reopened: 0,
      cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
    },
    agents: {
      tokens: [],
      tokens_total: 0,
      online: { enabled: true, clients: [], last_seen: null },
      writes: [],
      writes_total: 0,
    },
  };
}

const quietActivity = () => {
  const zeros = () => new Array<number>(364).fill(0);
  return {
    range: '52w',
    start: new Date(NOW - 363 * DAY).toISOString().slice(0, 10),
    end: new Date(NOW).toISOString().slice(0, 10),
    tz: 'UTC',
    sharing: { org_enabled: false, enabled: false },
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: zeros(),
      board_agent: zeros(),
    },
    prompts_by_agent: {},
    agents: [],
  };
};

const quietUsage = (userId: string) => ({
  user_id: userId,
  from: '2026-07-27',
  to: '2026-10-18',
  weeks: [],
  totals: {
    tokens: 0,
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    attributed_tokens: 0,
    cost: { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] },
  },
  by_agent: [],
  by_model: [],
  no_token_data: [],
  sharing: { org_enabled: true, enabled: true },
});

const SETUP_GRANT = ['developer_setup.read_any', 'agent.revoke_any', 'device.revoke_any'];

/** The owner's grants, with *See and manage anyone's developer setup* or without it. */
function permissions(withSetup: boolean, extra: readonly string[] = []) {
  const grants = defaultPermissions({ ...OWNER, memberships: [] }) as {
    me: { actions: string[] };
  };
  const actions = grants.me.actions.filter((a) => !SETUP_GRANT.includes(a));
  return {
    ...grants,
    me: {
      ...grants.me,
      actions: withSetup ? [...actions, ...SETUP_GRANT, ...extra] : [...actions, ...extra],
    },
  };
}

/** The page around the tab: the reader (Ada, an owner), the org, people and their profiles. */
export function base(withSetup = true): ApiStub {
  return {
    '/api/v1/me': { ...OWNER, memberships: [] },
    '/api/v1/permissions': permissions(withSetup),
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users': { data: [OWNER, ROWAN], next_cursor: null },
    '/api/v1/projects': {
      data: [
        {
          id: 'p1',
          slug: 'fixture',
          name: 'Fixture Space',
          prefix: 'FIX',
          description: null,
          repo: null,
          visibility: 'private',
          color: null,
          task_create_min_role: 'member',
          agents_allowed: true,
          former_prefixes: [],
          context_md: '',
          board_hide_done_days: null,
          archived_at: null,
          created_at: 1,
          updated_at: 1,
          task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        },
      ],
      next_cursor: null,
    },
    '/api/v1/users/u2/profile': profile(ROWAN),
    '/api/v1/users/u1/profile': profile(OWNER),
    '/api/v1/me/profile': profile(OWNER),
    '/api/v1/me/activity': quietActivity,
    '/api/v1/users/u2/usage': quietUsage('u2'),
    '/api/v1/users/u1/usage': quietUsage('u1'),
    '/api/v1/people/u2/activity': quietActivity,
    '/api/v1/people/u1/activity': quietActivity,
    '/api/v1/users/u2/tokens': { data: [], next_cursor: null },
    '/api/v1/users/u2/memberships': { data: [] },
  };
}

/** An owner reading Rowan's setup. */
export function adminStub(view: DeveloperSetup, extra: ApiStub = {}, withSetup = true): ApiStub {
  return { ...base(withSetup), '/api/v1/people/u2/developer-setup': view, ...extra };
}

const ME_SETUP = { id: 'u1', name: 'Ada Owner', org_role: 'owner', is_active: true };

/** Ada's own setup, as Developer access's own endpoints answer it — never the admin read. */
export function ownStub(view: DeveloperSetup, extra: ApiStub = {}): ApiStub {
  const reads = ownReadsFrom(view, ME_SETUP);
  return {
    ...base(true),
    '/api/v1/devices': { data: reads.devices },
    '/api/v1/agents': { data: reads.agents, next_cursor: null },
    '/api/v1/project-setups': { data: reads.setups },
    '/api/v1/tokens': { data: reads.tokens, next_cursor: null },
    '/api/v1/devices/pairing-requests': { data: reads.pending },
    '/api/v1/me/developer-setup/activity': { now: reads.now, data: reads.activity },
    ...Object.fromEntries(
      [...reads.verifications].map(([id, v]) => [`/api/v1/agents/${id}/verification`, v]),
    ),
    ...Object.fromEntries(
      [...reads.consents].map(([id, given]) => [
        `/api/v1/agents/${id}/checkpoint-consent`,
        { given, given_by_user_id: null, given_at: null, withdrawn_at: null },
      ]),
    ),
    ...extra,
  };
}

export const ADMIN_TAB = '/people?user=u2&tab=dev';
export const OWN_TAB = '/people?user=u1&tab=dev';
