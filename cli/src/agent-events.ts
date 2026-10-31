import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AgentCredential,
  callBoard,
  describe,
  type Fetch,
  type Harness,
  isAlive,
  isLaikaId,
  isRecord,
  log,
  privateDir,
  readJson,
  readProc,
  sessionsDir,
  UNKNOWN,
  writePrivate,
} from './agent-session.ts';

/**
 * The local event helper (LAI-554, proposal §4.6, §5; SPEC §4.76, §4.77,
 * §6.4, §11.5): it receives an agent's hand-off and context events, keeps one
 * record per event, and lets a hook show a short notice at the next boundary.
 *
 * ## Where events come from
 *
 * **The durable record is the board's delivery row; the stream is a notice.**
 * Two ways in, both de-duplicated by `event_id` into one local store:
 *
 * - {@link syncOnce} pages `GET /agents/me/events?state=undelivered` — at
 *   session start, at each prompt, every {@link POLL_EVERY_TOOL_CALLS} tool
 *   calls, and whenever the stream connects or reports a `gap`. A closed
 *   laptop, a dropped connection or a stream that never opened loses nothing:
 *   an unreceived event comes back on every poll until it is acknowledged.
 * - {@link runEventStream} holds `/api/v1/events` open in the session's
 *   background watcher, resuming from the last frame id it saw
 *   (`Last-Event-ID`). A replay delivers frames already seen; they are
 *   recognised by `event_id` and produce nothing new.
 *
 * ## Delivery states, recorded only when they happened
 *
 * `available` (the board has it) → `received` (this helper acknowledged it,
 * and the board answered 200 to that acknowledgement) → `presented` (a hook
 * printed a notice naming it to the harness, and only then) → `accepted`,
 * which is never written here: it is the offer's own state on the board.
 * **None of them says the model read or understood anything**, and nothing
 * here claims it did. A notice is shown only once its `received` is recorded,
 * because the board refuses `presented` before `received` (`409
 * not_received`).
 *
 * ## What a notice may contain
 *
 * Only fields that pass a fixed format: ids are ULIDs, a task key matches
 * {@link TASK_KEY}, a harness and a device label match short character
 * classes with no spaces, revisions are integers, the event type is one of a
 * closed list. **The sender's reason and note are never read** — not even
 * their hash — so no text another agent wrote can reach the model through
 * this path. Every notice line is built from those fields and fixed words,
 * capped at {@link NOTICE_MAX} characters for the whole block, and wrapped in
 * a block that says it is board data, not instructions. Nothing in it is run.
 *
 * ## The credential
 *
 * Read from the agent's own file (or `LAIKA_AGENT_TOKEN`) by the caller and
 * passed in; the background watcher gets it on stdin. It is sent only in the
 * `Authorization` header, never written to the store or the log, and never
 * put in a child's argv or environment. A `401` — a revoked or expired
 * token, at connect, on the stream (`error` frame) or on any request — stops
 * the stream for good and marks the store refused; nothing retries it.
 */

/** The most a hook injects for events, block markers included (the task's AC). */
export const NOTICE_MAX = 300;

/** How often a `PostToolUse` hook polls, in tool calls. */
export const POLL_EVERY_TOOL_CALLS = 10;

/** Records kept, and event ids remembered for de-duplication. */
const MAX_RECORDS = 200;
const MAX_SEEN = 1000;

