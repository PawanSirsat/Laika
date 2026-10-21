import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  addDays,
  commonGitDir,
  localDay,
  MAX_BODY_BYTES,
  rememberedRepos,
  reposInScope,
  type GitRunner,
} from './activity-census.ts';
import {
  readText,
  recordError,
  writeFile600,
  type ActivityPaths,
  type ActivityState,
} from './activity-store.ts';
import { draftSources, textKeys, toplevelOf, type UsageRoots } from './activity-usage.ts';

/**
 * Time drafts, built on the developer's own machine (LAI-787, D-088 items 3,
 * 4 and 9).
 *
 * ## What is read, and what leaves
 *
 * From what the collector already holds, and nothing else: the times of
 * Claude Code's replies and the session each is in (the token reader's
 * records — the same automated sessions left out, the same task rule), the
 * times of the prompts the person typed (`events.log`), the times an
 * Omnigent-native orchestrator's turns started and ended in the person's
 * primary session (`events.log` too, LAI-792), the Laika marks that
 * start work on a task, the person's own commits in the repos the hook has
 * seen sessions start in (author time, and a key from the subject, which is
 * read and dropped at once), and the reply times and task of each session the
 * hook marked Omnigent-dispatched (D-095). **Only blocks leave**: a start, an
 * end, minutes, a task key or `null`, and how many of each signal fell in it.
 * Never prompt or reply text, paths, repository or branch names, session ids
 * or a commit message — none of them reaches {@link Block}. Which blocks took
 * a dispatched session's key is said on this machine only ({@link Draft}).
 *
 * ## The rule (design REPORT.md §2.1, measured on the owner's machine)
 *
 * - A **lane** is one session — its subagents with it — or the prompts the
 *   person typed. A lane's events no more than {@link GAP_S} apart chain; after
 *   its last event before a longer gap it stays active {@link TAIL_S}.
 * - An Omnigent-native orchestrator's session (polly) is a lane of its own:
 *   the starts and ends of the turns the person started. A turn Omnigent
 *   started itself — a sub-agent finishing, a timer, an idle terminal; the
 *   hook's `w` (D-090) — makes no time, and nor does the end that closes it:
 *   each end closes the start before it in its session, and an end with no
 *   start counts nothing. A kept end is a reply; no start is a typed prompt.
 * - A **minute** counts once, whatever number of lanes are active in it:
 *   parallel sessions share a person's time and never multiply it.
 * - A minute's **tasks** are the distinct keys of the lanes active in it. A
 *   session's untied minute in a repository takes the key of a commit there
 *   with exactly one key the board serves, authored within
 *   {@link COMMIT_REACH_S} after it. The minute is split equally between its
 *   tasks; with none, it is untied (`task: null`).
 * - **A minute none of the person's lanes tied takes the keys of the
 *   sessions Omnigent dispatched that are active in it** (D-095): each such
 *   session is a lane by the same rules, and the minute is split equally
 *   between their distinct keys. A minute the person's lanes tied keeps its
 *   keys and gains none.
 * - **Commits and dispatched sessions never make time**: they add a key —
 *   a commit a count too — to minutes the person's lanes already made.
 * - A **stretch** is a run of active minutes, cut at local midnight; it gives
 *   one block per task in it, its minutes by largest remainder so a stretch's
 *   blocks add up to its wall-clock minutes.
 *
 * Codex and Gemini CLI sessions are LAI-790: {@link DRAFT_AGENTS} is the seam.
 */

/** Events this close chain into one stretch of a lane (D-088 item 3). */
export const GAP_S = 15 * 60;
/** A lane stays active this long after its last event before a gap. */
export const TAIL_S = 5 * 60;
/** A commit names the task of a session's untied minutes up to this long before it. */
export const COMMIT_REACH_S = 15 * 60;
/** The server's bound on blocks a day (SPEC §6.4). */
export const BLOCKS_PER_DAY_MAX = 48;
/** The days a sync drafts: today and the six before it. */
export const DRAFT_DAYS = 7;
/** Time-draft reports in one run, at most. */
export const TIME_REPORTS_PER_RUN = 3;
/** While drafting is off, the board is asked again at most this often. */
export const TIME_RECHECK_S = 3600;
/** The agents whose typed prompts draft time; Codex and Gemini CLI are LAI-790. */
export const DRAFT_AGENTS: readonly string[] = ['claude-code'];
/** The orchestrators whose turns draft time (LAI-792): the hook's `t`/`w`/`r` lines. */
export const TURN_AGENTS: readonly string[] = ['omnigent'];
/** The server's bound on one signal count. */
const SIGNAL_MAX = 100_000;

/** How many of each signal fell in a block — counts, and nothing else. */
export interface Signals {
  prompts: number;
  replies: number;
  sessions: number;
  commits: number;
  marks: number;
}

