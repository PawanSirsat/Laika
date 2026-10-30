import { request } from './client.ts';
import { formatDurationMs } from './duration.ts';
import { agentLabel } from './selected-agent.ts';
import { type Task } from './tasks.ts';

/**
 * The review gate (SPEC §4.25–§4.27, §6.4, D-082, LAI-758): the proof an agent
 * hands back with `finish_task`, the queue of work waiting for a person, and
 * the two decisions a person makes there.
 *
 * Every evidence item starts `claimed` — the agent said so and nothing has
 * checked. Step 2 (D-083, LAI-766) has GitHub's own deliveries flip it to
 * `confirmed` or `failed`, and adds the CI line for the round's head commit.
 */

export type EvidenceState = 'claimed' | 'confirmed' | 'failed';

export interface EvidenceItem {
  readonly id: string;
  readonly state: EvidenceState;
  /** What checked it — `github` (D-083). Null while `claimed`. */
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
  /** Whether GitHub reported it merged; null until a delivery named it (D-083). */
  readonly merged: boolean | null;
}

/**
 * CI for a round's head commit, as GitHub reported it (§4.31, D-083). The
 * test items' states follow it: any failed → `failed`, all passed →
 * `confirmed`, otherwise `claimed`.
 */
export interface RoundCi {
  readonly head_sha: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
  /** What failed, by name, at most ten. */
  readonly failed_names: readonly string[];
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
  /**
   * The registered agent whose token finished it (D-120, LAI-1001): named
   * `<harness> · <device>` through `agentLabel`. Null for a person, a legacy
   * token, a token since deleted — **and for an agent the reader may not
   * see** (another person's, neither selected on the task nor holding it).
   */
  readonly agent: RoundAgent | null;
  /** A registered agent finished it, even when `agent` is withheld: *an agent*. */
  readonly by_registered_agent: boolean;
  readonly summary_md: string;
  readonly commits: readonly CommitEvidence[];
  readonly branch: BranchEvidence | null;
  readonly pull_request: PullRequestEvidence | null;
  readonly tests: readonly TestEvidence[];
  /** Null when GitHub reported no CI for the round's head commit. */
  readonly ci: RoundCi | null;
  readonly created_at: number;
}

/** `RoundAgentView` in `server/src/services/rounds.ts`: what naming the agent takes. */
export interface RoundAgent {
  readonly id: string;
  readonly harness: string;
  readonly device_label: string | null;
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
  /**
   * "Check this one" (LAI-772): its first round finished in under a quarter
   * of the build-time p50 frozen at the start, and CI has not confirmed it.
   * The server decides; about the task, never the person.
   */
  readonly cue: FastFinishCue | null;
}

/** The server's `FastFinishCue`. */
export interface FastFinishCue {
  readonly kind: 'fast';
  readonly build_ms: number;
  readonly forecast_p50_ms: number;
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

/** A registered agent the reader may not see: true, and naming nobody. */
export const HIDDEN_AGENT = 'an agent';

/**
 * Who finished a round, as the review screens name them (D-120, LAI-1001):
 *
 * - a registered agent the reader may see, as `<harness> · <device>` —
 *   *Omnigent · Belka* — never the client's own word for itself;
 * - one they may not (the server withholds it), as {@link HIDDEN_AGENT}, and
 *   **not** by `client_name`, which carries the agent's token name;
 * - a legacy token's round by its client word, marked unregistered;
 * - a round a person finished: `null`.
 *
 * Both fields are read with `??`, so a round from a server older than them
 * reads as unregistered rather than crashing.
 */
export function roundAgentName(
  round: Pick<Round, 'agent' | 'by_registered_agent' | 'client_name'>,
): string | null {
  const sent = round as { agent?: RoundAgent | null; by_registered_agent?: boolean };
  const agent = sent.agent ?? null;
  if (agent !== null) return agentLabel(agent);
  if (sent.by_registered_agent === true) return HIDDEN_AGENT;
  return round.client_name === null ? null : `unregistered agent (${round.client_name})`;
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

/**
 * The CI line, as the server's `get_task_context` says it
 * (`server/src/services/github-proof.ts`): *CI: 3 of 3 checks passed*,
 * *CI: lint failed*, *CI: 1 of 2 checks passed, 1 pending*.
 */
export function ciLine(ci: RoundCi): string {
  const noun = ci.total === 1 ? 'check' : 'checks';
  if (ci.failed > 0) {
    return ci.failed <= 3 && ci.failed_names.length === ci.failed
      ? `CI: ${ci.failed_names.join(', ')} failed`
      : `CI: ${String(ci.failed)} of ${String(ci.total)} ${noun} failed`;
  }
  const passed = `CI: ${String(ci.passed)} of ${String(ci.total)} ${noun} passed`;
  return ci.pending > 0 ? `${passed}, ${String(ci.pending)} pending` : passed;
}

/** What CI says about a round: failed, confirmed (all passed), pending, or none. */
export type CiVerdict = 'failed' | 'confirmed' | 'pending' | 'none';

export function ciVerdict(round: Round | null): CiVerdict {
  const ci = round?.ci ?? null;
  if (ci === null || ci.total === 0) return 'none';
  if (ci.failed > 0) return 'failed';
  return ci.pending > 0 ? 'pending' : 'confirmed';
}

/**
 * When anything about a round's proof last changed — the newest `state_at` —
 * so a screen holding the round can tell that GitHub has spoken since it drew.
 */
export function proofStamp(round: Round | null): number {
  if (round === null) return 0;
  const items: readonly EvidenceItem[] = [
    ...round.commits,
    ...(round.branch === null ? [] : [round.branch]),
    ...(round.pull_request === null ? [] : [round.pull_request]),
    ...round.tests,
  ];
  return items.reduce((latest, item) => Math.max(latest, item.state_at ?? 0), 0);
}

/** The queue's filters. `assignee` is a user id, `'none'`, or null for anyone. */
export interface QueueFilter {
  readonly project: string | null;
  readonly assignee: string | null;
  readonly failing: boolean;
  readonly noEvidence: boolean;
  /** GitHub's CI failed for the round's head commit (D-083). */
  readonly ciFailed: boolean;
  /** GitHub's CI passed, every check of it (D-083). */
  readonly ciConfirmed: boolean;
  /** Only the tasks cued "check this one" (LAI-772). */
  readonly fast: boolean;
}

export const NO_FILTER: QueueFilter = {
  project: null,
  assignee: null,
  failing: false,
  noEvidence: false,
  ciFailed: false,
  ciConfirmed: false,
  fast: false,
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
    const ci = ciVerdict(item.round);
    if (filter.ciFailed && ci !== 'failed') return false;
    if (filter.ciConfirmed && ci !== 'confirmed') return false;
    if (filter.fast && item.cue === null) return false;
    return true;
  });
}

const MINUTE = 60_000;

/** How long something has waited: `just now`, `12 min`, `3 h 12 min`, `2 d 5 h` (LAI-830). */
export function waitingFor(since: number, now: number): string {
  const age = Math.max(0, now - since);
  if (age < MINUTE) return 'just now';
  return formatDurationMs(age);
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
