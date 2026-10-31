import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  type AgentCredential,
  type ApiResult,
  callBoard,
  describe,
  type Fetch,
  type Harness,
  HARNESSES,
  isLaikaId,
  isRecord,
  listStates,
  liveness,
  log,
  privateDir,
  type ProcReader,
  readCredential,
  readJson,
  readProc,
  isDeadState,
  probeKill,
  type Probe,
  readState,
  sessionFileKey,
  UNKNOWN,
  type SessionState,
  statePath,
  writePrivate,
} from './agent-session.ts';
import {
  assertIsolated,
  assertNotBusy,
  assertWorkBranch,
  busyReason,
  commitStaged,
  currentBranch,
  DEFAULT_MAX_FILE_BYTES,
  type GitRunner,
  headSha,
  manifest as manifestOf,
  type ManifestEntry,
  pushBranch,
  pushTag,
  Refusal,
  remoteDefault,
  remoteFor,
  repoName,
  secretIn,
  stageSafely,
  indexSnapshot,
  restoreIndex,
  TAG_PREFIX,
  ulid,
  type Worktree,
  worktreeAt,
} from './checkpoint-git.ts';

/**
 * `laika agent checkpoint …` — the engine (LAI-542's helper, extended by
 * LAI-547; proposal §4.3.1, §4.7; SPEC §4.70 – §4.72, §4.75, §6.4; D-115,
 * D-116, D-116a).
 *
 * ## The order, and why it is this one
 *
 * 1. **Commit** the work-in-progress on the task's branch, in the task's own
 *    worktree, staging only what passes {@link stageSafely}.
 * 2. **Write the record** — the checkpoint id (a ULID this helper mints), the
 *    idempotency key and everything the registration will send — to
 *    `~/.laika/agent-checkpoints/records/<id>.json` (0600), **before anything
 *    leaves the machine**.
 * 3. **Push the branch**, then **push the one lightweight tag**
 *    `laika-ckpt/<LAI-NNN>/<id>` at the same commit, alone in its own push:
 *    GitHub creates no push event for more than three tags at once (D-116
 *    item 1).
 * 4. **Register** — `POST /tasks/:id/checkpoints` with that key and the
 *    claim's generation. A registration that fails on the network or a 5xx
 *    leaves the record at `tag_pushed`, and the next save, `status` or hook
 *    sends it again with **the same key and the same body**, so the board
 *    answers with the one checkpoint it already has (§6.4).
 *
 * The manifest (paths and line counts, read from git) and the continuation
 * note (free text the agent wrote) are separate fields and are never mixed;
 * the note records which commit it describes, so a note older than the save
 * is labelled stale by the board rather than passed off as current (D-115
 * item 6). A note that matches a secret pattern is refused (item 5).
 *
 * ## Automatic saves
 *
 * Only with the owner's consent, read from the board before each automatic
 * save (§4.75; a manual save never needs it). The hooks count mutating tool
 * calls and start a background save after ~10 of them or ~2 minutes of
 * activity, and at `Stop` and session end; the save waits for quiet — no tool
 * in flight, no `index.lock` — and gives up rather than racing.
 *
 * The token is the session helper's: read from the agent's own file or
 * `LAIKA_AGENT_TOKEN`, sent as a header, handed to a background child on its
 * stdin, and never in argv, an environment, a record or the log.
 */

/* -------------------------------------------------------------------------- */
/* Where things are kept                                                      */
/* -------------------------------------------------------------------------- */

export const checkpointsDir = (home: string): string => join(home, '.laika', 'agent-checkpoints');
const recordsDir = (home: string): string => join(checkpointsDir(home), 'records');
const notesDir = (home: string): string => join(checkpointsDir(home), 'notes');
const activityDir = (home: string): string => join(checkpointsDir(home), 'activity');
export const inflightDir = (home: string, harness: Harness, harnessSessionId: string): string =>
  join(checkpointsDir(home), 'inflight', `${harness}-${sessionFileKey(harnessSessionId)}`);
export const recordPath = (home: string, id: string): string =>
  join(recordsDir(home), `${id}.json`);
export const activityPath = (home: string, harness: Harness, harnessSessionId: string): string =>
  join(activityDir(home), `${harness}-${sessionFileKey(harnessSessionId)}.json`);
const notePath = (home: string, top: string): string =>
  join(notesDir(home), `${createHash('sha256').update(top).digest('hex').slice(0, 32)}.json`);

function writeJson(home: string, dir: string, path: string, value: unknown): void {
  privateDir(join(home, '.laika'));
  privateDir(checkpointsDir(home));
  privateDir(dir);
  writePrivate(path, `${JSON.stringify(value)}\n`);
}

/* -------------------------------------------------------------------------- */
/* The continuation note                                                      */
/* -------------------------------------------------------------------------- */

export const NOTE_FIELDS = [
  'work_done',
  'next_step',
  'decisions',
  'open_questions',
  'failing',
] as const;
export type Note = Partial<Record<(typeof NOTE_FIELDS)[number], string>>;
export const NOTE_FIELD_MAX = 4000;

/**
 * The five-field note of §4.70, checked: strings only, each at most 4000
 * characters, no other field — and **refused when it matches a secret
 * pattern** (D-115 item 5). A mitigation, not a guarantee.
 */
export function parseNote(raw: unknown): Note {
  if (!isRecord(raw)) throw new Refusal('the note must be a JSON object', 'bad_note');
  const note: Note = {};
  for (const [field, value] of Object.entries(raw)) {
    if (!(NOTE_FIELDS as readonly string[]).includes(field)) {
      throw new Refusal(
        `the note has no field "${field}" — it takes ${NOTE_FIELDS.join(', ')}`,
        'bad_note',
      );
    }
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') throw new Refusal(`note.${field} must be text`, 'bad_note');
    if (value.length > NOTE_FIELD_MAX) {
      throw new Refusal(`note.${field} is over ${String(NOTE_FIELD_MAX)} characters`, 'bad_note');
    }
    const found = secretIn(value);
    if (found !== undefined) {
      throw new Refusal(
        `refused: note.${field} looks like it holds ${found}. Notes are shown to everyone who can ` +
          'read the task; never put a credential or copied secret in one. Nothing was saved.',
        'secret_in_note',
        [`note.${field}`],
      );
    }
    note[field as keyof Note] = value;
  }
  return note;
}

interface StoredNote {
  readonly summary: Note;
  /** HEAD when the note was written: a save from that HEAD is the save it describes. */
  readonly head: string;
  /** Set once a save carried it as current; later saves name this commit, so it reads stale. */
  readonly described?: string;
}

