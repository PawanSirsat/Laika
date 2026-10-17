import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Db } from '../db/client.ts';
import { gt, sql } from 'drizzle-orm';
import { meetingReviews, orgs } from '../db/schema.ts';
import { appendActivity } from '../db/activity.ts';
import { ApiError } from '../errors.ts';
import { decryptSecret, type SecretPurpose } from '../secrets.ts';
import { httpProviderClient, type ProviderClient } from './provider.ts';
import { eq } from 'drizzle-orm';
import { type ServiceCaller } from '../auth/resolve-actor.ts';
import { type TaskStatus } from '../db/enums.ts';
import { tasks } from '../db/schema.ts';
import { requireOrgId } from '../db/orgs.ts';
import { resolveBranchTask, resolveRepoProjects } from './heartbeats.ts';
import { addComment } from './comments.ts';
import { isOutsideId } from './outside-ids.ts';
import { changeStatus } from './tasks.ts';
import { type GithubCheckKind } from '../db/enums.ts';
import {
  checkOutcome,
  foldRepo,
  githubTime,
  pullRequestKey,
  pullRequestsWithHead,
  reconcileProof,
  recordCheck,
  recordCommits,
  recordPullRequest,
  type SeenCommit,
} from './github-proof.ts';

/**
 * `POST /webhooks/github` — the parts that decide whether to listen (§10.1).
 *
 * Mounted outside `/api/v1` with no user session (§10, line 1195), so the
 * signature is the only thing standing between an anonymous caller and the
 * handlers. Everything here is about that.
 */

/** GitHub's header, and the only scheme it has ever sent for this. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';
/** SHA-256 as lowercase hex. Fixed, so a wrong length is not a timing signal. */
const DIGEST_HEX_LENGTH = 64;

/**
 * The org's webhook secret, or `null` when none is configured.
 *
 * **Decrypted per request** rather than cached: §12 keeps it as ciphertext, the
 * plaintext has no business outliving the request that needs it, and an org that
 * rotates its secret should not have to restart the process.
 *
 * A **failed** decrypt is not `null`. `decryptSecret` throws
 * `SecretAuthError` when `LAIKA_SECRET` has changed or the row was altered, and
 * that must not arrive here as "no webhook configured" — an operator told the
 * webhook is unconfigured will go and configure it, which is the one action that
 * cannot help (LAI-437, LAI-161).
 */
export function githubWebhookSecret(db: Db, serverSecret: string): string | null {
  const row = db.select({ enc: orgs.githubWebhookSecretEnc }).from(orgs).limit(1).get();

  return storedSecret(row?.enc ?? null, serverSecret, 'github_webhook_secret');
}

/**
 * §10.2's secret (D-052, LAI-450).
 *
 * **A different column and a different `SecretPurpose` from §10.1's.** One secret
 * for two integrations means revoking either breaks both, and a leak of one
 * hands over the other — so the ciphertexts are not interchangeable either, and
 * a row written for one purpose will not decrypt under the other.
 */
export function transcriptWebhookSecret(db: Db, serverSecret: string): string | null {
  const row = db.select({ enc: orgs.transcriptWebhookSecretEnc }).from(orgs).limit(1).get();

  return storedSecret(row?.enc ?? null, serverSecret, 'transcript_webhook_secret');
}

function storedSecret(
  enc: string | null,
  serverSecret: string,
  purpose: SecretPurpose,
): string | null {
  if (enc === null || enc === '') return null;

  return decryptSecret(enc, serverSecret, purpose);
}

/**
 * Does this body carry a signature made with this secret?
 *
 * ## Constant-time, and why the early returns are not a leak
 *
 * §13.1 requires constant-time comparison for HMACs. A byte-by-byte compare
 * returns sooner the earlier it finds a difference, so an attacker who can time
 * responses recovers the expected digest one character at a time and then replays
 * it — the signature check becomes a formality without ever failing a test.
 *
 * The three rejections above the comparison are all decided by **the shape of
 * the caller's own input** — absent header, wrong scheme, not 64 hex characters —
 * and none of them touches the secret or the expected digest. Timing them tells
 * an attacker only what they already typed. `timingSafeEqual` also *throws* on a
 * length mismatch rather than returning false, so the length check has to happen
 * first regardless.
 */
