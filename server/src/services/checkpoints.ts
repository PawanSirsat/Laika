import { and, asc, desc, eq, inArray, lt, max, notExists } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type CheckpointVerification } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  activity,
  agentCheckpointConsents,
  agents,
  agentSessions,
  type CheckpointManifestEntry,
  checkpointRefs,
  checkpointRefTransitions,
  type CheckpointSummary,
  projects,
  taskCheckpoints,
  tasks,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, systemPrincipal } from '../policy/can.ts';
import {
  claimFenceRefusal,
  liveClaim,
  registeredAgent,
  reloadAgentActor,
  requireVisibleTaskToClaim,
} from './claims.ts';
import { type AgentReader, agentLens, agentReader } from './agent-visibility.ts';
import { foldRepo } from './github-proof.ts';
import { resolveRepoProjects } from './heartbeats.ts';

/**
 * Checkpoints (SPEC §4.70 – §4.72, §4.75, §6.4, §10.1, D-115, D-116, LAI-545).
 *
 * ## What a checkpoint is
 *
 * A save an agent registers **on purpose** inside a task its session holds:
 * the repo, the branch, the commit, the files it changed with line counts, and
 * a structured note. It is not a heartbeat and not telemetry (D-005), and
 * there is no field for file contents, a diff, a prompt or a transcript
 * (D-115 item 4). The note, the branch and the paths are **untrusted data**:
 * stored and shown, never executed and never read as instructions (item 7).
 *
 * ## How it is proved
 *
 * **Push, then register** (D-116 item 1): the helper pushes the work branch,
 * then one lightweight tag `laika-ckpt/<task>/<id>` alone in its own push,
 * then registers here. The registration says nothing about whether the push
 * happened — a checkpoint starts `pending` and is `verified` **only** by
 * signed `push` deliveries for the project's configured repo (§10.1). The
 * server never fetches the ref, a URL or GitHub (D-083), and no API field or
 * tool argument reaches `verification`.
 *
 * ## How a ref is judged
 *
 * Every delivered transition `before → after` for a ref is kept (§4.72), and
 * the ref's state is a function of **that set alone** — never of the order
 * the deliveries arrived in ({@link deriveRefState}). The function is
 * monotone: a delivery can only move a ref up `pending → verified →
 * ref_deleted`, or to `uncertain`, and nothing comes back from `ref_deleted`
 * or `uncertain`. Only a re-tag, through a **new** ref, clears either
 * (D-116 item 7); the checkpoint's state is its newest ref's.
 *
 * ## Deliveries that arrive first
 *
 * A notice can beat its registration. It is kept by repository and ref name
 * with no §4.71 row, and attached when the checkpoint — or the re-tag — that
 * owns the ref registers. Each delivery's id is written **in the transaction
 * that applies it**, so a repeat is ignored and a delivery whose handler
 * failed before it was applied leaves nothing behind and is processed when
 * redelivered (D-116 item 5).
 */

// ------------------------------------------------------------------ settings

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface CheckpointSettings {
  /** §9.1.1's pending notice: a `pending` checkpoint older than this is labelled. */
  pendingNoticeMs: number;
  /** D-115 item 9: how long after Done or Cancelled the rows are kept. */
  retentionMs: number;
}

export const DEFAULT_CHECKPOINT_SETTINGS: CheckpointSettings = {
  pendingNoticeMs: 10 * MINUTE,
  retentionMs: 90 * DAY,
};

let settings: CheckpointSettings = { ...DEFAULT_CHECKPOINT_SETTINGS };

/** Both windows are configurable (§9.1.1, D-115 item 9) — and a test injects them. */
export function configureCheckpoints(next: Partial<CheckpointSettings>): void {
  settings = { ...settings, ...next };
}

export function checkpointSettings(): Readonly<CheckpointSettings> {
  return settings;
}

// -------------------------------------------------------------------- limits

/** §4.70's bounds, shared by the route and the tool so neither is looser. */
export const CHECKPOINT_LIMITS = {
  manifestEntries: 1000,
  path: 1024,
  lines: 10_000_000,
  summaryField: 4000,
  repo: 200,
  branch: 255,
  idempotencyKey: 200,
} as const;

export const SUMMARY_FIELDS = [
  'work_done',
  'next_step',
  'decisions',
  'open_questions',
  'failing',
] as const satisfies readonly (keyof CheckpointSummary)[];

const ZERO_SHA = '0'.repeat(40);
const SHA = /^[0-9a-f]{40}$/;
/** Crockford base32, 26 characters — what `newId()` mints, and the helper too. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** One path segment of a tag name: what `git check-ref-format` accepts, narrowed. */
const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export const CHECKPOINT_TAG_PREFIX = 'refs/tags/laika-ckpt/';
const CHECKPOINT_REF = /^refs\/tags\/laika-ckpt\/[^/\s]+\/[^/\s]+$/;

// ---------------------------------------------------------------- the rule

export interface Transition {
  beforeSha: string;
  afterSha: string;
}

