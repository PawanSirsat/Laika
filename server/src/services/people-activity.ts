import { and, eq, gte, lte } from 'drizzle-orm';
import { AGENT_CLIENTS, type AgentClient } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { boardDayOf } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { requireOrgId } from '../db/orgs.ts';
import { boardActivityDays, localActivityDays, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { bulkRowsBetween } from './bulk-moves.ts';
import { addDays, daysBetween, dayIn } from './calendar-days.ts';
import {
  agentKindOf,
  collectionView,
  latestReportZone,
  pushedPerDay,
  readPrompts,
} from './local-activity.ts';
import { readLogged } from './analytics-views.ts';

/**
 * One person's activity per day, for the profile's heatmap (SPEC §6.4,
 * §11.4.2, D-079, LAI-751).
 *
 * ## Who may ask
 *
 * The profile's rule (D-078): an owner or admin, signed in to the web app —
 * §3.1's *"View a member's activity heatmap"*, its own row. Asked **before**
 * the person is looked up, so a caller who may not ask cannot tell a real id
 * from a made-up one.
 *
 * ## Three sources, and what each needs
 *
 * - **Board** — `board_activity_days`, the rollup `appendActivity` keeps of the
 *   log. Always there: it is what the board already records (D-078 item 4).
 * - **GitHub** and **Local** — what the person's own machines reported
 *   (`pushed_commit_keys`, `local_activity_days`). `null`, never zeros, unless
 *   the organisation's switch is on now — the person's own is not asked (D-102
 *   amended): an organisation that stops collecting stops showing it,
 *   whatever is still held.
 *
 * ## Bounded reads only
 *
 * Every query is a range of one person's days on a key that leads with the
 * person: at most a year of rows per source, whatever the size of the log, the
 * board or the organisation. The one read of `activity` is the bulk moves
 * below, and it is bounded the same way: one person's moves and creations in
 * the range, through the actor's index.
 *
 * ## Bulk moves are not activity (D-093, LAI-823)
 *
 * A sweep or an import is bookkeeping, and three such days were 54% of one
 * person's twelve weeks. Their rows stay in the rollup — it is a count of the
 * log, and the log is untouched — and are taken off each board day here, by
 * the rule in `bulk-moves.ts`, with `bulk_excluded` saying how many.
 *
 * ## The days
 *
 * One integer per day from `start` to `end`. `end` is today in the person's
 * most recent reporting zone while their local activity is shown, otherwise in
 * UTC; board days are UTC days (§4.22), local days the machine's own.
 *
 * Context only (D-079 item 6): nothing here is scored or combined.
 */

export const ACTIVITY_RANGES = ['12w', '52w'] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

const RANGE_DAYS: Readonly<Record<ActivityRange, number>> = { '12w': 12 * 7, '52w': 52 * 7 };

export interface ActivitySeries {
  /** Distinct commits on a remote, by the day first reported. */
  github: number[] | null;
  /** Commits on no remote yet, every machine summed. */
  local_commits: number[] | null;
  prompts: number[] | null;
  /** Agent sessions started. */
  sessions: number[] | null;
  /** Board actions they made on a web session. */
  board_self: number[];
  /** Board actions made with their tokens. */
  board_agent: number[];
}

export interface PeopleActivityView {
  range: ActivityRange;
  start: string;
  end: string;
  tz: string;
  sharing: { org_enabled: boolean; enabled: boolean };
  series: ActivitySeries;
  /** Only days with prompts; `{}` while local activity is not shown. */
  prompts_by_agent: Record<string, Partial<Record<AgentClient, number>>>;
  /** Every agent with prompts in the range, most first. */
  agents: AgentClient[];
  /** Bulk moves left off the board days in the range (D-093). */
  bulk_excluded: number;
}

export function getPeopleActivity(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  range: ActivityRange,
  now: number = Date.now(),
): PeopleActivityView {
  assertCan(actor, 'profile.activity.read');

  const person = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (person === undefined) throw ApiError.notFound(`No user with id "${userId}"`);

  // Somebody else's heatmap is a logged read (D-102 rule 3, LAI-957).
  return readLogged(
    db,
    actor,
    userId,
    'activity',
    () => activityOf(db, userId, range, now),
    () => null,
    now,
  );
}

function activityOf(db: Db, userId: string, range: ActivityRange, now: number): PeopleActivityView {
  // The organisation's switch alone (D-102 amended): the person's own is not asked.
  const sharing = collectionView(db);
  const shown = sharing.org_enabled;

  const tz = shown ? latestReportZone(db, userId) : 'UTC';
  const length = RANGE_DAYS[range];
  const end = dayIn(tz, now);
  const start = addDays(end, -(length - 1));
  const index = (day: string): number => daysBetween(start, day);
  const zeros = (): number[] => new Array<number>(length).fill(0);

  const boardSelf = zeros();
  const boardAgent = zeros();
  for (const row of db
    .select()
    .from(boardActivityDays)
    .where(
      and(
        eq(boardActivityDays.userId, userId),
        gte(boardActivityDays.day, start),
        lte(boardActivityDays.day, end),
      ),
    )
    .all()) {
    const i = index(row.day);
    boardSelf[i] = row.bySelf;
    boardAgent[i] = row.byAgents;
  }

  // The range's board days run from start to end in UTC (§4.22); a day either
  // side covers any zone the range was drawn in.
  let bulkExcluded = 0;
  const from = Date.parse(`${addDays(start, -1)}T00:00:00Z`);
  const to = Date.parse(`${addDays(end, 2)}T00:00:00Z`) - 1;
  for (const row of bulkRowsBetween(db, requireOrgId(db), from, to, userId)) {
    const i = index(boardDayOf(row.createdAt));
    if (i < 0 || i >= length) continue;
    const series = row.actorKind === 'user' ? boardSelf : boardAgent;
    if (series[i]! <= 0) continue;
    series[i]! -= 1;
    bulkExcluded += 1;
  }

  const view: PeopleActivityView = {
    range,
    start,
    end,
    tz,
    sharing,
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: boardSelf,
      board_agent: boardAgent,
    },
    prompts_by_agent: {},
    agents: [],
    bulk_excluded: bulkExcluded,
  };
  if (!shown) return view;

  const github = zeros();
  for (const [day, n] of pushedPerDay(db, userId, start, end)) github[index(day)] = n;

  const localCommits = zeros();
  const prompts = zeros();
  const sessions = zeros();
  const byDay: Record<string, Partial<Record<AgentClient, number>>> = {};
  const byAgent = new Map<AgentClient, number>();

  for (const row of db
    .select({
      day: localActivityDays.day,
      prompts: localActivityDays.prompts,
      promptsByAgent: localActivityDays.promptsByAgent,
      sessions: localActivityDays.sessions,
      commitsLocal: localActivityDays.commitsLocal,
    })
    .from(localActivityDays)
    .where(
      and(
        eq(localActivityDays.userId, userId),
        gte(localActivityDays.day, start),
        lte(localActivityDays.day, end),
      ),
    )
    .all()) {
    const i = index(row.day);
    localCommits[i] = (localCommits[i] ?? 0) + row.commitsLocal;
    sessions[i] = (sessions[i] ?? 0) + row.sessions;
    prompts[i] = (prompts[i] ?? 0) + row.prompts;

    if (row.prompts === 0) continue;
    const day = (byDay[row.day] ??= {});
    for (const [id, n] of Object.entries(readPrompts(row.promptsByAgent))) {
      const kind = agentKindOf(id);
      day[kind] = (day[kind] ?? 0) + n;
      byAgent.set(kind, (byAgent.get(kind) ?? 0) + n);
    }
  }

  const order = (kind: AgentClient) => AGENT_CLIENTS.indexOf(kind);
  return {
    ...view,
    series: {
      ...view.series,
      github,
      local_commits: localCommits,
      prompts,
      sessions,
    },
    prompts_by_agent: byDay,
    agents: [...byAgent]
      .sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]))
      .map(([kind]) => kind),
  };
}
