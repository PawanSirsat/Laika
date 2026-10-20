import type { TimeDraft } from '../../../api/time.ts';
import { applyToEach, failureMessage, type BulkOutcome } from '../list/list-bulk.ts';
import { draftTarget, hm, rangeLabel } from './my-day-derive.ts';

/**
 * Many drafted blocks at once (LAI-810, the owner: *"lot of task but i need
 * to do the one by one confirm … also add the all select and multi select"*).
 *
 * **The endpoints that exist, and no other** (CLAUDE.md §5.1): one request
 * per block to `POST /me/time-drafts/:id/confirm`, `/dismiss` or `PATCH
 * /me/time-drafts/:id`, in order, through the List's own `applyToEach`; and
 * `POST /me/time/days/:day/confirm` when the whole day is meant.
 *
 * **A block on nothing is never confirmed in bulk.** The server confirms an
 * untied block as General — right when the person clicked Confirm on that
 * very row, wrong when it rode along in a selection of forty. So it is left
 * out, kept selected, and named.
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

/** The selected blocks' minutes, in the order of the day. */
export function minutesOf(drafts: readonly TimeDraft[], selected: ReadonlySet<string>): number {
  return drafts.reduce((sum, d) => (selected.has(d.id) ? sum + d.minutes : sum), 0);
}

/** Whether a block needs a card or General before it may be confirmed in bulk. */
export const needsCard = (draft: TimeDraft): boolean => draftTarget(draft).untied;

export interface ConfirmPlan {
  /** On a card, a space or General: confirmed as they stand. */
  readonly ready: readonly TimeDraft[];
  /** On nothing: left out and named, never confirmed as General unasked. */
  readonly needCard: readonly TimeDraft[];
  /** Every block of the day is chosen and ready, so one *confirm day* does it. */
  readonly wholeDay: boolean;
}

export function confirmPlan(all: readonly TimeDraft[], chosen: readonly TimeDraft[]): ConfirmPlan {
  const ready = chosen.filter((d) => !needsCard(d));
  const needCard = chosen.filter(needsCard);
  return { ready, needCard, wholeDay: all.length > 0 && ready.length === all.length };
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
    return range === '' ? `a ${hm(d.minutes)} block with no set time` : range;
  });
  const rest = drafts.length - NAMED;
  return rest > 0 ? `${names.join(', ')} and ${String(rest)} more` : names.join(', ');
}

export type BulkKind = 'confirm' | 'general' | 'dismiss';

/** The writes a batch makes — the real client in the page, a fake in a test. */
export interface BulkApi {
  readonly confirmDraft: (id: string) => Promise<unknown>;
  readonly confirmDay: (day: string) => Promise<unknown>;
  readonly dismissDraft: (id: string) => Promise<unknown>;
  readonly toGeneral: (id: string) => Promise<unknown>;
}

export interface BulkResult {
  /** What stays selected: the blocks that failed, and those left out. */
  readonly keep: readonly string[];
  readonly text: string;
  /** Everything asked for happened. */
  readonly ok: boolean;
}

const DONE: Readonly<Record<BulkKind, (n: number) => string>> = {
  confirm: (n) => `Confirmed ${blocks(n)}.`,
  general: (n) => `Moved ${blocks(n)} to General.`,
  dismiss: (n) => `Marked ${blocks(n)} as not work.`,
};

function blocks(n: number): string {
  return `${String(n)} ${n === 1 ? 'block' : 'blocks'}`;
}

/** What a batch did, in one paragraph: done, refused and why, left out and which. */
export function bulkReport(
  kind: BulkKind,
  outcome: BulkOutcome,
  left: readonly TimeDraft[],
): string {
  const parts: string[] = [];
  if (outcome.done.length > 0) parts.push(DONE[kind](outcome.done.length));
  else if (outcome.failed.length === 0)
    parts.push(left.length > 0 ? 'Nothing confirmed.' : DONE[kind](0));
  if (outcome.failed.length > 0) {
    // The server's own sentences, each once: twelve `day_full`s are one reason.
    const why = [...new Set(outcome.failed.map((f) => f.message))].join(' ');
    const n = outcome.failed.length;
    parts.push(`${blocks(n)} did not save and ${n === 1 ? 'stays' : 'stay'} selected: ${why}`);
  }
  if (left.length > 0) {
    parts.push(`Left out, still selected — ${needCardLine(left.length)}: ${nameBlocks(left)}.`);
  }
  return parts.join(' ');
}

/**
 * Run one batch over `chosen`, one request at a time, and say what happened.
 * `onProgress(done, total)` after every request, refusals included.
 */
export async function runBulk(
  kind: BulkKind,
  chosen: readonly TimeDraft[],
  all: readonly TimeDraft[],
  day: string,
  api: BulkApi,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<BulkResult> {
  let outcome: BulkOutcome;
  let left: readonly TimeDraft[] = [];

  if (kind === 'confirm') {
    const plan = confirmPlan(all, chosen);
    left = plan.needCard;
    const ids = plan.ready.map((d) => d.id);
    if (plan.wholeDay) {
      onProgress(0, ids.length);
      try {
        await api.confirmDay(day);
        outcome = { done: ids, failed: [] };
      } catch (cause) {
        const message = failureMessage(cause);
        outcome = { done: [], failed: ids.map((id) => ({ id, message })) };
      }
      onProgress(ids.length, ids.length);
    } else {
      outcome = await applyToEach(ids, api.confirmDraft, (n) => {
        onProgress(n, ids.length);
      });
    }
  } else {
    // General on a block already on General is not a change; it is not sent.
    const ids = chosen.filter((d) => kind === 'dismiss' || !d.general).map((d) => d.id);
    outcome = await applyToEach(ids, kind === 'dismiss' ? api.dismissDraft : api.toGeneral, (n) => {
      onProgress(n, ids.length);
    });
  }

  return {
    keep: [...outcome.failed.map((f) => f.id), ...left.map((d) => d.id)],
    text: bulkReport(kind, outcome, left),
    ok: outcome.failed.length === 0 && left.length === 0,
  };
}