/**
 * A ref's state from **the set of transitions seen for it** (§4.71, D-116
 * item 4 as D-116a states it) — the order they arrived in is not an
 * argument, so it cannot decide anything. The all-zero SHA means absent.
 *
 * 1. none → `pending`;
 * 2. exactly one creation `0000…→commit`, and nothing else → `verified`;
 * 3. that creation plus one or more deletions `commit→0000…`, and nothing
 *    else → `ref_deleted` (a deletion notice sent twice cannot flip it);
 * 4. anything else — a second creation, an update, a ref at another SHA (an
 *    annotated tag's object among them), a deletion with no creation seen →
 *    `uncertain`.
 *
 * **Neither `ref_deleted` nor `uncertain` is ever `verified` again** (D-116a's
 * *final*): the set only grows, and every set holding a deletion or a foreign
 * transition maps to one of the two. Between them the set decides — a
 * deletion seen before its creation is `uncertain` until the creation
 * arrives, then `ref_deleted`.
 */
export function deriveRefState(
  transitions: readonly Transition[],
  commitSha: string,
): CheckpointVerification {
  if (transitions.length === 0) return 'pending';

  const commit = commitSha.toLowerCase();
  let creations = 0;
  let deletions = 0;
  for (const { beforeSha, afterSha } of transitions) {
    const before = beforeSha.toLowerCase();
    const after = afterSha.toLowerCase();
    if (before === ZERO_SHA && after === commit) creations += 1;
    else if (before === commit && after === ZERO_SHA) deletions += 1;
    else return 'uncertain';
  }
  if (creations !== 1) return 'uncertain';
  return deletions > 0 ? 'ref_deleted' : 'verified';
}

// --------------------------------------------------------------------- views

export interface CheckpointRefView {
  ref: string;
  revision: number;
  state: CheckpointVerification;
}

export interface CheckpointView {
  id: string;
  task_id: string;
  /**
   * The saving session and its agent — null, with `agent_redacted`, to a
   * reader who may not see that agent: another person's, once the task no
   * longer shows it as selected or as its live claim's holder (D-121 item 7,
   * LAI-1012).
   */
  session_id: string | null;
  agent_id: string | null;
  /** The save's agent is one this reader may not see: *an agent*. */
  agent_redacted: boolean;
  claim_generation: number;
  repo: string;
  branch: string;
  remote_ref: string;
  commit_sha: string;
  manifest: CheckpointManifestEntry[];
  summary: CheckpointSummary | null;
  summary_commit_sha: string | null;
  created_at: number;
  verification: CheckpointVerification;
  verified_at: number | null;
  /** When the newest ref was registered, while it waits for its notice; null unless `pending`. */
  pending_since: number | null;
  /** `pending` for longer than the pending notice (§9.1.1): the UI says no notice came yet. */
  pending_notice: boolean;
  /** Derived on read, information only: a newer verified checkpoint on the same claim exists. */
  superseded: boolean;
  refs: CheckpointRefView[];
}

type CheckpointRow = typeof taskCheckpoints.$inferSelect;
type RefRow = typeof checkpointRefs.$inferSelect;

function views(
  db: Db,
  reader: AgentReader,
  rows: readonly CheckpointRow[],
  now: number,
): CheckpointView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const refs = db
    .select()
    .from(checkpointRefs)
    .where(inArray(checkpointRefs.checkpointId, ids))
    .orderBy(asc(checkpointRefs.revision))
    .all();
  const refsOf = new Map<string, RefRow[]>();
  for (const ref of refs) {
    const list = refsOf.get(ref.checkpointId) ?? [];
    list.push(ref);
    refsOf.set(ref.checkpointId, list);
  }

  const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
  const agentOf = new Map(
    db
      .select({ id: agentSessions.id, agentId: agentSessions.agentId })
      .from(agentSessions)
      .where(inArray(agentSessions.id, sessionIds))
      .all()
      .map((s) => [s.id, s.agentId]),
  );
  const lens = agentLens(
    db,
    reader,
    rows.map((r) => r.taskId),
    [...agentOf.values()],
  );

  // `superseded` (§4.70): a newer verified checkpoint on the same claim — the
  // same task and generation. Asked of every checkpoint of those tasks, not
  // only the page's, so a page boundary cannot hide the newer one.
  const taskIds = [...new Set(rows.map((r) => r.taskId))];
  const newestVerified = new Map<string, number>();
  for (const v of db
    .select({
      taskId: taskCheckpoints.taskId,
      generation: taskCheckpoints.claimGeneration,
      createdAt: max(taskCheckpoints.createdAt),
    })
    .from(taskCheckpoints)
    .where(
      and(inArray(taskCheckpoints.taskId, taskIds), eq(taskCheckpoints.verification, 'verified')),
    )
    .groupBy(taskCheckpoints.taskId, taskCheckpoints.claimGeneration)
    .all()) {
    if (v.createdAt !== null)
      newestVerified.set(`${v.taskId}:${String(v.generation)}`, v.createdAt);
  }

  return rows.map((row) => {
    const own = refsOf.get(row.id) ?? [];
    const newest = own.at(-1);
    const pendingSince =
      row.verification === 'pending' ? (newest?.createdAt ?? row.createdAt) : null;
    const newer = newestVerified.get(`${row.taskId}:${String(row.claimGeneration)}`);
    const agentId = agentOf.get(row.sessionId) ?? null;
    const hidden = agentId === null || !lens.visible(row.taskId, agentId);
    return {
      id: row.id,
      task_id: row.taskId,
      session_id: hidden ? null : row.sessionId,
      agent_id: hidden ? null : agentId,
      agent_redacted: hidden,
      claim_generation: row.claimGeneration,
      repo: row.repo,
      branch: row.branch,
      remote_ref: row.remoteRef,
      commit_sha: row.commitSha,
      manifest: row.manifest,
      summary: row.summary ?? null,
      summary_commit_sha: row.summaryCommitSha,
      created_at: row.createdAt,
      verification: row.verification,
      verified_at: row.verifiedAt,
      pending_since: pendingSince,
      pending_notice: pendingSince !== null && now - pendingSince > settings.pendingNoticeMs,
      superseded: newer !== undefined && newer > row.createdAt,
      refs: own.map((r) => ({ ref: r.ref, revision: r.revision, state: r.state })),
    };
  });
}