/** §4.76's agent-event verbs: a closed list. Anything else is not rendered. */
export const EVENT_TYPES = [
  'task.agent_selected',
  'task.handoff_offered',
  'task.handoff_approved',
  'task.handoff_accepted',
  'task.handoff_declined',
  'task.handoff_cancelled',
  'task.handoff_expired',
  'task.recovered',
  'project.context_updated',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

const OFFER_KINDS: ReadonlySet<string> = new Set(['work_request', 'handoff', 'recovery']);

/** A board task key, e.g. `LAI-123` or `LAIKA-806`. */
export const TASK_KEY = /^[A-Z][A-Z0-9]{0,9}-[0-9]{1,7}$/;
/** A harness name as a notice may show it: no spaces, nothing to read as a sentence. */
const HARNESS = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** A device label as a notice may show it (`Strelka`, `belka-2`). */
const DEVICE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/;

const HARNESS_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export type LocalState = 'available' | 'received' | 'presented';

export interface Party {
  readonly agent_id: string;
  readonly harness: string | null;
  readonly device: string | null;
}

/** One event as this helper keeps it: validated fields only, never the reason or note. */
export interface EventRecord {
  readonly event_id: string;
  readonly cursor: number;
  readonly type: EventType;
  readonly project_id: string | null;
  readonly task_id: string | null;
  task_key?: string;
  readonly offer_id: string | null;
  readonly offer_kind: string | null;
  readonly from: Party | null;
  readonly to: Party | null;
  readonly context_revision: number | null;
  /** The revision this helper last knew for the project, when it knew one. */
  context_before?: number;
  state: LocalState;
  /** `presented` was printed but the board has not yet recorded it. */
  presented_unacked?: boolean;
  /** The board's own view at the last read: available, received, presented or accepted. */
  board_state?: string;
  readonly at: number;
}

export interface EventStore {
  readonly version: 1;
  readonly harness: Harness;
  /** The last frame id the stream saw: its `Last-Event-ID` on reconnect. */
  stream_cursor?: number;
  records: EventRecord[];
  /** Every event id ever stored, newest last: a replay of one is not new. */
  seen: string[];
  /** The newest context revision seen, per project id. */
  context_seen: Record<string, number>;
  tool_calls: number;
  last_sync_at?: number;
  last_sync?: string;
  /** Set when the board refused the credential (401). Cleared by a later success. */
  refused_at?: number;
  stream_pid?: number;
  stream_started?: string;
}

export const storePath = (home: string, harness: Harness): string =>
  join(sessionsDir(home), `events-${harness}.json`);

function emptyStore(harness: Harness): EventStore {
  return { version: 1, harness, records: [], seen: [], context_seen: {}, tool_calls: 0 };
}

export function readStore(home: string, harness: Harness): EventStore {
  const value = readJson(storePath(home, harness));
  if (!isRecord(value) || value.version !== 1 || value.harness !== harness) {
    return emptyStore(harness);
  }
  const store = value as unknown as EventStore;
  return {
    ...emptyStore(harness),
    ...store,
    records: Array.isArray(store.records) ? store.records : [],
    seen: Array.isArray(store.seen) ? store.seen : [],
    context_seen: isRecord(store.context_seen) ? store.context_seen : {},
  };
}

function writeStore(home: string, store: EventStore): void {
  privateDir(join(home, '.laika'));
  privateDir(sessionsDir(home));
  writePrivate(storePath(home, store.harness), `${JSON.stringify(store)}\n`);
}

const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/**
 * Read, change and write the store under a lock: the hooks and the watcher's
 * stream are separate processes writing one file. A lock older than 10 s is
 * a dead holder's and is taken over. Synchronous, and never held across the
 * network.
 */
export function mutate<T>(home: string, harness: Harness, change: (store: EventStore) => T): T {
  privateDir(join(home, '.laika'));
  privateDir(sessionsDir(home));
  const lock = `${storePath(home, harness)}.lock`;
  const until = Date.now() + 3000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > until) break; // Proceed rather than stall a hook.
      Atomics.wait(PAUSE, 0, 0, 10);
    }
  }
  try {
    const store = readStore(home, harness);
    const result = change(store);
    writeStore(home, store);
    return result;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

const posInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

function asParty(value: unknown): Party | null {
  if (!isRecord(value) || !isLaikaId(value.agent_id)) return null;
  const harness =
    typeof value.harness === 'string' && HARNESS.test(value.harness) ? value.harness : null;
  const device =
    typeof value.device === 'string' && DEVICE.test(value.device) ? value.device : null;
  return { agent_id: value.agent_id, harness, device };
}

/**
 * One §4.76 envelope as a record, or `undefined` when anything that names it
 * is not what it must be. Reads only the fields a notice may use: **never
 * `reason`, `closed_reason` or `note_hash`**.
 */
export function asRecord(value: unknown, now: number): EventRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { event_id, cursor, type, project_id, task_id } = value;
  if (!isLaikaId(event_id) || !posInt(cursor)) return undefined;
  if (typeof type !== 'string' || !TYPE_SET.has(type)) return undefined;
  if (project_id !== null && !isLaikaId(project_id)) return undefined;
  if (task_id !== null && !isLaikaId(task_id)) return undefined;
  const offer = isRecord(value.offer) ? value.offer : null;
  const offerOk =
    offer !== null &&
    isLaikaId(offer.id) &&
    typeof offer.kind === 'string' &&
    OFFER_KINDS.has(offer.kind);
  const revision = posInt(value.context_revision) ? value.context_revision : null;
  const delivery = isRecord(value.delivery) ? value.delivery : null;
  const boardState =
    typeof delivery?.state === 'string' &&
    ['available', 'received', 'presented', 'accepted'].includes(delivery.state)
      ? delivery.state
      : undefined;
  return {
    event_id,
    cursor,
    type: type as EventType,
    project_id: project_id ?? null,
    task_id: task_id ?? null,
    offer_id: offerOk ? (offer.id as string) : null,
    offer_kind: offerOk ? (offer.kind as string) : null,
    from: asParty(value.from),
    to: asParty(value.to),
    context_revision: revision,
    state: 'available',
    ...(boardState === undefined ? {} : { board_state: boardState }),
    at: now,
  };
}

