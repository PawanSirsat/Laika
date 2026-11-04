/**
 * The rail's derived lines (§11.4.2.1, LAI-1117, LAI-1122): the status
 * control's sub-line, the Estimate card's token headline and its similar
 * tasks, the priority's words, the pull request's line and the foot's
 * *Created via*.
 */

import { formatDurationMs } from '../../../api/duration.ts';
import type { ActivityEvent } from '../../../api/activity.ts';
import { buildLabel, type SimilarTask, type SimilarTaskRef } from '../../../api/estimates.ts';
import type { TaskPriority, TaskSummary } from '../../../api/tasks.ts';
import { compactTokens, shareOf } from '../../../api/usage.ts';

function ago(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  return ms < 60_000 ? 'just now' : `${formatDurationMs(ms)} ago`;
}

/** When the task last moved into review: its newest status row to `review`. */
export function reviewSince(activity: readonly ActivityEvent[]): number | null {
  let newest: number | null = null;
  for (const event of activity) {
    if (event.type !== 'task.status_changed') continue;
    const to = (event.payload as { to?: unknown } | null)?.to;
    if (to === 'review' && (newest === null || event.created_at > newest))
      newest = event.created_at;
  }
  return newest;
}

/**
 * The line under the status: *In review for 24 min · round 1*, *Claimed 18
 * min ago*, *Sent back 6 min ago · round 2*, *Not started*. `null` when there
 * is nothing true to add.
 */
export function statusSubline(
  task: Pick<TaskSummary, 'status' | 'started_at' | 'completed_at' | 'send_back' | 'claim'>,
  input: { readonly rounds: number; readonly reviewSince: number | null; readonly now: number },
): string | null {
  const round = input.rounds > 0 ? ` · round ${String(input.rounds)}` : '';
  // `??`: a view served before LAI-758 carries no `send_back` at all.
  const sentBack = task.send_back ?? null;
  switch (task.status) {
    case 'review':
      return input.reviewSince === null
        ? `In review${round}`
        : `In review for ${formatDurationMs(Math.max(60_000, input.now - input.reviewSince))}${round}`;
    case 'done':
      return task.completed_at === null ? null : `Done ${ago(task.completed_at, input.now)}`;
    case 'cancelled':
      return null;
    case 'backlog':
    case 'todo':
      if (sentBack !== null) {
        return `Sent back ${ago(sentBack.created_at, input.now)} · round ${String(input.rounds + 1)}`;
      }
      return task.started_at === null ? 'Not started' : null;
    case 'in_progress':
      if (sentBack !== null) {
        return `Sent back ${ago(sentBack.created_at, input.now)} · round ${String(input.rounds + 1)}`;
      }
      return task.started_at === null ? null : `Started ${ago(task.started_at, input.now)}`;
  }
}

/** *597K of 716K (83%)* against the token estimate's high end; *212K so far* without one. */
export function tokensOfLine(total: number, p80: number | null): string {
  if (p80 === null || p80 <= 0) return `${compactTokens(total)} so far`;
  return `${compactTokens(total)} of ${compactTokens(p80)} (${shareOf(total, p80)})`;
}

/** The Details card's priority, as the design writes it: *P1 · High*. */
export function priorityWords(priority: TaskPriority): { code: string; word: string } {
  const word = priority === 'p1' ? 'High' : priority === 'p2' ? 'Medium' : 'Low';
  return { code: priority.toUpperCase(), word };
}

/**
 * The Development card's pull request: `#260 · not merged` for a GitHub pull
 * request, `#260 · merged` once GitHub said so, `#260` before it said either;
 * any other address as it is.
 */
export function pullRequestLine(url: string, merged: boolean | null): string {
  const number = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1];
  if (number === undefined) return url;
  return merged === null ? `#${number}` : `#${number} · ${merged ? 'merged' : 'not merged'}`;
}

/** A reason's first line, for a folded mention of it: the rest is one click away. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** One similar finished task in the Estimate card. */
export interface SimilarRow {
  readonly task_id: string;
  readonly key: string;
  readonly title: string;
  /** *took 44 min*, from the estimate's own similar list; null when it is not in it. */
  readonly took: string | null;
  /** Why it was sent back, each time, oldest first: the first line of each. */
  readonly sentBack: readonly { readonly round: number | null; readonly reason: string }[];
}

/**
 * The estimate's similar tasks — the ones it was computed from, with their
 * build times — and the send-back reasons `GET /tasks/:id/similar` adds,
 * matched by id; a similar task only that read names comes after, without a
 * time. Without that read (it failed, or has not answered) the estimate's own
 * list stands alone.
 */
export function similarRows(
  fromEstimate: readonly SimilarTaskRef[],
  similar: readonly SimilarTask[] | undefined,
): SimilarRow[] {
  const byId = new Map((similar ?? []).map((s) => [s.task_id, s] as const));
  const reasons = (id: string) =>
    (byId.get(id)?.send_backs ?? [])
      .map((b) => ({ round: b.round, reason: firstLine(b.reason) }))
      .filter((b) => b.reason !== '');
  const seen = new Set(fromEstimate.map((s) => s.task_id));
  return [
    ...fromEstimate.map((s) => ({
      task_id: s.task_id,
      key: s.key,
      title: s.title,
      took: `took ${buildLabel(s.build_ms)}`,
      sentBack: reasons(s.task_id),
    })),
    ...(similar ?? [])
      .filter((s) => !seen.has(s.task_id))
      .map((s) => ({
        task_id: s.task_id,
        key: s.key,
        title: s.title,
        took: null,
        sentBack: reasons(s.task_id),
      })),
  ];
}

/** What `created_via` is called on screen. */
const VIA: Readonly<Record<string, string>> = {
  web: 'the web',
  mcp: 'MCP',
  api: 'the API',
  webhook: 'a webhook',
  meeting: 'a meeting review',
};

/**
 * The foot's *Created via MCP · claude-code*: the way in, then the agent's
 * own name for itself when it gave one. A value this page does not know is
 * said as it is.
 */
export function createdViaLine(
  task: Pick<TaskSummary, 'created_via' | 'created_by_client'>,
): string {
  const via = VIA[task.created_via] ?? task.created_via;
  return task.created_by_client === null ? via : `${via} · ${task.created_by_client}`;
}