function viewOf(db: Db, reader: AgentReader, row: CheckpointRow, now: number): CheckpointView {
  return views(db, reader, [row], now)[0]!;
}

// ---------------------------------------------------------------- refusals

function unprocessable(field: string, message: string, details: Record<string, unknown> = {}) {
  return new ApiError('unprocessable', message, { field, ...details });
}

function notAnAgent(): ApiError {
  return new ApiError('forbidden', 'Only a registered agent saves a checkpoint', {
    action: 'task.checkpoint.create',
    reason: 'not_an_agent',
  });
}

// --------------------------------------------------------------- registering

export interface RegisterCheckpointInput {
  /** The ULID the helper minted before its push: the tag's last segment. */
  id: string;
  idempotencyKey: string;
  repo: string;
  branch: string;
  commitSha: string;
  manifest: readonly CheckpointManifestEntry[];
  summary?: { [K in keyof CheckpointSummary]?: string | undefined } | null | undefined;
  summaryCommitSha?: string | null | undefined;
  now?: number;
}

export interface RegisteredCheckpoint {
  checkpoint: CheckpointView;
  /** `false` when the key was registered already and this is that checkpoint. */
  created: boolean;
}

interface CleanInput {
  id: string;
  idempotencyKey: string;
  repo: string;
  branch: string;
  commitSha: string;
  manifest: CheckpointManifestEntry[];
  summary: CheckpointSummary | null;
  summaryCommitSha: string | null;
}

/**
 * Every bound here as well as in the route's and the tool's schemas: a
 * service reached without zod still refuses what §4.70 does not allow
 * (LAI-404's rule for heartbeats). **Only the five note fields and the
 * manifest's three** are kept — the schemas refuse any other key, and this
 * copies by name, so nothing else reaches a column.
 */
function cleanInput(input: RegisterCheckpointInput): CleanInput {
  const id = input.id.trim();
  if (!ULID.test(id)) throw unprocessable('id', 'A checkpoint id is a ULID the helper mints');

  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey === '' || idempotencyKey.length > CHECKPOINT_LIMITS.idempotencyKey) {
    throw unprocessable('idempotency_key', 'An idempotency key is 1–200 characters');
  }

  const branch = input.branch.trim();
  if (branch === '' || branch.length > CHECKPOINT_LIMITS.branch) {
    throw unprocessable('branch', 'A branch name is 1–255 characters');
  }

  const repo = input.repo.trim().length > CHECKPOINT_LIMITS.repo ? null : foldRepo(input.repo);
  if (repo === null) throw unprocessable('repo', 'A repo is owner/name');

  const commitSha = input.commitSha.trim().toLowerCase();
  if (!SHA.test(commitSha))
    throw unprocessable('commit_sha', 'A commit is its full 40-character SHA');

  if (input.manifest.length > CHECKPOINT_LIMITS.manifestEntries) {
    throw unprocessable('manifest', 'A manifest lists at most 1000 files');
  }
  const manifest = input.manifest.map((entry) => {
    const ok =
      typeof entry.path === 'string' &&
      entry.path.length > 0 &&
      entry.path.length <= CHECKPOINT_LIMITS.path &&
      Number.isInteger(entry.added) &&
      Number.isInteger(entry.removed) &&
      entry.added >= 0 &&
      entry.removed >= 0 &&
      entry.added <= CHECKPOINT_LIMITS.lines &&
      entry.removed <= CHECKPOINT_LIMITS.lines;
    if (!ok) throw unprocessable('manifest', 'Each manifest entry is { path, added, removed }');
    return { path: entry.path, added: entry.added, removed: entry.removed };
  });

  const hasSummary = input.summary !== null && input.summary !== undefined;
  const rawNoteSha = input.summaryCommitSha?.trim().toLowerCase() ?? null;
  const noteSha = rawNoteSha === '' ? null : rawNoteSha;
  if (hasSummary !== (noteSha !== null)) {
    throw unprocessable(
      noteSha === null ? 'summary_commit_sha' : 'summary',
      'A note and the commit it describes come together',
    );
  }
  if (noteSha !== null && !SHA.test(noteSha)) {
    throw unprocessable('summary_commit_sha', 'A commit is its full 40-character SHA');
  }

  let summary: CheckpointSummary | null = null;
  if (hasSummary) {
    const given = input.summary!;
    const note = {} as CheckpointSummary;
    for (const field of SUMMARY_FIELDS) {
      const value = given[field] ?? '';
      if (typeof value !== 'string' || value.length > CHECKPOINT_LIMITS.summaryField) {
        throw unprocessable('summary', `summary.${field} is a string of at most 4000 characters`);
      }
      note[field] = value;
    }
    summary = note;
  }

  return {
    id,
    idempotencyKey,
    repo,
    branch,
    commitSha,
    manifest,
    summary,
    summaryCommitSha: noteSha,
  };
}