/** One block, as `PUT /me/time-drafts` carries it (SPEC §6.4). */
export interface Block {
  /** Unix ms, on a minute. */
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
  readonly task: string | null;
  readonly signals: Signals;
}

export interface ReplyEvent {
  readonly at: number;
  /** Local only: which lane it is in. */
  readonly session: string;
  /** Local only: an opaque identity of the repository it was in, or `null`. */
  readonly repo: string | null;
  readonly task: string | null;
}

export interface CommitEvent {
  readonly at: number;
  readonly repo: string | null;
  /** The one key its subject carried that the board serves, or `null`. */
  readonly task: string | null;
}

export interface MarkEvent {
  readonly at: number;
  readonly session: string;
}

/** A turn of an Omnigent-native orchestrator's primary session (LAI-792). */
export interface TurnEvent {
  readonly at: number;
  /** Local only: the orchestrator session it is in — its lane. */
  readonly session: string;
  /**
   * `start`: a turn the person started. `wake`: one Omnigent started itself
   * (D-090). `end`: a turn's end, whichever started it.
   */
  readonly kind: 'start' | 'wake' | 'end';
}

/**
 * The turns the person started, starts and ends: each end closes the start
 * before it in its session — in their order, which is the hook's, within a
 * second — and is kept only when the person started that turn (D-090).
 */
export function personTurns(turns: readonly TurnEvent[]): TurnEvent[] {
  const open = new Map<string, TurnEvent['kind']>();
  const kept: TurnEvent[] = [];
  const ordered = turns.map((t, i) => ({ t, i })).sort((a, b) => a.t.at - b.t.at || a.i - b.i);
  for (const { t } of ordered) {
    if (t.kind === 'end') {
      if (open.get(t.session) === 'start') kept.push(t);
      open.delete(t.session);
    } else {
      open.set(t.session, t.kind);
      if (t.kind === 'start') kept.push(t);
    }
  }
  return kept;
}

/** A reply of a session Omnigent dispatched (D-095): its time and its key, for lending. */
export interface DispatchedEvent {
  readonly at: number;
  /** Local only: which lane it is in. */
  readonly session: string;
  readonly task: string | null;
}

export interface DraftInputs {
  readonly replies: readonly ReplyEvent[];
  /** Epoch seconds of the prompts the person typed. */
  readonly prompts: readonly number[];
  readonly commits: readonly CommitEvent[];
  readonly marks: readonly MarkEvent[];
  readonly turns: readonly TurnEvent[];
  /** The replies of sessions Omnigent dispatched: they lend keys, and make no minute. */
  readonly dispatched?: readonly DispatchedEvent[];
}

/* -------------------------------------------------------------------------- */
/* The rule — pure: events in, blocks out                                     */
/* -------------------------------------------------------------------------- */

interface LaneMinute {
  readonly task: string | null;
  readonly repo: string | null;
  readonly session: boolean;
}

interface MinuteInfo {
  stretch: number;
  /** The minute's tasks, sorted; `[null]` when it has none. */
  keys: (string | null)[];
  /** Each active lane's own key in it (a session's commit key applied). */
  lanes: Map<string, string | null>;
  /** Its keys are ones dispatched sessions lent (D-095). */
  lent: boolean;
}

interface Building {
  first: number;
  last: number;
  share: number;
  task: string | null;
  signals: Signals;
  sessions: Set<string>;
  minutes: number;
  /** Some minute of it took a key a dispatched session lent: said locally, never sent. */
  lent: boolean;
}

const zero = (): Signals => ({ prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 });

/** An instant's local day, formatted once per quarter hour (every offset is a multiple of 15 min). */
function dayFinder(tz: string): (epochS: number) => string {
  const memo = new Map<number, string>();
  return (epochS) => {
    const quarter = Math.floor(epochS / 900);
    let day = memo.get(quarter);
    if (day === undefined) {
      day = localDay(quarter * 900, tz);
      memo.set(quarter, day);
    }
    return day;
  };
}

/**
 * Each minute one lane's events keep it active, with the event that does:
 * events no more than {@link GAP_S} apart chain, and the last before a longer
 * gap holds on for {@link TAIL_S}.
 */
function eachActiveMinute<E extends { readonly at: number }>(
  events: E[],
  visit: (minute: number, event: E) => void,
): void {
  events.sort((a, b) => a.at - b.at);
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e === undefined) continue;
    const next = events[i + 1];
    const end = next !== undefined && next.at - e.at <= GAP_S ? next.at : e.at + TAIL_S;
    const m0 = Math.floor(e.at / 60);
    const m1 = Math.max(m0 + 1, Math.floor(end / 60));
    for (let m = m0; m < m1; m += 1) visit(m, e);
  }
}

/**
 * The blocks of `days` (local, in `tz`), every one of them in the answer —
 * a day with nothing in it as `[]`.
 */