function readNote(home: string, top: string): StoredNote | undefined {
  const value = readJson(notePath(home, top));
  if (!isRecord(value) || !isRecord(value.summary) || typeof value.head !== 'string') {
    return undefined;
  }
  try {
    // Checked again: what is on disk is data, never trusted.
    const summary = parseNote(value.summary);
    return {
      summary,
      head: value.head,
      ...(typeof value.described === 'string' && /^[0-9a-f]{40}$/.test(value.described)
        ? { described: value.described }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function writeNote(home: string, top: string, note: StoredNote): void {
  writeJson(home, notesDir(home), notePath(home, top), note);
}

/**
 * `laika agent checkpoint note`: keep a note for this worktree's next save,
 * with the HEAD it was written over — so the save made from that HEAD
 * carries it as current, and any later one as an earlier save's.
 */
export function writeNoteFor(deps: CheckpointDeps, cwd: string, note: Note): string {
  const wt = worktreeAt(deps.git, cwd);
  writeNote(deps.home, wt.top, { summary: note, head: headSha(deps.git, wt) });
  return wt.top;
}

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

export type Stage = 'committed' | 'branch_pushed' | 'tag_pushed' | 'registered' | 'refused';

export interface Retag {
  readonly ref: string;
  readonly revision: number;
  pushed: boolean;
}

export interface CheckpointRecord {
  readonly version: 1;
  readonly id: string;
  readonly idempotency_key: string;
  readonly harness: Harness;
  readonly url: string;
  readonly task_id: string;
  readonly task_segment: string;
  readonly generation: number;
  readonly worktree: string;
  readonly remote: string;
  readonly remote_default?: string;
  readonly repo: string;
  readonly branch: string;
  readonly commit_sha: string;
  readonly tag_ref: string;
  readonly manifest: readonly ManifestEntry[];
  readonly summary: Note | null;
  readonly summary_commit_sha: string | null;
  readonly auto: boolean;
  readonly created_at: number;
  stage: Stage;
  attempts: number;
  verification?: string;
  last_error?: string;
  retags: Retag[];
}

export function readRecord(home: string, id: string): CheckpointRecord | undefined {
  if (!isLaikaId(id)) return undefined;
  const value = readJson(recordPath(home, id));
  return isRecord(value) && value.version === 1 && value.id === id
    ? (value as unknown as CheckpointRecord)
    : undefined;
}

function writeRecord(home: string, record: CheckpointRecord): void {
  writeJson(home, recordsDir(home), recordPath(home, record.id), record);
}

export function listRecords(home: string): CheckpointRecord[] {
  let names: string[];
  try {
    names = readdirSync(recordsDir(home));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => readRecord(home, n.slice(0, -5)))
    .filter((r): r is CheckpointRecord => r !== undefined)
    .sort((a, b) => b.created_at - a.created_at);
}

/** What registration sends — built from the record alone, so a retry sends exactly the same. */
export function registrationBody(record: CheckpointRecord): Record<string, unknown> {
  return {
    id: record.id,
    idempotency_key: record.idempotency_key,
    repo: record.repo,
    branch: record.branch,
    commit_sha: record.commit_sha,
    manifest: record.manifest,
    summary: record.summary,
    summary_commit_sha: record.summary_commit_sha,
  };
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* -------------------------------------------------------------------------- */

export interface CheckpointDeps {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: Fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly git: GitRunner;
  /** The process table, for the in-flight markers' liveness; `ps` by default. */
  readonly proc?: ProcReader;
  /**
   * A test's window onto the races P1-7 closes: after the quiet wait, after
   * staging (a delay here is a slow commit), and when the interlock is let go.
   */
  readonly onPhase?: (phase: 'quiet' | 'staged' | 'released') => void | Promise<void>;
  /** An automatic save's time budget under the interlock; {@link SAVE_BUDGET_MS} at most. */
  readonly saveBudgetMs?: number;
}

const retryable = (r: ApiResult): boolean =>
  r.kind === 'network' ||
  (r.kind === 'http' && (r.status >= 500 || r.status === 408 || r.status === 429));

async function get(
  deps: CheckpointDeps,
  credential: AgentCredential,
  path: string,
): Promise<ApiResult> {
  return callBoard(deps.fetch, credential, path, undefined, {}, 10_000, 'GET');
}

/* -------------------------------------------------------------------------- */
/* Which claim                                                                */
/* -------------------------------------------------------------------------- */

const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

interface TaskInfo {
  readonly id: string;
  readonly key: string;
  readonly externalRef: string | null;
  readonly segment: string;
  readonly branch: string | null;
}

/** The tag's task segment exactly as the server builds it (§6.4): the outside id, else the key. */
export function segmentOf(key: string, externalRef: string | null): string {
  const outside = externalRef?.trim() ?? '';
  return REF_SEGMENT.test(outside) ? outside : key;
}

async function taskInfo(
  deps: CheckpointDeps,
  credential: AgentCredential,
  taskId: string,
): Promise<TaskInfo | undefined> {
  const r = await get(deps, credential, `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  if (r.kind !== 'ok' || !isRecord(r.body)) return undefined;
  const b = r.body;
  if (b.id !== taskId || typeof b.key !== 'string' || !REF_SEGMENT.test(b.key)) return undefined;
  const externalRef = typeof b.external_ref === 'string' ? b.external_ref : null;
  return {
    id: taskId,
    key: b.key,
    externalRef,
    segment: segmentOf(b.key, externalRef),
    branch: typeof b.branch === 'string' ? b.branch : null,
  };
}

/** A branch is the task's own when it is named after it, `LAI-547-short-name`, or is the branch the task records. */
export function branchIsTasks(branch: string, task: TaskInfo): boolean {
  const b = branch.toUpperCase();
  const s = task.segment.toUpperCase();
  return b === s || b.startsWith(`${s}-`) || (task.branch !== null && task.branch === branch);
}

export interface Target {
  readonly harness: Harness;
  readonly credential: AgentCredential;
  readonly task: TaskInfo;
  readonly generation: number;
}

export interface ClaimQuery {
  readonly harness?: Harness;
  /** One harness session's claims only (a hook's save). */
  readonly harnessSessionId?: string;
  /** The task, by id, key or outside id. */
  readonly task?: string;
  /** With `task` as an id: the claim's generation, for a session this machine has no state for. */
  readonly generation?: number;
  /**
   * The credential to act with for {@link harness} — a background save's,
   * handed to it on stdin (P2-10). Its child process has no token on disk
   * or in its environment when the agent was logged in by environment only.
   */
  readonly credential?: AgentCredential;
}

/**
 * The live claim this save is under: one held by an agent session on this
 * machine (the session helper's state, refreshed by every heartbeat), on the
 * task the branch is named after.
 */
export async function resolveTarget(
  deps: CheckpointDeps,
  branch: string,
  query: ClaimQuery,
): Promise<Target> {
  if (query.generation !== undefined) {
    if (query.task === undefined || !isLaikaId(query.task)) {
      throw new Refusal('--generation needs --task <task id>', 'bad_arguments');
    }
    const harness = query.harness ?? onlyHarness(deps);
    const credential = readCredential(deps.home, harness, deps.env);
    if (credential === undefined) throw noCredential(harness);
    const task = await taskInfo(deps, credential, query.task);
    if (task === undefined) throw new Refusal(`the board has no task ${query.task}`, 'no_task');
    if (!branchIsTasks(branch, task)) throw notTasksBranch(branch, task);
    return { harness, credential, task, generation: query.generation };
  }

  const states = listStates(deps.home).filter(
    (s) =>
      s.status === 'live' &&
      (query.harness === undefined || s.harness === query.harness) &&
      (query.harnessSessionId === undefined || s.harness_session_id === query.harnessSessionId),
  );
  const seen: TaskInfo[] = [];
  for (const state of states) {
    const credential =
      query.credential !== undefined && state.harness === query.harness
        ? query.credential
        : readCredential(deps.home, state.harness, deps.env);
    if (credential === undefined) continue;
    for (const claim of state.claims.slice(0, 20)) {
      if (!isLaikaId(claim.task_id) || !Number.isSafeInteger(claim.generation)) continue;
      const task = await taskInfo(deps, credential, claim.task_id);
      if (task === undefined) continue;
      seen.push(task);
      const asked = query.task ?? '';
      const named =
        query.task === undefined ||
        [task.id, task.key.toUpperCase(), task.externalRef?.toUpperCase()].includes(
          /^[0-9A-HJKMNP-TV-Z]{26}$/.test(asked) ? asked : asked.toUpperCase(),
        );
      if (named && branchIsTasks(branch, task)) {
        return { harness: state.harness, credential, task, generation: claim.generation };
      }
    }
  }
  const held = seen.map((t) => t.segment).join(', ');
  throw new Refusal(
    `no agent session on this machine holds a live claim on the task branch ${branch} is for` +
      `${held === '' ? '' : ` (sessions here hold: ${held})`}. Claim it with start_working and the ` +
      'session id, then save again; the helper learns a new claim at its next heartbeat (≤30 s).',
    'no_claim',
  );
}

function onlyHarness(deps: CheckpointDeps): Harness {
  const saved = HARNESSES.filter((h) => readCredential(deps.home, h, deps.env) !== undefined);
  if (saved.length === 1 && saved[0] !== undefined) return saved[0];
  throw new Refusal(`name the harness: --harness ${HARNESSES.join('|')}`, 'bad_arguments');
}

const noCredential = (harness: Harness): Refusal =>
  new Refusal(
    `no agent token for ${harness}: run \`laika agent login ${harness}\` first`,
    'no_credential',
  );

const notTasksBranch = (branch: string, task: TaskInfo): Refusal =>
  new Refusal(
    `${branch} is not ${task.segment}'s branch: a checkpoint saves only the task's own branch, ` +
      `named ${task.segment}-short-name`,
    'not_task_branch',
  );

/* -------------------------------------------------------------------------- */
/* The lock                                                                   */
/* -------------------------------------------------------------------------- */

const LOCK_STALE_MS = 10 * 60_000;

/** One save at a time per worktree, beside its git dir. A lock older than ten minutes is a crashed save's. */
function takeLock(wt: Worktree, now: number): () => void {
  const path = join(wt.gitDir, 'laika-checkpoint.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      closeSync(openSync(path, 'wx', 0o600));
      return () => rmSync(path, { force: true });
    } catch {
      try {
        if (now - statSync(path).mtimeMs < LOCK_STALE_MS) break;
        rmSync(path, { force: true });
      } catch {
        break;
      }
    }
  }
  throw new Refusal(
    `another checkpoint is being saved in ${wt.top} (${path}); nothing was done`,
    'checkpoint_busy',
  );
}

/* -------------------------------------------------------------------------- */
/* Saving                                                                     */
/* -------------------------------------------------------------------------- */

export interface SaveOptions {
  readonly cwd: string;
  readonly auto: boolean;
  readonly note?: Note;
  readonly files?: readonly string[];
  readonly claim: ClaimQuery;
  readonly maxFileBytes?: number;
  /**
   * An automatic save's hold on the session's tools (P1-7, round-2 #2).
   * `acquire` takes the interlock right before staging and throws if a tool
   * is running; `check` throws when a tool has started or the save's time
   * budget is nearly spent, and is asked right before the commit; `release`
   * lets `PreToolUse` go, after the commit or on any way out.
   */
  readonly interlock?: {
    readonly acquire: () => void;
    readonly check: () => void;
    readonly release: () => void;
  };
}

export type SaveOutcome =
  | { readonly kind: 'saved'; readonly record: CheckpointRecord }
  /** Nothing new, and the save it matches was already registered. */
  | { readonly kind: 'unchanged'; readonly record: CheckpointRecord }
  /**
   * Nothing new, and the save it matches was **not** registered when this
   * run began: it was retried, with its own key and body, and `record` says
   * where that left it (P2-9).
   */
  | { readonly kind: 'retried'; readonly record: CheckpointRecord };

/**
 * One save, start to finish. Every refusal is thrown as a {@link Refusal}
 * **before** the step that would have changed something: a refused file
 * stages nothing, a busy repo is not touched, a protected branch is never
 * committed to or pushed.
 */
export async function save(deps: CheckpointDeps, options: SaveOptions): Promise<SaveOutcome> {
  const git = deps.git;
  const wt = worktreeAt(git, options.cwd);
  assertIsolated(git, wt);
  assertNotBusy(wt);
  const branch = currentBranch(git, wt);
  const remote = remoteFor(git, wt, branch);
  const def = remoteDefault(git, wt, remote);
  assertWorkBranch(branch, def);
  const repo = repoName(git, wt, remote);
  const target = await resolveTarget(deps, branch, options.claim);

  // An earlier save that pushed and did not register is finished first —
  // same key, same body — so a save of the same commit reports what that
  // one is now, rather than "nothing new" over an unregistered checkpoint.
  const unfinished = new Set(
    listRecords(deps.home)
      .filter((r) => r.stage !== 'registered' && r.stage !== 'refused')
      .map((r) => r.id),
  );
  await retryPending(deps, { harness: target.harness, credential: target.credential });

  const release = takeLock(wt, deps.now());
  let record: CheckpointRecord;
  try {
    // Asked again under the lock: git may have started while the board answered.
    assertNotBusy(wt);
    const before = git(wt.top, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']).stdout.trim();
    const id = ulid(deps.now());
    const segment = target.task.segment;
    // Held from here to the commit, and only that: nothing below until the
    // commit touches the network, so the budget bounds local git work alone.
    options.interlock?.acquire();
    const snapshot = indexSnapshot(git, wt);
    const staged = stageSafely(git, wt, {
      ...(options.files === undefined ? {} : { add: options.files }),
      maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    });
    await deps.onPhase?.('staged');
    try {
      options.interlock?.check();
    } catch (cause) {
      // A tool started while this was staging, or the budget ran out: what
      // was staged is not this save's to commit. Put the index back exactly
      // as it was for these paths — the person's own staging included.
      restoreIndex(git, wt, snapshot, staged);
      throw cause;
    }
    const committed = commitStaged(
      git,
      wt,
      `checkpoint(${segment}): work in progress\n\nLaika checkpoint ${id}${options.auto ? ' (automatic)' : ''}.`,
    );
    options.interlock?.release();
    const sha = committed ?? headSha(git, wt);

    if (committed === undefined) {
      const last = listRecords(deps.home).find(
        (r) => r.task_id === target.task.id && r.commit_sha === sha && r.stage !== 'refused',
      );
      if (last !== undefined && options.note === undefined) {
        return { kind: unfinished.has(last.id) ? 'retried' : 'unchanged', record: last };
      }
    }

    // The note: given now, it describes this save. Kept from earlier, it
    // describes the save made from the HEAD it was written over, or else
    // the save that first carried it — which the board then labels stale.
    let summary: Note | null = null;
    let summaryCommitSha: string | null = null;
    if (options.note !== undefined) {
      summary = options.note;
      summaryCommitSha = sha;
      writeNote(deps.home, wt.top, { summary, head: sha, described: sha });
    } else {
      const stored = readNote(deps.home, wt.top);
      if (stored !== undefined && Object.keys(stored.summary).length > 0) {
        summary = stored.summary;
        if (stored.described === undefined && stored.head === before) {
          summaryCommitSha = sha;
          writeNote(deps.home, wt.top, { ...stored, described: sha });
        } else {
          summaryCommitSha =
            stored.described ?? (/^[0-9a-f]{40}$/.test(stored.head) ? stored.head : null);
          if (summaryCommitSha === null) summary = null;
        }
      }
    }

    record = {
      version: 1,
      id,
      idempotency_key: `laika-ckpt-${id}`,
      harness: target.harness,
      url: target.credential.url,
      task_id: target.task.id,
      task_segment: segment,
      generation: target.generation,
      worktree: wt.top,
      remote,
      ...(def === undefined ? {} : { remote_default: def }),
      repo,
      branch,
      commit_sha: sha,
      tag_ref: `${TAG_PREFIX}${segment}/${id}`,
      manifest: manifestOf(git, wt, sha, remote, def),
      summary,
      summary_commit_sha: summaryCommitSha,
      auto: options.auto,
      created_at: deps.now(),
      stage: 'committed',
      attempts: 0,
      retags: [],
    };
    // On disk before anything leaves the machine.
    writeRecord(deps.home, record);
    log(deps.home, `checkpoint ${id} committed ${sha} on ${branch}`);

    try {
      pushBranch(git, wt, remote, branch, sha);
      record.stage = 'branch_pushed';
      writeRecord(deps.home, record);
      pushTag(git, wt, remote, sha, record.tag_ref);
      record.stage = 'tag_pushed';
      writeRecord(deps.home, record);
    } catch (cause) {
      settleRefusedPush(deps.home, record, cause);
      throw cause;
    }
    log(deps.home, `checkpoint ${id} pushed ${branch} and ${record.tag_ref}`);
  } finally {
    // A refusal after the record exists leaves it for the next run to finish.
    options.interlock?.release();
    release();
  }
  await register(deps, record, target.credential);
  return { kind: 'saved', record };
}

/**
 * A push the remote **refused** — it moved on, or a ruleset said no — will be
 * refused again, so the record stops there rather than being retried for
 * ever. A push that could not reach the remote stays to be retried.
 */
function settleRefusedPush(home: string, record: CheckpointRecord, cause: unknown): void {
  record.last_error = cause instanceof Error ? cause.message.slice(0, 300) : 'error';
  if (cause instanceof Refusal && cause.code !== 'push_failed' && cause.code !== 'git_busy') {
    record.stage = 'refused';
  }
  writeRecord(home, record);
}

/**
 * `POST /tasks/:id/checkpoints`, with the record's own key and body. A
 * failure the board may not have seen leaves the record to be sent again.
 */
export async function register(
  deps: CheckpointDeps,
  record: CheckpointRecord,
  credential: AgentCredential,
): Promise<CheckpointRecord> {
  record.attempts += 1;
  const result = await callBoard(
    deps.fetch,
    credential,
    `/api/v1/tasks/${encodeURIComponent(record.task_id)}/checkpoints`,
    registrationBody(record),
    { 'X-Laika-Claim-Generation': String(record.generation) },
  );
  if (result.kind === 'ok' && isRecord(result.body) && result.body.id === record.id) {
    record.stage = 'registered';
    record.verification =
      typeof result.body.verification === 'string' ? result.body.verification : 'pending';
    delete record.last_error;
    if (result.body.remote_ref !== record.tag_ref || result.body.commit_sha !== record.commit_sha) {
      record.last_error = `the board recorded ${String(result.body.remote_ref)} at ${String(result.body.commit_sha)}, not what was pushed`;
    }
    writeRecord(deps.home, record);
    log(deps.home, `checkpoint ${record.id} registered (${describe(result)})`);
    return record;
  }
  record.last_error = describe(result);
  if (!retryable(result)) record.stage = 'refused';
  writeRecord(deps.home, record);
  log(deps.home, `checkpoint ${record.id} register: ${describe(result)} -> ${record.stage}`);
  return record;
}

/**
 * Finish whatever an earlier run left: a push not yet made, a tag not yet
 * pushed, a registration not yet answered, a re-tag registered but not
 * pushed. Same key, same body, same ref — never a new checkpoint.
 */
export async function retryPending(
  deps: CheckpointDeps,
  using?: { readonly harness: Harness; readonly credential: AgentCredential },
): Promise<CheckpointRecord[]> {
  const done: CheckpointRecord[] = [];
  for (const record of listRecords(deps.home).slice(0, 50)) {
    const unpushedRetag = record.retags.find((r) => !r.pushed);
    if (record.stage === 'registered' && unpushedRetag === undefined) continue;
    if (record.stage === 'refused') continue;
    // The credential the caller was handed wins for its own harness (P2-10):
    // a background save has no token on disk or in its environment to read.
    const credential =
      using?.harness === record.harness && using.credential.url === record.url
        ? using.credential
        : readCredential(deps.home, record.harness, deps.env);
    if (credential?.url !== record.url) continue;
    try {
      if (record.stage === 'committed' || record.stage === 'branch_pushed' || unpushedRetag) {
        const wt = worktreeAt(deps.git, record.worktree);
        assertNotBusy(wt);
        const release = takeLock(wt, deps.now());
        try {
          if (record.stage === 'committed') {
            pushBranch(deps.git, wt, record.remote, record.branch, record.commit_sha);
            record.stage = 'branch_pushed';
            writeRecord(deps.home, record);
          }
          if (record.stage === 'branch_pushed') {
            pushTag(deps.git, wt, record.remote, record.commit_sha, record.tag_ref);
            record.stage = 'tag_pushed';
            writeRecord(deps.home, record);
          }
          if (unpushedRetag !== undefined && record.stage === 'registered') {
            pushTag(deps.git, wt, record.remote, record.commit_sha, unpushedRetag.ref);
            unpushedRetag.pushed = true;
            writeRecord(deps.home, record);
          }
        } finally {
          release();
        }
      }
      if (record.stage === 'tag_pushed') await register(deps, record, credential);
      done.push(record);
    } catch (cause) {
      settleRefusedPush(deps.home, record, cause);
    }
  }
  return done;
}

/* -------------------------------------------------------------------------- */
/* Verification, as the board says it                                         */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PENDING_NOTICE_MS = 10 * 60_000;

export function pendingNoticeMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS;
  return raw !== undefined && /^\d{1,6}$/.test(raw)
    ? Number(raw) * 1000
    : DEFAULT_PENDING_NOTICE_MS;
}

export const PENDING = 'Verification pending';
export const PENDING_LONG = 'Verification pending — no push notice from GitHub yet';
export const REDELIVER_HINT =
  "Check the GitHub webhook's Recent Deliveries and use Redeliver (an admin of the repository, within 3 days), " +
  'or run `laika agent checkpoint reverify <id>` to push a fresh tag at the same commit.';

/**
 * §4.70's wording for a checkpoint's state. `ageMs` is how long it has been
 * pending **by the board's clock** (its `Date` header less `pending_since`),
 * so a laptop whose clock is wrong does not say ten minutes early or late.
 */
export function verificationLines(
  verification: string | undefined,
  ageMs: number | undefined,
  noticeMs: number,
): string[] {
  switch (verification) {
    case 'verified':
      return ['Verified'];
    case 'pending':
      return ageMs !== undefined && ageMs >= noticeMs ? [PENDING_LONG, REDELIVER_HINT] : [PENDING];
    case 'uncertain':
      return [
        'Save needs attention — GitHub’s notices do not match a single clean save',
        'Run `laika agent checkpoint reverify <id>` to push a fresh tag at the same commit.',
      ];
    case 'ref_deleted':
      return ['Save removed from GitHub'];
    default:
      return [PENDING];
  }
}

interface BoardCheckpoint {
  readonly verification?: string;
  readonly pending_since?: number | null;
}

async function boardCheckpoints(
  deps: CheckpointDeps,
  credential: AgentCredential,
  taskId: string,
): Promise<{ byId: Map<string, BoardCheckpoint>; date: number | undefined } | undefined> {
  const r = await get(deps, credential, `/api/v1/tasks/${encodeURIComponent(taskId)}/checkpoints`);
  if (r.kind !== 'ok' || !isRecord(r.body) || !Array.isArray(r.body.data)) return undefined;
  const byId = new Map<string, BoardCheckpoint>();
  for (const c of r.body.data.slice(0, 500)) {
    if (!isRecord(c) || !isLaikaId(c.id)) continue;
    byId.set(c.id, {
      ...(typeof c.verification === 'string' ? { verification: c.verification } : {}),
      pending_since: typeof c.pending_since === 'number' ? c.pending_since : null,
    });
  }
  return { byId, date: r.date };
}

export async function statusLines(deps: CheckpointDeps, limit = 10): Promise<string[]> {
  await retryPending(deps);
  const records = listRecords(deps.home).slice(0, limit);
  if (records.length === 0) return ['No checkpoints saved from this machine.'];
  const noticeMs = pendingNoticeMs(deps.env);
  const boards = new Map<string, Awaited<ReturnType<typeof boardCheckpoints>>>();
  const lines: string[] = [];
  for (const r of records) {
    lines.push(
      `${r.id} ${r.task_segment} ${r.commit_sha.slice(0, 12)} on ${r.branch}${r.auto ? ' (automatic)' : ''}`,
    );
    if (r.stage === 'registered') {
      const credential = readCredential(deps.home, r.harness, deps.env);
      const cacheKey = `${r.harness} ${r.task_id}`;
      if (credential !== undefined && !boards.has(cacheKey)) {
        boards.set(cacheKey, await boardCheckpoints(deps, credential, r.task_id));
      }
      const board = boards.get(cacheKey);
      const seen = board?.byId.get(r.id);
      const verification = seen?.verification ?? r.verification;
      const since = seen?.pending_since ?? undefined;
      // The `Date` header is whole seconds, so a fresh save can read a few
      // hundred milliseconds "before" its own `pending_since`.
      const age =
        since === undefined || since === null
          ? undefined
          : Math.max(0, (board?.date ?? deps.now()) - since);
      for (const line of verificationLines(verification, age, noticeMs)) {
        lines.push(`  ${line.replace('<id>', r.id)}`);
      }
      if (seen?.verification !== undefined && seen.verification !== r.verification) {
        r.verification = seen.verification;
        writeRecord(deps.home, r);
      }
    } else if (r.stage === 'refused') {
      lines.push(`  Not registered: the board refused it (${r.last_error ?? 'unknown'})`);
    } else {
      lines.push(
        `  Saved here, not registered yet (${r.stage.replace('_', ' ')}) — retried by the next save, status or hook` +
          `${r.last_error === undefined ? '' : `; last: ${r.last_error}`}`,
      );
    }
    for (const t of r.retags) {
      lines.push(`  re-tag r${String(t.revision)}: ${t.ref}${t.pushed ? '' : ' (not pushed yet)'}`);
    }
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Re-tagging (D-116 item 7)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Register the next ref, `…/<id>-r<n>`, **then** push it alone at the same
 * commit (§4.71: the server registers a re-tag before its push). The board
 * names the ref; it is pushed only when it is exactly the shape expected.
 */
export async function reverify(
  deps: CheckpointDeps,
  id: string,
): Promise<{ record: CheckpointRecord; retag: Retag }> {
  const record = readRecord(deps.home, id);
  if (record === undefined) {
    throw new Refusal(`no checkpoint ${id} was saved from this machine`, 'no_record');
  }
  if (record.stage !== 'registered') {
    throw new Refusal(
      `checkpoint ${id} is not registered yet (${record.stage}); run \`laika agent checkpoint status\` to retry it`,
      'not_registered',
    );
  }
  const credential = readCredential(deps.home, record.harness, deps.env);
  if (credential === undefined) throw noCredential(record.harness);
  const wt = worktreeAt(deps.git, record.worktree);
  assertNotBusy(wt);

  const result = await callBoard(
    deps.fetch,
    credential,
    `/api/v1/checkpoints/${encodeURIComponent(id)}/refs`,
  );
  if (result.kind !== 'ok' || !isRecord(result.body)) {
    throw new Refusal(`the board did not register a re-tag: ${describe(result)}`, 'retag_refused');
  }
  const revision = result.body.revision;
  const ref = result.body.ref;
  if (!Number.isSafeInteger(revision) || ref !== `${record.tag_ref}-r${String(revision)}`) {
    throw new Refusal(
      `the board answered a ref of an unexpected shape: ${String(ref)}`,
      'retag_refused',
    );
  }
  const retag: Retag = { ref, revision: revision as number, pushed: false };
  record.retags.push(retag);
  record.verification =
    typeof result.body.verification === 'string' ? result.body.verification : 'pending';
  writeRecord(deps.home, record);

  const release = takeLock(wt, deps.now());
  try {
    pushTag(deps.git, wt, record.remote, record.commit_sha, ref);
  } finally {
    release();
  }
  retag.pushed = true;
  writeRecord(deps.home, record);
  log(deps.home, `checkpoint ${id} re-tagged ${ref}`);
  return { record, retag };
}

/* -------------------------------------------------------------------------- */
/* Prune — a list, never a deletion (D-115 item 9, D-116 item 2)              */
/* -------------------------------------------------------------------------- */

export const DEFAULT_RETENTION_DAYS = 90;

/**
 * The `laika-ckpt/` tags on the remote whose task reached `done` or
 * `cancelled` at least `days` ago, by the board's own record. **Deletes
 * nothing** — there is no code here that could — and a tag whose task the
 * board does not show, or that is still open, is never listed.
 */
export async function pruneCandidates(
  deps: CheckpointDeps,
  cwd: string,
  credential: AgentCredential,
  remote: string,
  days: number,
): Promise<{ due: string[]; kept: number }> {
  const wt = worktreeAt(deps.git, cwd);
  const r = deps.git(wt.top, ['ls-remote', '--refs', '--', remote]);
  if (r.code !== 0) throw new Refusal(`could not list ${remote}'s tags`, 'ls_remote_failed');
  const tags = r.stdout
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .filter((ref) => ref.startsWith(TAG_PREFIX));

  const closed = new Map<string, number>();
  for (const status of ['done', 'cancelled']) {
    let cursor: string | undefined;
    for (let page = 0; page < 200; page += 1) {
      const result = await get(
        deps,
        credential,
        `/api/v1/tasks?status=${status}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      if (result.kind !== 'ok' || !isRecord(result.body) || !Array.isArray(result.body.data)) {
        throw new Refusal(
          `the board did not list ${status} tasks: ${describe(result)}`,
          'board_failed',
        );
      }
      for (const t of result.body.data) {
        if (!isRecord(t) || typeof t.key !== 'string') continue;
        const at = typeof t.completed_at === 'number' ? t.completed_at : t.updated_at;
        if (typeof at !== 'number') continue;
        const externalRef = typeof t.external_ref === 'string' ? t.external_ref : null;
        closed.set(segmentOf(t.key, externalRef).toUpperCase(), at);
      }
      const next = result.body.next_cursor;
      if (typeof next !== 'string' || next === '') break;
      cursor = next;
    }
  }

  const cutoff = deps.now() - days * 86_400_000;
  const due = tags.filter((ref) => {
    const segment = ref.slice(TAG_PREFIX.length).split('/')[0]?.toUpperCase() ?? '';
    const at = closed.get(segment);
    return at !== undefined && at <= cutoff;
  });
  return { due: due.sort(), kept: tags.length - due.length };
}

/* -------------------------------------------------------------------------- */
/* Consent (§4.75)                                                            */
/* -------------------------------------------------------------------------- */

export async function consentGiven(
  deps: CheckpointDeps,
  credential: AgentCredential,
  agentId: string,
): Promise<boolean | undefined> {
  const r = await get(
    deps,
    credential,
    `/api/v1/agents/${encodeURIComponent(agentId)}/checkpoint-consent`,
  );
  if (r.kind !== 'ok' || !isRecord(r.body)) return undefined;
  return r.body.given === true;
}

/* -------------------------------------------------------------------------- */
/* Activity and the automatic trigger                                         */
/* -------------------------------------------------------------------------- */

/** Tool calls that can change files. Reading, searching and fetching never count. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Bash',
  'apply_patch',
  'shell',
  'local_shell',
  'exec_command',
  'write_stdin',
]);

export const TRIGGER_MUTATIONS = 10;
export const TRIGGER_MS = 2 * 60_000;

export interface Activity {
  mutations: number;
  first_mutation_at?: number;
  last_save_at?: number;
  last_attempt_at?: number;
  cwd?: string;
}

export function readActivity(home: string, harness: Harness, id: string): Activity {
  const value = readJson(activityPath(home, harness, id));
  if (!isRecord(value) || typeof value.mutations !== 'number') return { mutations: 0 };
  return value as unknown as Activity;
}

export function writeActivity(
  home: string,
  harness: Harness,
  id: string,
  activity: Activity,
): void {
  writeJson(home, activityDir(home), activityPath(home, harness, id), activity);
}

const markerName = (key: string): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 32);

/** The harness process a tool runs in: the marker's proof of life (P1-8). */
export interface MarkerOwner {
  readonly pid: number;
  readonly started: string;
}

/**
 * `PreToolUse`: a tool is running, **in this harness process**. Removed by
 * its `PostToolUse` or `PostToolUseFailure`, or at a `Stop` that shows it is
 * done ({@link reconcileAtStop}). `agent` is the subagent it runs in, when
 * the harness says so: a subagent's tools outlive the main turn's `Stop`.
 */
export function markInflight(
  home: string,
  harness: Harness,
  id: string,
  key: string,
  owner: MarkerOwner,
  agent?: string,
): void {
  const dir = inflightDir(home, harness, id);
  privateDir(join(home, '.laika'));
  privateDir(checkpointsDir(home));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, markerName(key)),
    JSON.stringify({
      pid: owner.pid,
      started: owner.started,
      ...(agent === undefined ? {} : { agent }),
    }),
    { mode: 0o600 },
  );
}

export function clearInflight(home: string, harness: Harness, id: string, key: string): void {
  rmSync(join(inflightDir(home, harness, id), markerName(key)), { force: true });
}

/** One entry of Claude Code's `Stop` `background_tasks`, as documented. */
export interface BackgroundTask {
  readonly id?: string;
  readonly type?: string;
  readonly status?: string;
}

/**
 * Statuses that mean a task has stopped. The docs name the field ("current
 * task status") and describe each entry as in flight, but do not list its
 * values, so **only these** count as finished; anything else, or nothing,
 * is a task still running.
 */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'complete',
  'done',
  'finished',
  'succeeded',
  'success',
  'failed',
  'error',
  'errored',
  'killed',
  'stopped',
  'cancelled',
  'canceled',
  'exited',
]);

const isTerminal = (task: BackgroundTask): boolean =>
  task.status !== undefined && TERMINAL_TASK_STATUSES.has(task.status.toLowerCase());

/**
 * `Stop`, from a harness that says what still runs (round-2 #4, round-3 #2).
 * Claude Code's `Stop` input carries `background_tasks`: one entry per task
 * in flight, `{ id, type, status, description, … }`
 * (code.claude.com/docs/en/hooks#stop-input), and an empty list when
 * nothing is. When the main turn stops, its foreground tools have finished,
 * but a background shell, subagent or monitor may still be writing. So:
 *
 * - **any task not known to be finished** — a status outside
 *   {@link TERMINAL_TASK_STATUSES}, or none — and **nothing is cleared**;
 *   each such task gets a marker of its own, so a save waits for it;
 * - **every task finished, or none listed**: the main turn's markers are
 *   finished tools — one whose `PostToolUse` never fired, an earlier
 *   task's — and go;
 * - a subagent's marker stays either way: its tools are not the main turn's.
 *
 * A `Stop` that does not carry the list (Codex's, an older Claude Code's)
 * calls nothing here: a live marker is never cleared on a guess.
 */
export function reconcileAtStop(
  home: string,
  harness: Harness,
  id: string,
  owner: MarkerOwner,
  tasks: readonly BackgroundTask[],
): void {
  const running = tasks.filter((task) => !isTerminal(task));
  if (running.length > 0) {
    // Every running task was looked at; one marker is enough to hold a save
    // off, so at most 200 files are written however long the list.
    for (const task of running.slice(0, 200)) {
      if (task.id !== undefined) {
        markInflight(home, harness, id, `bg:${task.type ?? ''}:${task.id}`, owner);
      }
    }
    // A running task with no id to key it by — or a list too long to judge,
    // which stands as one such task (round-5 #2) — still holds saves off:
    // one session-level marker, cleared only by a later Stop whose list is
    // readable and empty or all finished.
    if (running.some((task) => task.id === undefined)) {
      markInflight(home, harness, id, 'bg:unidentified-running', owner);
    }
    return;
  }
  const dir = inflightDir(home, harness, id);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const value = readJson(join(dir, name));
    if (isRecord(value) && typeof value.agent === 'string') continue;
    rmSync(join(dir, name), { force: true });
  }
}

const INTERLOCK = '.saving';

/**
 * The longest an automatic save may hold the interlock: staging, the checks
 * and the commit, nothing on the network (P1-7, round-2 #2). `PreToolUse`
 * waits no longer than the deadline this sets, plus {@link INTERLOCK_GRACE_MS}.
 */
export const SAVE_BUDGET_MS = 10_000;
export const INTERLOCK_GRACE_MS = 1_000;
/** `ps -o lstart=` is whole seconds; a start this close is the same process. */
const START_TOLERANCE_MS = 2_000;

/** The interlock's holder: the saving process (PID **and** start time) and its deadline. */
export interface InterlockHolder {
  readonly pid: number;
  readonly started_ms: number;
  readonly deadline: number;
}

function interlockHolder(path: string): InterlockHolder | undefined {
  const value = readJson(path);
  if (!isRecord(value)) return undefined;
  const { pid, started_ms: started, deadline } = value;
  return Number.isSafeInteger(pid) &&
    (pid as number) > 0 &&
    typeof started === 'number' &&
    Number.isFinite(started) &&
    typeof deadline === 'number' &&
    Number.isFinite(deadline)
    ? { pid: pid as number, started_ms: started, deadline }
    : undefined;
}

/** This process's start time, from its own uptime: no process-table read to time out. */
const selfStartedMs = (): number => Date.now() - process.uptime() * 1000;

/**
 * Whether the holder is still the process that took the interlock — the
 * same liveness rule as the markers (P1-8): **a PID alone is not a holder**,
 * since the OS hands a freed PID to the next process. Dead on evidence only:
 * the kernel has no such PID, or the PID's start time is another process's.
 * A `ps` that cannot answer is `unknown`, which holds — waiting, never racing.
 */
function holderState(
  h: InterlockHolder,
  probe: Probe,
  proc: ProcReader,
): 'alive' | 'dead' | 'unknown' {
  if (probe(h.pid) === 'absent') return 'dead';
  if (h.pid === process.pid) {
    return Math.abs(selfStartedMs() - h.started_ms) <= START_TOLERANCE_MS ? 'alive' : 'dead';
  }
  const info = proc(h.pid);
  if (info === UNKNOWN) return 'unknown';
  if (info === undefined || isDeadState(info.state)) return 'dead';
  const started = Date.parse(info.started.trim());
  if (!Number.isFinite(started)) return 'unknown';
  return Math.abs(started - h.started_ms) <= START_TOLERANCE_MS ? 'alive' : 'dead';
}

export type InterlockRelease = (() => void) & { readonly deadline: number };

/**
 * An automatic save's interlock (P1-7): held from just before staging until
 * the commit, never across the network. `PreToolUse` writes its marker and
 * then waits while it is held — until the holder's deadline and a second of
 * grace, then it **denies** the tool rather than let it race — and the save
 * asks for markers again under it, so a tool that starts after the quiet
 * check either waits for the commit or stops the save before it commits.
 */
export function takeSaveInterlock(
  home: string,
  harness: Harness,
  id: string,
  options: { budgetMs?: number; probe?: Probe; proc?: ProcReader } = {},
): InterlockRelease {
  const probe = options.probe ?? probeKill;
  const proc = options.proc ?? readProc;
  const budget = Math.max(100, Math.min(SAVE_BUDGET_MS, options.budgetMs ?? SAVE_BUDGET_MS));
  const dir = inflightDir(home, harness, id);
  privateDir(join(home, '.laika'));
  privateDir(checkpointsDir(home));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, INTERLOCK);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const holder: InterlockHolder = {
      pid: process.pid,
      started_ms: selfStartedMs(),
      deadline: Date.now() + budget,
    };
    try {
      writeFileSync(path, JSON.stringify(holder), { mode: 0o600, flag: 'wx' });
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        const now = interlockHolder(path);
        if (now?.pid === holder.pid && now.started_ms === holder.started_ms) {
          rmSync(path, { force: true });
        }
      };
      return Object.assign(release, { deadline: holder.deadline });
    } catch {
      const current = interlockHolder(path);
      // A file in no shape this writes is nobody's: taken over, as a dead holder's is.
      if (current !== undefined && holderState(current, probe, proc) !== 'dead') break;
      rmSync(path, { force: true });
    }
  }
  throw new Refusal('another automatic save holds this session’s interlock', 'checkpoint_busy');
}

/** The live holder of the session's save interlock, or `undefined` when nothing holds it. */
export function interlockHolderOf(
  home: string,
  harness: Harness,
  id: string,
  probe: Probe = probeKill,
  proc: ProcReader = readProc,
): InterlockHolder | undefined {
  const path = join(inflightDir(home, harness, id), INTERLOCK);
  if (!existsSync(path)) return undefined;
  const holder = interlockHolder(path);
  return holder !== undefined && holderState(holder, probe, proc) !== 'dead' ? holder : undefined;
}

/** Whether a live process holds the session's save interlock. */
export function interlockHeld(
  home: string,
  harness: Harness,
  id: string,
  probe: Probe = probeKill,
  proc: ProcReader = readProc,
): boolean {
  return interlockHolderOf(home, harness, id, probe, proc) !== undefined;
}

/**
 * The longest `PreToolUse` waits for a save, whatever a lock file says: it
 * must stay inside the hook's own timeout (30 s), or the harness would kill
 * the hook and run the tool anyway.
 */
export const PRE_TOOL_WAIT_MS = 20_000;

/**
 * What `PreToolUse` does about a save in progress (round-2 #2): wait while a
 * live save holds the interlock — until it lets go, or its deadline and
 * {@link INTERLOCK_GRACE_MS} have passed — and then `deny` if it still
 * holds it. **A tool never starts while a live save holds the interlock**:
 * it waits for the commit, or it is refused and the model is told to retry.
 */
export function awaitSave(
  home: string,
  harness: Harness,
  id: string,
  pause: (ms: number) => void,
  probe: Probe = probeKill,
  proc: ProcReader = readProc,
): 'clear' | 'deny' {
  const cap = Date.now() + PRE_TOOL_WAIT_MS;
  const path = join(inflightDir(home, harness, id), INTERLOCK);
  let holder = interlockHolderOf(home, harness, id, probe, proc);
  while (holder !== undefined) {
    if (Date.now() >= Math.min(holder.deadline + INTERLOCK_GRACE_MS, cap)) return 'deny';
    pause(100);
    // Cheap while it is the same holder: the file and the kernel, no `ps`.
    const now = interlockHolder(path);
    const same = now?.pid === holder.pid && now.started_ms === holder.started_ms;
    holder =
      same && probe(holder.pid) !== 'absent'
        ? holder
        : interlockHolderOf(home, harness, id, probe, proc);
  }
  return 'clear';
}

function markerOwner(path: string): MarkerOwner | undefined {
  const value = readJson(path);
  return isRecord(value) &&
    Number.isSafeInteger(value.pid) &&
    (value.pid as number) > 0 &&
    typeof value.started === 'string'
    ? { pid: value.pid as number, started: value.started }
    : undefined;
}

/**
 * Tools still running in this harness session. **Age proves nothing**: a
 * build can run for an hour. A marker is stale only on evidence — its
 * harness process is gone, or its PID now belongs to another process (the
 * start time differs). A live harness, or one whose liveness cannot be told,
 * or a marker with no owner on it, counts as a tool still running.
 */
export function inflight(
  home: string,
  harness: Harness,
  id: string,
  proc: ProcReader = readProc,
): number {
  const dir = inflightDir(home, harness, id);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    const owner = markerOwner(path);
    if (owner !== undefined && liveness(owner.pid, owner.started, proc) === 'dead') {
      rmSync(path, { force: true });
      continue;
    }
    if (existsSync(path)) count += 1;
  }
  return count;
}

/**
 * Whether the hook should start a save: after ~10 mutating calls, or ~2
 * minutes after the first unsaved one; at `Stop` and session end whenever
 * anything is unsaved. Never twice inside two minutes of the last attempt,
 * so a save that keeps being refused is not retried on every tool call.
 */
export function shouldTrigger(activity: Activity, now: number, boundary: boolean): boolean {
  if (activity.mutations < 1) return false;
  if (
    activity.last_attempt_at !== undefined &&
    now - activity.last_attempt_at < TRIGGER_MS &&
    !boundary
  ) {
    return false;
  }
  if (boundary) return true;
  if (activity.mutations >= TRIGGER_MUTATIONS) return true;
  const since = activity.first_mutation_at ?? now;
  return now - since >= TRIGGER_MS;
}

/** Refusals that mean "not now" rather than "not this": the next trigger tries again. */
const BUSY_CODES: ReadonlySet<string> = new Set(['tool_started', 'save_budget', 'checkpoint_busy']);

export type AutoOutcome =
  | 'saved'
  | 'unchanged'
  | 'retried'
  | 'no_session'
  | 'no_consent'
  | 'consent_unknown'
  | 'busy'
  | 'refused'
  | 'nothing';

/**
 * What an automatic save came to, **with the record it made or matched**
 * (LAI-552): a caller that reports or offers the save names exactly this
 * one, never "the newest record" — a session holding two tasks has two.
 */
export interface AutoResult {
  readonly outcome: AutoOutcome;
  /** Present for `saved`, `unchanged` and `retried`: the save's own record. */
  readonly record?: CheckpointRecord;
}

/** {@link autoCheckpointResult}'s outcome alone, for callers that need only that. */
export async function autoCheckpoint(
  deps: CheckpointDeps,
  harness: Harness,
  harnessSessionId: string,
  credential: AgentCredential,
  quietMs = 30_000,
): Promise<AutoOutcome> {
  return (await autoCheckpointResult(deps, harness, harnessSessionId, credential, quietMs)).outcome;
}

/**
 * The background save a hook starts. **Consent first**, from the board,
 * every time; then quiet — no tool in flight in this harness session and no
 * git operation — waiting up to `quietMs` and giving up rather than racing.
 */
export async function autoCheckpointResult(
  deps: CheckpointDeps,
  harness: Harness,
  harnessSessionId: string,
  credential: AgentCredential,
  quietMs = 30_000,
): Promise<AutoResult> {
  const activity = readActivity(deps.home, harness, harnessSessionId);
  if (activity.mutations < 1 || activity.cwd === undefined) return { outcome: 'nothing' };
  const session: SessionState | undefined = readState(
    statePath(deps.home, harness, harnessSessionId),
  );
  if (session?.status !== 'live' || !isLaikaId(session.agent_id)) return { outcome: 'no_session' };

  const given = await consentGiven(deps, credential, session.agent_id);
  if (given === undefined) {
    log(deps.home, `auto checkpoint ${harness}: consent could not be read; not saved`);
    return { outcome: 'consent_unknown' };
  }
  if (!given) {
    log(deps.home, `auto checkpoint ${harness}: no consent for automatic saves; not saved`);
    return { outcome: 'no_consent' };
  }

  activity.last_attempt_at = deps.now();
  writeActivity(deps.home, harness, harnessSessionId, activity);

  const deadline = deps.now() + quietMs;
  for (;;) {
    let gitBusy: string | undefined;
    try {
      gitBusy = busyReason(worktreeAt(deps.git, activity.cwd));
    } catch {
      gitBusy = undefined;
    }
    const tools = inflight(deps.home, harness, harnessSessionId, deps.proc);
    if (gitBusy === undefined && tools === 0) break;
    if (deps.now() >= deadline) {
      log(
        deps.home,
        `auto checkpoint ${harness}: still busy (${gitBusy ?? `${String(tools)} tool(s) running`}); not saved`,
      );
      return { outcome: 'busy' };
    }
    await deps.sleep(500);
  }

  await deps.onPhase?.('quiet');
  // The interlock is taken inside the save, right before staging, and the
  // quiet check asked again under it: a tool that started since the loop
  // above is seen there, and one that starts from then on waits in its
  // PreToolUse — or is denied, past the deadline — or is seen before the
  // commit. Its budget covers local git work only; the network is outside it.
  const proc = deps.proc ?? readProc;
  const budget = Math.max(100, Math.min(SAVE_BUDGET_MS, deps.saveBudgetMs ?? SAVE_BUDGET_MS));
  // Time kept back for the commit itself: past this point the save stops
  // rather than start a commit that could outrun its deadline.
  const reserve = Math.min(2000, Math.floor(budget / 3));
  const toolsRunning = (): number => inflight(deps.home, harness, harnessSessionId, proc);
  let held: InterlockRelease | undefined;
  const interlock = {
    acquire: () => {
      held = takeSaveInterlock(deps.home, harness, harnessSessionId, { budgetMs: budget, proc });
      if (toolsRunning() > 0) {
        throw new Refusal('a tool started after the quiet check', 'tool_started');
      }
    },
    check: () => {
      if (toolsRunning() > 0) {
        throw new Refusal('a tool started while the save was staging', 'tool_started');
      }
      if (held !== undefined && Date.now() > held.deadline - reserve) {
        throw new Refusal(
          `the save ran past its ${String(budget)} ms budget before its commit`,
          'save_budget',
        );
      }
    },
    release: () => {
      if (held === undefined) return;
      held();
      held = undefined;
      void deps.onPhase?.('released');
    },
  };

  try {
    // The credential this child was handed, for everything it sends (P2-10).
    await retryPending(deps, { harness, credential });
    const outcome = await save(deps, {
      cwd: activity.cwd,
      auto: true,
      claim: { harness, harnessSessionId, credential },
      interlock,
    });
    const after = readActivity(deps.home, harness, harnessSessionId);
    after.mutations = 0;
    delete after.first_mutation_at;
    delete after.last_attempt_at;
    after.last_save_at = deps.now();
    writeActivity(deps.home, harness, harnessSessionId, after);
    return { outcome: outcome.kind, record: outcome.record };
  } catch (cause) {
    log(
      deps.home,
      `auto checkpoint ${harness}: ${cause instanceof Refusal ? cause.code : 'error'} — ${cause instanceof Error ? cause.message.slice(0, 300) : ''}`,
    );
    return { outcome: cause instanceof Refusal && BUSY_CODES.has(cause.code) ? 'busy' : 'refused' };
  } finally {
    interlock.release();
  }
}