/**
 * The tag's task segment (§6.4): the task's `external_ref` — `LAI-NNN` in
 * this repo — when it has one **that is a safe ref segment**, and its key
 * otherwise. `external_ref` is free text (§4.5); a value Git would refuse, or
 * one with a `/` in it, would make a ref nobody can push.
 */
function taskSegment(task: { externalRef: string | null; number: number }, prefix: string): string {
  const outside = task.externalRef?.trim() ?? '';
  return REF_SEGMENT.test(outside) ? outside : `${prefix}-${String(task.number)}`;
}

/** Whether a retried registration carries the body the first one did (§6.4). */
function sameSave(row: CheckpointRow, taskId: string, clean: CleanInput): boolean {
  return (
    row.taskId === taskId &&
    row.id === clean.id &&
    row.repo === clean.repo &&
    row.branch === clean.branch &&
    row.commitSha === clean.commitSha &&
    row.summaryCommitSha === clean.summaryCommitSha &&
    JSON.stringify(row.manifest) === JSON.stringify(clean.manifest) &&
    JSON.stringify(row.summary ?? null) === JSON.stringify(clean.summary)
  );
}

/**
 * `POST /tasks/:id/checkpoints`, `checkpoint_task` (§6.4, §7.1, LAI-545).
 *
 * One `BEGIN IMMEDIATE` transaction that asks everything again — the agent,
 * its token and owner, the owner's permission narrowed by the agent's grant —
 * then:
 *
 * - **a retry** — the same `idempotency_key` and the same body — answers the
 *   checkpoint already registered (`created: false`: no second row, no second
 *   `task.checkpoint_saved`). It is matched **before** the claim fence, so a
 *   save whose answer was lost still finds it after its session offered the
 *   task and the claim paused. The same key with another body is `409`;
 * - otherwise the claim fence, the one configured repo, and the checkpoint
 *   with its first ref, whose state is projected from the §4.72 deliveries
 *   already stored for that `repo` + `ref` — `verified` only when such a
 *   delivery arrived first, `pending` when none has.
 */
export function registerCheckpoint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: RegisterCheckpointInput,
): RegisteredCheckpoint {
  const now = input.now ?? Date.now();
  const agent = registeredAgent(actor);
  if (agent === null) throw notAnAgent();
  const clean = cleanInput(input);

  return immediateTransaction(sqlite, () => {
    const fresh = {
      ...reloadAgentActor(db, actor, now, 'task.checkpoint.create'),
      claimGeneration: actor.claimGeneration,
    };
    const { task, project } = requireVisibleTaskToClaim(db, fresh, taskId);
    assertCan(withProject(fresh, project.id), 'task.checkpoint.create', {
      projectId: project.id,
    });

    const seen = db
      .select()
      .from(taskCheckpoints)
      .where(eq(taskCheckpoints.idempotencyKey, clean.idempotencyKey))
      .get();
    if (seen !== undefined) {
      if (!sameSave(seen, taskId, clean)) {
        throw new ApiError('conflict', 'That idempotency key was used with a different body', {
          reason: 'idempotency_key_reused',
          field: 'idempotency_key',
        });
      }
      return { checkpoint: viewOf(db, agentReader(actor), seen, now), created: false };
    }

    // The fence (§6.3): a paused, stale or other session's save is refused. A
    // task nobody holds passes the fence — and is refused below, because a
    // save needs the live claim.
    const refusal = claimFenceRefusal(db, fresh, taskId, now);
    if (refusal !== null) throw refusal;
    const live = liveClaim(db, taskId);
    if (live?.agentId !== agent.id || live.state !== 'active') {
      throw new ApiError('conflict', 'Saving a checkpoint needs this task’s live claim', {
        reason: 'stale_claim',
        task_id: taskId,
        claim_generation: fresh.claimGeneration ?? null,
      });
    }

    if (db.select().from(taskCheckpoints).where(eq(taskCheckpoints.id, clean.id)).get()) {
      throw unprocessable('id', 'Another checkpoint already has that id');
    }

    // One repo (D-116 limitation 4): the project's configured repo, and only it.
    const configured = project.repo === null ? null : foldRepo(project.repo);
    if (configured === null || configured !== clean.repo) {
      throw unprocessable(
        'repo',
        'Checkpoints are verified only in the project’s configured repo',
        {
          reason: 'repo_not_configured',
        },
      );
    }

    const remoteRef = `${CHECKPOINT_TAG_PREFIX}${taskSegment(task, project.prefix)}/${clean.id}`;
    db.insert(taskCheckpoints)
      .values({
        id: clean.id,
        taskId,
        sessionId: live.sessionId,
        claimGeneration: live.generation,
        repo: clean.repo,
        branch: clean.branch,
        remoteRef,
        commitSha: clean.commitSha,
        manifest: clean.manifest,
        summary: clean.summary,
        summaryCommitSha: clean.summaryCommitSha,
        createdAt: now,
        verification: 'pending',
        verifiedAt: null,
        idempotencyKey: clean.idempotencyKey,
      })
      .run();
    rederive(db, insertRef(db, clean.id, 0, clean.repo, remoteRef, now), now);

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      actorId: fresh.userId,
      actorKind: 'agent',
      actorTokenId: fresh.token.id,
      agentSessionId: live.sessionId,
      type: 'task.checkpoint_saved',
      payload: {
        checkpoint_id: clean.id,
        commit_sha: clean.commitSha,
        branch: clean.branch,
        claim_generation: live.generation,
        session_id: live.sessionId,
      },
      now,
    });

    const row = db.select().from(taskCheckpoints).where(eq(taskCheckpoints.id, clean.id)).get()!;
    return { checkpoint: viewOf(db, agentReader(actor), row, now), created: true };
  });
}

