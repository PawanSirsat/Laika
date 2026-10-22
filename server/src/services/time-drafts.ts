import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type TimeDraftSource } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { projects, tasks, timeDrafts, timeEntries, timeUndo } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addDays, dayIn, isTimeZone } from './calendar-days.ts';
import { assertReportDays, latestReportZone } from './local-activity.ts';
import { canSeeProject } from './projects.ts';
import { resolveKeys } from './token-usage.ts';
import {
  assertFitsTheClock,
  assertSpanOnDay,
  assertWithinSpan,
  entryById,
  insertEntry,
  projectRefOf,
  type ProjectRef,
  resolveTarget,
  type Target,
  type TaskRef,
  taskRefOf,
  syncEntry,
  type TimeEntryView,
  type Tx,
} from './time-entries.ts';
import { assertDrafting, assertTimeOn } from './time-settings.ts';
import { daySubject, recordUndo, type OnUndo } from './time-undo-log.ts';

/**
 * Drafted time (D-088 items 3, 4, 11 and 13, SPEC §4.47, LAI-787): blocks a
 * person's own collector drafted on their machine, and entries an agent
 * proposed. **The person's, and nobody else's**: sending is a collector's or an
 * agent's (`time_drafts.send_own`, any `full` token of theirs), and reading,
 * editing and confirming are the person's on a web session
 * (`time_drafts.read_own`, `time_drafts.manage_own`) — there is no admin read
 * and no token reads a draft. Both switches are asked on every send.
 *
 * ## What a block carries
 *
 * Start, end, the local day and zone, the minutes, a task key or none, and
 * the **counts** of the signals behind it — prompts, replies, sessions,
 * commits, task claims — with, since D-096, **which five minutes** its prompts
 * and commits fell in, as counts per bucket (`at`). Since D-098 it may also
 * carry the **name the person gave the work folder** it was drafted in, and
 * that folder's branch when they turned sending it on — and a block with a
 * name and no card goes under the project the name matches
 * ({@link matchingProject}). Nothing else can be sent: the body is a closed
 * schema of numbers, a zone, a key-shaped string and those two bounded
 * strings, and the table has no column that could hold a prompt, a path or a
 * repository.
 *
 * ## An upload replaces its own blocks, and is measured by origin
 *
 * A collector's upload replaces **its own unheld pending** blocks for each day
 * it carries — a retry changes nothing, and a block that grew since the last
 * sync is sent whole again. What it is then measured against is everything
 * else on the day that came from a block: drafts the person confirmed,
 * dismissed, or edited or split (held for them), and another machine's
 * blocks. Each keeps its **origin** — the block as first stored, which no
 * edit changes and the halves of a split share (§4.47) — so a confirmed
 * draft is measured against for as long as it is kept, **whatever has since
 * happened to its entry**: deleted, or moved to another day, its block does
 * not come back.
 *
 * The collector sends one block per task per stretch (a run of active
 * minutes), so the blocks of tasks worked in parallel overlap, and a
 * stretch's blocks add up to its wall-clock minutes. Two rules follow, and
 * both take off **minutes, never span**:
 *
 * - **By identity.** A block loses what origins of the **same task** that
 *   overlap it already hold — each origin's minutes in proportion to how much
 *   of its span lies in the block. Another task's settled block costs it
 *   nothing. What is left sits on the part of its span those origins do not
 *   cover, when that part can hold it.
 * - **By the clock.** A stretch — blocks whose spans touch or overlap — keeps
 *   no more than its own minutes less what is settled across it, of any
 *   task. So a stretch confirmed whole is not drafted again when a later
 *   commit ties part of it to a card, and two machines working the same
 *   hours draft them once, never twice.
 *
 * Entries are not consulted: a confirmed block is measured by its draft, and
 * a timeless manual entry overlaps nothing it could be compared with — the
 * day's 1440 minutes are what keep the two from being confirmed past a day.
 */

/** A collector may report this many days back, as a snapshot can (§6.4). */
export const DRAFT_DAYS_BACK = 14;
/** At most this many blocks a day. */
export const BLOCKS_PER_DAY_MAX = 48;
/** The body limit: a collector chunks its days to it. */
export const TIME_DRAFTS_BODY_MAX = 16 * 1024;
/** A signal count above this is not a day's work. */
export const SIGNAL_MAX = 100_000;

const MINUTE_MS = 60_000;

/** A work folder's chosen name: this many characters at most (D-098). */
export const FOLDER_NAME_MAX = 60;
/** A branch name, as the collector's hook keeps one: this many at most. */
export const BRANCH_MAX = 255;

/**
 * A work folder's chosen name (D-098): 1 to {@link FOLDER_NAME_MAX} characters
 * once trimmed, no control or format character, and no `/` or `\` — a name,
 * never a path.
 */
export function isFolderName(value: string): boolean {
  const name = value.trim();
  return (
    name === value &&
    name.length >= 1 &&
    name.length <= FOLDER_NAME_MAX &&
    !/[\p{Cc}\p{Cf}/\\]/u.test(name)
  );
}

/** A branch name as the hook keeps one: `[A-Za-z0-9._/-]`, 1 to {@link BRANCH_MAX}. */
export function isBranchName(value: string): boolean {
  return value.length <= BRANCH_MAX && /^[A-Za-z0-9._/-]+$/.test(value);
}

