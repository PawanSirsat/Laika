import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type AgentTimeKind } from '../db/enums.ts';
import { agentTimeDays, projects, tasks, tokenSessionTasks } from '../db/schema.ts';
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

/** A session the collector left out (automated, or out of scope): its agent time goes too. */
export function dropAgentTime(tx: Tx, userId: string, keys: readonly string[]): void {
  if (keys.length === 0) return;
  tx.delete(agentTimeDays)
    .where(and(eq(agentTimeDays.userId, userId), inArray(agentTimeDays.sessionKey, [...keys])))
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
}

/**
 * One day's agent minutes for one person: two reads, each one range of a
 * primary key that leads with (person, day).
 */
export function agentDay(db: Db, userId: string, day: string): AgentDayView {
  const seconds = db
    .select({
      sessionKey: agentTimeDays.sessionKey,
      kind: agentTimeDays.kind,
      seconds: agentTimeDays.seconds,
    })
    .from(agentTimeDays)
    .where(and(eq(agentTimeDays.userId, userId), eq(agentTimeDays.day, day)))
    .all();
  if (seconds.length === 0) {
    return { minutes: 0, keyboard_minutes: 0, by_task: [], unattributed_minutes: 0 };
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
  return {
    minutes,
    keyboard_minutes: Math.round(user / 60),
    by_task: byTask,
    unattributed_minutes: Math.max(0, minutes - placed),
  };
}