export function draftBlocks(
  inputs: DraftInputs,
  tz: string,
  days: readonly string[],
): Map<string, Block[]> {
  return draftDays(inputs, tz, days).days;
}

/**
 * {@link draftBlocks}, and which of the blocks took a key a dispatched session
 * lent (D-095) — for this machine to say so; it is never sent.
 */
export function draftDays(
  inputs: DraftInputs,
  tz: string,
  days: readonly string[],
): { days: Map<string, Block[]>; lent: Set<Block> } {
  const dayOf = dayFinder(tz);

  // --- lanes -----------------------------------------------------------------
  const lanes = new Map<string, { at: number; task: string | null; repo: string | null }[]>();
  const push = (lane: string, event: { at: number; task: string | null; repo: string | null }) => {
    const list = lanes.get(lane) ?? [];
    list.push(event);
    lanes.set(lane, list);
  };
  for (const r of inputs.replies) push(`s:${r.session}`, r);
  for (const at of inputs.prompts) push('p', { at, task: null, repo: null });
  const turns = personTurns(inputs.turns);
  for (const t of turns) push(`o:${t.session}`, { at: t.at, task: null, repo: null });

  // --- each lane's active minutes ---------------------------------------------
  const active = new Map<number, Map<string, LaneMinute>>();
  for (const [lane, events] of lanes) {
    eachActiveMinute(events, (m, e) => {
      let at = active.get(m);
      if (at === undefined) {
        at = new Map();
        active.set(m, at);
      }
      at.set(lane, { task: e.task, repo: e.repo, session: lane !== 'p' });
    });
  }

  // --- the keys dispatched sessions lend, by minute (D-095) -------------------
  // Their lanes follow the same rules and make no minute: only a minute the
  // person's lanes made, and left untied, ever asks for these.
  const dispatched = new Map<string, DispatchedEvent[]>();
  for (const d of inputs.dispatched ?? []) {
    const list = dispatched.get(d.session) ?? [];
    list.push(d);
    dispatched.set(d.session, list);
  }
  const lending = new Map<number, Set<string>>();
  for (const events of dispatched.values()) {
    eachActiveMinute(events, (m, e) => {
      if (e.task === null) return;
      const keys = lending.get(m) ?? new Set<string>();
      keys.add(e.task);
      lending.set(m, keys);
    });
  }

  // --- a commit's key, for a session's untied minutes in its repo -------------
  const keyed = new Map<string, { at: number; task: string }[]>();
  for (const c of inputs.commits) {
    if (c.task === null || c.repo === null) continue;
    const list = keyed.get(c.repo) ?? [];
    list.push({ at: c.at, task: c.task });
    keyed.set(c.repo, list);
  }
  for (const list of keyed.values()) list.sort((a, b) => a.at - b.at);
  const commitKey = (repo: string, minute: number): string | null => {
    const list = keyed.get(repo);
    if (list === undefined) return null;
    const from = minute * 60;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid]?.at ?? Infinity) < from) lo = mid + 1;
      else hi = mid;
    }
    const first = list[lo];
    return first !== undefined && first.at < from + 60 + COMMIT_REACH_S ? first.task : null;
  };

  // --- each minute's tasks, and its stretch -------------------------------------
  const info = new Map<number, MinuteInfo>();
  const stretches: { day: string; minutes: number[] }[] = [];
  let previous: number | undefined;
  let previousDay = '';
  for (const minute of [...active.keys()].sort((a, b) => a - b)) {
    const laneKeys = new Map<string, string | null>();
    const keys = new Set<string>();
    for (const [lane, at] of active.get(minute) ?? []) {
      const key = at.task ?? (at.session && at.repo !== null ? commitKey(at.repo, minute) : null);
      laneKeys.set(lane, key);
      if (key !== null) keys.add(key);
    }
    // None of the person's own: the keys of the dispatched sessions active in it.
    const lent = keys.size === 0 ? lending.get(minute) : undefined;
    for (const key of lent ?? []) keys.add(key);
    const day = dayOf(minute * 60);
    if (previous === undefined || minute !== previous + 1 || day !== previousDay) {
      stretches.push({ day, minutes: [] });
    }
    stretches.at(-1)?.minutes.push(minute);
    info.set(minute, {
      stretch: stretches.length - 1,
      keys: keys.size === 0 ? [null] : [...keys].sort(),
      lanes: laneKeys,
      lent: lent !== undefined,
    });
    previous = minute;
    previousDay = day;
  }

  // --- one block per task in each stretch ---------------------------------------
  const wanted = new Set(days);
  const building = stretches.map(() => new Map<string | null, Building>());
  stretches.forEach((stretch, s) => {
    if (!wanted.has(stretch.day)) return;
    const blocks = building[s] ?? new Map<string | null, Building>();
    for (const minute of stretch.minutes) {
      const at = info.get(minute);
      const keys = at?.keys ?? [null];
      for (const key of keys) {
        let b = blocks.get(key);
        if (b === undefined) {
          b = {
            first: minute,
            last: minute,
            share: 0,
            task: key,
            signals: zero(),
            sessions: new Set(),
            minutes: 0,
            lent: false,
          };
          blocks.set(key, b);
        }
        b.last = minute;
        b.share += 1 / keys.length;
        if (at?.lent === true) b.lent = true;
      }
    }
    // Largest remainder: whole minutes that add up to the stretch's own.
    const list = [...blocks.values()];
    for (const b of list) b.minutes = Math.floor(b.share + 1e-9);
    let left = stretch.minutes.length - list.reduce((n, b) => n + b.minutes, 0);
    list
      .slice()
      .sort(
        (a, b) =>
          b.share - Math.floor(b.share + 1e-9) - (a.share - Math.floor(a.share + 1e-9)) ||
          (a.task ?? '').localeCompare(b.task ?? ''),
      )
      .forEach((b) => {
        if (left > 0) {
          b.minutes += 1;
          left -= 1;
        }
      });
  });

  // --- what each block rests on ---------------------------------------------
  const blockAt = (minute: number, key: string | null): Building | undefined => {
    const at = info.get(minute);
    return at === undefined ? undefined : building[at.stretch]?.get(key);
  };
  const laneTarget = (minute: number, lane: string): Building | undefined => {
    const at = info.get(minute);
    if (at === undefined) return undefined;
    const own = at.lanes.get(lane);
    return blockAt(minute, own ?? at.keys[0] ?? null);
  };
  for (const r of inputs.replies) {
    const b = laneTarget(Math.floor(r.at / 60), `s:${r.session}`);
    if (b === undefined) continue;
    b.signals.replies += 1;
    b.sessions.add(r.session);
  }
  for (const m of inputs.marks) {
    const b = laneTarget(Math.floor(m.at / 60), `s:${m.session}`);
    if (b !== undefined) b.signals.marks += 1;
  }
  for (const t of turns) {
    const lane = `o:${t.session}`;
    const b = laneTarget(Math.floor(t.at / 60), lane);
    if (b === undefined) continue;
    if (t.kind === 'end') b.signals.replies += 1;
    b.sessions.add(lane);
  }
  // A prompt is evidence for every task its minute was split between.
  for (const at of inputs.prompts) {
    const minute = Math.floor(at / 60);
    for (const key of info.get(minute)?.keys ?? []) {
      const b = blockAt(minute, key);
      if (b !== undefined) b.signals.prompts += 1;
    }
  }
  // A commit lands in the stretch it closes: its own minute, or the active one
  // before it within reach; in its task's block when the stretch has one.
  for (const c of inputs.commits) {
    let minute = Math.floor(c.at / 60);
    const floor = minute - COMMIT_REACH_S / 60;
    while (minute >= floor && !info.has(minute)) minute -= 1;
    const at = info.get(minute);
    if (at === undefined) continue;
    const blocks = building[at.stretch];
    const b =
      (c.task !== null ? blocks?.get(c.task) : undefined) ?? blocks?.get(at.keys[0] ?? null);
    if (b !== undefined) b.signals.commits += 1;
  }

  // --- per day, capped -------------------------------------------------------
  const out = new Map<string, Block[]>(days.map((day) => [day, []]));
  const lent = new Set<Block>();
  const perDay = new Map<string, Building[]>();
  stretches.forEach((stretch, s) => {
    if (!wanted.has(stretch.day)) return;
    const blocks = [...(building[s]?.values() ?? [])];
    const largest = blocks.reduce<Building | undefined>(
      (best, b) => (best === undefined || b.minutes > best.minutes ? b : best),
      undefined,
    );
    for (const b of blocks) {
      b.signals.sessions = b.sessions.size;
      if (b.minutes > 0 || largest === undefined || b === largest) continue;
      // A task rounded to no whole minute keeps no block; its evidence goes
      // to the stretch's largest, which its minutes did.
      for (const k of ['prompts', 'replies', 'commits', 'marks'] as const) {
        largest.signals[k] += b.signals[k];
      }
      for (const session of b.sessions) largest.sessions.add(session);
      largest.signals.sessions = largest.sessions.size;
    }
    const kept = blocks.filter((b) => b.minutes > 0);
    perDay.set(stretch.day, [...(perDay.get(stretch.day) ?? []), ...kept]);
  });
  for (const [day, blocks] of perDay) {
    out.set(
      day,
      withinADay(capped(blocks)).map((b) => {
        const block = toBlock(b);
        if (b.lent) lent.add(block);
        return block;
      }),
    );
  }
  return { days: out, lent };
}