export function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (header === null || header === undefined) return false;
  if (!header.startsWith(SIGNATURE_PREFIX)) return false;

  const offered = header.slice(SIGNATURE_PREFIX.length).toLowerCase();
  if (offered.length !== DIGEST_HEX_LENGTH || !/^[0-9a-f]+$/.test(offered)) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  return timingSafeEqual(Buffer.from(offered, 'hex'), Buffer.from(expected, 'hex'));
}

/** 24 hours, per §10.1. */
export const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A cap, so an attacker cannot grow this by inventing delivery ids.
 *
 * Sized well above a real day: a busy org sees thousands of events a day, not a
 * hundred thousand. Reaching it means something is wrong, and dropping the
 * oldest is the failure that costs least — a redelivery of a very old event is
 * processed twice, which is the same thing a restart already does.
 */
const MAX_TRACKED = 100_000;

/**
 * Delivery ids seen in the last 24 hours (§10.1).
 *
 * ## In memory, and it does not survive a restart
 *
 * **Stated because the alternative is discovering it.** Laika is one process
 * with one SQLite file (D-002), so a `Map` is enough to make a redelivery
 * idempotent within a run.
 *
 * **GitHub does not retry a failed delivery** (LAI-753). Its documentation is
 * plain: a delivery that times out or answers non-2xx is marked failed and
 * stays failed until somebody presses *Redeliver* on the webhook's *Recent
 * Deliveries* page (or calls the redeliver API). So the duplicates this
 * catches are those manual redeliveries, and a delivery that arrives while
 * production restarts — every push to `master` restarts it (D-073) — is
 * **lost** unless redelivered by hand. The Organisation screen says so.
 *
 * What it costs: a redelivery **after a restart** is processed a second time.
 * For `push` that means a second `webhook.commit` row in an append-only log; for
 * `pull_request` and `issue_comment` the handlers are already idempotent in
 * effect — a task moved to `review` twice is in `review`. So the residue is a
 * duplicated audit row after a restart, which is visible, harmless and honest.
 *
 * A table would fix that and costs a migration, a write on the hot path, and a
 * cleanup job for rows nobody reads. **If a duplicated `webhook.commit` ever
 * matters, that is the trade to revisit** — it is not free either way, and this
 * is the cheaper wrong answer.
 */
export class DeliveryLog {
  private readonly seenAt = new Map<string, number>();

  /**
   * Record this delivery and say whether it is new.
   *
   * `true` means "not seen": the caller should process it. Named for what the
   * caller does rather than for what the map holds, because `seen()` returning
   * `true` for an unseen delivery is exactly the inversion somebody writes at
   * two in the morning.
   */
  accept(deliveryId: string, now: number): boolean {
    this.evict(now);

    if (this.seenAt.has(deliveryId)) return false;

    this.seenAt.set(deliveryId, now);
    return true;
  }

  /** For the tests, and for a health endpoint later. */
  size(): number {
    return this.seenAt.size;
  }

  /**
   * **Stops at the first live entry rather than scanning.**
   *
   * A `Map` iterates in insertion order and `now` is `Date.now()`, so entries
   * are in time order and everything after the first unexpired one is unexpired.
   * Sweeping the whole map on every delivery made this quadratic — 100k
   * deliveries took thirteen seconds in a test, which is the shape of a real
   * problem on a busy org rather than a slow test.
   *
   * The monotonic-clock assumption is worth naming because it is the thing that
   * makes the `break` correct: a caller passing times out of order would leave
   * expired entries behind. Nothing does, and the cost of being wrong is a
   * delivery remembered slightly too long.
   */
  private evict(now: number): void {
    for (const [id, at] of this.seenAt) {
      if (now - at < DELIVERY_TTL_MS) break;
      this.seenAt.delete(id);
    }

    // Insertion order is arrival order, so the first entry is the oldest.
    while (this.seenAt.size >= MAX_TRACKED) {
      const oldest = this.seenAt.keys().next();
      if (oldest.done === true) break;
      this.seenAt.delete(oldest.value);
    }
  }
}

/**
 * What a delivery did, for the route to answer with and a test to assert on.
 *
 * `ignored` is a first-class outcome, not a failure: §10.1 says *"everything
 * else is acknowledged and ignored"*, and a push on `main` that resolves to no
 * task is a **normal delivery** — §9.2's rule is that resolution degrades rather
 * than errors, and it applies here too.
 */
export interface DeliveryOutcome {
  handled: boolean;
  /** The task a `push` or `pull_request` resolved to, when it resolved to one. */
  taskId?: string;
  reason?: string;
  /** How many rounds' proof this delivery changed (D-083). */
  rounds?: number;
}

