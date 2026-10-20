import { ApiError } from '../../../api/errors.ts';
import type { TimeDraft, TimeEntry } from '../../../api/time.ts';
import { failureMessage } from '../list/list-bulk.ts';
import { formatDuration } from '../../../api/duration.ts';
import { draftTarget, rangeLabel } from './my-day-derive.ts';

/**
 * Many drafted blocks at once (LAI-810, the owner: *"lot of task but i need
 * to do the one by one confirm … also add the all select and multi select"*).
 *
 * **The endpoints that exist, and no other** (CLAUDE.md §5.1).
 *
 * **What was ticked is what is confirmed, by id** (LAI-810 review round 1).
 * *Confirm selected* sends `POST /me/time-drafts/:id/confirm` for each ticked
 * block, never `POST /me/time/days/:day/confirm` — even when every block is
 * ticked. That request confirms whatever the server holds for the day when it
 * arrives, and a collector upload (every ten minutes) replaces the untouched
 * blocks under new ids: a page a few minutes old would confirm blocks nobody
 * saw, and an untied one as General. Confirmed by id, a block that changed
 * answers `404` and nothing is confirmed in its place.
 *
 * *Confirm day*, the header's button, is the request that means the whole
 * day. It is made only when every block on the page is ready, and what comes
 * back is compared with what the page showed — any difference is said.
 *
 * **A block on nothing is never confirmed in bulk.** The server confirms an
 * untied block as General — right when the person clicked Confirm on that
 * very row, wrong when it rode along in a selection of forty. So it is left
 * out, and named.
 */

/** About ten rows a page: a morning's worth, few enough to read. */
export const PAGE_SIZE = 10;

export interface Paged<T> {
  readonly items: readonly T[];
  /** 0-based, clamped into range — a page that emptied shows the last one. */
  readonly page: number;
  readonly pages: number;
  /** `1–10 of 37`. */
  readonly label: string;
}

