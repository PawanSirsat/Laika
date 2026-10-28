/**
 * Agent selections in flight, **one per task, for the whole SPA session**
 * (LAI-538 review, rounds 3 and 4).
 *
 * Request ids stop a stale *answer* from changing the screen, but not a stale
 * *write* from landing: a withdraw sent on one drawer visit and a select sent
 * on the next both reach the server, and whichever lands last wins. So the
 * record of a write in flight lives here, outside any component, keyed by
 * task, and the next write on that task waits for it.
 *
 * ## Every record ends
 *
 * A record clears when its write settles — and if the write never settles, at
 * {@link AGENT_SAVE_DEADLINE_MS}, when its request is aborted. That outcome
 * is **uncertain** (the write may or may not have landed), so the row reads
 * the task back before it lets the next write go (`AgentRow.tsx`). A record
 * is also dropped with the session: {@link resetAgentWrites} runs from
 * `setStoreUser` whenever the signed-in user changes or signs out.
 *
 * Each record carries a **token**, and only the request holding it may end
 * it, so a late cleanup from an old request can never clear a newer one.
 */

/** How long a selection may go unanswered before its outcome is checked. */
export const AGENT_SAVE_DEADLINE_MS = 30_000;

/** Why a write's request was aborted: its deadline passed, or the session ended. */
export type AbortReason = 'deadline' | 'reset';

/** The timers a deadline runs on — the real ones, or a test's. */
export interface Timers {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

const REAL_TIMERS: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

interface Open {
  readonly token: number;
  readonly controller: AbortController;
  readonly timer: unknown;
  readonly timers: Timers;
}

const open = new Map<string, Open>();
const uncertain = new Set<string>();
const listeners = new Set<() => void>();
let lastToken = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: called whenever any record opens, ends or resets. */
export function subscribeAgentWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A write on this task is in flight. */
export function isAgentWriteOpen(taskId: string): boolean {
  return open.has(taskId);
}

/**
 * The last write on this task ended without anyone being able to say whether
 * it landed — its deadline passed, and reading the task back failed too.
 */
export function isAgentWriteUncertain(taskId: string): boolean {
  return uncertain.has(taskId);
}

/** What a write holds while it is in flight. */
export interface WriteTicket {
  readonly token: number;
  /** Aborted at the deadline (`reason: 'deadline'`) or with the session (`'reset'`). */
  readonly signal: AbortSignal;
}

/**
 * Open the task's record, or `undefined` when one is already open — the
 * caller then does not write. Clears an earlier uncertain outcome: a new
 * write is the reader's answer to it.
 */
export function beginAgentWrite(
  taskId: string,
  timers: Timers = REAL_TIMERS,
): WriteTicket | undefined {
  if (open.has(taskId)) return undefined;
  lastToken += 1;
  const token = lastToken;
  const controller = new AbortController();
  const timer = timers.setTimeout(() => {
    controller.abort('deadline' satisfies AbortReason);
  }, AGENT_SAVE_DEADLINE_MS);
  open.set(taskId, { token, controller, timer, timers });
  uncertain.delete(taskId);
  notify();
  return { token, signal: controller.signal };
}

/**
 * End the task's record — **only if `token` is still the one it holds**.
 * `uncertain` marks a write nobody could confirm or deny.
 */
export function endAgentWrite(taskId: string, token: number, uncertainOutcome = false): void {
  const record = open.get(taskId);
  if (record?.token !== token) return;
  record.timers.clearTimeout(record.timer);
  open.delete(taskId);
  if (uncertainOutcome) uncertain.add(taskId);
  notify();
}

/** Why `signal` was aborted, if it was by this module. */
export function abortReason(signal: AbortSignal): AbortReason | undefined {
  if (!signal.aborted) return undefined;
  const reason: unknown = signal.reason;
  return reason === 'deadline' || reason === 'reset' ? reason : undefined;
}

/**
 * A deadline for a follow-up read — reading a task back must not hang where
 * the write did. Cancel it once the read has answered.
 */
export function readDeadline(timers: Timers = REAL_TIMERS): {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
} {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => {
    controller.abort('deadline' satisfies AbortReason);
  }, AGENT_SAVE_DEADLINE_MS);
  return {
    signal: controller.signal,
    cancel: () => {
      timers.clearTimeout(timer);
    },
  };
}

/**
 * Drop every record — the session ended, or became somebody else's. Each
 * write still in flight is aborted with `'reset'`; nothing it answers later
 * can touch a record, because its token is gone.
 */
export function resetAgentWrites(): void {
  const hadAny = open.size > 0 || uncertain.size > 0;
  for (const record of open.values()) {
    record.timers.clearTimeout(record.timer);
    record.controller.abort('reset' satisfies AbortReason);
  }
  open.clear();
  uncertain.clear();
  if (hadAny) notify();
}
