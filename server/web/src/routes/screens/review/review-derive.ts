import { buildLabel } from '../../../api/estimates.ts';
import {
  ciLine,
  ciVerdict,
  evidenceSummary,
  filterQueue,
  type QueueFilter,
  type ReviewQueueItem,
  type ReviewProject,
} from '../../../api/review.ts';
import type { BulkOutcome } from '../list/list-bulk.ts';

/**
 * The Review tab as a decision queue (D-146, LAI-1168).
 *
 * **A derive module, not a renderer** (CONVENTIONS §4): which rows the page
 * shows, how they group and what a bulk Accept reports are decided here,
 * where each rule can be pinned without a browser. `ReviewScreen` places them.
 *
 * `GET /review` is the organisation's pile — every review task on the spaces
 * the reader holds `task.write` on, oldest first, at most 200 — and the
 * server marks each row `can_decide`. The page opens on the rows that wait
 * on *this* reader; everything else is one toggle away, read-only.
 */

/** What the page lists: the decision queue, the whole queue, or — LAI-1169 — the hand-offs. */
export type ReviewView = 'mine' | 'all' | 'handoffs';

/** The default view is not in the address; `?view=all` and `?view=handoffs` are. */
export function reviewView(params: URLSearchParams): ReviewView {
  const asked = params.get('view');
  return asked === 'all' || asked === 'handoffs' ? asked : 'mine';
}

/** The address for a view: `mine` leaves `view` out, the others set it. */
export function withView(params: URLSearchParams, view: ReviewView): URLSearchParams {
  const next = new URLSearchParams(params);
  if (view === 'mine') next.delete('view');
  else next.set('view', view);
  return next;
}

export interface VisibleOptions {
  /** Only the rows the reader may decide (`can_decide`). */
  readonly decidable: boolean;
  readonly filter: QueueFilter;
}

/**
 * The rows the page shows: the filters first, then — on the decision view —
 * only what the reader may decide. The server's order (oldest waiting first)
 * is kept; nothing here sorts.
 */
export function visibleQueue(
  items: readonly ReviewQueueItem[],
  { decidable, filter }: VisibleOptions,
): ReviewQueueItem[] {
  const filtered = filterQueue(items, filter);
  return decidable ? filtered.filter((item) => item.can_decide) : filtered;
}

export interface SpaceGroup {
  readonly project: ReviewProject;
  /** The group's rows, in the order the queue had them. */
  readonly items: readonly ReviewQueueItem[];
  /** The ids a group's select-all reaches: the rows the reader may decide. */
  readonly decidable: readonly string[];
}

/**
 * Rows by space, **in order of first appearance**: the queue is oldest-first,
 * so the space with the longest-waiting task heads the page, and within a
 * group the rows keep that order. No alphabetical sort — the point of the
 * page is what has waited longest.
 */
export function groupBySpace(items: readonly ReviewQueueItem[]): SpaceGroup[] {
  const groups = new Map<string, { project: ReviewProject; items: ReviewQueueItem[] }>();
  for (const item of items) {
    const group = groups.get(item.project.id);
    if (group === undefined) groups.set(item.project.id, { project: item.project, items: [item] });
    else group.items.push(item);
  }
  return [...groups.values()].map((group) => ({
    project: group.project,
    items: group.items,
    decidable: group.items.filter((item) => item.can_decide).map((item) => item.task.id),
  }));
}

/** Every row's task id, groups flattened, in the order the page draws them. */
export function flatOrder(groups: readonly SpaceGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.task.id));
}

/**
 * `3 accepted`, `2 accepted, 1 refused`, `0 accepted, 2 refused`. Unlike the
 * List's `bulkSummary` there is no "already there": a row in the queue is by
 * definition still waiting, so every selected id is sent.
 */
export function acceptSummary(outcome: BulkOutcome): string {
  const parts = [`${String(outcome.done.length)} accepted`];
  if (outcome.failed.length > 0) parts.push(`${String(outcome.failed.length)} refused`);
  return parts.join(', ');
}

/* ------------------------------------------------------- the dialog (LAI-1169) */

/** The open item: `?item=<taskId>`, or none. */
export function itemParam(params: URLSearchParams): string | null {
  const asked = params.get('item');
  return asked === null || asked === '' ? null : asked;
}

/** The address with `item` set, or without it. Other params survive. */
export function withItem(params: URLSearchParams, id: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (id === null) next.delete('item');
  else next.set('item', id);
  return next;
}

export interface ItemPosition {
  /** Zero-based, as the page draws the rows. */
  readonly index: number;
  readonly total: number;
  readonly prev: string | null;
  readonly next: string | null;
}

/** Where `id` sits in the drawn order, with its neighbours; `null` when it is not drawn. */
export function positionOf(order: readonly string[], id: string): ItemPosition | null {
  const index = order.indexOf(id);
  if (index === -1) return null;
  return {
    index,
    total: order.length,
    prev: index === 0 ? null : (order[index - 1] ?? null),
    next: index === order.length - 1 ? null : (order[index + 1] ?? null),
  };
}

