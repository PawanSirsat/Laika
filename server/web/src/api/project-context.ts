import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * The shared project context document (SPEC §7.3, API by LAI-404).
 *
 * One markdown document per project, served **verbatim** to every agent session
 * on it. That is why there is no rich-text layer here and no client-side
 * reshaping of what was typed: whatever this sends is what an agent reads.
 *
 * It has its own endpoint pair rather than riding on `PATCH /projects/:slug`
 * (LAI-404). Reading follows project read — a viewer sees it — while editing is
 * `lead`+.
 */

export interface ProjectContext {
  readonly context_md: string;
  /**
   * The revision this text is (SPEC §4.68, LAI-555). A save names it as
   * `base_revision`, so one made over somebody else's newer save is refused
   * rather than silently overwriting it.
   */
  readonly revision: number;
  /**
   * Length and limit come **from the server**, not from a constant here.
   *
   * The bound is enforced in the service so REST and MCP share one rule; a
   * mirrored copy in the client is the copy that goes stale when it moves, and
   * this screen's whole job is showing the budget accurately.
   */
  readonly length: number;
  readonly limit: number;
  /** `null` when the document has never been edited — the honest answer. */
  readonly updated_at: number | null;
  readonly updated_by: string | null;
}

export function getProjectContext(slug: string, signal?: AbortSignal): Promise<ProjectContext> {
  return request<ProjectContext>(
    `/projects/${encodeURIComponent(slug)}/context`,
    signal === undefined ? {} : { signal },
  );
}

export function updateProjectContext(
  slug: string,
  contextMd: string,
  baseRevision: number,
): Promise<ProjectContext> {
  return request<ProjectContext>(`/projects/${encodeURIComponent(slug)}/context`, {
    method: 'PATCH',
    body: { context_md: contextMd, base_revision: baseRevision },
  });
}

/**
 * One revision without its text — the history list (SPEC §4.68, §6.4,
 * LAI-555). `author_id` is null on a revision 1 that existed before revisions
 * did; `agent_id` names the registered agent whose token wrote it, or null.
 */
export interface ContextRevisionSummary {
  readonly revision: number;
  readonly length: number;
  readonly author_id: string | null;
  readonly agent_id: string | null;
  readonly created_at: number;
}

/** One revision with its whole text. */
export interface ContextRevision extends ContextRevisionSummary {
  readonly body: string;
}

/**
 * What changed between two revisions, as the server's unified line diff.
 *
 * Past 2,000 changed lines the server sends **no diff**: `truncated` is true,
 * `diff` is empty and both counts are null. A screen says so and offers the
 * revision whole — it never shows an empty diff as "nothing changed".
 */
export interface ContextDiff {
  readonly from_revision: number;
  readonly to_revision: number;
  readonly current_revision: number;
  readonly diff: string;
  readonly added: number | null;
  readonly removed: number | null;
  readonly truncated: boolean;
  readonly hint: string | null;
}

/** `GET .../context/revisions` — newest first, no text. */
export function listContextRevisions(
  slug: string,
  signal?: AbortSignal,
): Promise<readonly ContextRevisionSummary[]> {
  return request<readonly ContextRevisionSummary[]>(
    `/projects/${encodeURIComponent(slug)}/context/revisions`,
    signal === undefined ? {} : { signal },
  );
}

/** `GET .../context/revisions/:revision` — one revision with its text. */
export function getContextRevision(
  slug: string,
  revision: number,
  signal?: AbortSignal,
): Promise<ContextRevision> {
  return request<ContextRevision>(
    `/projects/${encodeURIComponent(slug)}/context/revisions/${String(revision)}`,
    signal === undefined ? {} : { signal },
  );
}