const IGNORED: DeliveryOutcome = { handled: false, reason: 'event not handled' };

/** GitHub's `push`: `ref` is `refs/heads/<branch>`, `repository.full_name` is `owner/name`. */
interface PushPayload {
  ref?: unknown;
  after?: unknown;
  deleted?: unknown;
  forced?: unknown;
  commits?: unknown;
  repository?: { full_name?: unknown; default_branch?: unknown };
}

interface PullRequestPayload {
  action?: unknown;
  pull_request?: {
    head?: { ref?: unknown; sha?: unknown };
    number?: unknown;
    merged?: unknown;
    html_url?: unknown;
    updated_at?: unknown;
  };
  repository?: { full_name?: unknown };
}

/** How many shas one `webhook.commit` row lists; `count` says how many there were. */
export const PUSH_SHAS_LISTED = 50;
/** A bound on what one delivery may make this server store. */
const PUSH_COMMITS_RECORDED = 2048;

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * `push` → one `webhook.commit` row, and its commits remembered for the proof
 * (§10.1, §9.2, LAI-753, D-083).
 *
 * **The row says what a reader needs**: the repository, the branch, whether it
 * is the repository's default branch, how many commits the delivery carried,
 * their shas (the first 50) and whether it was forced. It does **not** say who
 * wrote them: D-050 refused mapping a commit author to a Laika user, and an
 * author's name or email in the payload would be that mapping arriving as a
 * convenience.
 *
 * **A push to the default branch is stored too.** It names no task, so it is
 * the project's row rather than a task's — the project whose `repo` (§4.3) is
 * this repository. A branch that resolves to no task is not an error either:
 * §9.2's resolution degrades, and `main` is the commonest branch there is.
 *
 * The commits are remembered whether or not any project tracks the repository
 * (§4.28): a project that never named its repository still has an agent's
 * proof to confirm.
 */
export function handlePush(db: Db, payload: PushPayload, now: number): DeliveryOutcome {
  const repoName = str(payload.repository?.full_name);
  const ref = str(payload.ref);
  if (repoName === null || ref === null)
    return { handled: false, reason: 'push is missing repo or ref' };
  if (payload.deleted === true) return { handled: false, reason: 'branch deleted' };
  if (!ref.startsWith('refs/heads/')) return { handled: false, reason: 'not a branch' };
  const repo = foldRepo(repoName);
  if (repo === null) return { handled: false, reason: 'push is missing repo or ref' };

  const branch = ref.slice('refs/heads/'.length);
  const listed = pushCommits(payload.commits);
  const after = str(payload.after);
  const shas = recordCommits(
    db,
    repo,
    branch,
    after === null ? listed : [...listed, { sha: after, committedAt: null }],
    now,
  );

  const resolved = resolveBranchTask(db, repoName, branch);
  const projectId = resolved?.projectId ?? soleProject(db, repoName, branch);
  if (projectId !== null) {
    const defaultBranch = str(payload.repository?.default_branch);
    appendActivity(db, {
      orgId: requireOrgId(db),
      projectId,
      taskId: resolved?.taskId ?? null,
      actorId: null,
      actorKind: 'system',
      type: 'webhook.commit',
      payload: {
        repo: repoName,
        branch,
        default_branch: defaultBranch !== null && branch === defaultBranch,
        count: listed.length,
        shas: listed.slice(0, PUSH_SHAS_LISTED).map((c) => c.sha.toLowerCase()),
        forced: payload.forced === true,
      },
      now,
    });
  }

  const rounds = reconcileProof(db, { shas, branches: [branch] }, now);

  return {
    handled: true,
    ...(resolved === null ? {} : { taskId: resolved.taskId }),
    ...(projectId === null ? { reason: 'repository is tracked by no project' } : {}),
    rounds,
  };
}

/** The commits a push lists, bounded, each with its own timestamp. */
function pushCommits(value: unknown): SeenCommit[] {
  if (!Array.isArray(value)) return [];
  const commits: SeenCommit[] = [];
  for (const entry of value.slice(0, PUSH_COMMITS_RECORDED) as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, timestamp } = entry as { id?: unknown; timestamp?: unknown };
    const sha = str(id);
    if (sha === null || !/^[0-9a-fA-F]{40}$/.test(sha)) continue;
    commits.push({ sha, committedAt: githubTime(timestamp) });
  }
  return commits;
}