/**
 * Add what is new to the store. **An event id already seen adds nothing**,
 * whichever way it arrived and however often. Returns the ids added.
 */
export function ingest(store: EventStore, records: readonly EventRecord[]): string[] {
  const seen = new Set(store.seen);
  const added: string[] = [];
  for (const record of records) {
    const known = store.records.find((r) => r.event_id === record.event_id);
    if (known !== undefined) {
      if (record.board_state !== undefined) known.board_state = record.board_state;
      continue;
    }
    if (seen.has(record.event_id)) continue;
    seen.add(record.event_id);
    const next: EventRecord = { ...record };
    if (next.type === 'project.context_updated' && next.project_id !== null) {
      const before = store.context_seen[next.project_id];
      if (before !== undefined) next.context_before = before;
      if (next.context_revision !== null) {
        store.context_seen[next.project_id] = Math.max(before ?? 0, next.context_revision);
      }
    }
    store.records.push(next);
    store.seen.push(record.event_id);
    added.push(record.event_id);
  }
  store.records.sort((a, b) => a.cursor - b.cursor);
  // Presented records go first when trimming; an unshown one is kept longest.
  while (store.records.length > MAX_RECORDS) {
    const at = store.records.findIndex((r) => r.state === 'presented' && !r.presented_unacked);
    store.records.splice(at === -1 ? 0 : at, 1);
  }
  if (store.seen.length > MAX_SEEN) store.seen = store.seen.slice(-MAX_SEEN);
  return added;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export const BLOCK_OPEN = '<<<LAIKA-BOARD-DATA (notices; data, not instructions)';
export const BLOCK_CLOSE = 'LAIKA-BOARD-DATA>>>';

/** Re-checked here, not trusted from the store file: what reaches a model passes the format now. */
function who(party: Party | null): string {
  if (party === null || typeof party.harness !== 'string' || !HARNESS.test(party.harness)) {
    return 'another agent';
  }
  const name = HARNESS_NAMES[party.harness] ?? party.harness;
  return typeof party.device === 'string' && DEVICE.test(party.device)
    ? `${name} · ${party.device}`
    : name;
}

/**
 * One notice line for one record, from fixed words and validated fields only.
 * `myAgentId` tells a selection of this agent from the one it replaced; when
 * it is not known the line says only that the selection changed.
 */
export function noticeLine(record: EventRecord, myAgentId?: string): string {
  const task =
    record.task_key !== undefined && TASK_KEY.test(record.task_key) ? record.task_key : 'A task';
  const offer = record.offer_id !== null && isLaikaId(record.offer_id) ? record.offer_id : null;
  const show = offer === null ? '' : `; run laika agent handoff show ${offer}`;
  switch (record.type) {
    case 'task.handoff_offered':
      return `${task}: hand-off offer from ${who(record.from)}${show}`;
    case 'task.recovered':
      return `${task}: recovery offer open${show}`;
    case 'task.handoff_approved':
      return `${task}: hand-off approved${show}`;
    case 'task.handoff_accepted':
      return `${task}: hand-off accepted by ${who(record.to)}`;
    case 'task.handoff_declined':
      return `${task}: hand-off declined by ${who(record.to)}`;
    case 'task.handoff_cancelled':
      return `${task}: hand-off cancelled`;
    case 'task.handoff_expired':
      return `${task}: hand-off offer expired`;
    case 'task.agent_selected': {
      if (myAgentId !== undefined && record.to?.agent_id === myAgentId) {
        return `${task}: selected for this agent; run laika agent inbox`;
      }
      if (myAgentId !== undefined && record.from?.agent_id === myAgentId) {
        return `${task}: this agent is no longer selected; stop work on it`;
      }
      return `${task}: agent selection changed; run laika agent inbox`;
    }
    case 'project.context_updated': {
      const to = posInt(record.context_revision) ? `r${String(record.context_revision)}` : '';
      const from = posInt(record.context_before) ? `r${String(record.context_before)} → ` : '';
      return `Project context changed${to === '' ? '' : `: ${from}${to}`}; call get_project_context to read it`;
    }
  }
}

/**
 * The block a hook injects: the oldest records not yet shown, as many whole
 * lines as fit in {@link NOTICE_MAX} with the markers, and a count of the
 * rest. `ids` are exactly the events whose line is in `text` — the only ones
 * that may be recorded as presented.
 */
export function renderNotices(
  records: readonly EventRecord[],
  myAgentId?: string,
): { text: string; ids: string[] } {
  const waiting = records.filter((r) => r.state === 'received' && TYPE_SET.has(r.type));
  if (waiting.length === 0) return { text: '', ids: [] };
  const lines: string[] = [];
  const ids: string[] = [];
  const build = (more: number): string =>
    [
      BLOCK_OPEN,
      ...lines,
      ...(more > 0 ? [`+${String(more)} more; run laika agent events`] : []),
      BLOCK_CLOSE,
    ].join('\n');
  for (const record of waiting) {
    const line = noticeLine(record, myAgentId).slice(0, NOTICE_MAX);
    lines.push(line);
    const rest = waiting.length - lines.length;
    if (build(rest).length > NOTICE_MAX) {
      lines.pop();
      break;
    }
    ids.push(record.event_id);
  }
  const text = build(waiting.length - ids.length);
  // A block of markers and a count alone, or one somehow over the cap, is not shown.
  if (ids.length === 0 || text.length > NOTICE_MAX) return { text: '', ids: [] };
  return { text, ids };
}

/* -------------------------------------------------------------------------- */
/* The board                                                                  */
/* -------------------------------------------------------------------------- */

export interface EventDeps {
  readonly home: string;
  readonly fetch: Fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export type SyncOutcome = 'ok' | 'refused' | 'network' | 'error';

const refusedStatus = (status: number): boolean => status === 401;

function markRefused(deps: EventDeps, harness: Harness, where: string): void {
  mutate(deps.home, harness, (s) => {
    s.refused_at = deps.now();
    s.last_sync = `refused (${where})`;
  });
  log(deps.home, `events ${harness}: credential refused at ${where}; stopped`);
}

/**
 * Acknowledge `ids` as `state`. Returns the ids the board recorded. All or
 * nothing on the board (§6.4), so a batch it refuses with `404` (one event it
 * may no longer read) is retried one by one, and an event refused alone is
 * dropped from the store: the agent may not see it now.
 */
export async function ack(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  ids: readonly string[],
  state: 'received' | 'presented',
  sessionId: string | undefined,
  timeoutMs = 5000,
): Promise<{ recorded: string[]; outcome: SyncOutcome }> {
  if (ids.length === 0) return { recorded: [], outcome: 'ok' };
  const send = (batch: readonly string[]) =>
    callBoard(
      deps.fetch,
      credential,
      '/api/v1/agents/me/events/ack',
      {
        event_ids: batch,
        state,
        ...(sessionId !== undefined && isLaikaId(sessionId) ? { session_id: sessionId } : {}),
      },
      {},
      timeoutMs,
    );
  const recorded: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const result = await send(batch);
    if (result.kind === 'ok') {
      recorded.push(...batch);
      continue;
    }
    if (result.kind === 'http' && refusedStatus(result.status)) {
      markRefused(deps, harness, 'ack');
      return { recorded, outcome: 'refused' };
    }
    if (result.kind === 'network') return { recorded, outcome: 'network' };
    // A session that is not open any more: the ack is still true without it.
    if (result.kind === 'http' && sessionId !== undefined && result.status !== 404) {
      return ack(deps, harness, credential, batch, state, undefined, timeoutMs).then((r) => ({
        recorded: [...recorded, ...r.recorded],
        outcome: r.outcome,
      }));
    }
    const dropped: string[] = [];
    for (const id of batch) {
      const one = await send([id]);
      if (one.kind === 'ok') recorded.push(id);
      else if (one.kind === 'http' && one.status === 404) dropped.push(id);
      else if (one.kind === 'http' && refusedStatus(one.status)) {
        markRefused(deps, harness, 'ack');
        return { recorded, outcome: 'refused' };
      }
    }
    if (dropped.length > 0) {
      mutate(deps.home, harness, (s) => {
        s.records = s.records.filter((r) => !dropped.includes(r.event_id));
      });
    }
  }
  return { recorded, outcome: 'ok' };
}

/** Mark records received, in the store, only for ids the board recorded. */
function markReceived(deps: EventDeps, harness: Harness, ids: readonly string[]): void {
  if (ids.length === 0) return;
  mutate(deps.home, harness, (s) => {
    for (const r of s.records) {
      if (ids.includes(r.event_id) && r.state === 'available') r.state = 'received';
    }
    delete s.refused_at;
  });
}

/** Store what arrived and acknowledge it as received. The shared half of a poll and a frame. */
export async function receive(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  envelopes: readonly unknown[],
  sessionId: string | undefined,
  timeoutMs = 5000,
): Promise<SyncOutcome> {
  const now = deps.now();
  const records = envelopes
    .slice(0, 500)
    .map((e) => asRecord(e, now))
    .filter((r): r is EventRecord => r !== undefined);
  const unreceived = mutate(deps.home, harness, (s) => {
    ingest(s, records);
    return s.records.filter((r) => r.state === 'available').map((r) => r.event_id);
  });
  const { recorded, outcome } = await ack(
    deps,
    harness,
    credential,
    unreceived,
    'received',
    sessionId,
    timeoutMs,
  );
  markReceived(deps, harness, recorded);
  return outcome;
}

/** Task keys for records that lack one: `GET /tasks/:id`, a few per call, validated. */
async function fillKeys(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  deadline: number,
): Promise<void> {
  const missing = readStore(deps.home, harness)
    .records.filter(
      (r) => r.task_id !== null && r.task_key === undefined && r.state !== 'presented',
    )
    .slice(0, 5);
  const keys = new Map<string, string>();
  for (const r of missing) {
    const left = deadline - deps.now();
    if (left < 200 || r.task_id === null) break;
    if (keys.has(r.task_id)) continue;
    const result = await callBoard(
      deps.fetch,
      credential,
      `/api/v1/tasks/${r.task_id}`,
      undefined,
      {},
      Math.min(left, 3000),
      'GET',
    );
    if (result.kind === 'ok' && isRecord(result.body)) {
      const key = result.body.key;
      if (typeof key === 'string' && TASK_KEY.test(key)) keys.set(r.task_id, key);
    }
  }
  if (keys.size === 0) return;
  mutate(deps.home, harness, (s) => {
    for (const r of s.records) {
      if (r.task_id !== null && keys.has(r.task_id)) r.task_key = keys.get(r.task_id)!;
    }
  });
}

/**
 * One catch-up: every undelivered event, acknowledged as received; then the
 * `presented` acknowledgements still owed; then task keys. Bounded by
 * `budgetMs` (a hook's time is short).
 */
export async function syncOnce(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  sessionId: string | undefined,
  budgetMs = 10_000,
): Promise<SyncOutcome> {
  const deadline = deps.now() + budgetMs;
  let after = 0;
  let outcome: SyncOutcome = 'ok';
  for (let page = 0; page < 20; page += 1) {
    const left = deadline - deps.now();
    if (left < 200) break;
    const result = await callBoard(
      deps.fetch,
      credential,
      `/api/v1/agents/me/events?state=undelivered&after=${String(after)}&limit=100`,
      undefined,
      {},
      left,
      'GET',
    );
    if (result.kind === 'http' && refusedStatus(result.status)) {
      markRefused(deps, harness, 'poll');
      return 'refused';
    }
    if (result.kind !== 'ok' || !isRecord(result.body) || !Array.isArray(result.body.data)) {
      outcome = result.kind === 'network' ? 'network' : 'error';
      mutate(deps.home, harness, (s) => {
        s.last_sync = `poll ${describe(result)}`;
      });
      break;
    }
    const got = await receive(
      deps,
      harness,
      credential,
      result.body.data,
      sessionId,
      Math.max(200, deadline - deps.now()),
    );
    if (got === 'refused') return 'refused';
    if (got !== 'ok') outcome = got;
    const cursor = result.body.cursor;
    if (result.body.has_more !== true || !posInt(cursor) || cursor <= after) break;
    after = cursor;
  }
  // `presented` owed from a hook whose acknowledgement did not arrive.
  const owed = readStore(deps.home, harness)
    .records.filter((r) => r.presented_unacked === true)
    .map((r) => r.event_id);
  if (owed.length > 0 && deadline - deps.now() > 200) {
    const { recorded } = await ack(
      deps,
      harness,
      credential,
      owed,
      'presented',
      sessionId,
      Math.max(200, deadline - deps.now()),
    );
    clearOwed(deps, harness, recorded);
  }
  await fillKeys(deps, harness, credential, deadline);
  if (outcome === 'ok') {
    mutate(deps.home, harness, (s) => {
      s.last_sync_at = deps.now();
      s.last_sync = 'ok';
      delete s.refused_at;
    });
  }
  return outcome;
}

function clearOwed(deps: EventDeps, harness: Harness, ids: readonly string[]): void {
  if (ids.length === 0) return;
  mutate(deps.home, harness, (s) => {
    for (const r of s.records) {
      if (ids.includes(r.event_id)) {
        delete r.presented_unacked;
        r.board_state = r.board_state === 'accepted' ? 'accepted' : 'presented';
      }
    }
  });
}

/**
 * After a hook **printed** a notice naming `ids`: they are presented. Written
 * locally first — the harness has the text whatever the board answers — then
 * acknowledged; an acknowledgement that does not arrive is owed and retried
 * at the next sync.
 */
export async function presented(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  ids: readonly string[],
  sessionId: string | undefined,
  timeoutMs = 2000,
): Promise<void> {
  if (ids.length === 0) return;
  // Only a received event can be presented: the board refuses the other order.
  const moved = mutate(deps.home, harness, (s) => {
    const out: string[] = [];
    for (const r of s.records) {
      if (ids.includes(r.event_id) && r.state === 'received') {
        r.state = 'presented';
        r.presented_unacked = true;
        out.push(r.event_id);
      }
    }
    return out;
  });
  const { recorded } = await ack(
    deps,
    harness,
    credential,
    moved,
    'presented',
    sessionId,
    timeoutMs,
  );
  clearOwed(deps, harness, recorded);
}

/* -------------------------------------------------------------------------- */
/* The stream                                                                 */
/* -------------------------------------------------------------------------- */

export interface Frame {
  readonly event: string;
  readonly id?: string;
  readonly data: string;
}

/** Split `text/event-stream` text into frames; returns the frames and what is left over. */
export function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const frames: Frame[] = [];
  const normalised = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalised.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const at = line.indexOf(':');
      const field = at === -1 ? line : line.slice(0, at);
      const value = at === -1 ? '' : line.slice(at + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length === 0 && id === undefined) continue;
    frames.push({ event, ...(id === undefined ? {} : { id }), data: data.join('\n') });
  }
  return { frames, rest };
}

