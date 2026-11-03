/**
 * The rail's derived lines (§11.4.2.1, LAI-1117): the status control's
 * sub-line and the Estimate card's token headline.
 */

import { formatDurationMs } from '../../../api/duration.ts';
import type { ActivityEvent } from '../../../api/activity.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
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
      if (task.send_back !== null) {
        return `Sent back ${ago(task.send_back.created_at, input.now)} · round ${String(input.rounds + 1)}`;
      }
      return task.started_at === null ? 'Not started' : null;
    case 'in_progress':
      if (task.send_back !== null) {
        return `Sent back ${ago(task.send_back.created_at, input.now)} · round ${String(input.rounds + 1)}`;
      }
      return task.started_at === null ? null : `Started ${ago(task.started_at, input.now)}`;
  }
}

/** *597K of 716K (83%)* against the token estimate's high end; *212K so far* without one. */
export function tokensOfLine(total: number, p80: number | null): string {
  if (p80 === null || p80 <= 0) return `${compactTokens(total)} so far`;
  return `${compactTokens(total)} of ${compactTokens(p80)} (${shareOf(total, p80)})`;
}