export const SIGNAL_KINDS = ['prompts', 'replies', 'sessions', 'commits', 'marks'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export type Signals = Record<SignalKind, number>;

/**
 * When a block's prompts and commits happened is kept to five minutes and no
 * finer (D-096, LAI-834): enough to draw them along the day, too coarse to
 * replay anybody's typing.
 */
export const SIGNAL_BUCKET_MS = 5 * MINUTE_MS;
/** The signals whose time is kept: prompts typed and commits made. */
export const TIMED_SIGNALS = ['prompts', 'commits'] as const;
export type TimedSignal = (typeof TIMED_SIGNALS)[number];
/** At most this many buckets of one kind in a block: a day of 25 hours. */
export const SIGNAL_BUCKETS_MAX = (25 * 60) / 5;
/**
 * Per kind, `[bucket, count]` pairs in order, a bucket being
 * `floor(unix ms / SIGNAL_BUCKET_MS)` — numbers, and nothing else.
 */
export type SignalBuckets = Partial<Record<TimedSignal, [number, number][] | undefined>>;

/**
 * The day's SIGNALS lane (§6.4's My day): per kind, `[bucket start in unix
 * ms, count]` in order — every block of the day, whatever became of it, a
 * bucket two blocks share drawn once.
 */
export interface SignalTimesView {
  prompts: [number, number][];
  commits: [number, number][];
}

/** One draft, as its person sees it (§6.4). */
export interface TimeDraftView {
  id: string;
  source: TimeDraftSource;
  day: string;
  tz: string;
  started_at: number | null;
  ended_at: number | null;
  minutes: number;
  task: TaskRef | null;
  /** The key as it was sent, when it names no task this person can read. */
  task_key: string | null;
  project: ProjectRef | null;
  /** Put on no card and no project by the person, on purpose. */
  general: boolean;
  signals: Signals;
  note: string | null;
  /** The name the person gave the work folder it was drafted in (D-098), or null. */
  folder: string | null;
  /** That folder's branch, sent only when the person turned it on; null without a name. */
  branch: string | null;
}

export interface DraftBlockInput {
  start: number;
  end: number;
  minutes: number;
  task: string | null;
  signals: Partial<Record<SignalKind, number | undefined>>;
  /** When its prompts and commits happened, by bucket (D-096); a collector may leave it out. */
  at?: SignalBuckets | undefined;
  /** The work folder's chosen name, from a collector the board said takes it (D-098). */
  folder?: string | undefined;
  /** Its branch: only with a name, and only when the person turned it on. */
  branch?: string | undefined;
}

export interface TimeDraftsReport {
  v: 1;
  collector_id: string;
  tz: string;
  days: { day: string; blocks: DraftBlockInput[] }[];
}

const zeroSignals = (): Signals => ({ prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 });

function readSignals(json: string): Signals {
  const out = zeroSignals();
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return out;
    for (const kind of SIGNAL_KINDS) {
      const n = (parsed as Record<string, unknown>)[kind];
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out[kind] = n;
    }
  } catch {
    // Written only here, so a bad one is a bug — shown as no evidence.
  }
  return out;
}

/** The buckets stored beside a block's counts, `{}` for a block sent without them. */
function readSignalBuckets(json: string): SignalBuckets {
  const out: SignalBuckets = {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return out;
    const at = (parsed as Record<string, unknown>).at;
    if (typeof at !== 'object' || at === null) return out;
    for (const kind of TIMED_SIGNALS) {
      const list = (at as Record<string, unknown>)[kind];
      if (!Array.isArray(list)) continue;
      out[kind] = list.filter(
        (p): p is [number, number] =>
          Array.isArray(p) &&
          p.length === 2 &&
          Number.isInteger(p[0]) &&
          Number.isInteger(p[1]) &&
          (p[1] as number) > 0,
      );
    }
  } catch {
    // As for the counts: a bad one is a bug, shown as nothing on the lane.
  }
  return out;
}

/**
 * A block's buckets, checked against the block (D-096): each kind in order,
 * each bucket once and inside the block's span — its last minute included —
 * and no more of a kind than the block counts.
 */
function assertBuckets(b: DraftBlockInput, day: string, index: number): void {
  if (b.at === undefined) return;
  const first = Math.floor(b.start / SIGNAL_BUCKET_MS);
  const last = Math.floor((b.end - 1) / SIGNAL_BUCKET_MS);
  for (const kind of TIMED_SIGNALS) {
    const pairs = b.at[kind];
    if (pairs === undefined) continue;
    let previous = -Infinity;
    let total = 0;
    for (const [bucket, count] of pairs) {
      if (bucket <= previous) {
        invalid(`a block's ${kind} times are in order, each once`, { day, index });
      }
      if (bucket < first || bucket > last) {
        invalid(`a block's ${kind} times fall inside it`, { day, index });
      }
      previous = bucket;
      total += count;
    }
    if (total > (b.signals[kind] ?? 0)) {
      invalid(`a block times no more ${kind} than it counts`, { day, index });
    }
  }
}

function invalid(message: string, extra: Record<string, unknown>): never {
  throw new ApiError('unprocessable', message, { reason: 'invalid_blocks', ...extra });
}