function insertRef(
  db: Db,
  checkpointId: string,
  revision: number,
  repo: string,
  ref: string,
  now: number,
): string {
  const id = newId();
  db.insert(checkpointRefs)
    .values({ id, checkpointId, revision, repo, ref, state: 'pending', createdAt: now })
    .run();
  return id;
}

/**
 * The ref's state again from **every** §4.72 row for its name — whenever they
 * arrived, before its registration included — and, when it is its
 * checkpoint's newest ref, the checkpoint's. In the caller's transaction, so
 * a registration and a delivery for one name cannot interleave: whichever
 * commits second sees the other (§4.72). `verified_at` is when the checkpoint
 * last became `verified`.
 */
function rederive(db: Db, refId: string, now: number): void {
  const ref = db.select().from(checkpointRefs).where(eq(checkpointRefs.id, refId)).get()!;
  const checkpoint = db
    .select()
    .from(taskCheckpoints)
    .where(eq(taskCheckpoints.id, ref.checkpointId))
    .get()!;
  const seen = db
    .select({
      beforeSha: checkpointRefTransitions.beforeSha,
      afterSha: checkpointRefTransitions.afterSha,
    })
    .from(checkpointRefTransitions)
    .where(
      and(eq(checkpointRefTransitions.repo, ref.repo), eq(checkpointRefTransitions.ref, ref.ref)),
    )
    .all();
  const state = deriveRefState(seen, checkpoint.commitSha);
  if (state !== ref.state) {
    db.update(checkpointRefs).set({ state }).where(eq(checkpointRefs.id, refId)).run();
  }

  const newest = db
    .select({ id: checkpointRefs.id })
    .from(checkpointRefs)
    .where(eq(checkpointRefs.checkpointId, checkpoint.id))
    .orderBy(desc(checkpointRefs.revision))
    .limit(1)
    .get()!;
  if (newest.id !== refId || state === checkpoint.verification) return;
  db.update(taskCheckpoints)
    .set({ verification: state, ...(state === 'verified' ? { verifiedAt: now } : {}) })
    .where(eq(taskCheckpoints.id, checkpoint.id))
    .run();
}

// --------------------------------------------------------------- re-tagging

export interface CheckpointRefRegistered {
  ref: string;
  revision: number;
  verification: CheckpointVerification;
}

/**
 * `POST /checkpoints/:id/refs` (§6.4, D-116 item 7, `task.checkpoint.retag`):
 * the next re-tag `…-r<n>`, registered **before** the helper pushes it.
 *
 * **Any registered agent of the saving agent's owner** with a `full` grant
 * (§3.2), so a replacement agent can re-verify a dead one's save; it needs no
 * claim, because it changes no task, only which ref is the checkpoint's
 * newest. The new ref starts from absent; the checkpoint takes its state at
 * once — `pending`, timed from now, unless its deliveries arrived first —
 * which is the one change to `verification` no delivery makes (§4.71). The
 * server calls nothing to do this.
 */
export function registerCheckpointRef(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  checkpointId: string,
  now = Date.now(),
): CheckpointRefRegistered {
  const agent = registeredAgent(actor);
  if (agent === null) {
    throw new ApiError('forbidden', 'Only a registered agent re-tags a checkpoint', {
      action: 'task.checkpoint.retag',
      reason: 'not_an_agent',
    });
  }

  return immediateTransaction(sqlite, () => {
    const fresh = reloadAgentActor(db, actor, now, 'task.checkpoint.retag');
    const checkpoint = db
      .select()
      .from(taskCheckpoints)
      .where(eq(taskCheckpoints.id, checkpointId))
      .get();
    const task =
      checkpoint === undefined
        ? undefined
        : db.select().from(tasks).where(eq(tasks.id, checkpoint.taskId)).get();
    if (
      checkpoint === undefined ||
      task === undefined ||
      !can(withProject(fresh, task.projectId), 'project.read', { projectId: task.projectId })
    ) {
      throw ApiError.notFound(`No checkpoint with id "${checkpointId}"`);
    }

    const savedBy = db
      .select({ ownerUserId: agents.ownerUserId })
      .from(agentSessions)
      .innerJoin(agents, eq(agents.id, agentSessions.agentId))
      .where(eq(agentSessions.id, checkpoint.sessionId))
      .get()!;
    if (savedBy.ownerUserId !== fresh.userId) {
      throw new ApiError('forbidden', 'Only an agent of the saving agent’s owner re-tags it', {
        action: 'task.checkpoint.retag',
        reason: 'not_the_owners_agent',
      });
    }
    assertCan(withProject(fresh, task.projectId), 'task.checkpoint.retag', {
      projectId: task.projectId,
    });

    const top = db
      .select({ revision: max(checkpointRefs.revision) })
      .from(checkpointRefs)
      .where(eq(checkpointRefs.checkpointId, checkpointId))
      .get();
    const revision = (top?.revision ?? 0) + 1;
    const ref = `${checkpoint.remoteRef}-r${String(revision)}`;
    rederive(db, insertRef(db, checkpointId, revision, checkpoint.repo, ref, now), now);
    const verification = db
      .select({ verification: taskCheckpoints.verification })
      .from(taskCheckpoints)
      .where(eq(taskCheckpoints.id, checkpointId))
      .get()!.verification;
    return { ref, revision, verification };
  });
}