export type StreamOutcome = 'refused' | 'stopped';

export interface StreamOptions {
  readonly signal?: AbortSignal;
  /** Called before each (re)connect; true stops the stream. */
  readonly shouldStop?: () => boolean;
  readonly sessionId?: () => string | undefined;
  /** Longest wait between reconnects. */
  readonly maxBackoffMs?: number;
  /** For tests: called after each frame is handled. */
  readonly onFrame?: (frame: Frame) => void;
}

/**
 * Hold `/api/v1/events` open, resuming from the last frame id. Catches up
 * with {@link syncOnce} on every `ready` (any connect, which covers whatever
 * happened while it was away) and every `gap`, and falls back to polling at
 * each failed connect. Returns `refused` on a `401` or an `error` frame — and
 * never reconnects after one — or `stopped` when told to stop.
 */
export async function runEventStream(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  options: StreamOptions = {},
): Promise<StreamOutcome> {
  const maxBackoff = options.maxBackoffMs ?? 30_000;
  let failures = 0;
  const stopped = (): boolean =>
    options.signal?.aborted === true || options.shouldStop?.() === true;
  while (!stopped()) {
    const cursor = readStore(deps.home, harness).stream_cursor;
    let response: Response | undefined;
    try {
      response = await deps.fetch(`${credential.url.replace(/\/+$/, '')}/api/v1/events`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.token}`,
          Accept: 'text/event-stream',
          ...(cursor === undefined ? {} : { 'Last-Event-ID': String(cursor) }),
        },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      response = undefined;
    }
    if (stopped()) break;
    if (response !== undefined && refusedStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      markRefused(deps, harness, 'connect');
      return 'refused';
    }
    if (response === undefined || !response.ok || response.body === null) {
      await response?.body?.cancel().catch(() => undefined);
      failures += 1;
      // The stream is down: the durable record is still there to poll.
      const polled = await syncOnce(deps, harness, credential, options.sessionId?.());
      if (polled === 'refused') return 'refused';
      await deps.sleep(Math.min(maxBackoff, 500 * 2 ** Math.min(failures, 6)));
      continue;
    }
    const outcome = await readStream(deps, harness, credential, response.body, options);
    if (outcome === 'refused') return 'refused';
    if (outcome === 'ready') failures = 0;
    failures += 1;
    if (stopped()) break;
    await deps.sleep(Math.min(maxBackoff, 250 * 2 ** Math.min(failures, 7)));
  }
  return 'stopped';
}

async function readStream(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  body: ReadableStream<Uint8Array>,
  options: StreamOptions,
): Promise<'refused' | 'ready' | 'ended'> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let wasReady = false;
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        return wasReady ? 'ready' : 'ended';
      }
      if (chunk.done) return wasReady ? 'ready' : 'ended';
      buffer += decoder.decode(chunk.value, { stream: true });
      // One frame never needs more than this; a stream that sends more is cut.
      if (buffer.length > 1024 * 1024) return wasReady ? 'ready' : 'ended';
      const parsed = parseFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        const handled = await handleFrame(deps, harness, credential, frame, options);
        options.onFrame?.(frame);
        if (handled === 'refused') return 'refused';
        if (frame.event === 'ready') wasReady = true;
        if (handled === 'closing') return wasReady ? 'ready' : 'ended';
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => undefined);
  }
}

async function handleFrame(
  deps: EventDeps,
  harness: Harness,
  credential: AgentCredential,
  frame: Frame,
  options: StreamOptions,
): Promise<'ok' | 'refused' | 'closing'> {
  const sessionId = options.sessionId?.();
  if (frame.event === 'error') {
    let code: unknown;
    try {
      const data = JSON.parse(frame.data) as unknown;
      code = isRecord(data) && isRecord(data.error) ? data.error.code : undefined;
    } catch {
      code = undefined;
    }
    // Every `error` frame closes the stream (LAI-539); a credential one ends it for good.
    if (code === 'unauthorized' || code === undefined) {
      markRefused(deps, harness, 'stream');
      return 'refused';
    }
    return 'closing';
  }
  if (frame.event === 'closing') return 'closing';
  if (frame.event === 'ready' || frame.event === 'gap') {
    const polled = await syncOnce(deps, harness, credential, sessionId);
    return polled === 'refused' ? 'refused' : 'ok';
  }
  const seq = frame.id === undefined ? NaN : Number(frame.id);
  if (frame.event.includes('.') && TYPE_SET.has(frame.event)) {
    let envelope: unknown;
    try {
      const data = JSON.parse(frame.data) as unknown;
      envelope = isRecord(data) ? data.envelope : undefined;
    } catch {
      envelope = undefined;
    }
    if (envelope !== undefined) {
      const got = await receive(deps, harness, credential, [envelope], sessionId);
      if (got === 'refused') return 'refused';
    }
  }
  if (Number.isSafeInteger(seq) && seq > 0) {
    mutate(deps.home, harness, (s) => {
      s.stream_cursor = Math.max(s.stream_cursor ?? 0, seq);
    });
  }
  return 'ok';
}

/* -------------------------------------------------------------------------- */
/* One stream per harness                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Take the harness's stream slot for `self`, or `false` when a live process
 * holds it. Every session of one harness is the same agent, so one stream is
 * enough; the others' watchers only renew.
 */
export function takeStreamSlot(
  home: string,
  harness: Harness,
  self: { pid: number; started: string },
): boolean {
  return mutate(home, harness, (s) => {
    if (
      s.stream_pid !== undefined &&
      s.stream_started !== undefined &&
      (s.stream_pid !== self.pid || s.stream_started !== self.started)
    ) {
      const holder = readProc(s.stream_pid);
      if (holder !== UNKNOWN && isAlive(s.stream_pid, s.stream_started)) return false;
    }
    s.stream_pid = self.pid;
    s.stream_started = self.started;
    return true;
  });
}

export function releaseStreamSlot(
  home: string,
  harness: Harness,
  self: { pid: number; started: string },
): void {
  mutate(home, harness, (s) => {
    if (s.stream_pid === self.pid && s.stream_started === self.started) {
      delete s.stream_pid;
      delete s.stream_started;
    }
  });
}