/** The checks a schema cannot make, per day: the span, the day, the minutes. */
function assertBlocks(report: TimeDraftsReport): void {
  for (const { day, blocks } of report.days) {
    if (blocks.length > BLOCKS_PER_DAY_MAX) {
      invalid(`at most ${String(BLOCKS_PER_DAY_MAX)} blocks a day`, { day });
    }
    let total = 0;
    blocks.forEach((b, index) => {
      if (!(b.end > b.start)) invalid('a block ends after it starts', { day, index });
      if (dayIn(report.tz, b.start) !== day) {
        invalid(`a block starts on its own day in ${report.tz}`, { day, index });
      }
      const span = Math.ceil((b.end - b.start) / MINUTE_MS);
      if (b.minutes > span) {
        invalid('a block holds no more minutes than its span', { day, index });
      }
      assertBuckets(b, day, index);
      if (b.folder !== undefined && !isFolderName(b.folder)) {
        invalid(
          `a folder's name is 1 to ${String(FOLDER_NAME_MAX)} characters, no path separator or control character`,
          { day, index },
        );
      }
      if (b.branch !== undefined) {
        if (b.folder === undefined)
          invalid('a branch goes only with a folder’s name', { day, index });
        if (!isBranchName(b.branch)) invalid('a branch is a branch name', { day, index });
      }
      total += b.minutes;
    });
    if (total > 1440) invalid('a day holds at most 1440 minutes', { day });
  }
}

type Interval = [number, number];

/** `[start, end)` less every interval in `cuts`, in order. */
export function clip(start: number, end: number, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [[start, end]];
  for (const [cs, ce] of cuts) {
    const next: Interval[] = [];
    for (const [s, e] of pieces) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    pieces = next;
  }
  return pieces;
}

/** A block as first stored: the halves of a split share one. */
interface Origin {
  task: string | null;
  start: number;
  end: number;
  minutes: number;
}

/**
 * Every origin on a person's day, once each — what a collector's new blocks
 * are measured against once its own unheld blocks are gone. One range of
 * `time_drafts_user_day_idx`. An agent's proposal has no origin.
 */
function originsOn(tx: Tx, userId: string, day: string): Origin[] {
  const seen = new Map<string, Origin>();
  for (const r of tx
    .select({
      id: timeDrafts.originId,
      task: timeDrafts.originTask,
      start: timeDrafts.originStartedAt,
      end: timeDrafts.originEndedAt,
      minutes: timeDrafts.originMinutes,
    })
    .from(timeDrafts)
    .where(
      and(eq(timeDrafts.userId, userId), eq(timeDrafts.day, day), isNotNull(timeDrafts.originId)),
    )
    .all()) {
    if (r.id === null || r.start === null || r.end === null || r.minutes === null) continue;
    if (!seen.has(r.id)) {
      seen.set(r.id, { task: r.task, start: r.start, end: r.end, minutes: r.minutes });
    }
  }
  return [...seen.values()];
}

/** The minutes of an origin that fall in `[start, end)`, by its share of the origin's span. */
function heldIn(o: Origin, start: number, end: number): number {
  const overlap = Math.min(o.end, end) - Math.max(o.start, start);
  return overlap <= 0 ? 0 : (o.minutes * overlap) / (o.end - o.start);
}

/** What of a new block is still to draft: its minutes, and where they sit. */
interface Remainder {
  readonly block: DraftBlockInput;
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
}

/**
 * New blocks measured against a day's origins, by the module comment's two
 * rules: the same task's origins by identity, each stretch by the clock. Whole
 * minutes, by largest remainder within a stretch; a block left with none is
 * not kept.
 */
function remainders(blocks: readonly DraftBlockInput[], origins: readonly Origin[]): Remainder[] {
  const draft = blocks.map((b) => {
    const same = origins.filter((o) => o.task === b.task && o.end > b.start && o.start < b.end);
    const held = same.reduce((n, o) => n + heldIn(o, b.start, b.end), 0);
    const exact = Math.max(0, b.minutes - held);
    const rest = clip(
      b.start,
      b.end,
      same.map((o): Interval => [o.start, o.end]),
    );
    const first = rest[0];
    const last = rest.at(-1);
    const fits =
      first !== undefined && last !== undefined && exact <= (last[1] - first[0]) / MINUTE_MS;
    return {
      block: b,
      start: fits ? first[0] : b.start,
      end: fits ? last[1] : b.end,
      exact,
      minutes: 0,
    };
  });

  // Stretches: blocks whose spans touch or overlap, in order of start.
  const order = draft
    .map((_, i) => i)
    .sort((a, b) => (draft[a]?.block.start ?? 0) - (draft[b]?.block.start ?? 0));
  const stretches: number[][] = [];
  let reach = -Infinity;
  for (const i of order) {
    const b = draft[i]?.block;
    if (b === undefined) continue;
    if (b.start > reach) {
      stretches.push([i]);
      reach = b.end;
    } else {
      stretches.at(-1)?.push(i);
      reach = Math.max(reach, b.end);
    }
  }

  for (const stretch of stretches) {
    const members = stretch.map((i) => draft[i]).filter((d) => d !== undefined);
    const from = Math.min(...members.map((d) => d.block.start));
    const to = Math.max(...members.map((d) => d.block.end));
    const own = members.reduce((n, d) => n + d.block.minutes, 0);
    const settled = origins.reduce((n, o) => n + heldIn(o, from, to), 0);
    const room = Math.max(0, own - settled);
    const wanted = members.reduce((n, d) => n + d.exact, 0);
    const scale = wanted > room && wanted > 0 ? room / wanted : 1;
    const shares = members.map((d) => d.exact * scale);
    const target = Math.floor(Math.min(room, wanted) + 1e-9);
    members.forEach((d, k) => {
      d.minutes = Math.floor((shares[k] ?? 0) + 1e-9);
    });
    let left = target - members.reduce((n, d) => n + d.minutes, 0);
    members
      .map((d, k) => ({ d, frac: (shares[k] ?? 0) - d.minutes }))
      .sort((a, b) => b.frac - a.frac || a.d.block.start - b.d.block.start)
      .forEach(({ d, frac }) => {
        if (left > 0 && frac > 1e-9) {
          d.minutes += 1;
          left -= 1;
        }
      });
  }

  return draft
    .filter((d) => d.minutes >= 1)
    .map((d) => ({ block: d.block, start: d.start, end: d.end, minutes: d.minutes }));
}