// ------------------------------------------------------------------- reading

/** `GET /tasks/:id/checkpoints` (§6.4): newest first, under *Read tasks*. */
export function listCheckpoints(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now = Date.now(),
): CheckpointView[] {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  // *Read tasks* (§3.2). A task the caller cannot read is answered as one
  // that does not exist, so the read discloses neither.
  if (!can(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId })) {
    throw ApiError.notFound(`No task with id "${taskId}"`);
  }

  const rows = db
    .select()
    .from(taskCheckpoints)
    .where(eq(taskCheckpoints.taskId, taskId))
    .orderBy(desc(taskCheckpoints.createdAt), desc(taskCheckpoints.id))
    .all();
  return views(db, agentReader(actor), rows, now);
}

/**
 * The accept-time check LAI-546 calls (§4.73, D-116 items 6 and 8), inside
 * its own transaction: the checkpoint must be `verified` **now** — `409
 * checkpoint_unverified` otherwise, with `details.verification` — and the
 * receiver's SHA must be the checkpoint's — `422 checkpoint_mismatch`. The
 * SHA is the receiver's acknowledgement, not proof: the server only compares.
 */
export function assertCheckpointAcceptable(
  db: Db,
  checkpointId: string,
  verifiedCommitSha: string,
): void {
  const checkpoint = assertCheckpointOfferable(db, checkpointId);
  if (verifiedCommitSha.trim().toLowerCase() !== checkpoint.commitSha) {
    throw new ApiError('unprocessable', 'That is not the checkpoint’s commit', {
      reason: 'checkpoint_mismatch',
      field: 'verified_commit_sha',
      checkpoint_id: checkpointId,
    });
  }
}

/** A `pending`, `uncertain` or `ref_deleted` checkpoint is neither offered nor accepted. */
export function assertCheckpointOfferable(db: Db, checkpointId: string): CheckpointRow {
  const checkpoint = db
    .select()
    .from(taskCheckpoints)
    .where(eq(taskCheckpoints.id, checkpointId))
    .get();
  if (checkpoint === undefined) throw ApiError.notFound(`No checkpoint with id "${checkpointId}"`);
  if (checkpoint.verification !== 'verified') {
    throw new ApiError('conflict', 'That checkpoint is not verified', {
      reason: 'checkpoint_unverified',
      checkpoint_id: checkpointId,
      verification: checkpoint.verification,
    });
  }
  return checkpoint;
}

// ---------------------------------------------------------------- deliveries

export interface CheckpointDelivery {
  /** `X-GitHub-Delivery` — the same on a redelivery (D-116). */
  deliveryId: string;
  repo: string;
  ref: string;
  before: string;
  after: string;
}

export interface CheckpointDeliveryOutcome {
  handled: boolean;
  reason?: string;
  deduplicated?: boolean;
  checkpointId?: string;
  state?: CheckpointVerification;
}

/** Whether a `push` delivery is about a checkpoint tag at all (§10.1). */
export function isCheckpointRef(ref: unknown): ref is string {
  return typeof ref === 'string' && CHECKPOINT_REF.test(ref);
}

/**
 * Seam for a test of D-116's redelivery: called inside the delivery's
 * transaction after the transition is written, so a test can make the
 * handler fail **before it is applied** and see the transaction roll back.
 */
let afterTransitionWritten: (() => void) | null = null;
export function onCheckpointTransitionWritten(hook: (() => void) | null): void {
  afterTransitionWritten = hook;
}

/**
 * A signed `push` for `refs/tags/laika-ckpt/…` (§10.1, §4.72, §3.4's
 * `system.checkpoint.verify`). One `BEGIN IMMEDIATE` transaction per
 * delivery — so deliveries for one ref are applied one at a time — that
 * stores the transition **by repo and ref name** with the delivery's id, and,
 * when a §4.71 ref of that name is registered, re-derives its state from
 * every row for the name.
 *
 * - **Seen before** (its id is stored): ignored, `deduplicated`.
 * - **Not a configured repo**: a registered ref whose project's repo is not
 *   this one, or a name no project's repo tracks — verifies nothing, stores
 *   nothing.
 * - **No ref of that name registered yet** — the normal race, since the
 *   helper pushes first: stored, and counted by the registration that follows.
 *
 * A throw anywhere rolls the whole delivery back, id included, so GitHub's
 * *Redeliver* — same id — processes it.
 */