/** The most minutes the board takes for one day (§6.4's `invalid_blocks`). */
export const DAY_MINUTES = 1440;

/**
 * A day's blocks held to {@link DAY_MINUTES}. A local day can be longer: the
 * day a zone leaves daylight saving runs 25 hours, and a session active all
 * of it drafts up to 1500 minutes — which the board refuses, and with it every
 * other day in the report (LAI-787 review). Each block keeps its share, by
 * largest remainder; one left with no whole minute is not sent.
 */
function withinADay(blocks: Building[]): Building[] {
  const sum = blocks.reduce((n, b) => n + b.minutes, 0);
  if (sum <= DAY_MINUTES) return blocks;
  const shares = blocks.map((b) => (b.minutes * DAY_MINUTES) / sum);
  blocks.forEach((b, i) => {
    b.minutes = Math.floor((shares[i] ?? 0) + 1e-9);
  });
  let left = DAY_MINUTES - blocks.reduce((n, b) => n + b.minutes, 0);
  blocks
    .map((b, i) => ({ b, frac: (shares[i] ?? 0) - b.minutes }))
    .sort((x, y) => y.frac - x.frac || x.b.first - y.b.first)
    .forEach(({ b }) => {
      if (left > 0) {
        b.minutes += 1;
        left -= 1;
      }
    });
  return blocks.filter((b) => b.minutes > 0);
}