/**
 * Where the dialog goes once `id` is decided: the next row after it in the
 * order **captured before the decision**, or `null` at the end — close. A row
 * no longer `present` (a poll took it meanwhile) is skipped, never shown as
 * vanished the moment it opens.
 */
export function advanceAfterDecide(
  order: readonly string[],
  id: string,
  present?: ReadonlySet<string>,
): string | null {
  const at = order.indexOf(id);
  if (at === -1) return null;
  for (const candidate of order.slice(at + 1)) {
    if (candidate !== id && (present === undefined || present.has(candidate))) return candidate;
  }
  return null;
}

export type DialogCommand = 'next' | 'prev' | 'accept' | 'send_back' | 'close';

/** What of a key event the dialog reads — a real one, or a test's. */
export interface DialogKey {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly defaultPrevented?: boolean;
}

/**
 * The dialog's keys: `j` / `↓` next, `k` / `↑` previous, `a` accept, `s`
 * send back, Escape close. **Nothing while typing** — a reason being written
 * says "as" — except Escape, which is the one key a field expects to give up;
 * and nothing with a modifier held, so ⌘A still selects text. Escape a control
 * inside has already spent (`defaultPrevented`) is left to it.
 */
export function dialogCommand(event: DialogKey, typing: boolean): DialogCommand | null {
  if (event.key === 'Escape') return event.defaultPrevented === true ? null : 'close';
  if (typing) return null;
  if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) return null;
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'ArrowUp':
      return 'prev';
    case 'a':
      return 'accept';
    case 's':
      return 'send_back';
    default:
      return null;
  }
}

/* ------------------------------------------------- the page body (LAI-1222) */

const DAY_MS = 24 * 3_600_000;

/**
 * A wait worth colouring: two days in review. Below it the age is plain ink —
 * colour on every row says nothing, and most rows are hours old.
 */
export const STALE_AFTER_MS = 2 * DAY_MS;

export function isStale(ms: number): boolean {
  return Number.isFinite(ms) && ms >= STALE_AFTER_MS;
}

/** The one word a row says about its proof, most urgent first. */
export type EvidenceKind =
  'tests_failed' | 'ci_failed' | 'check' | 'none' | 'ci_pending' | 'ci_confirmed' | 'attached';

export interface EvidenceState {
  readonly kind: EvidenceKind;
  /** The chip's text. */
  readonly label: string;
  /** The `Chip` tone: red only for a failure, green only for CI's own pass. */
  readonly tone: 'danger' | 'orange' | 'green' | 'neutral';
  /** The status mark drawn in place of the dot — never colour alone. */
  readonly mark: 'alert' | 'clock' | 'dot';
  /** What the tooltip explains: why the row says it, and what is behind it. */
  readonly hint: string;
}

