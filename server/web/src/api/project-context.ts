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

export function updateProjectContext(slug: string, contextMd: string): Promise<ProjectContext> {
  return request<ProjectContext>(`/projects/${encodeURIComponent(slug)}/context`, {
    method: 'PATCH',
    body: { context_md: contextMd },
  });
}

/**
 * May this person edit the document? `lead`+ (SPEC §3.2, §7.3).
 *
 * Same shape as `canManageMembers` and `canManageSprints`, and named for what it
 * authorises rather than shared with them, because these are three separate
 * server rules that happen to agree today. **It hides the editor rather than
 * offering one that answers `403`** — a display decision, not enforcement. The
 * server decides; if the two disagree the server is right and this is the bug.
 */
export function canEditProjectContext(
  orgRole: string,
  projectId: string,
  memberships: readonly { readonly project_id: string; readonly role: string }[],
): boolean {
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  return memberships.some((m) => m.project_id === projectId && m.role === 'lead');
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