const REPORT_WINDOW = { daysBack: DRAFT_DAYS_BACK, maxDays: DRAFT_DAYS_BACK + 1 };

/**
 * The project a work folder's chosen name puts an untied block under (D-098
 * item 4, SPEC §6.4): of the live projects the person may read
 * (`project.read`), the one whose slug is the name in lower case — else the
 * one, and only one, whose name is the name, case aside. Two whose names both
 * match, or none, is no project: the board never guesses.
 */
export function matchingProject(db: Db, actor: ResolvedActor, name: string): string | null {
  const wanted = name.trim().toLowerCase();
  const candidates = db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        or(eq(projects.slug, wanted), sql`lower(trim(${projects.name})) = ${wanted}`),
      ),
    )
    .all()
    .filter((p) => canSeeProject(actor, p.id));
  const bySlug = candidates.filter((p) => p.slug === wanted);
  if (bySlug.length === 1) return bySlug[0]?.id ?? null;
  const byName = candidates.filter((p) => p.name.trim().toLowerCase() === wanted);
  return byName.length === 1 ? (byName[0]?.id ?? null) : null;
}

/**
 * `PUT /me/time-drafts`: one collector's blocks for the days it carries, each
 * day's own unheld blocks replaced and the new ones measured by origin.
 */
export function recordTimeDrafts(
  db: Db,
  actor: ResolvedActor,
  report: TimeDraftsReport,
  now: number = Date.now(),
): { accepted_days: number; stored_blocks: number } {
  assertCan(actor, 'time_drafts.send_own');
  assertDrafting(db, actor);
  assertReportDays(report, now, REPORT_WINDOW);
  assertBlocks(report);
  const collectorId = report.collector_id.toLowerCase();

  const keys = new Set<string>();
  for (const day of report.days) {
    for (const b of day.blocks) if (b.task !== null) keys.add(b.task);
  }
  const resolved = resolveKeys(db, actor, keys);
  // Each chosen name's project, asked once per upload (D-098 item 4).
  const matched = new Map<string, string | null>();
  const projectFor = (name: string): string | null => {
    if (!matched.has(name)) matched.set(name, matchingProject(db, actor, name));
    return matched.get(name) ?? null;
  };

  let stored = 0;
  db.transaction((tx) => {
    for (const { day, blocks } of report.days) {
      tx.delete(timeDrafts)
        .where(
          and(
            eq(timeDrafts.userId, actor.userId),
            eq(timeDrafts.day, day),
            eq(timeDrafts.collectorId, collectorId),
            eq(timeDrafts.state, 'pending'),
          ),
        )
        .run();
      const rows: (typeof timeDrafts.$inferInsert)[] = [];
      for (const r of remainders(blocks, originsOn(tx, actor.userId, day))) {
        const b = r.block;
        const task = b.task === null ? undefined : resolved.get(b.task);
        const signals: Signals & { at?: SignalBuckets } = zeroSignals();
        for (const kind of SIGNAL_KINDS) signals[kind] = b.signals[kind] ?? 0;
        const at: SignalBuckets = {};
        for (const kind of TIMED_SIGNALS) {
          const pairs = b.at?.[kind];
          if (pairs !== undefined && pairs.length > 0) at[kind] = pairs;
        }
        if (Object.keys(at).length > 0) signals.at = at;
        const id = newId();
        rows.push({
          id,
          userId: actor.userId,
          source: 'collector',
          collectorId,
          day,
          tz: report.tz,
          startedAt: r.start,
          endedAt: r.end,
          minutes: r.minutes,
          taskKey: b.task !== null && task === undefined ? b.task : null,
          taskId: task?.taskId ?? null,
          // A card's project is its own; an untied block's, its folder's name's.
          projectId: task?.projectId ?? (b.folder === undefined ? null : projectFor(b.folder)),
          signals: JSON.stringify(signals),
          folder: b.folder ?? null,
          branch: b.folder === undefined ? null : (b.branch ?? null),
          state: 'pending',
          // Its own origin: what a later upload is measured against once the
          // person settles it.
          originId: id,
          originTask: b.task,
          originStartedAt: r.start,
          originEndedAt: r.end,
          originMinutes: r.minutes,
          createdAt: now,
          updatedAt: now,
        });
      }
      for (let i = 0; i < rows.length; i += 50) {
        tx.insert(timeDrafts)
          .values(rows.slice(i, i + 50))
          .run();
      }
      stored += rows.length;
    }
  });
  return { accepted_days: report.days.length, stored_blocks: stored };
}

