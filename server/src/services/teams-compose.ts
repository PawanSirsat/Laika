import { type TeamsNotice, type TeamsTable } from './teams-message.ts';

/**
 * What each Teams post says (D-154, LAI-1314) — KSage's stand-up
 * (`scheduled.rs`'s `build_update`), nightly digest (`send_digest`) and
 * instant notices (`notify.rs`'s `item_notice`), in Laika's terms.
 *
 * **Pure: composed from data already gathered**, as KSage's `build_update`
 * is, so the template itself can be checked without a database, a clock or a
 * channel. `teams-posting.ts` gathers and sends.
 *
 * ## KSage's words, Laika's things
 *
 * | KSage | Laika |
 * | --- | --- |
 * | project, its code (`RMB`) | space, its key prefix (`LAI`) |
 * | work item `RMB-52` | task `LAI-52` |
 * | owner | assignee |
 * | project lead, else an administrator | the space's lead |
 * | blocked (a pause, with a cause) | a task with a dependency not done (`blocked_by`) |
 * | on hold (our own choice) | stale (in progress, untouched — §11.6 flags it) |
 * | in progress, unit testing, QA | `in_progress` |
 * | UAT, *with the client* | `review`, *waiting for review* |
 * | due date | `due_on` |
 * | signed off | `done` |
 * | the audit log's `item.*` rows | `activity`'s `task.*` rows |
 *
 * The times are KSage's: IST, because the people who read these are in India,
 * and SAST for the nightly digest's day, because the working day is South
 * African. Both have no daylight saving, so each is a fixed offset.
 */

/** UTC+05:30, India. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** UTC+02:00, South Africa. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StandupRun = 'morning' | 'evening';

/** One run's hour, label and the next run — KSage's `Run`. */
export const STANDUP_RUNS: Readonly<
  Record<StandupRun, { hourIst: number; minuteIst: number; label: string; next: string }>
> = {
  morning: {
    hourIst: 11,
    minuteIst: 0,
    label: '11:00 AM IST Run Update',
    next: '06:00 PM IST today',
  },
  evening: {
    hourIst: 18,
    minuteIst: 0,
    label: '06:00 PM IST Run Update',
    next: '11:00 AM IST on the next working day',
  },
};