/** `2 commits, a pull request, 3 test runs (1 failed)` — what a finish carried, in words. */
function attachedWords(item: ReviewQueueItem): string {
  const round = item.round;
  if (round === null) return 'nothing';
  const parts: string[] = [];
  if (round.commits.length > 0) {
    parts.push(
      `${String(round.commits.length)} ${round.commits.length === 1 ? 'commit' : 'commits'}`,
    );
  }
  if (round.branch !== null) parts.push('a branch');
  if (round.pull_request !== null) parts.push('a pull request');
  if (round.tests.length > 0) {
    const failed = round.tests.filter((t) => t.exit_code !== 0).length;
    parts.push(
      `${String(round.tests.length)} test ${round.tests.length === 1 ? 'run' : 'runs'}${
        failed > 0 ? ` (${String(failed)} failed)` : ''
      }`,
    );
  }
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

/**
 * **One** evidence state per row (LAI-1222), where the row used to draw a
 * pill per kind of proof and a loud `no proof` on every bare one. The most
 * urgent wins — a failure, then *check this one*, then no proof at all, then
 * CI's verdict, then plain *proof attached* — and the tooltip carries the
 * rest; the full proof is the Review dialog's.
 */
export function evidenceState(item: ReviewQueueItem): EvidenceState {
  const summary = evidenceSummary(item.round);
  const ci = ciVerdict(item.round);
  const carried = `The finish carried ${attachedWords(item)}.`;
  if (summary.testsFailed > 0) {
    return {
      kind: 'tests_failed',
      label: 'Tests failing',
      tone: 'danger',
      mark: 'alert',
      hint: `${String(summary.testsFailed)} of the test runs the agent reported exited non-zero. ${carried}`,
    };
  }
  if (ci === 'failed' && item.round?.ci != null) {
    return {
      kind: 'ci_failed',
      label: 'CI failed',
      tone: 'danger',
      mark: 'alert',
      hint: `${ciLine(item.round.ci)} — GitHub's verdict on the head commit, not the agent's. ${carried}`,
    };
  }
  if (item.cue !== null) {
    return {
      kind: 'check',
      label: 'Check this one',
      tone: 'orange',
      mark: 'clock',
      hint: `Finished in ${buildLabel(item.cue.build_ms)} against a forecast of ${buildLabel(
        item.cue.forecast_p50_ms,
      )}, and CI has not confirmed it. About the task, not the person.`,
    };
  }
  if (summary.empty) {
    return {
      kind: 'none',
      label: 'No proof',
      tone: 'neutral',
      mark: 'alert',
      hint:
        item.round === null
          ? 'Moved to review without a finish: no commits, branch, pull request or test runs to check.'
          : 'The agent finished without attaching commits, a branch, a pull request or test runs.',
    };
  }
  if (ci === 'pending' && item.round?.ci != null) {
    return {
      kind: 'ci_pending',
      label: 'CI running',
      tone: 'neutral',
      mark: 'clock',
      hint: `${ciLine(item.round.ci)}. ${carried}`,
    };
  }
  if (ci === 'confirmed' && item.round?.ci != null) {
    return {
      kind: 'ci_confirmed',
      label: 'CI passed',
      tone: 'green',
      mark: 'dot',
      hint: `${ciLine(item.round.ci)} — GitHub's verdict on the head commit. ${carried}`,
    };
  }
  return {
    kind: 'attached',
    label: 'Proof attached',
    tone: 'neutral',
    mark: 'dot',
    hint: `${carried} Claimed by the agent until something checks it.`,
  };
}

/** The evidence filters, in the order the figures draw them. */
export type EvidenceFilter = 'failing' | 'noEvidence' | 'ciFailed' | 'ciConfirmed' | 'fast';

export interface ReviewKpi {
  readonly id: EvidenceFilter;
  readonly label: string;
  readonly count: number;
  readonly tone: 'danger' | 'warning' | 'positive' | undefined;
}

/**
 * The figures that are also the evidence filters (LAI-1222): how many of the
 * view's rows each would leave. **Only a figure worth a tile is returned** —
 * a non-zero count, or the filter that is switched on (so a reader can always
 * see and undo what is narrowing the page). The colour is for a problem that
 * exists: red for failures, orange for *check these*, nothing for no proof.
 */
export function reviewKpis(items: readonly ReviewQueueItem[], filter: QueueFilter): ReviewKpi[] {
  const summaries = items.map((item) => ({ s: evidenceSummary(item.round), item }));
  const all: ReviewKpi[] = [
    {
      id: 'failing',
      label: 'Failing tests',
      count: summaries.filter(({ s }) => s.testsFailed > 0).length,
      tone: 'danger',
    },
    {
      id: 'ciFailed',
      label: 'CI failed',
      count: summaries.filter(({ item }) => ciVerdict(item.round) === 'failed').length,
      tone: 'danger',
    },
    {
      id: 'fast',
      label: 'Check these',
      count: items.filter((item) => item.cue !== null).length,
      tone: 'warning',
    },
    {
      id: 'noEvidence',
      label: 'No proof',
      count: summaries.filter(({ s }) => s.empty).length,
      tone: undefined,
    },
    {
      id: 'ciConfirmed',
      label: 'CI passed',
      count: summaries.filter(({ item }) => ciVerdict(item.round) === 'confirmed').length,
      tone: 'positive',
    },
  ];
  return all.filter((kpi) => kpi.count > 0 || filter[kpi.id]);
}

/** The filter with one evidence filter flipped; CI failed and CI passed exclude each other. */
export function toggleEvidence(filter: QueueFilter, id: EvidenceFilter): QueueFilter {
  const next = { ...filter, [id]: !filter[id] };
  if (id === 'ciFailed' && next.ciFailed) return { ...next, ciConfirmed: false };
  if (id === 'ciConfirmed' && next.ciConfirmed) return { ...next, ciFailed: false };
  return next;
}

/** The filter with every evidence filter off and the dropdowns kept. */
export function withoutEvidence(filter: QueueFilter): QueueFilter {
  return {
    ...filter,
    failing: false,
    noEvidence: false,
    ciFailed: false,
    ciConfirmed: false,
    fast: false,
  };
}

/** Whether any evidence filter is on. */
export function evidenceOn(filter: QueueFilter): boolean {
  return (
    filter.failing || filter.noEvidence || filter.ciFailed || filter.ciConfirmed || filter.fast
  );
}

/**
 * The commands the queue's own rows answer (LAI-1222), the same keys as the
 * Review dialog so a reader learns them once: `j` / `↓` the next row, `k` /
 * `↑` the one before, `a` accept the focused row, `s` send it back. Nothing
 * while typing, nothing with a modifier, and Escape is not the list's.
 */
export function listCommand(
  event: DialogKey,
  typing: boolean,
): Exclude<DialogCommand, 'close'> | null {
  const command = dialogCommand(event, typing);
  return command === 'close' ? null : command;
}