// --------------------------------------------------------------- proposals

/** What an agent is told of its proposal: no more than it sent, and where it went. */
export interface ProposedTimeDraft {
  id: string;
  minutes: number;
  day: string;
}

export interface ProposalInput {
  minutes: number;
  task?: string | undefined;
  day?: string | undefined;
  tz?: string | undefined;
  note?: string | undefined;
}

/** The zone a person's drafts are read in when an agent names none. */
function zoneOf(db: Db, userId: string): string {
  const row = db
    .select({ tz: timeDrafts.tz })
    .from(timeDrafts)
    .where(eq(timeDrafts.userId, userId))
    .orderBy(desc(timeDrafts.day))
    .limit(1)
    .get();
  return row !== undefined && isTimeZone(row.tz) ? row.tz : latestReportZone(db, userId);
}

/**
 * `POST /me/time-drafts` and §7.1's `propose_time_entry` (D-088 item 13): an
 * agent proposes time into its person's drafts — **never an entry**. Only the
 * person, signed in, confirms it. Both switches must be on.
 *
 * The answer is the proposal's id, minutes and day and nothing more: a token
 * reads no draft, its own proposal included, so nothing of the person's
 * drafts — the task as resolved, the zone, the project — goes back to it
 * (LAI-787 review).
 */