export function applyCheckpointDelivery(
  sqlite: Database.Database,
  db: Db,
  delivery: CheckpointDelivery,
  now: number,
): CheckpointDeliveryOutcome {
  const repo = foldRepo(delivery.repo);
  const before = delivery.before.trim().toLowerCase();
  const after = delivery.after.trim().toLowerCase();
  if (delivery.deliveryId.trim() === '') {
    return { handled: false, reason: 'a checkpoint delivery needs its X-GitHub-Delivery id' };
  }
  if (repo === null || !isCheckpointRef(delivery.ref) || !SHA.test(before) || !SHA.test(after)) {
    return { handled: false, reason: 'not a checkpoint tag transition' };
  }

  return immediateTransaction(sqlite, () => {
    const repeat = db
      .select({ id: checkpointRefTransitions.id })
      .from(checkpointRefTransitions)
      .where(eq(checkpointRefTransitions.deliveryId, delivery.deliveryId))
      .get();
    if (repeat !== undefined) return { handled: true, deduplicated: true };

    const ref = db
      .select()
      .from(checkpointRefs)
      .where(and(eq(checkpointRefs.repo, repo), eq(checkpointRefs.ref, delivery.ref)))
      .get();

    if (ref === undefined) {
      const { projectIds } = resolveRepoProjects(db, repo, '');
      const projectId = projectIds[0];
      if (projectId === undefined) {
        return { handled: false, reason: 'repository is tracked by no project' };
      }
      assertCan(systemPrincipal(projectId), 'system.checkpoint.verify', { projectId });
      writeTransition(db, repo, delivery, before, after, now);
      return { handled: true, reason: 'stored until its ref registers' };
    }

    const checkpoint = db
      .select()
      .from(taskCheckpoints)
      .where(eq(taskCheckpoints.id, ref.checkpointId))
      .get()!;
    const project = db
      .select({ id: projects.id, repo: projects.repo })
      .from(projects)
      .innerJoin(tasks, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, checkpoint.taskId))
      .get()!;
    const configured = project.repo === null ? null : foldRepo(project.repo);
    if (repo !== configured) {
      return { handled: false, reason: 'not the project’s configured repo' };
    }

    assertCan(systemPrincipal(project.id), 'system.checkpoint.verify', { projectId: project.id });
    writeTransition(db, repo, delivery, before, after, now);
    rederive(db, ref.id, now);
    const state = db
      .select({ verification: taskCheckpoints.verification })
      .from(taskCheckpoints)
      .where(eq(taskCheckpoints.id, checkpoint.id))
      .get()!.verification;
    return { handled: true, checkpointId: checkpoint.id, state };
  });
}

function writeTransition(
  db: Db,
  repo: string,
  delivery: CheckpointDelivery,
  before: string,
  after: string,
  now: number,
): void {
  db.insert(checkpointRefTransitions)
    .values({
      id: newId(),
      repo,
      ref: delivery.ref,
      deliveryId: delivery.deliveryId,
      beforeSha: before,
      afterSha: after,
      createdAt: now,
    })
    .run();
  afterTransitionWritten?.();
}

// ----------------------------------------------------------------- retention

/**
 * Seam for a test of retention's atomicity: called inside a checkpoint's
 * prune transaction after its delivery rows are deleted and before the
 * checkpoint is, so a test can fail the prune half-way and see nothing move.
 */
let midPrune: (() => void) | null = null;
export function onCheckpointPruneStep(hook: (() => void) | null): void {
  midPrune = hook;
}

/**
 * When each `cancelled` task was cancelled: its latest `task.status_changed`
 * row **into** `cancelled` from another category (§4.8) — the status-change record, not `updated_at`,
 * which any later edit moves. A task with no such row (created cancelled, or
 * older than the record) falls back to `updated_at`, which is never earlier
 * than the cancel, so it is only ever kept longer.
 */