export function pageOf<T>(all: readonly T[], page: number, size: number = PAGE_SIZE): Paged<T> {
  const pages = Math.max(1, Math.ceil(all.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  const start = at * size;
  const items = all.slice(start, start + size);
  const label =
    items.length === 0
      ? `0 of ${String(all.length)}`
      : `${String(start + 1)}–${String(start + items.length)} of ${String(all.length)}`;
  return { items, page: at, pages, label };
}

/**
 * Shift-click: every row from the one clicked last (`anchor`) to this one
 * takes this one's new state, `on`. Without an anchor still in the list it is
 * one row, as a plain click is.
 */
export function selectRange(
  selected: ReadonlySet<string>,
  ordered: readonly string[],
  anchor: string | undefined,
  id: string,
  on: boolean,
): ReadonlySet<string> {
  const to = ordered.indexOf(id);
  if (to === -1) return selected;
  const from = anchor === undefined ? -1 : ordered.indexOf(anchor);
  const lo = from === -1 ? to : Math.min(from, to);
  const hi = from === -1 ? to : Math.max(from, to);
  const next = new Set(selected);
  for (const each of ordered.slice(lo, hi + 1)) {
    if (on) next.add(each);
    else next.delete(each);
  }
  return next;
}

/** The selected blocks' minutes. */
export function minutesOf(drafts: readonly TimeDraft[], selected: ReadonlySet<string>): number {
  return drafts.reduce((sum, d) => (selected.has(d.id) ? sum + d.minutes : sum), 0);
}

/** Whether a block needs a card or General before it may be confirmed in bulk. */
export const needsCard = (draft: TimeDraft): boolean => draftTarget(draft).untied;

/** On a card or a space — what *General* would take it off. */
export const placed = (draft: TimeDraft): boolean => draft.task !== null || draft.project !== null;

export interface ConfirmPlan {
  /** On a card, a space or General: confirmed as they stand. */
  readonly ready: readonly TimeDraft[];
  /** On nothing: left out and named, never confirmed as General unasked. */
  readonly needCard: readonly TimeDraft[];
}

export function confirmPlan(chosen: readonly TimeDraft[]): ConfirmPlan {
  return { ready: chosen.filter((d) => !needsCard(d)), needCard: chosen.filter(needsCard) };
}

/** `1 needs a card or General`, `2 need a card or General`. */
export function needCardLine(n: number): string {
  return `${String(n)} ${n === 1 ? 'needs' : 'need'} a card or General`;
}

const NAMED = 5;

/** `07:00–07:18, 09:20–09:38` — which blocks, by when; the sixth on is counted. */
export function nameBlocks(drafts: readonly TimeDraft[]): string {
  const names = drafts.slice(0, NAMED).map((d) => {
    const range = rangeLabel(d);
    return range === '' ? `a ${formatDuration(d.minutes)} block with no set time` : range;
  });
  const rest = drafts.length - NAMED;
  return rest > 0 ? `${names.join(', ')} and ${String(rest)} more` : names.join(', ');
}

const blocks = (n: number): string => `${String(n)} ${n === 1 ? 'block' : 'blocks'}`;
const was = (n: number): string => (n === 1 ? 'was' : 'were');

/* ------------------------------------------------------- one block at a time */

/**
 * Why a block's request was refused, as far as the reader can act on it:
 * `stale` — it is not there any more (`404`: an upload replaced it, or it was
 * settled elsewhere); `full` — the day would hold more than 24 hours (`422
 * day_full`); `other` — anything else, in the server's own words.
 */
export type Why = 'stale' | 'full' | 'other';

export function whyRefused(cause: unknown): Why {
  if (!(cause instanceof ApiError)) return 'other';
  if (cause.status === 404) return 'stale';
  const details = cause.details;
  const reason =
    typeof details === 'object' && details !== null && 'reason' in details
      ? details.reason
      : undefined;
  return reason === 'day_full' ? 'full' : 'other';
}

export interface Refusal {
  readonly id: string;
  readonly message: string;
  readonly why: Why;
}

export interface Pass {
  readonly done: readonly string[];
  readonly refused: readonly Refusal[];
  /** Never sent: the day was full before their turn. */
  readonly untried: readonly string[];
}

/**
 * One request a block, in order, and on past a refusal — **except a full
 * day**: once the day would hold more than 24 hours, the blocks after it would
 * be refused the same way, or confirmed in whatever order happens to fit, so
 * the pass stops there and keeps the rest untried. `onProgress(done, total)`
 * after every request.
 */
export async function eachBlock(
  ids: readonly string[],
  write: (id: string) => Promise<unknown>,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<Pass> {
  const done: string[] = [];
  const refused: Refusal[] = [];
  for (const [i, id] of ids.entries()) {
    try {
      await write(id);
      done.push(id);
    } catch (cause) {
      const why = whyRefused(cause);
      refused.push({ id, message: failureMessage(cause), why });
      if (why === 'full') {
        onProgress(i + 1, ids.length);
        return { done, refused, untried: ids.slice(i + 1) };
      }
    }
    onProgress(i + 1, ids.length);
  }
  return { done, refused, untried: [] };
}

/* ----------------------------------------------------------------- the API */

/** The writes a batch makes — the real client in the page, a fake in a test. */
export interface BulkApi {
  readonly confirmDraft: (id: string) => Promise<unknown>;
  readonly confirmDay: (day: string) => Promise<{ readonly entries: readonly TimeEntry[] }>;
  readonly dismissDraft: (id: string) => Promise<unknown>;
  readonly toGeneral: (id: string) => Promise<unknown>;
}

export interface BulkResult {
  /** What stays selected. Always empty for the header's *Confirm day*. */
  readonly keep: readonly string[];
  readonly text: string;
  /** Everything asked for happened, as the page showed it. */
  readonly ok: boolean;
}

/* ------------------------------------------------------ the selection's bar */

export type BulkKind = 'confirm' | 'general' | 'dismiss';

const DONE: Readonly<Record<BulkKind, (n: number) => string>> = {
  confirm: (n) => `Confirmed ${blocks(n)}.`,
  general: (n) => `Moved ${blocks(n)} to General.`,
  dismiss: (n) => `Marked ${blocks(n)} as not work.`,
};

function pick(drafts: readonly TimeDraft[], ids: readonly string[]): TimeDraft[] {
  const wanted = new Set(ids);
  return drafts.filter((d) => wanted.has(d.id));
}

/**
 * What a batch over the selection did, in one paragraph — every sentence
 * about the selection as it now is, since the day is re-read straight after.
 */
export function selectionReport(
  kind: BulkKind,
  chosen: readonly TimeDraft[],
  pass: Pass,
  left: readonly TimeDraft[],
): string {
  const stale = pass.refused.filter((r) => r.why === 'stale');
  const full = pass.refused.filter((r) => r.why === 'full');
  const other = pass.refused.filter((r) => r.why === 'other');
  const parts: string[] = [];

  if (pass.done.length > 0) parts.push(DONE[kind](pass.done.length));
  else if (pass.refused.length === 0) {
    parts.push(left.length > 0 ? 'Nothing confirmed.' : DONE[kind](0));
  }
  if (full.length > 0) {
    const n = full.length + pass.untried.length;
    parts.push(
      `Stopped at ${nameBlocks(
        pick(
          chosen,
          full.map((r) => r.id),
        ),
      )}: confirming it would put ` +
        `more than 24 hours on the day. ${blocks(n)} not confirmed, still selected.`,
    );
  }
  if (stale.length > 0) {
    // Gone from the day the moment it is re-read, so never "still selected".
    parts.push(
      `${blocks(stale.length)} changed since this page loaded — reloaded; please review again.`,
    );
  }
  if (other.length > 0) {
    // The server's own sentences, each once: twelve of one reason are one reason.
    const why = [...new Set(other.map((r) => r.message))].join(' ');
    const n = other.length;
    parts.push(`${blocks(n)} did not save and ${n === 1 ? 'stays' : 'stay'} selected: ${why}`);
  }
  if (left.length > 0) {
    parts.push(`Left out, still selected — ${needCardLine(left.length)}: ${nameBlocks(left)}.`);
  }
  return parts.join(' ');
}

/**
 * Run one batch over the ticked blocks — **one request per block, by id**,
 * for every kind and however many are ticked. `onProgress(done, total)` after
 * every request, refusals included.
 */
export async function runBulk(
  kind: BulkKind,
  chosen: readonly TimeDraft[],
  api: BulkApi,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  let ids: readonly string[];
  let left: readonly TimeDraft[] = [];
  let write: (id: string) => Promise<unknown>;

  if (kind === 'confirm') {
    const plan = confirmPlan(chosen);
    left = plan.needCard;
    ids = plan.ready.map((d) => d.id);
    write = api.confirmDraft;
  } else if (kind === 'general') {
    // General on a block already on General is not a change; it is not sent.
    ids = chosen.filter((d) => !d.general).map((d) => d.id);
    write = api.toGeneral;
  } else {
    ids = chosen.map((d) => d.id);
    write = api.dismissDraft;
  }

  const pass = await eachBlock(ids, write, onProgress);
  const kept = pass.refused.filter((r) => r.why !== 'stale').map((r) => r.id);
  return {
    keep: [...kept, ...pass.untried, ...left.map((d) => d.id)],
    text: selectionReport(kind, chosen, pass, left),
    ok: pass.refused.length === 0 && left.length === 0,
  };
}

/* ------------------------------------------------------ the header's button */

/**
 * *Confirm day* refused because a block's stretch would hold more minutes
 * than its clock (`409 overlaps_confirmed`, LAI-831 review round 2): which
 * block, as the page shows it, and the two figures — or `undefined`.
 */
function clashOf(
  cause: unknown,
  all: readonly TimeDraft[],
): { readonly draft: TimeDraft; readonly stretch: number; readonly would: number } | undefined {
  if (!(cause instanceof ApiError)) return undefined;
  const d = cause.details as Record<string, unknown> | null;
  if (d === null || typeof d !== 'object' || d.reason !== 'overlaps_confirmed') return undefined;
  const draft = all.find((x) => x.id === d.draft_id);
  const stretch = d.stretch_minutes;
  const would = d.would_hold;
  if (draft === undefined || typeof stretch !== 'number' || typeof would !== 'number') {
    return undefined;
  }
  return { draft, stretch, would };
}

/**
 * After `POST /me/time/days/:day/confirm`: what came back, against what the
 * page showed. The server confirmed what it held when the request arrived,
 * so any difference — blocks that arrived since, blocks that changed, an
 * untied block now General — is said, plainly.
 */
export function dayReport(
  planned: readonly TimeDraft[],
  entries: readonly TimeEntry[],
): { readonly text: string; readonly ok: boolean } {
  const plannedMinutes = planned.reduce((sum, d) => sum + d.minutes, 0);
  const gotMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const extra = entries.length - planned.length;
  // On no card and no space: General, chosen on the page or not.
  const general = entries.filter((e) => e.task === null && e.project === null).length;
  const chosenGeneral = planned.filter((d) => d.task === null && d.project === null).length;

  const parts = [`Confirmed the day: ${blocks(entries.length)}, ${formatDuration(gotMinutes)}.`];
  if (extra > 0) {
    parts.push(
      `${blocks(extra)} more arrived since this page loaded and ${was(extra)} confirmed too.`,
    );
  } else if (extra < 0) {
    parts.push(
      `${blocks(-extra)} shown here had changed since this page loaded and ${was(-extra)} not among them.`,
    );
  } else if (gotMinutes !== plannedMinutes) {
    parts.push(
      `The day changed since this page loaded: ${formatDuration(gotMinutes)} was confirmed, not the ${formatDuration(plannedMinutes)} shown.`,
    );
  }
  if (general > chosenGeneral) {
    const n = general - chosenGeneral;
    parts.push(
      `${blocks(n)} on no card ${was(n)} confirmed as General — change ${n === 1 ? 'it' : 'them'} under Confirmed if ${n === 1 ? 'it belongs' : 'they belong'} on one.`,
    );
  }
  const ok = extra === 0 && gotMinutes === plannedMinutes && general <= chosenGeneral;
  return { text: parts.join(' '), ok };
}

/**
 * *Confirm day*: when every block on the page is ready, the one request that
 * means the whole day, checked against the page after. When some need a card,
 * the ready ones one by one, and the report says exactly how many were
 * confirmed and why the rest were left. Nothing stays selected: the header
 * selects nothing.
 */
export async function runConfirmDay(
  all: readonly TimeDraft[],
  day: string,
  api: BulkApi,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<BulkResult> {
  const plan = confirmPlan(all);

  if (plan.needCard.length === 0) {
    onProgress(0, all.length);
    try {
      const { entries } = await api.confirmDay(day);
      onProgress(all.length, all.length);
      return { keep: [], ...dayReport(all, entries) };
    } catch (cause) {
      onProgress(all.length, all.length);
      const clash = clashOf(cause, all);
      const text =
        whyRefused(cause) === 'full'
          ? 'Nothing confirmed: the day would hold more than 24 hours of confirmed time. Shorten or dismiss a block, then confirm again.'
          : clash !== undefined
            ? `Nothing confirmed: ${nameBlocks([clash.draft])} would count confirmed time twice — its stretch has ${formatDuration(clash.stretch)} of clock and would hold ${formatDuration(clash.would)}. Shorten it or mark it not work, then confirm again.`
            : `Nothing confirmed: ${failureMessage(cause)}`;
      return { keep: [], text, ok: false };
    }
  }

  const pass = await eachBlock(
    plan.ready.map((d) => d.id),
    api.confirmDraft,
    onProgress,
  );
  const stale = pass.refused.filter((r) => r.why === 'stale');
  const full = pass.refused.filter((r) => r.why === 'full');
  const other = pass.refused.filter((r) => r.why === 'other');
  const reasons = [`${needCardLine(plan.needCard.length)} (${nameBlocks(plan.needCard)})`];
  if (full.length > 0) {
    reasons.push(
      `${blocks(full.length + pass.untried.length)} from ${nameBlocks(
        pick(
          all,
          full.map((r) => r.id),
        ),
      )} on would put more than 24 hours on the day`,
    );
  }
  if (stale.length > 0) {
    reasons.push(
      `${blocks(stale.length)} changed since this page loaded — reloaded; please review again`,
    );
  }
  if (other.length > 0) {
    reasons.push(
      `${blocks(other.length)} refused: ${[...new Set(other.map((r) => r.message))].join(' ')}`,
    );
  }
  const left = all.length - pass.done.length;
  return {
    keep: [],
    text: `Confirmed ${String(pass.done.length)} of ${blocks(all.length)}; ${String(left)} left drafted — ${reasons.join('; ')}.`,
    ok: false,
  };
}
