import type { AgentClient } from '../../../../api/agent-clients.ts';
import type { AwayPeriod } from '../../../../api/availability.ts';
import type {
  ProfileAgentToken,
  ProfileDelivery,
  ProfileProject,
} from '../../../../api/profiles.ts';
import type { SummaryDay } from '../../../../api/time.ts';
import type { UsageAgentSlice } from '../../../../api/usage.ts';
import { connected, durationLabel } from '../profile-derive.ts';

/**
 * How the profile's Overview rows read (SPEC §11.4.2.1, D-139, LAI-1153).
 *
 * Every figure is a response's; nothing here counts anything the server did
 * not. These functions only decide order, folding and words — and the one
 * rule the profile keeps everywhere: an absence is said, never drawn as zero.
 */

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** How many rows a Work list shows before *Show all* (the design's five). */
export const WORK_ROWS = 5;

/** The three lists Work's tiles switch between. */
export type WorkList = 'in_progress' | 'in_review' | 'due';

// ------------------------------------------------------------------- work

/**
 * The *Delivered · 12 weeks* footer after its bold label: what was accepted,
 * reopened and how long it took — or *Nothing accepted yet.*, with when they
 * joined if that was inside the window (the design's new member).
 */
export function deliveredLine(
  delivery: ProfileDelivery | undefined,
  joined: { readonly at: number; readonly since: number; readonly now: number },
): string {
  if (delivery === undefined || delivery.accepted === 0) {
    const days = Math.floor((joined.now - joined.at) / DAY_MS);
    if (joined.at < joined.since) return 'Nothing accepted yet.';
    return `Nothing accepted yet. Joined ${
      days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${String(days)} days ago`
    }.`;
  }
  const { cycle_time: cycle } = delivery;
  const parts = [`${String(delivery.accepted)} accepted`, `${String(delivery.reopened)} reopened`];
  if (cycle.p50_ms !== null) {
    parts.push(
      cycle.p75_ms === null
        ? `cycle p50 ${durationLabel(cycle.p50_ms)}`
        : `cycle p50 ${durationLabel(cycle.p50_ms)}, p75 ${durationLabel(cycle.p75_ms)}`,
    );
  }
  if (cycle.unmeasured > 0) {
    parts.push(`${String(cycle.unmeasured)} done with no recorded start, counted but not measured`);
  }
  return parts.join(' · ');
}

/** *Show all 32* / *Show fewer*; the count is the list's total, not the rows sent. */
export function moreLabel(expanded: boolean, total: number): string {
  return expanded ? 'Show fewer' : `Show all ${total.toLocaleString('en-GB')}`;
}

/**
 * The note under an opened list the server capped (LAI-746): it sends at most
 * its cap of each and the total beside it.
 */
export function capNote(shown: number, total: number): string | undefined {
  if (total <= shown) return undefined;
  return `Showing ${String(shown)} of ${total.toLocaleString('en-GB')}, oldest first. Open in Work to filter the rest.`;
}

// -------------------------------------------------------------- projects

/** A project role in the design's words (D-103): a lead is a *Space admin*. */
export function projectRole(role: string | null): string {
  if (role === null) return 'No membership';
  if (role === 'lead') return 'Space admin';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Hours in D-139 item 7's short form, for a table cell or a bar's label where
 * `38 h 20 min` will not fit: `38h 20m`, `8h`, `40m` — hours, never days, and
 * never `h:mm`. A total in a sentence keeps {@link formatHours}.
 */
export function shortHours(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${String(rest)}m`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
}

/** Their hours there in the last two weeks: `38h 20m`, or a dash for none. */
export function hoursText(minutes: number | undefined): string {
  return minutes === undefined || minutes <= 0 ? '—' : shortHours(minutes);
}

/** Nothing open, tracked, accepted or reviewed there: folded into *N quiet projects*. */
export function isQuiet(project: ProfileProject): boolean {
  return (
    project.open_tasks === 0 &&
    (project.minutes_14d ?? 0) <= 0 &&
    project.accepted === 0 &&
    project.reviewed === 0
  );
}

/**
 * The table's two parts: the projects with something in them, most open
 * first then A–Z, and the quiet ones A–Z.
 */
export function splitProjects(projects: readonly ProfileProject[]): {
  readonly active: ProfileProject[];
  readonly quiet: ProfileProject[];
} {
  const byName = (a: ProfileProject, b: ProfileProject) => a.name.localeCompare(b.name);
  return {
    active: projects
      .filter((p) => !isQuiet(p))
      .sort((a, b) => b.open_tasks - a.open_tasks || byName(a, b)),
    quiet: projects.filter(isQuiet).sort(byName),
  };
}

/** `4 quiet projects` and the line beside it. */
export function quietLabel(quiet: readonly ProfileProject[]): {
  readonly title: string;
  readonly names: string;
} {
  return {
    title: `${String(quiet.length)} quiet ${quiet.length === 1 ? 'project' : 'projects'}`,
    names: `nothing open or tracked · ${quiet.map((p) => p.name).join(', ')}`,
  };
}

// ---------------------------------------------------------------- agents

/** One tool on the Agents card: its share of LLM tokens and the tokens it is on. */
export interface ToolRow {
  readonly client: AgentClient;
  /** Its LLM tokens in the window; 0 for a tool on a token that sent none. */
  readonly llmTokens: number;
  /** `74%`, `<1%`, or `—` for none. */
  readonly share: string;
  readonly tokens: readonly ProfileAgentToken[];
}

/** A share of a whole in the design's words: `74%`, `<1%`, `—` for none. */
export function shareText(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '—';
  const pct = (part / whole) * 100;
  if (pct < 1) return '<1%';
  return `${String(Math.min(100, Math.round(pct)))}%`;
}

/**
 * One row per tool: every agent with LLM tokens in the window — most first,
 * the usage read's order — then every agent on a connected token, or online
 * now, that sent none. The folded *fewer than three people* row is not a tool
 * (D-087 item 7) and is left out.
 */
export function toolRows(
  byAgent: readonly UsageAgentSlice[] | undefined,
  usable: readonly ProfileAgentToken[],
  online: readonly AgentClient[],
): ToolRow[] {
  const tokens = usable.filter(connected);
  const spent = (byAgent ?? []).filter((a) => a.few_people === undefined && a.tokens > 0);
  const whole = spent.reduce((sum, a) => sum + a.tokens, 0);
  const onTokens = (client: AgentClient) => tokens.filter((t) => t.client === client);
  const named = new Set(spent.map((a) => a.agent));
  const silent = [...new Set([...tokens.map((t) => t.client), ...online])].filter(
    (c) => !named.has(c),
  );
  return [
    ...spent
      .slice()
      .sort((a, b) => b.tokens - a.tokens)
      .map((a) => ({
        client: a.agent,
        llmTokens: a.tokens,
        share: shareText(a.tokens, whole),
        tokens: onTokens(a.agent),
      })),
    ...silent.map((client) => ({ client, llmTokens: 0, share: '—', tokens: onTokens(client) })),
  ];
}

// ------------------------------------------------------------- this week

/** One day's bar: what was confirmed, what is still a draft, and whether it is today. */
export interface WeekBar {
  readonly day: string;
  readonly confirmed: number;
  readonly drafted: number;
  readonly today: boolean;
}

/** Monday to Sunday of `today`'s week, each with the report's minutes or none. */
export function weekBars(
  week: readonly string[],
  byDay: readonly SummaryDay[],
  today: string,
): WeekBar[] {
  const minutes = new Map(byDay.map((d) => [d.day, d]));
  return week.map((day): WeekBar => ({
    day,
    confirmed: minutes.get(day)?.confirmed_minutes ?? 0,
    drafted: minutes.get(day)?.drafted_minutes ?? 0,
    today: day === today,
  }));
}

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** `Mon 2 – Sun 8 Nov`, or across a month `Mon 30 Nov – Sun 6 Dec`. */
export function weekSpan(from: string, to: string): string {
  const a = dateOf(from);
  const b = dateOf(to);
  const day = (d: Date) => `${WEEKDAYS[d.getUTCDay()] ?? ''} ${String(d.getUTCDate())}`;
  const month = (d: Date) => MONTHS[d.getUTCMonth()] ?? '';
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${day(a)} – ${day(b)} ${month(b)}`
    : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

/** One away period as the design prints it: `Fri 20 – Mon 23 Nov`, a single day once. */
export function awayText(period: Pick<AwayPeriod, 'from' | 'to'>): string {
  if (period.from === period.to) {
    const d = dateOf(period.from);
    return `${WEEKDAYS[d.getUTCDay()] ?? ''} ${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''}`;
  }
  return weekSpan(period.from, period.to);
}

/** The short weekday a bar is labelled with. */
export function weekdayOf(day: string): string {
  return WEEKDAYS[dateOf(day).getUTCDay()] ?? '';
}