function cancelledAt(db: Db, cancelled: readonly { id: string; updatedAt: number }[]) {
  const at = new Map(cancelled.map((t) => [t.id, null as number | null]));
  for (let i = 0; i < cancelled.length; i += 500) {
    const batch = cancelled.slice(i, i + 500).map((t) => t.id);
    for (const row of db
      .select({
        taskId: activity.taskId,
        payloadJson: activity.payloadJson,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .where(and(eq(activity.type, 'task.status_changed'), inArray(activity.taskId, batch)))
      .all()) {
      const { from, to } = JSON.parse(row.payloadJson) as { from?: unknown; to?: unknown };
      // A move between two cancelled statuses is not a §5 transition (LAI-738,
      // D-077): it is written with `from` equal to `to`, and the task was
      // cancelled before it. Only entering the category counts.
      if (to !== 'cancelled' || from === 'cancelled' || row.taskId === null) continue;
      const seen = at.get(row.taskId);
      if (seen === undefined) continue;
      if (seen === null || row.createdAt > seen) at.set(row.taskId, row.createdAt);
    }
  }
  return new Map(cancelled.map((t) => [t.id, at.get(t.id) ?? t.updatedAt]));
}

/**
 * §11.6's checkpoint retention (D-115 item 9), daily, under
 * `system.checkpoint.prune`:
 *
 * - checkpoints of tasks `done` or `cancelled` for longer than the retention,
 *   **each in one transaction with all its evidence** — its refs (cascade)
 *   and every §4.72 row for those refs' names, delivery ids included. Never
 *   the evidence without the checkpoint: a surviving ref whose deliveries
 *   were gone would forget its deletion, and replaying the original creation
 *   would make a `ref_deleted` or `uncertain` ref `verified` again;
 * - §4.72 rows for a name **never registered** — a tag pushed by hand, or a
 *   helper that pushed and never registered — once as old as the retention.
 *
 * **When a task closed**: `completed_at` for `done`; for `cancelled`, the
 * status change into it ({@link cancelledAt}). Closed offers that named a
 * pruned checkpoint keep their own snapshot and lose the link (§4.73, `ON
 * DELETE SET NULL` — LAI-546's column). Writes no `activity` row: the
 * `task.checkpoint_saved` rows naming the checkpoints stay, and they are the
 * history. **Laika never deletes a Git tag.**
 */
export function pruneCheckpoints(db: Db, now: number): { checkpoints: number; orphans: number } {
  assertCan(systemPrincipal(), 'system.checkpoint.prune');
  const cutoff = now - settings.retentionMs;

  const done = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.status, 'done'), lt(tasks.completedAt, cutoff)))
    .all()
    .map((t) => t.id);
  const cancelled = db
    .select({ id: tasks.id, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(eq(tasks.status, 'cancelled'))
    .all();
  const closed = [
    ...done,
    ...[...cancelledAt(db, cancelled)].filter(([, at]) => at < cutoff).map(([id]) => id),
  ];

  const due: string[] = [];
  for (let i = 0; i < closed.length; i += 500) {
    for (const row of db
      .select({ id: taskCheckpoints.id })
      .from(taskCheckpoints)
      .where(inArray(taskCheckpoints.taskId, closed.slice(i, i + 500)))
      .all()) {
      due.push(row.id);
    }
  }

  let checkpoints = 0;
  for (const checkpointId of due) {
    immediateTransaction(db.$client, () => {
      const names = db
        .select({ repo: checkpointRefs.repo, ref: checkpointRefs.ref })
        .from(checkpointRefs)
        .where(eq(checkpointRefs.checkpointId, checkpointId))
        .all();
      for (const name of names) {
        db.delete(checkpointRefTransitions)
          .where(
            and(
              eq(checkpointRefTransitions.repo, name.repo),
              eq(checkpointRefTransitions.ref, name.ref),
            ),
          )
          .run();
      }
      midPrune?.();
      checkpoints += db
        .delete(taskCheckpoints)
        .where(eq(taskCheckpoints.id, checkpointId))
        .run().changes;
    });
  }

  const orphans = db
    .delete(checkpointRefTransitions)
    .where(
      and(
        lt(checkpointRefTransitions.createdAt, cutoff),
        notExists(
          db
            .select({ id: checkpointRefs.id })
            .from(checkpointRefs)
            .where(
              and(
                eq(checkpointRefs.repo, checkpointRefTransitions.repo),
                eq(checkpointRefs.ref, checkpointRefTransitions.ref),
              ),
            ),
        ),
      ),
    )
    .run().changes;
  return { checkpoints, orphans };
}

// ------------------------------------------------------------------- consent

/** §6.4's consent shape: whether hooks may save without asking (D-115 item 2). */
export interface CheckpointConsentView {
  given: boolean;
  given_by_user_id: string | null;
  given_at: number | null;
  withdrawn_at: number | null;
}

function consentView(db: Db, agentId: string): CheckpointConsentView {
  const row = db
    .select()
    .from(agentCheckpointConsents)
    .where(eq(agentCheckpointConsents.agentId, agentId))
    .get();
  return {
    given: row?.withdrawnAt === null,
    given_by_user_id: row?.givenByUserId ?? null,
    given_at: row?.givenAt ?? null,
    withdrawn_at: row?.withdrawnAt ?? null,
  };
}

/** The agent, when the caller is its owner — anything else is a `404`, as another person's agent is (§4.63). */
function ownAgent(db: Db, actor: ResolvedActor, agentId: string) {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (agent?.ownerUserId !== actor.userId) throw ApiError.agentNotFound();
  return agent;
}

/**
 * `GET /agents/:id/checkpoint-consent` (§6.4, §4.75): the owner, or **the
 * agent's own token** — so the helper knows whether it may save on its own.
 * Another agent's token, even the same owner's, is answered as no agent.
 */
export function readCheckpointConsent(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
): CheckpointConsentView {
  assertCan(actor, 'agent.read_own');
  const caller = registeredAgent(actor);
  if (caller !== null && caller.id !== agentId) {
    throw ApiError.agentNotFound();
  }
  ownAgent(db, actor, agentId);
  return consentView(db, agentId);
}

/**
 * `PUT` / `DELETE /agents/:id/checkpoint-consent` (§6.4, §4.75): the owner's,
 * signed in — `agent.manage_own` is session-only. Giving it again clears a
 * withdrawal and stamps `given_at` afresh; withdrawing stops automatic saves
 * and leaves manual ones working. **No `activity` row**: it is a setting of
 * the agent, as its grants are (§4.64). The server never sees whether a save
 * was automatic; the helper reads this before a hook saves.
 */
export function setCheckpointConsent(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  given: boolean,
  now = Date.now(),
): CheckpointConsentView {
  assertCan(actor, 'agent.manage_own');
  ownAgent(db, actor, agentId);

  const existing = db
    .select()
    .from(agentCheckpointConsents)
    .where(eq(agentCheckpointConsents.agentId, agentId))
    .get();
  if (given) {
    if (existing === undefined) {
      db.insert(agentCheckpointConsents)
        .values({ id: newId(), agentId, givenByUserId: actor.userId, givenAt: now })
        .run();
    } else {
      db.update(agentCheckpointConsents)
        .set({ givenByUserId: actor.userId, givenAt: now, withdrawnAt: null })
        .where(eq(agentCheckpointConsents.id, existing.id))
        .run();
    }
  } else if (existing?.withdrawnAt === null) {
    db.update(agentCheckpointConsents)
      .set({ withdrawnAt: now })
      .where(eq(agentCheckpointConsents.id, existing.id))
      .run();
  }
  return consentView(db, agentId);
}