export function proposeTimeDraft(
  db: Db,
  actor: ResolvedActor,
  input: ProposalInput,
  now: number = Date.now(),
): ProposedTimeDraft {
  assertCan(actor, 'time_drafts.send_own');
  assertDrafting(db, actor);
  const tz = input.tz ?? zoneOf(db, actor.userId);
  if (!isTimeZone(tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const day = input.day ?? dayIn(tz, now);
  assertReportDays({ tz, days: [{ day }] }, now, REPORT_WINDOW);
  const target = resolveTarget(db, actor, { task: input.task });
  const id = newId();
  db.insert(timeDrafts)
    .values({
      id,
      userId: actor.userId,
      source: 'agent',
      collectorId: '',
      day,
      tz,
      startedAt: null,
      endedAt: null,
      minutes: input.minutes,
      taskId: target.taskId,
      projectId: target.projectId,
      signals: JSON.stringify(zeroSignals()),
      note: input.note?.trim() === '' ? null : (input.note?.trim() ?? null),
      state: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { id, minutes: input.minutes, day };
}

// ------------------------------------------------------------------- views

const taskProject = alias(projects, 'draft_task_project');

function draftQuery(db: Db | Tx) {
  return db
    .select({
      id: timeDrafts.id,
      source: timeDrafts.source,
      collectorId: timeDrafts.collectorId,
      day: timeDrafts.day,
      tz: timeDrafts.tz,
      startedAt: timeDrafts.startedAt,
      endedAt: timeDrafts.endedAt,
      minutes: timeDrafts.minutes,
      taskKey: timeDrafts.taskKey,
      general: timeDrafts.general,
      signals: timeDrafts.signals,
      note: timeDrafts.note,
      folder: timeDrafts.folder,
      branch: timeDrafts.branch,
      state: timeDrafts.state,
      taskId: tasks.id,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      taskPrefix: taskProject.prefix,
      projectId: projects.id,
      projectSlug: projects.slug,
      projectName: projects.name,
    })
    .from(timeDrafts)
    .leftJoin(tasks, eq(tasks.id, timeDrafts.taskId))
    .leftJoin(taskProject, eq(taskProject.id, tasks.projectId))
    .leftJoin(projects, eq(projects.id, timeDrafts.projectId));
}

type DraftRow = ReturnType<ReturnType<typeof draftQuery>['all']>[number];

function draftView(r: DraftRow): TimeDraftView {
  return {
    id: r.id,
    source: r.source,
    day: r.day,
    tz: r.tz,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    minutes: r.minutes,
    task: taskRefOf(r.taskId, r.taskNumber, r.taskTitle, r.taskPrefix),
    task_key: r.taskKey,
    project: projectRefOf(r.projectId, r.projectSlug, r.projectName),
    general: r.general === 1,
    signals: readSignals(r.signals),
    note: r.note,
    folder: r.folder,
    branch: r.branch,
  };
}

/**
 * A person's pending drafts on one day, in the order they happened — **one
 * query on `time_drafts_user_day_idx`**, the joins by primary key. A helper of
 * My day, which asks `time_drafts.read_own` first.
 */
export function draftsOn(db: Db, userId: string, day: string): TimeDraftView[] {
  return draftQuery(db)
    .where(
      and(eq(timeDrafts.userId, userId), eq(timeDrafts.day, day), eq(timeDrafts.state, 'pending')),
    )
    .orderBy(
      asc(sql`coalesce(${timeDrafts.startedAt}, ${timeDrafts.createdAt})`),
      asc(timeDrafts.id),
    )
    .all()
    .map(draftView);
}

/**
 * The day's SIGNALS lane (D-096, LAI-834): when the prompts and commits
 * behind every block of the day happened — pending, confirmed or dismissed,
 * since the lane shows what happened, not what is left to settle. Blocks
 * worked in parallel carry their stretch's prompts each, so a bucket keeps
 * the largest count any block gave it rather than their sum. **One range of
 * `time_drafts_user_day_idx`**; a helper of My day, which asks
 * `time_drafts.read_own` first.
 */
export function signalTimesOn(db: Db, userId: string, day: string): SignalTimesView {
  const most: Record<TimedSignal, Map<number, number>> = { prompts: new Map(), commits: new Map() };
  for (const row of db
    .select({ signals: timeDrafts.signals })
    .from(timeDrafts)
    .where(and(eq(timeDrafts.userId, userId), eq(timeDrafts.day, day)))
    .all()) {
    const at = readSignalBuckets(row.signals);
    for (const kind of TIMED_SIGNALS) {
      for (const [bucket, count] of at[kind] ?? []) {
        most[kind].set(bucket, Math.max(most[kind].get(bucket) ?? 0, count));
      }
    }
  }
  const lane = (kind: TimedSignal): [number, number][] =>
    [...most[kind].entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, count]) => [bucket * SIGNAL_BUCKET_MS, count]);
  return { prompts: lane('prompts'), commits: lane('commits') };
}

function draftById(db: Db | Tx, userId: string, id: string): TimeDraftView {
  const row = draftQuery(db)
    .where(
      and(eq(timeDrafts.id, id), eq(timeDrafts.userId, userId), eq(timeDrafts.state, 'pending')),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No draft "${id}"`);
  return draftView(row);
}

/** The caller's own pending draft, or `404` — anybody else's is not there for them. */
function pendingRow(tx: Db | Tx, userId: string, id: string) {
  const row = tx
    .select()
    .from(timeDrafts)
    .where(
      and(eq(timeDrafts.id, id), eq(timeDrafts.userId, userId), eq(timeDrafts.state, 'pending')),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No draft "${id}"`);
  return row;
}

// ----------------------------------------------------- the person's hands

export interface DraftPatch {
  task?: string | null | undefined;
  project?: string | null | undefined;
  general?: boolean | undefined;
  minutes?: number | undefined;
  /** A new start or end on the block's own day (LAI-831: an edge dragged), unix ms. */
  started_at?: number | undefined;
  ended_at?: number | undefined;
  /** The work folder's name changed, or cleared with its branch (D-098 item 5). */
  folder?: string | null | undefined;
  /** Its branch changed or cleared; a branch needs a name. */
  branch?: string | null | undefined;
  /**
   * A title the person typed (LAI-865), trimmed; a blank one is none. It is
   * the block's `note`, so confirming makes it the entry's.
   */
  note?: string | null | undefined;
}

/** The name and branch a patch leaves a block with, or `undefined` when it touches neither. */
function patchedFolder(
  row: typeof timeDrafts.$inferSelect,
  patch: DraftPatch,
): { folder: string | null; branch: string | null } | undefined {
  if (patch.folder === undefined && patch.branch === undefined) return undefined;
  if (typeof patch.folder === 'string' && !isFolderName(patch.folder)) {
    throw new ApiError(
      'unprocessable',
      `A folder's name is 1 to ${String(FOLDER_NAME_MAX)} characters, no path separator or control character`,
      { field: 'folder', reason: 'invalid_folder' },
    );
  }
  if (typeof patch.branch === 'string' && !isBranchName(patch.branch)) {
    throw new ApiError('unprocessable', 'A branch is a branch name', {
      field: 'branch',
      reason: 'invalid_branch',
    });
  }
  const folder = patch.folder === undefined ? row.folder : patch.folder;
  // Clearing the name clears its branch: a branch goes only with a name.
  const branch = folder === null ? null : patch.branch === undefined ? row.branch : patch.branch;
  if (folder === null && typeof patch.branch === 'string') {
    throw new ApiError('unprocessable', 'A branch goes only with a folder’s name', {
      field: 'branch',
      reason: 'branch_without_folder',
    });
  }
  return { folder, branch };
}

/**
 * The span a patch gives a block, or `undefined` when it gives none. Only a
 * block with a span has edges; both stay on its day, and it holds no more
 * minutes than its span — the collector's own rule (`assertBlocks`).
 */
function patchedSpan(
  row: typeof timeDrafts.$inferSelect,
  patch: DraftPatch,
): { startedAt: number; endedAt: number } | undefined {
  if (patch.started_at === undefined && patch.ended_at === undefined) return undefined;
  if (row.startedAt === null || row.endedAt === null) {
    throw new ApiError('unprocessable', 'Only a block with a start and an end has edges', {
      field: 'started_at',
      reason: 'no_span',
    });
  }
  const startedAt = patch.started_at ?? row.startedAt;
  const endedAt = patch.ended_at ?? row.endedAt;
  assertSpanOnDay(row.day, row.tz, startedAt, endedAt);
  const minutes = patch.minutes ?? row.minutes;
  if (minutes > Math.ceil((endedAt - startedAt) / MINUTE_MS)) {
    throw new ApiError('unprocessable', 'A block holds no more minutes than its span', {
      field: 'minutes',
      reason: 'minutes_over_span',
    });
  }
  return { startedAt, endedAt };
}

/**
 * `PATCH /me/time-drafts/:id`: the person puts a block on a card, on a
 * project or on *General*, or changes its minutes. An edited block is **held
 * for them** — taken out of its collector's replace set — so the next sync
 * neither overwrites nor duplicates it.
 *
 * Since LAI-831 it also moves the block's edges on its own day — My day's
 * drag and −/+ — and records what it replaced, so Undo puts the block back
 * as its collector left it, held or not. Since LAI-865 it gives the block a
 * title, which holds it like any other edit.
 */
export function updateDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  patch: DraftPatch,
  now: number = Date.now(),
  onUndo?: OnUndo,
): TimeDraftView {
  assertCan(actor, 'time_drafts.manage_own');
  const general = patch.general === true;
  const touches = general || patch.task !== undefined || patch.project !== undefined;
  const target: Target | undefined = !touches
    ? undefined
    : general
      ? { taskId: null, projectId: null }
      : resolveTarget(db, actor, { task: patch.task ?? null, project: patch.project ?? null });
  const undoId = db.transaction((tx) => {
    const row = pendingRow(tx, actor.userId, id);
    const span = patchedSpan(row, patch);
    const named = patchedFolder(row, patch);
    // A longer or moved block holds no more than its span, and its stretch no
    // more than the clock: confirmed time is never counted twice (review round 2).
    const start = span?.startedAt ?? row.startedAt;
    const end = span?.endedAt ?? row.endedAt;
    if (start !== null && end !== null && (span !== undefined || patch.minutes !== undefined)) {
      const minutes = patch.minutes ?? row.minutes;
      assertWithinSpan(start, end, minutes);
      assertFitsTheClock(tx, actor.userId, start, end, minutes);
    }
    tx.update(timeDrafts)
      .set({
        ...(target === undefined
          ? {}
          : {
              taskId: target.taskId,
              projectId: target.projectId,
              taskKey: null,
              general: general ? 1 : 0,
            }),
        ...(patch.minutes === undefined ? {} : { minutes: patch.minutes }),
        ...(span ?? {}),
        ...(named ?? {}),
        ...(patch.note === undefined
          ? {}
          : { note: patch.note === null || patch.note.trim() === '' ? null : patch.note.trim() }),
        collectorId: '',
        updatedAt: now,
      })
      .where(eq(timeDrafts.id, id))
      .run();
    return recordUndo(tx, actor.userId, id, { drafts: [row] }, now);
  });
  onUndo?.(undoId);
  return draftById(db, actor.userId, id);
}

/**
 * `POST /me/time-drafts/:id/split`: one block becomes two at a minute inside
 * it, each holding its share of the minutes, both held for the person. The
 * evidence describes the block they came from, so each keeps it.
 */
export function splitDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  at: number,
  now: number = Date.now(),
  onUndo?: OnUndo,
): [TimeDraftView, TimeDraftView] {
  assertCan(actor, 'time_drafts.manage_own');
  const cut = Math.round(at / MINUTE_MS) * MINUTE_MS;
  const { ids, undoId } = db.transaction((tx) => {
    const row = pendingRow(tx, actor.userId, id);
    if (row.startedAt === null || row.endedAt === null) {
      throw new ApiError('unprocessable', 'Only a block with a start and an end can be split', {
        field: 'at',
        reason: 'no_span',
      });
    }
    if (!(cut > row.startedAt && cut < row.endedAt) || row.minutes < 2) {
      throw new ApiError('unprocessable', 'Split at a minute inside the block', {
        field: 'at',
        reason: 'outside_block',
      });
    }
    const first = Math.min(
      row.minutes - 1,
      Math.max(
        1,
        Math.round((row.minutes * (cut - row.startedAt)) / (row.endedAt - row.startedAt)),
      ),
    );
    const base = { ...row, collectorId: '', updatedAt: now };
    const a = { ...base, id: newId(), endedAt: cut, minutes: first };
    const b = { ...base, id: newId(), startedAt: cut, minutes: row.minutes - first };
    tx.delete(timeDrafts).where(eq(timeDrafts.id, id)).run();
    tx.insert(timeDrafts).values([a, b]).run();
    // Undo removes the halves and puts the block back under its own id.
    return {
      ids: [a.id, b.id] as const,
      undoId: recordUndo(tx, actor.userId, id, { drafts: [row], made: [a.id, b.id] }, now),
    };
  });
  onUndo?.(undoId);
  return [draftById(db, actor.userId, ids[0]), draftById(db, actor.userId, ids[1])];
}

