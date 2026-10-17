import { and, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import {
  type CheckOutcome,
  type EvidenceState,
  GITHUB_CHECK_KINDS,
  type GithubCheckKind,
} from '../db/enums.ts';
import {
  githubChecks,
  githubCommits,
  githubPullRequests,
  projects,
  taskEvidence,
  taskReviews,
  taskRoundGithub,
  taskRounds,
  tasks,
} from '../db/schema.ts';
import { normaliseRepo } from './heartbeats.ts';

/**
 * GitHub confirming the proof an agent attached on finish (SPEC §4.28–§4.31,
 * D-083, LAI-766) — review gate step 2.
 *
 * ## Two halves, and the order they arrive in does not matter
 *
 * **What GitHub said** is recorded as it arrives: the commits a push or a pull
 * request named, each pull request's newest state, and each CI result's newest
 * outcome. **What the agent claimed** is a round's `task_evidence` (§4.26).
 * `confirmRound` compares the two and flips each item's `state`; it runs on
 * every finish and for every open round a delivery could touch — the newest
 * of its task, not yet decided (`roundsTouched`). So an event that arrived
 * before the finish counts when the finish arrives, and one that arrives
 * after counts when it arrives.
 *
 * Nothing here calls GitHub (§13.4). Everything is what a delivery carried.
 *
 * ## Newest event wins
 *
 * A pull request and a CI result are each one row, replaced only by a delivery
 * whose own timestamp is not older — so a re-run that passes replaces the run
 * that failed, and a delivery that arrives late cannot undo a newer one. A
 * commit, once seen, stays seen. Test items therefore move both ways (failed →
 * pending → confirmed as CI re-runs); commit, branch and pull request items
 * only ever go from `claimed` to `confirmed`.
 *
 * This module imports nothing from `rounds.ts` or `tasks.ts`; `rounds.ts`
 * calls `confirmRound` when it records a round, so the two never form a cycle.
 */

/** How long a delivery's record is kept: 30 days from the last one that named it. */
export const GITHUB_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** What `state_source` says for a state GitHub decided. */
export const GITHUB_STATE_SOURCE = 'github';

/** git's shortest abbreviation, and §4.26's shortest sha. */
const SHA_MIN = 7;
const FULL_SHA = /^[0-9a-f]{40}$/;
const HEX = /^[0-9a-f]+$/;
/** Enough to name what broke; the rest is on GitHub. */
const MAX_FAILED_NAMES = 10;
/** One insert's rows, well inside SQLite's bound on variables. */
const CHUNK = 400;

/** `owner/name`, lowercased — the form every table here stores. */
export function foldRepo(value: string): string | null {
  return normaliseRepo(value)?.toLowerCase() ?? null;
}

/**
 * A pull request URL as a key: `github.com/owner/name#12`, lowercased, or null
 * for anything that is not a pull request URL.
 *
 * The URL an agent pastes and the `html_url` GitHub sends name the same pull
 * request with different spellings — case, a trailing `/files`, a fragment —
 * so both sides are reduced to host, repository and number before they meet.
 */
export function pullRequestKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/.exec(parsed.pathname);
  if (match === null) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return `${host}/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}#${String(Number(match[3]))}`;
}

/** The `owner/name` inside a pull request key. */
function repoOfKey(key: string): string {
  return key.slice(key.indexOf('/') + 1, key.lastIndexOf('#'));
}

