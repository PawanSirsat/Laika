/**
 * The state panel at the top of the task detail (§11.4.2.1, D-129, LAI-1117):
 * which one a task shows, and the facts each draws — every one from what the
 * server already sends. Nothing here is a guess dressed as a fact: a figure
 * the server did not send is said not to be known.
 */

import type { ActivityEvent } from '../../../api/activity.ts';
import { formatDurationMs } from '../../../api/duration.ts';
import type { HandoffOffer } from '../../../api/handoffs.ts';
import { ciLine, shortSha, type EvidenceItem, type Round } from '../../../api/review.ts';
import type { TaskSummary } from '../../../api/tasks.ts';

export type HeroKind = 'review' | 'progress' | 'sent_back' | 'waiting' | 'done';

/**
 * Which panel a task shows, first match wins: in review; done; sent back and
 * not yet finished again; held by a live claim; waiting for the agent a work
 * request went to. A cancelled task, or one nobody is on, shows none.
 */
export function heroKind(
  task: Pick<TaskSummary, 'status' | 'send_back' | 'claim' | 'selected_agent'>,
): HeroKind | null {
  if (task.status === 'review') return 'review';
  if (task.status === 'done') return 'done';
  if (task.status === 'cancelled') return null;
  // `??`: a view served before LAI-758 carries no `send_back` at all.
  if ((task.send_back ?? null) !== null) return 'sent_back';
  if (task.claim !== undefined && task.claim !== null) return 'progress';
  if (task.selected_agent !== undefined && task.selected_agent !== null) return 'waiting';
  return null;
}

/** Every proof item of a round, as one list: commits, branch, pull request, tests. */
function itemsOf(round: Round): readonly EvidenceItem[] {
  return [
    ...round.commits,
    ...(round.branch === null ? [] : [round.branch]),
    ...(round.pull_request === null ? [] : [round.pull_request]),
    ...round.tests,
  ];
}

/** How many of a round's items GitHub confirmed, contradicted, or has not checked. */
function proofCounts(round: Round): {
  readonly n: number;
  readonly confirmed: number;
  readonly failed: number;
  readonly claimed: number;
} {
  const items = itemsOf(round);
  const confirmed = items.filter((i) => i.state === 'confirmed').length;
  const failed = items.filter((i) => i.state === 'failed').length;
  return { n: items.length, confirmed, failed, claimed: items.length - confirmed - failed };
}

/**
 * {@link confirmedSentence} in a few words, for a folded Proof section's
 * summary (LAI-1122): *all 7 confirmed*, *3 of 4 confirmed*, *1 of 4
 * contradicted*, *nothing confirmed yet*, *no proof attached*.
 */
export function confirmedShort(round: Round): string {
  const { n, confirmed, failed } = proofCounts(round);
  const of = (k: number) => `${String(k)} of ${String(n)}`;
  if (n === 0) return 'no proof attached';
  if (failed > 0) return `${of(failed)} contradicted`;
  if (confirmed === n) return n === 1 ? 'its 1 item confirmed' : `all ${String(n)} confirmed`;
  if (confirmed > 0) return `${of(confirmed)} confirmed`;
  return 'nothing confirmed yet';
}

export interface ConfirmedSentence {
  readonly tone: 'ok' | 'partial' | 'failed' | 'claimed' | 'none';
  readonly text: string;
}

/**
 * What the proof's states add up to, in one sentence (D-129 item 6): from
 * **GitHub's signed deliveries**, never "against the repository" — Laika reads
 * the webhook and never calls GitHub (D-116).
 */
export function confirmedSentence(round: Round): ConfirmedSentence {
  const { n, confirmed, failed, claimed } = proofCounts(round);
  if (n === 0) return { tone: 'none', text: 'No proof attached to this finish.' };
  const of = (k: number) => `${String(k)} of ${String(n)}`;
  if (failed > 0) {
    return {
      tone: 'failed',
      text: `GitHub's signed deliveries contradicted ${of(failed)} items · ${String(confirmed)} confirmed · ${String(claimed)} still claimed.`,
    };
  }
  if (confirmed === n) {
    return {
      tone: 'ok',
      text: `Laika confirmed all ${String(n)} items from GitHub's signed deliveries.`,
    };
  }
  if (confirmed > 0) {
    return {
      tone: 'partial',
      text: `Laika confirmed ${of(confirmed)} items from GitHub's signed deliveries · ${String(claimed)} still claimed by the agent.`,
    };
  }
  return {
    tone: 'claimed',
    text: "Nothing confirmed yet: every item is the agent's claim until GitHub's signed deliveries arrive.",
  };
}

export interface ReviewFacts {
  readonly pullRequest: { readonly url: string; readonly label: string; readonly merged: string };
  readonly ci: string;
  readonly ciTone: 'ok' | 'failed' | 'pending' | 'none';
  readonly tests: string;
  readonly testsSub: string;
  readonly commits: string;
  readonly commitsSub: string;
}

/** A GitHub pull request's number from its URL, or null for another shape. */
function prNumber(url: string): string | null {
  return /\/pull\/(\d+)/.exec(url)?.[1] ?? null;
}

/** `#260`, or `link` when the URL names no number. */
function prLabel(url: string): string {
  const n = prNumber(url);
  return n === null ? 'link' : `#${n}`;
}