/**
 * `POST /me/time-drafts/:id/dismiss`: not work, or not worth keeping. Kept
 * until retention with its origin, so the collector's next upload of the same
 * stretch is measured against it and the block does not come back.
 */
export function dismissDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
  onUndo?: OnUndo,
): void {
  assertCan(actor, 'time_drafts.manage_own');
  const undoId = db.transaction((tx) => {
    const row = pendingRow(tx, actor.userId, id);
    tx.update(timeDrafts)
      .set({ state: 'dismissed', updatedAt: now })
      .where(eq(timeDrafts.id, id))
      .run();
    return recordUndo(tx, actor.userId, id, { drafts: [row] }, now);
  });
  onUndo?.(undoId);
}

/**
 * One block becomes confirmed time, inside the caller's transaction. A block
 * has **one entry for as long as it is kept** (`time_entries_source_ref_unique`):
 * confirmed again after an Undo took its entry back (LAI-831), the same entry
 * is live again as the next revision rather than a second one made.
 */
function confirmRow(
  tx: Tx,
  userId: string,
  row: typeof timeDrafts.$inferSelect,
  now: number,
  judge = true,
): string {
  // Confirmed time is never counted twice, by the clock (review round 2).
  // *Confirm day* judges the day once, when every block of it is in.
  if (judge && row.startedAt !== null && row.endedAt !== null) {
    assertFitsTheClock(tx, userId, row.startedAt, row.endedAt, row.minutes, { draftId: row.id });
  }
  const fields = {
    // An untied block is confirmed as General: the person confirmed it.
    target: { taskId: row.taskId, projectId: row.projectId },
    day: row.day,
    tz: row.tz,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    minutes: row.minutes,
    note: row.note,
    // The name and branch go with the entry once confirmed (D-098 item 5).
    folder: row.folder,
    branch: row.branch,
  };
  const before = tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.source, 'draft'),
        eq(timeEntries.sourceRef, row.id),
      ),
    )
    .get();
  let entryId: string;
  if (before === undefined) {
    entryId = insertEntry(tx, userId, fields, 'draft', row.id, now);
  } else {
    syncEntry(tx, before.id, fields, userId, now);
    entryId = before.id;
  }
  tx.update(timeDrafts)
    .set({ state: 'confirmed', entryId, updatedAt: now })
    .where(eq(timeDrafts.id, row.id))
    .run();
  return entryId;
}