/** `GET .../context/diff?from=&to=` — `from` may be 0, the empty document. */
export function getContextDiff(
  slug: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<ContextDiff> {
  return request<ContextDiff>(
    `/projects/${encodeURIComponent(slug)}/context/diff?from=${String(from)}&to=${String(to)}`,
    signal === undefined ? {} : { signal },
  );
}

/** One line of a unified diff, as a screen draws it. */
/**
 * The session's agent, served **only when it is the reader's own** (D-120,
 * D-121): another person's agent is `null` on its row, with no id or label.
 */
export interface ContextDeliveryAgent {
  readonly id: string;
  readonly harness: string;
  readonly device_label: string | null;
  readonly display_name: string;
  readonly status: string;
}

/** One agent session's **latest** delivered revision (§4.69, LAI-1003). */
export interface ContextDelivery {
  readonly session_id: string;
  readonly revision: number;
  /** When Laika sent it — received, never read. */
  readonly delivered_at: number;
  readonly session_ended_at: number | null;
  readonly agent: ContextDeliveryAgent | null;
}

/**
 * `GET /projects/:slug/context/deliveries` (§6.4). The server keeps each
 * session's latest delivery only, so a session later sent N+1 is no longer
 * under N — `scope` says so on every answer.
 */
export interface ContextDeliveries {
  readonly scope: 'latest_per_session';
  readonly revision: number | null;
  readonly current_revision: number;
  readonly data: readonly ContextDelivery[];
  readonly next_cursor: string | null;
}

/** The most rows one read asks for: §6.3's maximum page. */
export const DELIVERIES_PAGE = 200;

/**
 * Each session's latest delivery, newest first: those on `revision` when it
 * is given, every session's otherwise. `cursor` is a previous answer's
 * `next_cursor`, for the page after it.
 */
export function listContextDeliveries(
  slug: string,
  revision: number | null,
  signal?: AbortSignal,
  cursor: string | null = null,
): Promise<ContextDeliveries> {
  const query = new URLSearchParams({ limit: String(DELIVERIES_PAGE) });
  if (revision !== null) query.set('revision', String(revision));
  if (cursor !== null) query.set('cursor', cursor);
  return request<ContextDeliveries>(
    `/projects/${encodeURIComponent(slug)}/context/deliveries?${query.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

export interface DiffLine {
  readonly kind: 'hunk' | 'added' | 'removed' | 'same';
  readonly text: string;
}

/**
 * The server's unified diff, line by line. The first character is the
 * marker (`+`, `-`, a space) and the rest is the document's line verbatim;
 * `@@` lines head each hunk. An empty diff is no lines.
 */
export function diffLinesOf(diff: string): readonly DiffLine[] {
  if (diff === '') return [];
  return diff.split('\n').map((line): DiffLine => {
    if (line.startsWith('@@')) return { kind: 'hunk', text: line };
    const text = line.slice(1);
    if (line.startsWith('+')) return { kind: 'added', text };
    if (line.startsWith('-')) return { kind: 'removed', text };
    return { kind: 'same', text };
  });
}

/** What a stale save was refused with: the revision now current. */
export interface StaleContext {
  readonly base_revision: number;
  readonly current_revision: number;
}

/**
 * The `409 stale_context_revision` refusal (§6.4, LAI-555), or null for any
 * other failure. Somebody saved since this text was opened; nothing was
 * written.
 */
export function staleContextOf(cause: unknown): StaleContext | null {
  if (!(cause instanceof ApiError)) return null;
  const details = cause.details as {
    readonly reason?: unknown;
    readonly base_revision?: unknown;
    readonly current_revision?: unknown;
  } | null;
  if (details?.reason !== 'stale_context_revision') return null;
  const { base_revision: base, current_revision: current } = details;
  return typeof base === 'number' && typeof current === 'number'
    ? { base_revision: base, current_revision: current }
    : null;
}

/** How close the document is to the cap, and how loudly to say so. */
export type BudgetTone = 'ok' | 'near' | 'over';

export interface ContextBudget {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly tone: BudgetTone;
}

/**
 * The point at which the count stops being decoration and starts being a
 * warning. 90% of 100,000 leaves 10,000 characters — enough to finish a thought
 * and still cut something, which is the only warning worth giving.
 */
const NEAR_FRACTION = 0.9;

/**
 * Where the document stands against the cap.
 *
 * §7.3 requires the limit be visible **before** it is hit: "a context document
 * that silently blows an agent's context window is worse than no document". A
 * count that only appears on a failed save is a count that arrives after the
 * writing is done.
 *
 * `remaining` goes negative past the cap rather than clamping to zero — the
 * writer needs to know how much to cut, and "0 remaining" does not say that.
 */
export function contextBudget(used: number, limit: number): ContextBudget {
  const remaining = limit - used;
  const tone: BudgetTone = used > limit ? 'over' : used >= limit * NEAR_FRACTION ? 'near' : 'ok';
  return { used, limit, remaining, tone };
}

/**
 * The server's refusal, in words that say what to do about it.
 *
 * ## Two different `422`s mean the same thing
 *
 * SPEC §7.3 says exceeding the bound is "a `422` naming both the limit **and
 * the actual length**", and `updateProjectContext` in the service raises exactly
 * that — `{ limit, length }`. **It is unreachable over REST**: the route's zod
 * schema carries `.max(CONTEXT_MD_LIMIT)` too, so validation refuses first and
 * the reply is the generic envelope with a `too_big` issue that names the limit
 * and not the length. Measured, not assumed:
 *
 * ```
 * PATCH /projects/laika-core/context   (100,400 characters)
 * 422 {"message":"Invalid request body","details":{"issues":[
 *      {"path":"context_md","message":"Too big: expected string to have <=100000 characters"}]}}
 * ```
 *
 * That is filed against the server as LAI-228. Until it lands both shapes are
 * read here, because the reader's problem is the same either way and "Invalid
 * request body" tells them nothing about it.
 *
 * `actualLength` is passed in because the client already knows it — it is what
 * was just typed — and the zod shape does not carry it.
 */
export function readableContextError(cause: unknown, actualLength?: number): string {
  if (!(cause instanceof ApiError)) return 'Could not save the context document.';

  // Somebody saved since this was opened (LAI-555). The text typed here is
  // kept, and the panel offers the comparison beside this (LAI-556).
  if (
    (cause.details as { readonly reason?: unknown } | null)?.reason === 'stale_context_revision'
  ) {
    const stale = staleContextOf(cause);
    return stale === null
      ? 'Not saved: somebody saved a newer version while you were editing. Your text is still here.'
      : `Not saved: somebody saved a newer version (r${String(stale.current_revision)}) while you were editing r${String(stale.base_revision)}. Your text is still here.`;
  }

  const details = cause.details as {
    readonly limit?: unknown;
    readonly length?: unknown;
    readonly issues?: readonly { readonly message?: unknown }[];
  } | null;

  // The service's shape: both numbers, exactly as §7.3 asks.
  const { limit, length } = details ?? {};
  if (typeof limit === 'number' && typeof length === 'number') return tooLong(length, limit);

  // Zod's shape: the limit is in the message, the length is not.
  const issue = details?.issues?.[0]?.message;
  if (typeof issue === 'string') {
    const cap = /<=\s*(\d+)\s*characters/.exec(issue)?.[1];
    if (cap !== undefined && actualLength !== undefined) {
      return tooLong(actualLength, Number(cap));
    }
    return issue;
  }

  return cause.message;
}

function tooLong(length: number, limit: number): string {
  const over = length - limit;
  return `Too long by ${over.toLocaleString()} characters — ${length.toLocaleString()} of ${limit.toLocaleString()} allowed.`;
}