/** The one project tracking this repository, or null for none or several. */
function soleProject(db: Db, repo: string, branch: string): string | null {
  const { projectIds } = resolveRepoProjects(db, repo, branch);
  return projectIds.length === 1 ? projectIds[0]! : null;
}

/**
 * `pull_request` → link it and move the task (§10.1).
 *
 * **opened → `in_progress`; merged → `review`.** Both go through
 * `changeStatus`, which is §5's rules and one `activity` row and one SSE event —
 * the same path a person's `POST /tasks/:id/status` takes. A second
 * implementation here would be a second answer to "what happens when a task
 * moves", and they would diverge on the first change to either.
 *
 * **Merged → `review` is D-051.** §5 restricts that move to the assignee, a
 * lead or an admin, and a webhook is none of them — but that restriction is
 * about people, because its reason is *"agents do not self-certify"* and a
 * merged pull request is somebody else's review, not the actor's own claim.
 *
 * A transition §5 forbids — a `backlog` task whose PR is merged — still throws,
 * because `assertTransition` is not part of the exemption and nothing about a
 * webhook makes an impossible move possible.
 */
export function handlePullRequest(
  db: Db,
  payload: PullRequestPayload,
  principal: (projectId: string) => ServiceCaller,
  now: number,
): DeliveryOutcome {
  const action = str(payload.action);
  const repo = str(payload.repository?.full_name);
  const branch = str(payload.pull_request?.head?.ref);
  if (action === null || repo === null || branch === null) {
    return { handled: false, reason: 'pull_request is missing action, repo or branch' };
  }

  // Remembered for the proof (D-083) **before** anything moves, and whatever
  // the action: `synchronize` moves no task but is a new head commit, and a
  // move §5 refuses must not lose what GitHub said about the pull request.
  const rounds = recordPullRequestProof(db, repo, branch, payload, now);

  const to = statusForPullRequest(action, payload.pull_request?.merged === true);
  if (to === null) return { ...IGNORED, rounds };

  const resolved = resolveBranchTask(db, repo, branch);
  if (resolved === null) return { handled: false, reason: 'branch resolved to no task' };

  const number = payload.pull_request?.number;
  const held =
    db.select({ ref: tasks.externalRef }).from(tasks).where(eq(tasks.id, resolved.taskId)).get()
      ?.ref ?? null;
  // §9.2's `external_ref`. Written before the transition so a refused move
  // still records which pull request was talking about this task — **unless
  // it holds an outside id** (LAI-780): that is how the card is found by its
  // id elsewhere, and the pull request is kept as proof anyway (D-083). Over
  // nothing, or over an earlier pull request's ref, it writes.
  if (typeof number === 'number' && (held === null || !isOutsideId(held))) {
    db.update(tasks)
      .set({ externalRef: `${repo}#${String(number)}`, updatedAt: now })
      .where(eq(tasks.id, resolved.taskId))
      .run();
  }

  const current = db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, resolved.taskId))
    .get()?.status;

  // **`opened` and `reopened` only start work** (D-083). They move a task out
  // of `backlog` or `todo` and nothing else: a late or redelivered `opened`,
  // or a person opening the pull request while the task waits in review,
  // must not pull it out of the Review queue — and `reopened` must not take
  // accepted work back out of done.
  if (to === 'in_progress' && current !== 'backlog' && current !== 'todo') {
    return { handled: true, taskId: resolved.taskId, reason: `left in ${String(current)}`, rounds };
  }

  // **Already there, or past it, is not a failure** (LAI-766, D-083). Under
  // the review gate the agent finishes first and a person merges after, so
  // the task is in review — or already accepted — when `merged` arrives.
  // Answering `409` or `422` would mark the delivery failed on GitHub's page
  // for doing exactly what it should, and a merge never moves work out of done.
  if (to === 'review' && (current === 'review' || current === 'done')) {
    return { handled: true, taskId: resolved.taskId, reason: `left in ${current}`, rounds };
  }

  changeStatus(db, principal(resolved.projectId), resolved.taskId, to, now);

  return { handled: true, taskId: resolved.taskId, rounds };
}

/**
 * The pull request and its head commit, remembered (§4.28, §4.29), and the
 * rounds that name either re-checked. Returns how many changed.
 */
