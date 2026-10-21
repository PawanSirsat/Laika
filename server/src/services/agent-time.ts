import { and, between, eq, inArray, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type AgentTimeKind } from '../db/enums.ts';
import {
  agentTimeBuckets,
  agentTimeDays,
  projects,
  tasks,
  tokenSessionTasks,
} from '../db/schema.ts';
import { dayIn } from './calendar-days.ts';
import { type TaskRef, taskRefOf, type Tx } from './time-entries.ts';
import { type ResolvedTask } from './token-usage.ts';

/**
 * Agent minutes (D-088 item 8, SPEC §4.50–§4.51, LAI-787): Claude Code's own
 * `active_time`, split by its `type` — `user`, time at the keyboard in Claude
 * Code, and `cli`, the agent working — kept per one-way session key and day
 * by the OpenTelemetry receiver of D-087, under its two switches.
 *
 * **Minutes, never hours.** Agent time is not a person's time and is never
 * billed as it: everything here answers in minutes, and nothing adds it to a
 * time entry.
 *
 * **Tied to cards the way tokens are** (D-084 item 5): a collector's usage
 * report says, per session and day, how that session's tokens split between
 * tasks (`session_tasks`, §6.4) — the split its marks and branch made. A
 * session's agent seconds that day follow the same split; a session with no
 * split is unattributed, never guessed.
 */

/** One session's seconds of one kind on one day, as telemetry just added them. */
export interface AgentSeconds {
  day: string;
  sessionKey: string;
  kind: AgentTimeKind;
  seconds: number;
}

/** Add what telemetry measured, inside the receiver's transaction. */
export function storeAgentTime(
  tx: Tx,
  userId: string,
  added: readonly AgentSeconds[],
  now: number,
): void {
  for (const a of added) {
    if (!(a.seconds > 0)) continue;
    tx.insert(agentTimeDays)
      .values({
        userId,
        day: a.day,
        sessionKey: a.sessionKey,
        kind: a.kind,
        seconds: a.seconds,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          agentTimeDays.userId,
          agentTimeDays.day,
          agentTimeDays.sessionKey,
          agentTimeDays.kind,
        ],
        set: { seconds: sql`${agentTimeDays.seconds} + ${a.seconds}`, updatedAt: now },
      })
      .run();
  }
}

/**
 * When the agent worked is kept to five minutes of unix time (LAI-833) — the
 * resolution of My day's lanes, and nothing about what it worked on.
 */
export const AGENT_BUCKET_MS = 5 * 60_000;

/** One session's agent-working seconds in one bucket, as telemetry just added them. */
export interface AgentBucketSeconds {
  sessionKey: string;
  /** `floor(unix ms / AGENT_BUCKET_MS)`. */
  bucket: number;
  seconds: number;
}

/**
 * `seconds` of work reported for `[startMs, endMs]`, spread over the buckets
 * the interval covers in proportion to how much of each it covers. More
 * seconds than the interval spans — active time past wall time, which only a
 * bad point can say — are put in the stretch that long before `endMs`, so no
 * bucket ever holds more than five minutes.
 */
export function spreadActive(
  sessionKey: string,
  startMs: number,
  endMs: number,
  seconds: number,
): AgentBucketSeconds[] {
  if (!(seconds > 0)) return [];
  const from = Math.min(startMs, endMs - seconds * 1000);
  const span = endMs - from;
  const out: AgentBucketSeconds[] = [];
  const first = Math.floor(from / AGENT_BUCKET_MS);
  const last = Math.floor((endMs - 1) / AGENT_BUCKET_MS);
  for (let bucket = first; bucket <= last; bucket += 1) {
    const overlap =
      Math.min(endMs, (bucket + 1) * AGENT_BUCKET_MS) - Math.max(from, bucket * AGENT_BUCKET_MS);
    if (overlap > 0) out.push({ sessionKey, bucket, seconds: (seconds * overlap) / span });
  }
  return out;
}

/**
 * Add what telemetry placed, inside the receiver's transaction. A bucket
 * holds five minutes at most: two series of one session saying the same
 * minutes (a restarted process) cannot make it more, nor refuse the upload.
 */