/** The four facts of a finished round, as the review panel's grid draws them. */
export function reviewFacts(round: Round): ReviewFacts {
  const pr = round.pull_request;
  const number = pr === null ? null : prNumber(pr.url);
  const passed = round.tests.filter((t) => t.exit_code === 0).length;
  const failed = round.tests.length - passed;
  const ci = round.ci;
  return {
    pullRequest: {
      url: pr?.url ?? '',
      label: pr === null ? 'None' : number === null ? 'Open ↗' : `#${number} ↗`,
      merged:
        pr === null
          ? 'Not attached'
          : pr.merged === true
            ? 'Merged'
            : pr.merged === false
              ? 'Open · not merged'
              : 'Not reported yet',
    },
    ci:
      ci === null || ci.total === 0
        ? 'No CI reported'
        : ci.failed > 0
          ? ciLine(ci).replace(/^CI: /, '✗ ')
          : `✓ ${String(ci.passed)} of ${String(ci.total)} passed${ci.pending > 0 ? `, ${String(ci.pending)} pending` : ''}`,
    ciTone:
      ci === null || ci.total === 0
        ? 'none'
        : ci.failed > 0
          ? 'failed'
          : ci.pending > 0
            ? 'pending'
            : 'ok',
    tests:
      round.tests.length === 0 ? 'None run' : `${String(passed)} passed · ${String(failed)} failed`,
    testsSub:
      round.tests.length === 0
        ? ''
        : failed === 0
          ? 'every run exit 0'
          : `${String(failed)} exited non-zero`,
    commits: String(round.commits.length),
    commitsSub: round.branch?.name ?? (ci === null ? '' : `on ${shortSha(ci.head_sha)}`),
  };
}

/** How many test runs the review panel lists before *Show all N runs* (LAI-1122). */
export const TESTS_SHOWN = 4;

/** The runs the review panel lists: the first {@link TESTS_SHOWN}, or all of them. */
export function testsShown<T>(tests: readonly T[], all: boolean): readonly T[] {
  return all ? tests : tests.slice(0, TESTS_SHOWN);
}

/** The toggle under the runs, or null when every run already shows. */
export function testsToggle(total: number, all: boolean): string | null {
  if (total <= TESTS_SHOWN) return null;
  return all ? 'Show fewer' : `Show all ${String(total)} runs`;
}

export interface RoundEvidence {
  /** Null when the round attached no pull request. */
  readonly pullRequest: {
    readonly url: string;
    readonly label: string;
    readonly merged: string;
  } | null;
  readonly ci: string;
  readonly ciTone: ReviewFacts['ciTone'];
  readonly commits: string;
  readonly tests: string;
}

/**
 * The sent-back panel's one line about the round that was sent back
 * (LAI-1122): *PR #260 not merged · CI 13/13 passed · 4 commits · 10 tests
 * passed*. Every figure from the round; one it lacks is said to be missing.
 */
export function roundEvidence(round: Round): RoundEvidence {
  const facts = reviewFacts(round);
  const pr = round.pull_request;
  const ci = round.ci;
  const passed = round.tests.filter((t) => t.exit_code === 0).length;
  const failed = round.tests.length - passed;
  const plural = (k: number, one: string, many: string) => `${String(k)} ${k === 1 ? one : many}`;
  return {
    pullRequest:
      pr === null
        ? null
        : {
            url: pr.url,
            label: prLabel(pr.url),
            merged:
              pr.merged === true
                ? 'merged'
                : pr.merged === false
                  ? 'not merged'
                  : 'merge not reported',
          },
    ci:
      ci === null || ci.total === 0
        ? 'No CI reported'
        : ci.failed > 0
          ? `CI ${String(ci.failed)}/${String(ci.total)} failed`
          : `CI ${String(ci.passed)}/${String(ci.total)} passed${ci.pending > 0 ? `, ${String(ci.pending)} pending` : ''}`,
    ciTone: facts.ciTone,
    commits: plural(round.commits.length, 'commit', 'commits'),
    tests:
      round.tests.length === 0
        ? 'No tests run'
        : failed === 0
          ? `${plural(passed, 'test', 'tests')} passed`
          : `${String(passed)} passed · ${String(failed)} failed`,
  };
}

/**
 * When the live claim's holder took the task: its own `task.updated` claim row
 * for this generation, else when the task first started. `null` when neither
 * is known — the panel then says *Working now* without a duration.
 */
export function workingSince(
  activity: readonly ActivityEvent[],
  generation: number,
  startedAt: number | null,
): number | null {
  for (const event of activity) {
    if (event.type !== 'task.updated') continue;
    const payload = event.payload as {
      field?: unknown;
      to?: { generation?: unknown } | null;
    } | null;
    if (payload?.field !== 'claim') continue;
    if (payload.to?.generation === generation) return event.created_at;
  }
  return startedAt;
}

/** `for 18 min`, `for 1 h 12 min`; `just started` under a minute. */
export function workingFor(since: number, now: number): string {
  const ms = Math.max(0, now - since);
  return ms < 60_000 ? 'just started' : `for ${formatDurationMs(ms)}`;
}

/** How far into the estimate a run is, 0–1, against the high end; `null` without one. */
export function progressFraction(elapsedMs: number, p80Ms: number | null): number | null {
  if (p80Ms === null || p80Ms <= 0) return null;
  return Math.max(0, Math.min(1, elapsedMs / p80Ms));
}

/** The work request still waiting on `agentId`, newest first; none once it was accepted or closed. */
export function openWorkRequest(
  offers: readonly HandoffOffer[],
  agentId: string,
): HandoffOffer | undefined {
  return offers
    .filter((o) => o.kind === 'work_request' && o.state === 'open' && o.to_agent_id === agentId)
    .sort((a, b) => b.created_at - a.created_at)[0];
}

/**
 * Whether to offer Approve / Send back here (D-082, D-129 item 5): the
 * assignee or a lead, signed in. The server decides; this only keeps a button
 * from being offered to someone it would refuse.
 */
export function mayDecideReview(input: {
  readonly meId: string | undefined;
  readonly assigneeId: string | null;
  readonly leads: boolean;
}): boolean {
  if (input.meId === undefined) return false;
  return input.leads || input.assigneeId === input.meId;
}