/** `POST /me/time-drafts/:id/confirm`: one block becomes confirmed time. */
export function confirmDraft(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
  onUndo?: OnUndo,
): TimeEntryView {
  assertCan(actor, 'time_drafts.manage_own');
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  const { entryId, undoId } = db.transaction((tx) => {
    const row = pendingRow(tx, actor.userId, id);
    const made = confirmRow(tx, actor.userId, row, now);
    return {
      entryId: made,
      undoId: recordUndo(tx, actor.userId, id, { drafts: [row], entriesMade: [made] }, now),
    };
  });
  onUndo?.(undoId);
  return entryById(db, actor.userId, entryId);
}

/**
 * `POST /me/time/days/:day/confirm` — *Confirm day*: every pending draft of
 * the day becomes confirmed time, in one transaction. A day that would then
 * hold more than 1440 minutes confirms nothing (`422 day_full`).
 */
export function confirmDay(
  db: Db,
  actor: ResolvedActor,
  day: string,
  now: number = Date.now(),
  onUndo?: OnUndo,
): TimeEntryView[] {
  assertCan(actor, 'time_drafts.manage_own');
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  const { ids, undoId } = db.transaction((tx) => {
    const rows = tx
      .select()
      .from(timeDrafts)
      .where(
        and(
          eq(timeDrafts.userId, actor.userId),
          eq(timeDrafts.day, day),
          eq(timeDrafts.state, 'pending'),
        ),
      )
      .orderBy(asc(sql`coalesce(${timeDrafts.startedAt}, ${timeDrafts.createdAt})`))
      .all();
    const made = rows.map((row) => confirmRow(tx, actor.userId, row, now, false));
    // **All or nothing, judged on the day as it would stand** (review round 2):
    // every block's stretch, with every block of the day in it, against the
    // clock — so the order the blocks are taken in changes nothing. The first
    // that does not fit is named, and the whole day stays drafted.
    for (const row of rows) {
      if (row.startedAt === null || row.endedAt === null) continue;
      assertFitsTheClock(tx, actor.userId, row.startedAt, row.endedAt, 0, { draftId: row.id });
    }
    // Undo puts every block of the day back pending (LAI-831).
    return {
      ids: made,
      undoId:
        rows.length === 0
          ? undefined
          : recordUndo(tx, actor.userId, daySubject(day), { drafts: rows, entriesMade: made }, now),
    };
  });
  if (undoId !== undefined) onUndo?.(undoId);
  return ids.map((id) => entryById(db, actor.userId, id));
}

/**
 * `DELETE /me/time-drafts` (D-088 item 11): every draft the person has not
 * confirmed, now — pending and dismissed alike. What they confirmed is a
 * record, and stays.
 */
export function deleteOwnDrafts(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'time_drafts.manage_own');
  db.transaction((tx) => {
    tx.delete(timeDrafts)
      .where(
        and(
          eq(timeDrafts.userId, actor.userId),
          inArray(timeDrafts.state, ['pending', 'dismissed']),
        ),
      )
      .run();
    // A change's before-image holds a block's counts, and Undo would bring it back.
    tx.delete(timeUndo).where(eq(timeUndo.userId, actor.userId)).run();
  });
}

/**
 * Every pending draft a person holds, on every day — what turning *Draft my
 * time* off deletes, for My day to say before it asks (LAI-831, CHIEF's
 * addition F). One range of `time_drafts_user_day_idx`. A helper of My day,
 * which asks `time_drafts.read_own` first.
 */
export function heldDrafts(db: Db, userId: string): { count: number; minutes: number } {
  const row = db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      minutes: sql<number>`coalesce(sum(${timeDrafts.minutes}), 0)`.mapWith(Number),
    })
    .from(timeDrafts)
    .where(and(eq(timeDrafts.userId, userId), eq(timeDrafts.state, 'pending')))
    .get();
  return { count: row?.count ?? 0, minutes: row?.minutes ?? 0 };
}

/** Today in the zone the person's drafts are read in — for My day's default. */
export function draftZone(db: Db, userId: string): string {
  return zoneOf(db, userId);
}

/** Days `from`..`to` inclusive. */
export function daySpan(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