/**
 * At most {@link BLOCKS_PER_DAY_MAX} blocks a day. The shortest is merged
 * into the nearest block of the **same** task — the span grows, the minutes
 * add up, nothing is moved to another task; a shortest block with no
 * same-task partner is **dropped**, and its minutes with it: under-counting a
 * day is honest, tying minutes to a task they were not is not.
 */
function capped(blocks: Building[]): Building[] {
  const list = [...blocks];
  while (list.length > BLOCKS_PER_DAY_MAX) {
    list.sort((a, b) => a.minutes - b.minutes || a.first - b.first);
    const shortest = list.shift();
    if (shortest === undefined) break;
    let partner: Building | undefined;
    for (const b of list) {
      if (b.task !== shortest.task) continue;
      if (
        partner === undefined ||
        Math.abs(b.first - shortest.first) < Math.abs(partner.first - shortest.first)
      ) {
        partner = b;
      }
    }
    if (partner === undefined) continue;
    partner.first = Math.min(partner.first, shortest.first);
    partner.last = Math.max(partner.last, shortest.last);
    partner.minutes += shortest.minutes;
    partner.lent ||= shortest.lent;
    for (const k of ['prompts', 'replies', 'commits', 'marks'] as const) {
      partner.signals[k] += shortest.signals[k];
    }
    for (const session of shortest.sessions) partner.sessions.add(session);
    partner.signals.sessions = partner.sessions.size;
  }
  return list.sort((a, b) => a.first - b.first || (a.task ?? '').localeCompare(b.task ?? ''));
}