export function storeAgentBuckets(
  tx: Tx,
  userId: string,
  added: readonly AgentBucketSeconds[],
  now: number,
): void {
  const sums = new Map<string, AgentBucketSeconds>();
  for (const a of added) {
    if (!(a.seconds > 0)) continue;
    const id = `${a.sessionKey}\u0000${String(a.bucket)}`;
    const held = sums.get(id) ?? { ...a, seconds: 0 };
    held.seconds += a.seconds;
    sums.set(id, held);
  }
  for (const a of sums.values()) {
    const seconds = Math.min(AGENT_BUCKET_MS / 1000, a.seconds);
    tx.insert(agentTimeBuckets)
      .values({ userId, sessionKey: a.sessionKey, bucket: a.bucket, seconds, updatedAt: now })
      .onConflictDoUpdate({
        target: [agentTimeBuckets.userId, agentTimeBuckets.sessionKey, agentTimeBuckets.bucket],
        set: {
          seconds: sql`min(${AGENT_BUCKET_MS / 1000}, ${agentTimeBuckets.seconds} + ${seconds})`,
          updatedAt: now,
        },
      })
      .run();
  }
}

/** A session the collector left out (automated, or out of scope): its agent time goes too. */
export function dropAgentTime(tx: Tx, userId: string, keys: readonly string[]): void {
  if (keys.length === 0) return;
  tx.delete(agentTimeDays)
    .where(and(eq(agentTimeDays.userId, userId), inArray(agentTimeDays.sessionKey, [...keys])))
    .run();
  tx.delete(agentTimeBuckets)
    .where(
      and(eq(agentTimeBuckets.userId, userId), inArray(agentTimeBuckets.sessionKey, [...keys])),
    )
    .run();
}

/** At most this many session-to-task rows a day of a usage report may carry. */
export const SESSION_TASKS_PER_DAY_MAX = 200;

export interface SessionTaskInput {
  key: string;
  task: string;
  tokens: number;
}

/**
 * Replace one collector's session-to-task split for the days a usage report
 * carries, inside its transaction. Only keys the sender may read count — the
 * report's own resolution — and the rest are left unattributed.
 */
export function storeSessionTasks(
  tx: Tx,
  userId: string,
  collectorId: string,
  days: readonly { day: string; session_tasks?: readonly SessionTaskInput[] | undefined }[],
  resolved: ReadonlyMap<string, ResolvedTask>,
  now: number,
): void {
  if (days.length === 0) return;
  tx.delete(tokenSessionTasks)
    .where(
      and(
        eq(tokenSessionTasks.userId, userId),
        eq(tokenSessionTasks.collectorId, collectorId),
        inArray(
          tokenSessionTasks.day,
          days.map((d) => d.day),
        ),
      ),
    )
    .run();
  const rows = new Map<string, typeof tokenSessionTasks.$inferInsert>();
  for (const day of days) {
    for (const s of day.session_tasks ?? []) {
      const task = resolved.get(s.task);
      if (task === undefined || s.tokens <= 0) continue;
      const id = `${day.day}\u0000${s.key}\u0000${task.taskId}`;
      const held = rows.get(id);
      if (held === undefined) {
        rows.set(id, {
          userId,
          collectorId,
          day: day.day,
          sessionKey: s.key,
          taskId: task.taskId,
          tokens: s.tokens,
          updatedAt: now,
        });
      } else {
        held.tokens = (held.tokens ?? 0) + s.tokens;
      }
    }
  }
  const values = [...rows.values()];
  for (let i = 0; i < values.length; i += 50) {
    tx.insert(tokenSessionTasks)
      .values(values.slice(i, i + 50))
      .run();
  }
}

/** A person's agent minutes on one day (§6.4's `agent`). */
export interface AgentDayView {
  /** The agent working (`cli`), in minutes. */
  minutes: number;
  /** Time at the keyboard in Claude Code (`user`), in minutes. */
  keyboard_minutes: number;
  /** The agent minutes tied to each card, largest first. */
  by_task: { task: TaskRef; minutes: number }[];
  /** The agent minutes no split placed. */
  unattributed_minutes: number;
  /**
   * When the agent worked that day (LAI-833), for My day's AGENTS lane: per
   * five minutes, `[bucket start in unix ms, seconds, seconds on a card]` in
   * order — on a card where the session's own split ties it, as above.
   */
  lane: [number, number, number][];
}

/**
 * The buckets of `day` in `tz`, by session: one range of
 * `agent_time_buckets_user_bucket_idx` wide enough for any zone (the UTC day,
 * fourteen hours either side), each bucket kept where its start falls.
 */