/** A GitHub timestamp in ms, or null. */
export function githubTime(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// ------------------------------------------------------------------ records

export interface SeenCommit {
  sha: string;
  committedAt: number | null;
}

/**
 * Remember commits a delivery named, and return the full shas kept. A
 * commit already seen keeps the first branch it was seen on and its first
 * timestamp; only `seen_at` moves, which is what keeps it from expiring.
 */
export function recordCommits(
  db: Db,
  repo: string,
  branch: string | null,
  commits: readonly SeenCommit[],
  now: number,
): string[] {
  const rows = new Map<string, SeenCommit>();
  for (const commit of commits) {
    const sha = commit.sha.toLowerCase();
    // The all-zero sha is GitHub's "nothing": a deleted or a created branch.
    if (!FULL_SHA.test(sha) || /^0+$/.test(sha)) continue;
    if (!rows.has(sha)) rows.set(sha, { sha, committedAt: commit.committedAt });
  }

  const values = [...rows.values()].map((c) => ({
    repo,
    sha: c.sha,
    branch,
    committedAt: c.committedAt,
    seenAt: now,
  }));
  for (let at = 0; at < values.length; at += CHUNK) {
    db.insert(githubCommits)
      .values(values.slice(at, at + CHUNK))
      .onConflictDoUpdate({
        target: [githubCommits.repo, githubCommits.sha],
        set: {
          seenAt: now,
          branch: sql`coalesce(${githubCommits.branch}, excluded.branch)`,
          committedAt: sql`coalesce(${githubCommits.committedAt}, excluded.committed_at)`,
        },
      })
      .run();
  }
  return [...rows.keys()];
}

export interface SeenPullRequest {
  key: string;
  repo: string;
  number: number;
  url: string;
  headSha: string | null;
  headRef: string | null;
  merged: boolean;
  eventAt: number;
}

/** Keep a pull request's newest state: an older delivery changes nothing. */
export function recordPullRequest(db: Db, pr: SeenPullRequest, now: number): void {
  db.insert(githubPullRequests)
    .values({
      key: pr.key,
      repo: pr.repo,
      number: pr.number,
      url: pr.url,
      headSha: pr.headSha,
      headRef: pr.headRef,
      merged: pr.merged ? 1 : 0,
      eventAt: pr.eventAt,
      seenAt: now,
    })
    .onConflictDoUpdate({
      target: githubPullRequests.key,
      set: {
        url: pr.url,
        headSha: pr.headSha,
        headRef: pr.headRef,
        merged: pr.merged ? 1 : 0,
        eventAt: pr.eventAt,
        seenAt: now,
      },
      setWhere: sql`excluded.event_at >= ${githubPullRequests.eventAt}`,
    })
    .run();
}

export interface SeenCheck {
  repo: string;
  headSha: string;
  kind: GithubCheckKind;
  name: string;
  outcome: CheckOutcome;
  conclusion: string | null;
  eventAt: number;
}

/** Keep a CI result's newest outcome, by name, so a re-run replaces its run. */
export function recordCheck(db: Db, check: SeenCheck, now: number): void {
  db.insert(githubChecks)
    .values({ ...check, headSha: check.headSha.toLowerCase(), seenAt: now })
    .onConflictDoUpdate({
      target: [githubChecks.repo, githubChecks.headSha, githubChecks.kind, githubChecks.name],
      set: {
        outcome: check.outcome,
        conclusion: check.conclusion,
        eventAt: check.eventAt,
        seenAt: now,
      },
      setWhere: sql`excluded.event_at >= ${githubChecks.eventAt}`,
    })
    .run();
}

/**
 * GitHub's `status` and `conclusion`, folded to what the proof needs.
 *
 * Only a completed run has an answer. `neutral` and `skipped` are not
 * failures — GitHub draws them grey, and a skipped job has not broken
 * anything. `stale` is GitHub giving up on a run that never reported, which
 * is no answer either way, so it stays pending.
 */
export function checkOutcome(status: string | null, conclusion: string | null): CheckOutcome {
  if (status !== 'completed') return 'pending';
  switch (conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'passed';
    case 'failure':
    case 'timed_out':
    case 'cancelled':
    case 'action_required':
    case 'startup_failure':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Forget what no delivery has named for 30 days (§4.28–§4.30). */
export function pruneGithubRecords(db: Db, now: number): void {
  const cutoff = now - GITHUB_RECORD_TTL_MS;
  db.delete(githubCommits).where(lt(githubCommits.seenAt, cutoff)).run();
  db.delete(githubPullRequests).where(lt(githubPullRequests.seenAt, cutoff)).run();
  db.delete(githubChecks).where(lt(githubChecks.seenAt, cutoff)).run();
}

/** Pull requests GitHub said have this head, as keys. */
export function pullRequestsWithHead(db: Db, repo: string, headSha: string): string[] {
  return db
    .select({ key: githubPullRequests.key })
    .from(githubPullRequests)
    .where(
      and(eq(githubPullRequests.repo, repo), eq(githubPullRequests.headSha, headSha.toLowerCase())),
    )
    .all()
    .map((r) => r.key);
}

// ---------------------------------------------------------------- matching

/**
 * The repositories a round's proof may be matched in, or null for any.
 *
 * **The project's `repo` (§4.3) when it names one, and only that.** The agent
 * writes the proof, so nothing in it may choose who vouches for it: a pull
 * request URL in another repository would otherwise let that repository's
 * pushes and checks confirm this task (the D-083 review's B1). Such a pull
 * request confirms nothing, and nothing is matched through it.
 *
 * Only when the project names no repository does the pull request's own
 * narrow it — then nothing is matched anywhere else. Without either, any
 * repository this org's webhook reports.
 */
function plausibleRepos(projectRepo: string | null, prKey: string | null): string[] | null {
  const folded = projectRepo === null ? null : foldRepo(projectRepo);
  if (folded !== null) return [folded];
  return prKey === null ? null : [repoOfKey(prKey)];
}

/** `sha = value`, or a prefix range on `sha` that the index can serve. */
function shaMatches(column: typeof githubCommits.sha | typeof githubChecks.headSha, value: string) {
  return value.length === 40 ? eq(column, value) : and(gte(column, value), lt(column, `${value}g`));
}

/**
 * The commit a claimed sha names, when exactly one seen commit has it as a
 * prefix in a plausible repository. Two different commits sharing the prefix
 * is ambiguous and matches neither: guessing would confirm the wrong one.
 */
function findCommit(
  db: Db,
  value: string,
  repos: string[] | null,
): { sha: string; committedAt: number | null } | null {
  if (value.length < SHA_MIN || !HEX.test(value)) return null;
  const rows = db
    .select({ sha: githubCommits.sha, committedAt: githubCommits.committedAt })
    .from(githubCommits)
    .where(
      and(
        shaMatches(githubCommits.sha, value),
        repos === null ? undefined : inArray(githubCommits.repo, repos),
      ),
    )
    .all();
  const shas = new Set(rows.map((r) => r.sha));
  if (shas.size !== 1) return null;
  const times = rows.map((r) => r.committedAt).filter((t): t is number => t !== null);
  return { sha: rows[0]!.sha, committedAt: times.length === 0 ? null : Math.max(...times) };
}

/** Whether GitHub reported this branch: a push to it, or a pull request from it. */
function branchSeen(
  db: Db,
  name: string,
  repos: string[] | null,
  pr: { headRef: string | null } | undefined,
): boolean {
  if (pr?.headRef === name) return true;
  return (
    db
      .select({ sha: githubCommits.sha })
      .from(githubCommits)
      .where(
        and(
          eq(githubCommits.branch, name),
          repos === null ? undefined : inArray(githubCommits.repo, repos),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

/** The CI line for one round, as stored on `task_round_github` and served. */
export interface RoundCi {
  head_sha: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** What failed, by name, at most ten. */
  failed_names: string[];
}

/**
 * CI for one commit: the check runs if any were reported for it, else the
 * workflow runs, else the check suites — one kind, never the three summed,
 * because one GitHub Actions run reports itself as all three.
 */
function ciFor(db: Db, head: string, repos: string[] | null): RoundCi | null {
  const rows = db
    .select()
    .from(githubChecks)
    .where(
      and(
        shaMatches(githubChecks.headSha, head),
        repos === null ? undefined : inArray(githubChecks.repo, repos),
      ),
    )
    .all();
  if (rows.length === 0) return null;
  // A prefix that names two commits' CI is no answer.
  if (new Set(rows.map((r) => r.headSha)).size !== 1) return null;

  const kind = GITHUB_CHECK_KINDS.find((k) => rows.some((r) => r.kind === k));
  const chosen = rows.filter((r) => r.kind === kind);
  const failed = chosen.filter((r) => r.outcome === 'failed');
  return {
    head_sha: rows[0]!.headSha,
    total: chosen.length,
    passed: chosen.filter((r) => r.outcome === 'passed').length,
    failed: failed.length,
    pending: chosen.filter((r) => r.outcome === 'pending').length,
    failed_names: failed
      .map((r) => r.name)
      .sort()
      .slice(0, MAX_FAILED_NAMES),
  };
}

/**
 * The CI line as a reader sees it: *CI: 3 of 3 checks passed*, *CI: lint
 * failed*, *CI: 1 of 2 checks passed, 1 pending*. The web app draws the same
 * sentence from the same fields (`server/web/src/api/review.ts`).
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

/** What CI means for a test item: any failure fails, all passed confirms. */
function testState(ci: RoundCi): EvidenceState {
  if (ci.failed > 0) return 'failed';
  return ci.pending > 0 ? 'claimed' : 'confirmed';
}

// ---------------------------------------------------------------- rounds

/**
 * Check one round's proof against what GitHub has said, and write any item
 * whose state changed. Returns whether anything changed.
 *
 * - **commit**: `confirmed` when exactly one seen commit matches it.
 * - **branch**: `confirmed` when a push to it or a pull request from it was seen.
 * - **pull request**: `confirmed` when a delivery for it was seen; merged or not
 *   goes on the round's summary row.
 * - **test runs**: from CI for the round's head commit — the pull request's head
 *   when GitHub named one, else the newest claimed commit GitHub reported, else
 *   the first one listed. A command an agent typed cannot be matched to a CI
 *   job, so every test item takes CI's answer, and the CI line beside them says
 *   what that answer was.
 *
 * No CI result is not a CI result: with nothing reported for the head commit,
 * test items and the CI line are left as they were.
 */
export function confirmRound(db: Db, roundId: string, now: number): boolean {
  const round = db
    .select({ id: taskRounds.id, projectRepo: projects.repo })
    .from(taskRounds)
    .innerJoin(tasks, eq(tasks.id, taskRounds.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(taskRounds.id, roundId))
    .get();
  if (round === undefined) return false;

  const items = db
    .select()
    .from(taskEvidence)
    .where(eq(taskEvidence.roundId, roundId))
    .orderBy(taskEvidence.position)
    .all();
  if (items.length === 0) return false;

  const prItem = items.find((i) => i.kind === 'pull_request');
  const prKey = prItem === undefined ? null : pullRequestKey(prItem.value);
  const repos = plausibleRepos(round.projectRepo, prKey);
  // A pull request outside the plausible repositories is not looked up at
  // all: it confirms nothing, and its head is not this round's head.
  const pr =
    prKey === null || (repos !== null && !repos.includes(repoOfKey(prKey)))
      ? undefined
      : db.select().from(githubPullRequests).where(eq(githubPullRequests.key, prKey)).get();

  const next = new Map<string, EvidenceState>();
  // The newest claimed commit GitHub reported, for CI: latest commit time,
  // and on a tie the one listed first — agents list as `git log` does.
  let newest: { sha: string; at: number } | null = null;
  for (const item of items) {
    if (item.kind === 'commit') {
      const hit = findCommit(db, item.value, repos);
      if (hit === null) continue;
      next.set(item.id, 'confirmed');
      const at = hit.committedAt ?? Number.NEGATIVE_INFINITY;
      if (newest === null || at > newest.at) newest = { sha: hit.sha, at };
    } else if (item.kind === 'branch') {
      if (branchSeen(db, item.value, repos, pr)) next.set(item.id, 'confirmed');
    } else if (item.kind === 'pull_request') {
      if (pr !== undefined) next.set(item.id, 'confirmed');
    }
  }

  const firstCommit = items.find((i) => i.kind === 'commit')?.value ?? null;
  const head = pr?.headSha ?? newest?.sha ?? firstCommit;
  const ci = head === null ? null : ciFor(db, head, repos);
  if (ci !== null) {
    const state = testState(ci);
    for (const item of items) if (item.kind === 'test_run') next.set(item.id, state);
  }

  let changed = false;
  for (const item of items) {
    const state = next.get(item.id);
    if (state === undefined || state === item.state) continue;
    // Only tests move backwards, and only to `claimed` (a re-run pending).
    if (item.kind !== 'test_run' && item.state === 'confirmed') continue;
    db.update(taskEvidence)
      .set(
        state === 'claimed'
          ? { state, stateSource: null, stateAt: null }
          : { state, stateSource: GITHUB_STATE_SOURCE, stateAt: now },
      )
      .where(eq(taskEvidence.id, item.id))
      .run();
    changed = true;
  }

  if (pr !== undefined || ci !== null) {
    writeSummary(db, roundId, pr === undefined ? undefined : pr.merged === 1, ci, now);
  }
  return changed;
}

/** Upsert the round's summary, changing only what this check learned. */
function writeSummary(
  db: Db,
  roundId: string,
  merged: boolean | undefined,
  ci: RoundCi | null,
  now: number,
): void {
  const set = {
    ...(merged === undefined ? {} : { prMerged: merged ? 1 : 0 }),
    ...(ci === null
      ? {}
      : {
          ciHeadSha: ci.head_sha,
          ciTotal: ci.total,
          ciPassed: ci.passed,
          ciFailed: ci.failed,
          ciPending: ci.pending,
          ciFailedNames: JSON.stringify(ci.failed_names),
        }),
    updatedAt: now,
  };
  db.insert(taskRoundGithub)
    .values({ roundId, ...set })
    .onConflictDoUpdate({ target: taskRoundGithub.roundId, set })
    .run();
}

/** What a delivery named, for finding the rounds it could change. */
export interface Seen {
  shas?: readonly string[];
  branches?: readonly string[];
  pullRequests?: readonly string[];
}

/**
 * The rounds a delivery could change: those whose proof names one of its
 * commits (by any prefix of at least 7), one of its branches or one of its
 * pull requests, finished within the last 30 days — and **still open**: the
 * newest round of its task, with no review decision recorded against it.
 *
 * An earlier round is what a person already read, or sent back. Re-checking
 * it would let a later push rewrite it: round 1 on a pull request whose head
 * moved for round 2 would take round 2's CI as its own (the D-083 review's
 * B2), and a round sent back for red CI would turn green. So each round keeps
 * what GitHub said about it while it was the one waiting.
 */
export function roundsTouched(db: Db, seen: Seen, now: number): string[] {
  const ids = new Set<string>();

  const prefixes = new Set<string>();
  for (const sha of seen.shas ?? []) {
    const lower = sha.toLowerCase();
    for (let n = SHA_MIN; n <= lower.length; n += 1) prefixes.add(lower.slice(0, n));
  }
  const all = [...prefixes];
  for (let at = 0; at < all.length; at += CHUNK) {
    for (const row of db
      .select({ roundId: taskEvidence.roundId })
      .from(taskEvidence)
      .where(
        and(
          eq(taskEvidence.kind, 'commit'),
          inArray(taskEvidence.value, all.slice(at, at + CHUNK)),
        ),
      )
      .all())
      ids.add(row.roundId);
  }

  const branches = [...new Set(seen.branches ?? [])];
  if (branches.length > 0) {
    for (const row of db
      .select({ roundId: taskEvidence.roundId })
      .from(taskEvidence)
      .where(and(eq(taskEvidence.kind, 'branch'), inArray(taskEvidence.value, branches)))
      .all())
      ids.add(row.roundId);
  }

  for (const key of new Set(seen.pullRequests ?? [])) {
    const number = key.slice(key.lastIndexOf('#') + 1);
    for (const row of db
      .select({ roundId: taskEvidence.roundId, value: taskEvidence.value })
      .from(taskEvidence)
      .where(
        and(eq(taskEvidence.kind, 'pull_request'), like(taskEvidence.value, `%/pull/${number}%`)),
      )
      .all()) {
      if (pullRequestKey(row.value) === key) ids.add(row.roundId);
    }
  }

  if (ids.size === 0) return [];
  const touched = db
    .select({ id: taskRounds.id, taskId: taskRounds.taskId, number: taskRounds.number })
    .from(taskRounds)
    .where(
      and(inArray(taskRounds.id, [...ids]), gte(taskRounds.createdAt, now - GITHUB_RECORD_TTL_MS)),
    )
    .all();
  if (touched.length === 0) return [];

  const newest = new Map<string, number>();
  for (const row of db
    .select({ taskId: taskRounds.taskId, number: taskRounds.number })
    .from(taskRounds)
    .where(
      inArray(
        taskRounds.taskId,
        touched.map((r) => r.taskId),
      ),
    )
    .all()) {
    newest.set(row.taskId, Math.max(newest.get(row.taskId) ?? 0, row.number));
  }
  const decided = new Set(
    db
      .select({ roundId: taskReviews.roundId })
      .from(taskReviews)
      .where(
        inArray(
          taskReviews.roundId,
          touched.map((r) => r.id),
        ),
      )
      .all()
      .map((r) => r.roundId),
  );

  return touched
    .filter((r) => r.number === newest.get(r.taskId) && !decided.has(r.id))
    .map((r) => r.id);
}

/** Re-check every round a delivery could change. Returns how many changed. */
export function reconcileProof(db: Db, seen: Seen, now: number): number {
  let changed = 0;
  for (const id of roundsTouched(db, seen, now)) if (confirmRound(db, id, now)) changed += 1;
  return changed;
}

/** The summary rows of the rounds asked about, for the round views. */
export function roundSummaries(
  db: Db,
  roundIds: readonly string[],
): Map<string, { merged: boolean | null; ci: RoundCi | null }> {
  if (roundIds.length === 0) return new Map();
  const rows = db
    .select()
    .from(taskRoundGithub)
    .where(inArray(taskRoundGithub.roundId, [...roundIds]))
    .all();
  return new Map(
    rows.map((row) => [
      row.roundId,
      {
        merged: row.prMerged === null ? null : row.prMerged === 1,
        ci:
          row.ciHeadSha === null || row.ciTotal === 0
            ? null
            : {
                head_sha: row.ciHeadSha,
                total: row.ciTotal,
                passed: row.ciPassed,
                failed: row.ciFailed,
                pending: row.ciPending,
                failed_names: parseNames(row.ciFailedNames),
              },
      },
    ]),
  );
}

function parseNames(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