function recordPullRequestProof(
  db: Db,
  repoName: string,
  branch: string,
  payload: PullRequestPayload,
  now: number,
): number {
  const repo = foldRepo(repoName);
  const number = payload.pull_request?.number;
  if (repo === null || typeof number !== 'number' || !Number.isSafeInteger(number)) return 0;

  // GitHub always sends `html_url`; the fallback is for a payload that does not,
  // and it is the same URL GitHub would have sent for github.com.
  const url =
    str(payload.pull_request?.html_url) ?? `https://github.com/${repoName}/pull/${String(number)}`;
  const key = pullRequestKey(url);
  if (key === null) return 0;

  const head = str(payload.pull_request?.head?.sha)?.toLowerCase() ?? null;
  recordPullRequest(
    db,
    {
      key,
      repo,
      number,
      url,
      headSha: head,
      headRef: branch,
      merged: payload.pull_request?.merged === true,
      eventAt: githubTime(payload.pull_request?.updated_at) ?? now,
    },
    now,
  );
  const shas =
    head === null ? [] : recordCommits(db, repo, branch, [{ sha: head, committedAt: null }], now);

  return reconcileProof(db, { shas, branches: [branch], pullRequests: [key] }, now);
}

/** The three CI events (§10.1, D-083), each naming its object after itself. */
interface CheckPayload {
  action?: unknown;
  repository?: { full_name?: unknown };
  check_run?: CheckObject;
  workflow_run?: CheckObject;
  check_suite?: CheckObject;
}

interface CheckObject {
  head_sha?: unknown;
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  completed_at?: unknown;
  updated_at?: unknown;
  started_at?: unknown;
  created_at?: unknown;
  app?: { slug?: unknown; name?: unknown };
}

/**
 * `check_run`, `workflow_run` or `check_suite` → that CI result remembered
 * for its commit (§4.30), and every round whose head it is re-checked
 * (D-083). Every action is recorded, not only `completed`: a run that is
 * queued or in progress is what keeps a round's tests `claimed` rather than
 * confirmed by the jobs that happened to finish first.
 */
export function handleCheck(
  db: Db,
  kind: GithubCheckKind,
  payload: CheckPayload,
  now: number,
): DeliveryOutcome {
  const repo = foldRepo(str(payload.repository?.full_name) ?? '');
  const body = payload[kind];
  const head = str(body?.head_sha)?.toLowerCase() ?? null;
  const name =
    kind === 'check_suite'
      ? (str(body?.app?.slug) ?? str(body?.app?.name) ?? 'check suite')
      : str(body?.name);
  if (repo === null || head === null || !/^[0-9a-f]{40}$/.test(head) || name === null) {
    return { handled: false, reason: `${kind} is missing repo, head_sha or name` };
  }

  const conclusion = str(body?.conclusion);
  recordCheck(
    db,
    {
      repo,
      headSha: head,
      kind,
      name: name.slice(0, 200),
      outcome: checkOutcome(str(body?.status), conclusion),
      conclusion,
      eventAt:
        githubTime(body?.completed_at) ??
        githubTime(body?.updated_at) ??
        githubTime(body?.started_at) ??
        githubTime(body?.created_at) ??
        now,
    },
    now,
  );

  const rounds = reconcileProof(
    db,
    { shas: [head], pullRequests: pullRequestsWithHead(db, repo, head) },
    now,
  );
  return { handled: true, rounds };
}

/**
 * Which §5 status a pull-request action means, or `null` for one §10.1 does not
 * name. Where the task already is narrows it further: see `handlePullRequest`.
 *
 * `closed` without `merged` is **not** a transition: a pull request abandoned
 * without merging says nothing about whether the task is still being worked on,
 * and moving it would be inventing a rule §10.1 does not have.
 */
function statusForPullRequest(action: string, merged: boolean): TaskStatus | null {
  if (action === 'opened' || action === 'reopened') return 'in_progress';
  if (action === 'closed' && merged) return 'review';
  return null;
}

interface IssueCommentPayload {
  action?: unknown;
  comment?: { body?: unknown; user?: { login?: unknown }; html_url?: unknown };
  issue?: { pull_request?: { head?: { ref?: unknown } } };
  repository?: { full_name?: unknown };
}

/**
 * `issue_comment` → a comment on the task, with no Laika author (§10.1, LAI-449).
 *
 * **The GitHub login is preserved in the body**, because a mirrored comment that
 * loses who wrote it is worse than none. It goes in the text rather than in a
 * column: §4.7 has nowhere to put a foreign identity, and adding one would be
 * the identity mapping D-050 refused, arriving as a convenience.
 *
 * `created` only. `edited` and `deleted` would have to find the row they mirror,
 * and §4.7 stores no GitHub id to find it by — mirroring an edit as a second
 * comment would be worse than not mirroring it, so §10.1's silence is taken as
 * "not handled" rather than guessed at.
 */
