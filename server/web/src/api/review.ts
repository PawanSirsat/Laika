import { request } from './client.ts';
import { type Task } from './tasks.ts';

/**
 * The review gate (SPEC §4.25–§4.27, §6.4, D-082, LAI-758): the proof an agent
 * hands back with `finish_task`, the queue of work waiting for a person, and
 * the two decisions a person makes there.
 *
 * Every evidence item is `claimed` today — the agent said so and nothing has
 * checked. `confirmed` and `failed` are what step 2 (LAIKA-477) will write
 * when GitHub checks an item; the client draws all three now so that day
 * needs no change here.
 */

export type EvidenceState = 'claimed' | 'confirmed' | 'failed';

export interface EvidenceItem {
  readonly id: string;
  readonly state: EvidenceState;
  /** What checked it — `github` in step 2. Null while `claimed`. */
  readonly state_source: string | null;
  readonly state_at: number | null;
}

export interface CommitEvidence extends EvidenceItem {
  readonly sha: string;
  /** The commit's first line, or null. */
  readonly message: string | null;
}

export interface BranchEvidence extends EvidenceItem {
  readonly name: string;
}

export interface PullRequestEvidence extends EvidenceItem {
  readonly url: string;
}

export interface TestEvidence extends EvidenceItem {
  readonly command: string;
  readonly exit_code: number;
}

/** One finish of a task, with its proof (§4.25). */
export interface Round {
  readonly id: string;
  readonly task_id: string;
  readonly number: number;
  readonly finished_by: string;
  /** The agent's own name for itself when it finished (D-076), or null. */
  readonly client_name: string | null;
  readonly summary_md: string;
  readonly commits: readonly CommitEvidence[];
  readonly branch: BranchEvidence | null;
  readonly pull_request: PullRequestEvidence | null;
  readonly tests: readonly TestEvidence[];
  readonly created_at: number;
}

/** The send-back a task currently carries (§4.27). */
export interface SendBack {
  readonly id: string;
  readonly reason_md: string;
  readonly decided_by: string;
  readonly comment_id: string | null;
  readonly round_number: number | null;
  readonly created_at: number;
}

/** `GET /tasks/:id/rounds`: newest round first. */
export interface TaskRounds {
  readonly rounds: readonly Round[];
  readonly send_back: SendBack | null;
}

export interface ReviewProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly prefix: string;
}

export interface ReviewQueueItem {
  readonly task: Task;
  readonly project: ReviewProject;
  readonly assignee_name: string | null;
  /** When it last entered a review status — what "waiting" counts from. */
  readonly waiting_since: number;
  readonly round: Round | null;
  readonly finished_by_name: string | null;
  /** Whether this viewer may accept or send it back (§5). */
  readonly can_decide: boolean;
}

/** `GET /review`: oldest waiting first, at most 200. */
export interface ReviewQueue {
  readonly tasks: readonly ReviewQueueItem[];
  readonly truncated: boolean;
}

/** The server's bound on a send-back's reason (§6.4). */
export const SEND_BACK_REASON_MAX = 5000;

export function getTaskRounds(taskId: string, signal?: AbortSignal): Promise<TaskRounds> {
  return request<TaskRounds>(`/tasks/${encodeURIComponent(taskId)}/rounds`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getReviewQueue(signal?: AbortSignal): Promise<ReviewQueue> {
  return request<ReviewQueue>('/review', { ...(signal === undefined ? {} : { signal }) });
}

export function acceptReview(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/accept`, { method: 'POST' });
}

export function sendBackReview(taskId: string, reason: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/send-back`, {
    method: 'POST',
    body: { reason },
  });
}

/**
 * A pull request link that is safe to draw as one: `http:` or `https:` only,
 * or null. The server refuses anything else before storing it; this is the
 * second lock, at render time, for a row written some other way.
 */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** What a round's proof amounts to, for a queue row. */
export interface EvidenceSummary {
  readonly commits: number;
  readonly pullRequest: string | null;
  readonly testsPassed: number;
  readonly testsFailed: number;
  /** No commit, branch, pull request or test at all. */
  readonly empty: boolean;
}

export function evidenceSummary(round: Round | null): EvidenceSummary {
  if (round === null) {
    return { commits: 0, pullRequest: null, testsPassed: 0, testsFailed: 0, empty: true };
  }
  const passed = round.tests.filter((t) => t.exit_code === 0).length;
  return {
    commits: round.commits.length,
    pullRequest: round.pull_request === null ? null : safeHttpUrl(round.pull_request.url),
    testsPassed: passed,
    testsFailed: round.tests.length - passed,
    empty:
      round.commits.length === 0 &&
      round.branch === null &&
      round.pull_request === null &&
      round.tests.length === 0,
  };
}

/** The queue's filters. `assignee` is a user id, `'none'`, or null for anyone. */
export interface QueueFilter {
  readonly project: string | null;
  readonly assignee: string | null;
  readonly failing: boolean;
  readonly noEvidence: boolean;
}

export const NO_FILTER: QueueFilter = {
  project: null,
  assignee: null,
  failing: false,
  noEvidence: false,
};

export function filterQueue(
  items: readonly ReviewQueueItem[],
  filter: QueueFilter,
): ReviewQueueItem[] {
  return items.filter((item) => {
    if (filter.project !== null && item.project.slug !== filter.project) return false;
    if (filter.assignee === 'none' && item.task.assignee_id !== null) return false;
    if (
      filter.assignee !== null &&
      filter.assignee !== 'none' &&
      item.task.assignee_id !== filter.assignee
    ) {
      return false;
    }
    const summary = evidenceSummary(item.round);
    if (filter.failing && summary.testsFailed === 0) return false;
    if (filter.noEvidence && !summary.empty) return false;
    return true;
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long something has waited, compactly: `just now`, `12 min`, `3 h`, `2 d`. */
export function waitingFor(since: number, now: number): string {
  const age = Math.max(0, now - since);
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${String(Math.floor(age / MINUTE))} min`;
  if (age < DAY) return `${String(Math.floor(age / HOUR))} h`;
  return `${String(Math.floor(age / DAY))} d`;
}

/** Why a send-back reason cannot be sent yet, or null when it can. */
export function sendBackProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === '') return 'Say what needs to change: the agent reads this first.';
  if (trimmed.length > SEND_BACK_REASON_MAX) {
    return `At most ${String(SEND_BACK_REASON_MAX)} characters.`;
  }
  return null;
}

/** A sha as drawn: the first twelve characters, as GitHub abbreviates in lists. */
export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}