function bucketsOn(
  db: Db,
  userId: string,
  day: string,
  tz: string,
): { sessionKey: string; bucket: number; seconds: number }[] {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const wide = 14 * 60 * 60_000;
  return db
    .select({
      sessionKey: agentTimeBuckets.sessionKey,
      bucket: agentTimeBuckets.bucket,
      seconds: agentTimeBuckets.seconds,
    })
    .from(agentTimeBuckets)
    .where(
      and(
        eq(agentTimeBuckets.userId, userId),
        between(
          agentTimeBuckets.bucket,
          Math.floor((utc - wide) / AGENT_BUCKET_MS),
          Math.floor((utc + 24 * 60 * 60_000 + wide) / AGENT_BUCKET_MS),
        ),
      ),
    )
    .all()
    .filter((r) => dayIn(tz, r.bucket * AGENT_BUCKET_MS) === day);
}

/**
 * One day's agent minutes for one person: two reads, each one range of a
 * primary key that leads with (person, day), and the lane's one range of
 * buckets — in `tz`, the zone My day reads the day in.
 */
export function agentDay(db: Db, userId: string, day: string, tz = 'UTC'): AgentDayView {
  const seconds = db
    .select({
      sessionKey: agentTimeDays.sessionKey,
      kind: agentTimeDays.kind,
      seconds: agentTimeDays.seconds,
    })
    .from(agentTimeDays)
    .where(and(eq(agentTimeDays.userId, userId), eq(agentTimeDays.day, day)))
    .all();
  const buckets = bucketsOn(db, userId, day, tz);
  if (seconds.length === 0 && buckets.length === 0) {
    return { minutes: 0, keyboard_minutes: 0, by_task: [], unattributed_minutes: 0, lane: [] };
  }

  const splits = db
    .select({
      sessionKey: tokenSessionTasks.sessionKey,
      tokens: tokenSessionTasks.tokens,
      taskId: tasks.id,
      number: tasks.number,
      title: tasks.title,
      prefix: projects.prefix,
    })
    .from(tokenSessionTasks)
    .innerJoin(tasks, eq(tasks.id, tokenSessionTasks.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tokenSessionTasks.userId, userId), eq(tokenSessionTasks.day, day)))
    .all();
  const bySession = new Map<string, typeof splits>();
  for (const s of splits) {
    const list = bySession.get(s.sessionKey) ?? [];
    list.push(s);
    bySession.set(s.sessionKey, list);
  }
  const tied = (key: string): boolean =>
    (bySession.get(key) ?? []).reduce((n, s) => n + s.tokens, 0) > 0;

  let cli = 0;
  let user = 0;
  const perTask = new Map<string, { task: TaskRef; seconds: number }>();
  for (const row of seconds) {
    if (row.kind === 'user') {
      user += row.seconds;
      continue;
    }
    cli += row.seconds;
    const split = bySession.get(row.sessionKey) ?? [];
    const total = split.reduce((n, s) => n + s.tokens, 0);
    if (total <= 0) continue;
    for (const s of split) {
      const ref = taskRefOf(s.taskId, s.number, s.title, s.prefix);
      if (ref === null) continue;
      const held = perTask.get(ref.id) ?? { task: ref, seconds: 0 };
      held.seconds += (row.seconds * s.tokens) / total;
      perTask.set(ref.id, held);
    }
  }
  const minutes = Math.round(cli / 60);
  const byTask = [...perTask.values()]
    .map((t) => ({ task: t.task, minutes: Math.round(t.seconds / 60) }))
    .filter((t) => t.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.task.key.localeCompare(b.task.key));
  const placed = byTask.reduce((n, t) => n + t.minutes, 0);

  // The lane: each bucket's sessions together, on a card where a split ties them.
  const perBucket = new Map<number, { seconds: number; onCard: number }>();
  for (const b of buckets) {
    const held = perBucket.get(b.bucket) ?? { seconds: 0, onCard: 0 };
    held.seconds += b.seconds;
    if (tied(b.sessionKey)) held.onCard += b.seconds;
    perBucket.set(b.bucket, held);
  }
  const round = (n: number): number => Math.round(n * 100) / 100;
  const lane = [...perBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, b]): [number, number, number] => [
      bucket * AGENT_BUCKET_MS,
      round(b.seconds),
      round(b.onCard),
    ]);

  return {
    minutes,
    keyboard_minutes: Math.round(user / 60),
    by_task: byTask,
    unattributed_minutes: Math.max(0, minutes - placed),
    lane,
  };
}