export function handleIssueComment(
  db: Db,
  payload: IssueCommentPayload,
  principal: (projectId: string) => ServiceCaller,
  now: number,
): DeliveryOutcome {
  if (str(payload.action) !== 'created') return IGNORED;

  const repo = str(payload.repository?.full_name);
  const branch = str(payload.issue?.pull_request?.head?.ref);
  const body = str(payload.comment?.body);
  if (repo === null || branch === null || body === null) {
    return { handled: false, reason: 'issue_comment is missing repo, branch or body' };
  }

  const resolved = resolveBranchTask(db, repo, branch);
  if (resolved === null) return { handled: false, reason: 'branch resolved to no task' };

  const login = str(payload.comment?.user?.login) ?? 'someone';
  addComment(
    db,
    principal(resolved.projectId),
    resolved.taskId,
    `**@${login}** on GitHub:\n\n${body}`,
    now,
  );

  return { handled: true, taskId: resolved.taskId };
}

/**
 * §10.2's monthly cap, per D-052 — **counted from the database** (LAI-467).
 *
 * **A rate limit is not sufficient.** §6.3's limiter answers "you are going too
 * fast"; an authenticated integration gone wrong spends money at a perfectly
 * legal rate and never trips it. The cap is the bound that notices.
 *
 * A rolling 30 days rather than a calendar month: a calendar boundary hands an
 * attacker a fresh budget at a predictable moment, and an org that starts using
 * this on the 28th should not get two days of quota.
 *
 * ## Why this is a query and no longer a counter in memory
 *
 * It was a `SubmissionCounter` holding timestamps in the process, and LAI-450
 * wrote the cost down rather than leaving it to be found: **a restart forgave
 * the count**, which for a *spend* bound is the wrong direction to be wrong in.
 * A crash-loop, a deploy or a container restart reset the month's budget.
 *
 * **Derived rather than stored**, which is the stronger of the two fixes: a
 * count you can recompute cannot drift from the thing it counts. There is no
 * column to migrate, no counter to reconcile after a manual delete, and a
 * restored snapshot (LAI-466) carries the right number by construction because
 * it carries the rows.
 *
 * ## What this does not count, and it is not nothing
 *
 * A submission consumes budget **when it produces a `meeting_reviews` row**.
 * `storeTranscriptReview` calls the provider and *then* inserts, so a response
 * the model returns and `parseProposals` refuses has **cost money and left no
 * row** — and does not count here.
 *
 * A malformed body is fine: it is rejected before the provider is reached, so it
 * spends nothing and correctly counts nothing. The gap is the bad-JSON case, it
 * is real, and closing it needs somewhere durable to record an *attempt* —
 * a §4 change, so **LAI-171** rather than a guess made here.
 */
export const MONTHLY_SUBMISSION_CAP = 200;

/** Thirty days, in ms. Not a calendar month — see above. */
export const CAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many transcript submissions this instance has stored inside the window.
 *
 * The boundary is **exclusive at the far end**: a review created exactly
 * `CAP_WINDOW_MS` ago has left the window. Stated because *"monthly"* does not
 * say, and a caller at the edge gets a different answer from each reading.
 */
export function submissionsInWindow(db: Db, now: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(meetingReviews)
    .where(gt(meetingReviews.createdAt, now - CAP_WINDOW_MS))
    .get();

  return row?.n ?? 0;
}

/**
 * The org's configured provider, or a refusal.
 *
 * `unavailable` rather than `unprocessable`: an org with no provider configured
 * cannot do this **yet**, which is a state of the instance rather than a problem
 * with the request — and it is the same word §6.3 uses for a dependency that is
 * not there.
 */
export function providerFor(db: Db, serverSecret: string): ProviderClient {
  const row = db
    .select({
      provider: orgs.aiProvider,
      baseUrl: orgs.aiBaseUrl,
      keyEnc: orgs.aiApiKeyEnc,
    })
    .from(orgs)
    .limit(1)
    .get();

  if (row?.provider == null) {
    throw new ApiError('unavailable', 'This org has no AI provider configured', {
      reason: 'no_provider',
    });
  }

  return httpProviderClient({
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: row.keyEnc === null ? null : decryptSecret(row.keyEnc, serverSecret, 'ai_api_key'),
  });
}