/** When the nightly digest goes: 09:00 SAST, 07:00 UTC — KSage's nightly tick. */
export const DIGEST_HOUR_SAST = 9;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The wall clock in a fixed offset, read with the UTC getters. */
function wall(ms: number, offsetMs: number): Date {
  return new Date(ms + offsetMs);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of an instant, in a fixed offset. */
function dayIn(ms: number, offsetMs: number): string {
  return wall(ms, offsetMs).toISOString().slice(0, 10);
}

/** The IST calendar date of an instant — what a stand-up slot is keyed by. */
export function istDay(ms: number): string {
  return dayIn(ms, IST_OFFSET_MS);
}

/** The SAST calendar date of an instant. */
export function sastDay(ms: number): string {
  return dayIn(ms, SAST_OFFSET_MS);
}

/** The instant a wall-clock time on an IST date is. */
export function istInstant(day: string, hour: number, minute = 0): number {
  return Date.parse(`${day}T${pad2(hour)}:${pad2(minute)}:00Z`) - IST_OFFSET_MS;
}

/** The instant midnight starts a SAST date. */
export function sastMidnight(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - SAST_OFFSET_MS;
}

/** The day before a `YYYY-MM-DD`. */
export function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Saturday or Sunday, for a `YYYY-MM-DD`. */
export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** `Wed 21 Oct 2026, 11:00 IST`. */
export function formatIst(ms: number, withYear = true): string {
  const d = wall(ms, IST_OFFSET_MS);
  const date = `${WEEKDAYS[d.getUTCDay()] ?? ''} ${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''}`;
  return `${date}${withYear ? ` ${String(d.getUTCFullYear())}` : ''}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} IST`;
}

/**
 * The period a run reports on: everything since the previous run. The evening
 * run looks back at this morning; the morning run to the previous *weekday*
 * evening, so Monday's covers the weekend instead of dropping it.
 */
export function windowStart(run: StandupRun, now: number): number {
  const today = istDay(now);
  if (run === 'evening') {
    return istInstant(today, STANDUP_RUNS.morning.hourIst, STANDUP_RUNS.morning.minuteIst);
  }
  let day = dayBefore(today);
  while (isWeekend(day)) day = dayBefore(day);
  return istInstant(day, STANDUP_RUNS.evening.hourIst, STANDUP_RUNS.evening.minuteIst);
}

/** A space as a post names it. */
export interface TeamsSpace {
  readonly name: string;
  readonly prefix: string;
  readonly slug: string;
}

/** `/board?project=<slug>` on this Laika — KSage's `/?project=<code>`. */
export function boardLink(publicUrl: string | null, slug: string): string | null {
  if (publicUrl === null || publicUrl === '') return null;
  return `${publicUrl.replace(/\/+$/, '')}/board?project=${encodeURIComponent(slug)}`;
}

/** `/task/<key>` on this Laika — KSage's `/i/<code>`. */
export function taskLink(publicUrl: string | null, key: string): string | null {
  if (publicUrl === null || publicUrl === '') return null;
  return `${publicUrl.replace(/\/+$/, '')}/task/${encodeURIComponent(key)}`;
}

// -------------------------------------------------------------- the stand-up

/** A task waiting on another that is not done. */
export interface StandupBlocked {
  readonly key: string;
  readonly title: string;
  readonly assignee: string;
  /** The open blockers' keys, oldest dependency first. */
  readonly waitingOn: readonly string[];
  /** Days since its oldest open dependency was added. */
  readonly days: number;
}

/** A task in progress that §11.6 flagged as untouched — KSage's *on hold*. */
export interface StandupStale {
  readonly key: string;
  readonly title: string;
  readonly assignee: string;
  /** Days since anything touched it. */
  readonly days: number;
}

export interface StandupOverdue {
  readonly key: string;
  readonly title: string;
  readonly assignee: string;
  /** Whole days past `due_on`; 0 is due today. */
  readonly late: number;
}

/** One task in progress and not blocked, by who carries it. */
export interface StandupInFlight {
  readonly assignee: string;
  readonly key: string;
}

/** One change in the window, from `activity`. */
export interface StandupUpdate {
  readonly key: string;
  readonly title: string;
  readonly change: string;
  readonly who: string;
}

/** Everything one stand-up is composed from — KSage's `UpdateData`. */
export interface StandupData {
  readonly blocked: readonly StandupBlocked[];
  readonly stale: readonly StandupStale[];
  readonly overdue: readonly StandupOverdue[];
  /** Ordered by assignee, so one person's tasks are adjacent. */
  readonly inFlight: readonly StandupInFlight[];
  readonly inReview: number;
  readonly lead: string | null;
  /** Newest first, at most {@link UPDATES_FETCHED}. */
  readonly updates: readonly StandupUpdate[];
}

/**
 * How many of the window's changes are read. A full page is a floor and not
 * a count, so the heading says `25+` rather than a number that is quietly
 * wrong.
 */
export const UPDATES_FETCHED = 25;
/** How many of them are listed before the rest are counted. */
const UPDATES_SHOWN = 10;
/** How many blocked tasks are written out before the rest become a count. */
const BLOCKED_SHOWN = 5;
/** How many keys one person's In flight row names. */
const KEYS_SHOWN = 6;
/** How many stale tasks are written out before the rest become a count. */
export const STALE_SHOWN = 25;

/**
 * What a post says of a blocker in another space: that it is there, never its
 * key or title. A dependency may cross spaces (`addTaskDependency`), and each
 * space's channel is read by that space's people only (D-154 item 1).
 */
export const OTHER_SPACE_BLOCKER = 'a task in another space';

function waited(days: number): string {
  const whole = Math.floor(days);
  if (whole <= 0) return 'since this morning';
  if (whole === 1) return 'for a day';
  return `for ${String(whole)} days`;
}

function howLate(late: number): string {
  if (late <= 0) return 'due today';
  if (late === 1) return 'a day late';
  return `${String(late)} days late`;
}

/**
 * One space's stand-up for one run — KSage's `build_update`. Every section is
 * always present, empty or not: two runs a day are read by comparing one
 * against the other, and a section that vanishes when it is empty cannot be
 * compared.
 */
export function buildStandup(
  space: TeamsSpace,
  run: StandupRun,
  now: number,
  publicUrl: string | null,
  data: StandupData,
): TeamsNotice {
  const { blocked, stale, overdue, inFlight, inReview, updates } = data;
  const since = windowStart(run, now);

  // One indicator, in the order that matters: a blocked task needs somebody
  // today, a late or stale one this week, work moving needs nobody — and
  // *not started* last, because it is also true of a space nobody touched.
  const status =
    blocked.length > 0
      ? '🔴 Blocked'
      : stale.length > 0 || overdue.length > 0
        ? '🟡 At Risk'
        : inFlight.length > 0 || inReview > 0
          ? '🟢 On Track'
          : '⚪ Not Started';

  const parts: string[] = [];
  if (blocked.length > 0) parts.push(`Blocked ${String(blocked.length)}`);
  if (stale.length > 0) parts.push(`Stale ${String(stale.length)}`);
  if (overdue.length > 0) parts.push(`Past their date ${String(overdue.length)}`);
  if (inReview > 0) parts.push(`In review ${String(inReview)}`);
  if (inFlight.length > 0) parts.push(`In flight ${String(inFlight.length)}`);
  const lines = [
    parts.length === 0 ? 'Nothing blocked, nothing late, nothing in flight.' : parts.join('  ·  '),
  ];

  const tables: TeamsTable[] = [];

  // Key updates first: the only section that is new information.
  {
    const full = updates.length >= UPDATES_FETCHED;
    const rows: string[][] = updates
      .slice(0, UPDATES_SHOWN)
      .map((u) => [u.key, u.title, u.change, u.who]);
    if (updates.length > UPDATES_SHOWN) {
      const more = String(updates.length - UPDATES_SHOWN);
      rows.push([
        '',
        full ? `… and at least ${more} more changes` : `… and ${more} more changes`,
        '',
        '',
      ]);
    }
    tables.push({
      heading: `Key updates (${full ? `${String(UPDATES_FETCHED)}+` : String(updates.length)}) — since ${formatIst(since, false)}`,
      headers: ['Task', 'What', 'Change', 'Who'],
      rows,
      note: updates.length === 0 ? 'Nothing moved in this window.' : null,
    });
  }

  {
    const rows: string[][] = blocked.slice(0, BLOCKED_SHOWN).map((b) => {
      const first = b.waitingOn[0] ?? '';
      const others = b.waitingOn.length - 1;
      const on = others > 0 ? `${first} and ${String(others)} more` : first;
      return [b.key, b.title, b.assignee, `${waited(b.days)} · waiting on ${on}`];
    });
    if (blocked.length > BLOCKED_SHOWN) {
      // Oldest first, so the tail is the newest — hence "at least".
      const rest = blocked.slice(BLOCKED_SHOWN);
      const newest = Math.min(...rest.map((b) => Math.floor(b.days)));
      rows.push([
        '',
        `… and ${String(rest.length)} more, each waiting at least ${String(newest)} days`,
        '',
        '',
      ]);
    }
    tables.push({
      heading: `Blocked (${String(blocked.length)}) — needs a decision today`,
      headers: ['Task', 'What', 'Who', 'Waiting'],
      rows,
      note: blocked.length === 0 ? 'Nothing blocked.' : null,
    });
  }

  // Capped like the other lists: a space with forty untouched tasks has a
  // problem the first 25 already show, and the count says the rest.
  const staleRows: string[][] = stale
    .slice(0, STALE_SHOWN)
    .map((s) => [s.key, s.title, s.assignee, waited(s.days)]);
  if (stale.length > STALE_SHOWN) {
    staleRows.push(['', `… and ${String(stale.length - STALE_SHOWN)} more`, '', '']);
  }
  tables.push({
    heading: `Stale (${String(stale.length)}) — in progress and untouched, worth re-checking`,
    headers: ['Task', 'What', 'Who', 'Idle'],
    rows: staleRows,
    note: stale.length === 0 ? 'Nothing stale.' : null,
  });

  tables.push({
    heading: `Past their date (${String(overdue.length)})`,
    headers: ['Task', 'What', 'Who', 'How late'],
    rows: overdue.map((o) => [o.key, o.title, o.assignee, howLate(o.late)]),
    note: overdue.length === 0 ? 'Nothing past its due date.' : null,
  });

  {
    // One row per person, not per task: how much each is carrying, and enough
    // keys to point at one — not a copy of the board.
    const byAssignee: { assignee: string; keys: string[] }[] = [];
    for (const task of inFlight) {
      const last = byAssignee.at(-1);
      if (last?.assignee === task.assignee) last.keys.push(task.key);
      else byAssignee.push({ assignee: task.assignee, keys: [task.key] });
    }
    tables.push({
      heading: `In flight (${String(inFlight.length)})`,
      headers: ['Who', 'Carrying', 'Tasks'],
      rows: byAssignee.map(({ assignee, keys }) => {
        const shown = keys.slice(0, KEYS_SHOWN).join(', ');
        const more = keys.length - KEYS_SHOWN;
        return [
          assignee,
          String(keys.length),
          more > 0 ? `${shown}, +${String(more)} more` : shown,
        ];
      }),
      note: inFlight.length === 0 ? 'Nothing in flight.' : null,
    });
  }

  // Derived from the counts above and nothing else: an action this job
  // invents is one nobody agreed to.
  const actions: string[] = [];
  if (blocked.length > 0) {
    actions.push(
      `Decide or escalate ${String(blocked.length)} blocked task(s) — each is listed with how long it has waited.`,
    );
  }
  if (overdue.length > 0) {
    actions.push(`Re-date or close ${String(overdue.length)} task(s) already past their due date.`);
  }
  if (stale.length > 0) {
    actions.push(
      `Re-check ${String(stale.length)} stale task(s) — in progress, and nobody has touched them.`,
    );
  }
  if (inReview > 0) actions.push(`Review ${String(inReview)} task(s) waiting in Review.`);
  if (actions.length === 0) actions.push('Nothing from this run needs a decision.');
  actions.push(`Next update: ${STANDUP_RUNS[run].next}.`);

  const label = STANDUP_RUNS[run].label;
  return {
    title: `${space.name} (${space.prefix}) — Daily Update`,
    label,
    // Fixed names, fixed order, on both runs whatever they hold.
    fields: [
      ['Run', label],
      ['Status', status],
      ['As of', formatIst(now)],
      ['Owner', data.lead ?? '(no space lead set)'],
    ],
    lines,
    tables,
    actions,
    link: boardLink(publicUrl, space.slug),
  };
}

// ------------------------------------------------------------ the digest

export interface DigestMoved {
  readonly key: string;
  readonly title: string;
  /** The status it ended the day in, by its name on the board. */
  readonly status: string;
}

export interface DigestBlocked {
  readonly key: string;
  readonly waitingOn: readonly string[];
}

export interface DigestData {
  readonly moved: readonly DigestMoved[];
  readonly blocked: readonly DigestBlocked[];
  readonly inReview: number;
}

/**
 * Yesterday in one message — KSage's nightly `send_digest` (COL-007). Stuck
 * work leads, because a digest that opens with good news is one people stop
 * reading. **Nothing moved and nothing stuck sends nothing** (null): a daily
 * message that is usually empty trains people to ignore the one that is not.
 */
export function buildDigest(
  space: TeamsSpace,
  day: string,
  publicUrl: string | null,
  data: DigestData,
): TeamsNotice | null {
  const { moved, blocked, inReview } = data;
  if (moved.length === 0 && blocked.length === 0) return null;

  const lines: string[] = [];
  if (blocked.length > 0) {
    lines.push(`Blocked (${String(blocked.length)}):`);
    for (const b of blocked) lines.push(`  ${b.key} — waiting on ${b.waitingOn.join(', ')}`);
    lines.push('');
  }
  if (inReview > 0) {
    lines.push(`Waiting for review: ${String(inReview)}`);
    lines.push('');
  }
  if (moved.length === 0) {
    lines.push('Nothing moved yesterday.');
  } else {
    lines.push(`Moved (${String(moved.length)}):`);
    for (const m of moved) lines.push(`  ${m.key} — ${m.title} → ${m.status}`);
  }

  return {
    title: `${space.name} (${space.prefix}) — ${day}`,
    lines,
    link: boardLink(publicUrl, space.slug),
  };
}

// ------------------------------------------------------- the instant notices

/**
 * The things worth interrupting a channel for — KSage's `ItemEvent`, in
 * Laika's terms. The list is short on purpose: a channel that pings on every
 * status change is a channel everybody mutes.
 */
export type TaskEvent =
  /** Somebody now has this and did not before, given by somebody else. */
  | { readonly kind: 'assigned'; readonly to: string; readonly by: string }
  /** Out of review and back to work — KSage's *sent back*. */
  | {
      readonly kind: 'sent_back';
      readonly from: string;
      readonly to: string;
      readonly assignee: string;
    }
  /** Into review — KSage's *awaiting sign-off*. */
  | { readonly kind: 'in_review'; readonly to: string }
  /** Done — KSage's *signed off*. */
  | { readonly kind: 'done'; readonly to: string; readonly by: string }
  /** Waiting on a task that is not done. */
  | {
      readonly kind: 'blocked';
      /** The blocker as the post may name it: `LAI-9 Its title`, or {@link OTHER_SPACE_BLOCKER}. */
      readonly waitingOn: string;
      readonly assignee: string;
    }
  /** The last thing it waited on is done, or no longer in its way. */
  | { readonly kind: 'unblocked'; readonly assignee: string };

/**
 * The notice for one of those — KSage's `item_notice`. The person's name leads
 * the first line where a person is the news: a shared channel is scanned, and
 * a name in the middle of a sentence is a name nobody sees.
 */
export function buildTaskNotice(
  task: { readonly key: string; readonly title: string },
  spaceName: string,
  publicUrl: string | null,
  event: TaskEvent,
): TeamsNotice {
  const { key, title } = task;
  let headline: string;
  let lines: string[];
  switch (event.kind) {
    case 'assigned':
      headline = `${event.to} — ${key} is yours`;
      lines = [title, `Handed over by ${event.by}.`];
      break;
    case 'sent_back':
      headline = `${event.assignee} — ${key} came back from ${event.from}`;
      lines = [title, `Now in ${event.to}.`];
      break;
    case 'in_review':
      headline = `${key} is waiting for review`;
      lines = [title, `It is in ${event.to}, with a person to review and accept.`];
      break;
    case 'done':
      headline = `${key} is done — ${event.by}`;
      lines = [title, `Moved to ${event.to}.`];
      break;
    case 'blocked':
      headline = `${key} is blocked — ${event.assignee}`;
      lines = [title, `Waiting on: ${event.waitingOn}`];
      break;
    case 'unblocked':
      headline = `${key} is unblocked — ${event.assignee}`;
      lines = [title, 'Whatever was in the way has been cleared.'];
      break;
  }
  return {
    title: headline,
    lines: [...lines, `Space: ${spaceName}`],
    link: taskLink(publicUrl, key),
  };
}

/** The longest comment a notice carries before it says the rest is in Laika. */
export const COMMENT_SHOWN = 1000;

/**
 * A comment, as KSage posted every one — `comments.rs`: the title, who wrote
 * it and in what role, and what they wrote.
 */
export function buildCommentNotice(
  task: { readonly key: string; readonly title: string },
  author: { readonly name: string; readonly role: string | null },
  body: string,
  publicUrl: string | null,
): TeamsNotice {
  // By code point, so an emoji at the cut is kept whole or left out whole —
  // never half a surrogate pair, which the escaping would send as a lone `\ud83d`.
  const points = [...body];
  const text =
    points.length > COMMENT_SHOWN ? `${points.slice(0, COMMENT_SHOWN).join('').trimEnd()} …` : body;
  return {
    title: `New comment on ${task.key}`,
    lines: [
      task.title,
      author.role === null ? author.name : `${author.name} · ${author.role}`,
      '',
      ...text.split(/\r?\n/),
    ],
    link: taskLink(publicUrl, task.key),
  };
}

/**
 * KSage's `notify-test`: the only way to know a channel works is to post to
 * it. A URL being present proves nothing — a flow whose trigger is set to
 * *Any user in my tenant* refuses every post and looks configured from every
 * screen but this one.
 */
export function buildTestPost(space: TeamsSpace, publicUrl: string | null): TeamsNotice {
  return {
    title: `Laika is connected to this channel — ${space.name} (${space.prefix})`,
    lines: [
      'Stand-ups, the nightly digest and notices for this space will arrive here, and nowhere else.',
      'If you are reading this in the wrong channel, the flow is pointed at the wrong chat.',
    ],
    link: boardLink(publicUrl, space.slug),
  };
}