function toBlock(b: Building): Block {
  const cap = (n: number): number => Math.min(n, SIGNAL_MAX);
  return {
    start: b.first * 60_000,
    end: (b.last + 1) * 60_000,
    minutes: b.minutes,
    task: b.task,
    signals: {
      prompts: cap(b.signals.prompts),
      replies: cap(b.signals.replies),
      sessions: cap(b.signals.sessions),
      commits: cap(b.signals.commits),
      marks: cap(b.signals.marks),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reading what the machine holds                                             */
/* -------------------------------------------------------------------------- */

export interface DraftOptions {
  readonly paths: ActivityPaths;
  readonly roots: UsageRoots;
  readonly state: ActivityState;
  readonly tz: string;
  readonly nowS: number;
  /** How many local days, today included. */
  readonly days: number;
  readonly extraEmails: readonly string[];
  readonly git: GitRunner;
  /** The board's prefixes from this sync's answer; else the last one kept. */
  readonly prefixes?: readonly string[] | undefined;
  readonly signal?: AbortSignal;
  readonly stopAt?: number;
}

export interface Draft {
  /** Oldest day first; every day of the window, empty ones as `[]`. */
  readonly days: Map<string, Block[]>;
  /** Local only, never sent: the blocks that took a key a dispatched session lent (D-095). */
  readonly lent: ReadonlySet<Block>;
  /** What the blocks were built from, counted — for `laika time draft`. */
  readonly read: {
    readonly replies: number;
    readonly prompts: number;
    readonly commits: number;
    readonly marks: number;
    /** Omnigent orchestrator turns the person began (LAI-792). */
    readonly turns: number;
    /** Omnigent orchestrator turns Omnigent began itself, left out (D-090). */
    readonly runtimeTurns: number;
    /** Replies of sessions Omnigent dispatched, read for their keys alone (D-095). */
    readonly dispatched: number;
  };
}

const PROMPT_LINE = /^p ([a-z0-9-]{1,40}) (\d{1,12})$/;
const TURN_LINE = /^([twr]) ([a-z0-9-]{1,40}) (\d{1,12}) ([A-Za-z0-9._-]{1,128})$/;
const TURN_KIND = { t: 'start', w: 'wake', r: 'end' } as const;

/** `events.log`, and a half-compacted one a crashed sync left. */
function eventLines(paths: ActivityPaths): string[] {
  return `${readText(paths.eventsCompacting) ?? ''}\n${readText(paths.events) ?? ''}`.split('\n');
}

/** Prompt times from `events.log`, for the drafting agents. */
function promptTimes(lines: readonly string[], fromS: number): number[] {
  const agents = new Set(DRAFT_AGENTS);
  const out: number[] = [];
  for (const line of lines) {
    const match = PROMPT_LINE.exec(line.trim());
    if (match === null || !agents.has(match[1] ?? '')) continue;
    const at = Number(match[2]);
    if (at >= fromS) out.push(at);
  }
  return out;
}

/**
 * An orchestrator's turns from `events.log` (LAI-792): `t` the person started
 * one, `w` Omnigent did (D-090), `r` one ended.
 */
function turnTimes(lines: readonly string[], fromS: number): TurnEvent[] {
  const agents = new Set(TURN_AGENTS);
  const out: TurnEvent[] = [];
  for (const line of lines) {
    const match = TURN_LINE.exec(line.trim());
    if (match === null || !agents.has(match[2] ?? '')) continue;
    const at = Number(match[3]);
    const kind = TURN_KIND[(match[1] ?? 'r') as keyof typeof TURN_KIND];
    if (at >= fromS) out.push({ at, session: match[4] ?? '', kind });
  }
  return out;
}

const COMMON = ['--no-merges', '--no-use-mailmap', '--no-show-signature', '--no-color'];
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * The person's commits since `fromS` in the repos the hook has seen sessions
 * start in (in scope), each with the repo's identity and the one key its
 * subject carries that the board serves. The subject is read here and goes
 * no further than this loop.
 */
async function draftCommits(options: {
  readonly paths: ActivityPaths;
  readonly state: ActivityState;
  readonly nowS: number;
  readonly fromS: number;
  readonly extraEmails: readonly string[];
  readonly git: GitRunner;
  readonly serves: (key: string) => boolean;
  readonly signal?: AbortSignal;
  readonly stopAt?: number;
}): Promise<CommitEvent[]> {
  const { git } = options;
  const repos = await reposInScope(
    rememberedRepos(options.paths, options.nowS),
    options.state.scope,
  );
  const seen = new Set<string>();
  const shas = new Set<string>();
  const out: CommitEvent[] = [];
  for (const repo of repos) {
    if (
      options.signal?.aborted === true ||
      (options.stopAt !== undefined && Date.now() > options.stopAt)
    ) {
      break;
    }
    const gitDir = await commonGitDir(git, repo);
    if (gitDir === undefined || seen.has(gitDir)) continue;
    seen.add(gitDir);
    const own = (await git(repo, ['config', '--get', 'user.email']))?.trim().toLowerCase();
    const mine = new Set(options.extraEmails.map((e) => e.toLowerCase()));
    if (own !== undefined && own !== '') mine.add(own);
    if (mine.size === 0) continue;
    const hasHead = (await git(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) !== undefined;
    const log = await git(repo, [
      'log',
      '--branches',
      '--remotes',
      ...(hasHead ? ['HEAD'] : []),
      ...COMMON,
      // `--since` is the committer date; a day's margin keeps a rebased commit.
      `--since=@${String(options.fromS - 86_400)}`,
      '--format=%H%x09%at%x09%ae%x09%s',
    ]);
    for (const line of (log ?? '').split('\n')) {
      const [sha, at, email, ...rest] = line.split('\t');
      if (sha === undefined || !SHA.test(sha) || shas.has(sha)) continue;
      const epoch = Number(at);
      if (!Number.isFinite(epoch) || epoch < options.fromS) continue;
      if (!mine.has((email ?? '').trim().toLowerCase())) continue;
      shas.add(sha);
      const keys = [...new Set(textKeys(rest.join('\t')).filter(options.serves))];
      out.push({ at: epoch, repo: gitDir, task: keys.length === 1 ? (keys[0] ?? null) : null });
    }
  }
  return out;
}

/**
 * The blocks of the last `days` local days, from what this machine holds.
 * Reads what is new, as `status` does, and writes nothing.
 */
export async function buildDraft(options: DraftOptions): Promise<Draft> {
  const { tz, nowS } = options;
  const today = localDay(nowS, tz);
  const span = Math.max(1, Math.trunc(options.days));
  const days = Array.from({ length: span }, (_, i) => addDays(today, i - (span - 1)));
  const first = days[0] ?? today;
  // The day before too: a stretch that began before midnight reaches into the first.
  const before = addDays(first, -1);
  const fromS = Math.floor(Date.parse(`${before}T00:00:00Z`) / 1000) - 14 * 3600;

  const sources = await draftSources({
    paths: options.paths,
    roots: options.roots,
    state: options.state,
    tz,
    nowS,
    days: [before, ...days],
    prefixes: options.prefixes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.stopAt === undefined ? {} : { stopAt: options.stopAt }),
  });
  // Nothing is tied to a task until the board has named the prefixes it serves.
  const served = sources.prefixes === undefined ? undefined : new Set(sources.prefixes);
  const serves = (key: string): boolean => served?.has(key.slice(0, key.lastIndexOf('-'))) === true;

  const commits = await draftCommits({
    paths: options.paths,
    state: options.state,
    nowS,
    fromS,
    extraEmails: options.extraEmails,
    git: options.git,
    serves,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.stopAt === undefined ? {} : { stopAt: options.stopAt }),
  });

  // A session's repository, only when a commit could name its task.
  const repoOf = new Map<string, string | null>();
  if (commits.some((c) => c.task !== null)) {
    const byTop = new Map<string, string | null>();
    for (const cwd of new Set(sources.replies.map((r) => r.cwd))) {
      if (cwd === undefined) continue;
      const top = toplevelOf(cwd);
      if (top === undefined) {
        repoOf.set(cwd, null);
        continue;
      }
      if (!byTop.has(top)) byTop.set(top, (await commonGitDir(options.git, top)) ?? null);
      repoOf.set(cwd, byTop.get(top) ?? null);
    }
  }
  const replies: ReplyEvent[] = sources.replies.map((r) => ({
    at: r.at,
    session: r.session,
    repo: r.cwd === undefined ? null : (repoOf.get(r.cwd) ?? null),
    task: r.task,
  }));
  const lines = eventLines(options.paths);
  const prompts = promptTimes(lines, fromS);
  const turns = turnTimes(lines, fromS);
  const dispatched: DispatchedEvent[] = sources.dispatched.map((r) => ({
    at: r.at,
    session: r.session,
    task: r.task,
  }));
  const drafted = draftDays(
    { replies, prompts, commits, marks: sources.marks, turns, dispatched },
    tz,
    days,
  );
  return {
    days: drafted.days,
    lent: drafted.lent,
    read: {
      replies: replies.length,
      prompts: prompts.length,
      commits: commits.length,
      marks: sources.marks.length,
      turns: turns.filter((t) => t.kind === 'start').length,
      runtimeTurns: turns.filter((t) => t.kind === 'wake').length,
      dispatched: dispatched.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The report, and the step of the sync                                       */
/* -------------------------------------------------------------------------- */

/** What the board said about the two switches (`GET /me/time-settings`, SPEC §6.4). */
export interface TimeSettings {
  readonly org_mode: string;
  readonly draft_my_time: boolean;
  readonly drafting: boolean;
}

/** A call's answer — `activity-sync.ts`'s `Call`, by shape. */
export type TimeAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status?: number;
      readonly code?: string;
      readonly reason?: string;
      readonly retryAfterS?: number;
      readonly message: string;
    };

export type TimeOutcome =
  /** Not asked this run: drafting was off when last asked, within the hour. */
  | { readonly kind: 'skipped' }
  | { readonly kind: 'off' }
  /** An older board with no time drafts. */
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'sent';
      readonly reports: number;
      readonly days: number;
      readonly pending: number;
    }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'error'; readonly message: string };

export interface TimeContext extends DraftOptions {
  readonly collectorId: string;
  readonly settings: () => Promise<TimeAnswer<TimeSettings>>;
  readonly send: (body: string) => Promise<TimeAnswer<unknown>>;
}

/** What the board last took, per day — 0600, local; deleted when drafting is off. */
export function timeDraftsFile(paths: ActivityPaths): string {
  return join(paths.dir, 'time-drafts.json');
}

/**
 * Written by the hook for an orchestrator's primary session (D-088 item 9):
 * a Claude Code primary's session id, or an Omnigent-native orchestrator's
 * Omnigent session id (LAI-792).
 */
export function primarySessionsFile(paths: ActivityPaths): string {
  return join(paths.dir, 'primary-sessions');
}

/** How many primary sessions the hook counted as the person's. */
export function primarySessions(paths: ActivityPaths): number {
  const ids = new Set<string>();
  for (const line of (readText(primarySessionsFile(paths)) ?? '').split('\n')) {
    const id = line.split(' ')[1];
    if (id !== undefined && /^[A-Za-z0-9._-]{1,128}$/.test(id)) ids.add(id);
  }
  return ids.size;
}

interface Memory {
  v: 1;
  /** Per day, the blocks the board last accepted, as a signature. */
  sent: Record<string, string>;
}

function readMemory(paths: ActivityPaths): Memory {
  try {
    const raw = JSON.parse(readText(timeDraftsFile(paths)) ?? '') as Partial<Memory>;
    if (raw.v === 1 && typeof raw.sent === 'object' && raw.sent !== null) {
      return { v: 1, sent: { ...raw.sent } };
    }
  } catch {
    // Absent or torn: everything is due again, which the board takes as a replace.
  }
  return { v: 1, sent: {} };
}

function forget(paths: ActivityPaths): void {
  rmSync(timeDraftsFile(paths), { force: true });
}

/** The body `PUT /me/time-drafts` takes (SPEC §6.4). */
export function timeDraftBody(
  collectorId: string,
  tz: string,
  days: readonly { readonly day: string; readonly blocks: readonly Block[] }[],
): string {
  return JSON.stringify({ v: 1, collector_id: collectorId, tz, days });
}

/** Days as reports of at most 16 KB, oldest first; a day is never split. */
export function timeDraftReports(
  collectorId: string,
  tz: string,
  days: readonly { readonly day: string; readonly blocks: readonly Block[] }[],
): { readonly body: string; readonly days: readonly string[] }[] {
  const reports: { body: string; days: string[] }[] = [];
  let batch: { day: string; blocks: readonly Block[] }[] = [];
  for (const entry of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const next = [...batch, entry];
    if (
      batch.length > 0 &&
      Buffer.byteLength(timeDraftBody(collectorId, tz, next)) > MAX_BODY_BYTES
    ) {
      reports.push({ body: timeDraftBody(collectorId, tz, batch), days: batch.map((d) => d.day) });
      batch = [entry];
    } else {
      batch = next;
    }
  }
  if (batch.length > 0) {
    reports.push({ body: timeDraftBody(collectorId, tz, batch), days: batch.map((d) => d.day) });
  }
  return reports;
}

/**
 * Ask the board whether drafting is on — every sync while it is, at most once
 * an hour while it is not — and, when it is, send the days whose blocks
 * changed since it last took them. Off, or refused `time_drafts_off`, forgets
 * what was sent. Never throws: a failure is recorded and the sync goes on.
 */
export async function timeStep(ctx: TimeContext): Promise<TimeOutcome> {
  const { paths, state, nowS } = ctx;
  try {
    if (
      state.drafting !== true &&
      state.drafting_checked_at !== undefined &&
      nowS - state.drafting_checked_at < TIME_RECHECK_S
    ) {
      return { kind: 'skipped' };
    }
    const settings = await ctx.settings();
    if (!settings.ok) {
      if (settings.status === 404) {
        forget(paths);
        return { kind: 'unsupported' };
      }
      const message = `time drafts: asking whether drafting is on: ${settings.message}`;
      recordError(paths, nowS, message);
      return { kind: 'error', message };
    }
    if (!settings.value.drafting) {
      forget(paths);
      return { kind: 'off' };
    }

    const draft = await buildDraft(ctx);
    const memory = readMemory(paths);
    const first = [...draft.days.keys()][0] ?? '';
    for (const day of Object.keys(memory.sent)) if (day < first) delete memory.sent[day];
    const due: { day: string; blocks: Block[]; signature: string }[] = [];
    for (const [day, blocks] of draft.days) {
      const signature = JSON.stringify(blocks);
      const held = memory.sent[day];
      // An empty day goes only to empty what the board was given for it.
      const changed =
        blocks.length === 0 ? held !== undefined && held !== '[]' : held !== signature;
      if (changed) due.push({ day, blocks, signature });
    }
    const write = (): void => {
      writeFile600(timeDraftsFile(paths), `${JSON.stringify(memory)}\n`);
    };
    if (due.length === 0) {
      write();
      return { kind: 'idle' };
    }
    const signatureOf = new Map(due.map((d) => [d.day, d.signature]));
    const reports = timeDraftReports(
      ctx.collectorId,
      ctx.tz,
      due.map(({ day, blocks }) => ({ day, blocks })),
    );
    let sent = 0;
    let sentDays = 0;
    for (const report of reports) {
      if (sent >= TIME_REPORTS_PER_RUN) break;
      if (ctx.signal?.aborted === true || (ctx.stopAt !== undefined && Date.now() > ctx.stopAt)) {
        break;
      }
      const answer = await ctx.send(report.body);
      if (!answer.ok) {
        if (answer.status === 403 && answer.reason === 'time_drafts_off') {
          forget(paths);
          return { kind: 'off' };
        }
        if (answer.status === 429) return { kind: 'rate-limited' };
        const message = `time drafts: ${answer.message}`;
        recordError(paths, nowS, message);
        return { kind: 'error', message };
      }
      sent += 1;
      for (const day of report.days) {
        memory.sent[day] = signatureOf.get(day) ?? '[]';
        sentDays += 1;
      }
      write();
    }
    return { kind: 'sent', reports: sent, days: sentDays, pending: due.length - sentDays };
  } catch (cause) {
    const message = `time drafts: ${cause instanceof Error ? cause.message : String(cause)}`;
    recordError(paths, nowS, message);
    return { kind: 'error', message };
  }
}
