/**
 * The app's one toast queue (LAI-1129), as pure state so `node --test` can
 * drive it with a fake clock: what is showing, when each goes, and what
 * pausing and Undo do to that. `ToastProvider.tsx` owns the React half — one
 * timer aimed at {@link nextDeadline}, and the drawing.
 *
 * The rules (`docs/ux/design-system/interaction-contracts.md`, Toasts):
 *
 * - **Errors persist** until dismissed: an error that left by itself could be
 *   missed, and it is the one a person most needs to read.
 * - **A toast with Undo stays {@link UNDO_MS}** — long enough to reach the
 *   button, as My day's (LAI-831) — and counts down where it can be seen.
 * - **Anything else goes after {@link INFO_MS}.**
 * - **Hover or focus pauses every timer** in the stack, and leaving resumes
 *   each with the time it had left — never a fresh full count.
 * - **At most {@link MAX_SHOWN}** at once: the oldest that is not an error
 *   gives way, so an error is never pushed out by chatter.
 */

export type ToastTone = 'info' | 'success' | 'error';

/** Takes a change back on the server, and resolves to what to say after. */
export type UndoAction = () => Promise<string>;

export interface ToastInput {
  readonly text: string;
  readonly tone?: ToastTone | undefined;
  /** Offered only where the server can really reverse the change (LAI-1129 rule 2). */
  readonly undo?: UndoAction | undefined;
  /** Overrides the default stay, in ms; errors ignore it and persist. */
  readonly duration?: number | undefined;
  /** A `data-*` attribute name for tests and screens that look for their own toast. */
  readonly mark?: string | undefined;
}

export interface ToastItem {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
  readonly undo?: UndoAction | undefined;
  readonly mark?: string | undefined;
  /** How long it stays in all; `null` for one that persists. */
  readonly duration: number | null;
  /** When it goes, while running; `null` while paused or persisting. */
  readonly expiresAt: number | null;
  /** The time it had left when paused; `null` while running or persisting. */
  readonly remaining: number | null;
  /** Its Undo is in flight: the button waits, and the timer with it. */
  readonly undoing: boolean;
}

export interface ToastQueue {
  readonly items: readonly ToastItem[];
  readonly paused: boolean;
  readonly seq: number;
}

export const INFO_MS = 5_000;
export const UNDO_MS = 10_000;
export const MAX_SHOWN = 3;

export const EMPTY_QUEUE: ToastQueue = { items: [], paused: false, seq: 0 };

function stayFor(input: ToastInput): number | null {
  if ((input.tone ?? 'info') === 'error') return null;
  if (input.duration !== undefined) return input.duration;
  return input.undo === undefined ? INFO_MS : UNDO_MS;
}

/** Start the clock on an item, or hold it, as the queue is paused or not. */
function timed(item: ToastItem, left: number | null, paused: boolean, now: number): ToastItem {
  if (left === null || item.undoing) return { ...item, expiresAt: null, remaining: left };
  return paused
    ? { ...item, expiresAt: null, remaining: left }
    : { ...item, expiresAt: now + left, remaining: null };
}

/** The oldest item that may give way to a new one: never an error. */
function evict(items: readonly ToastItem[]): readonly ToastItem[] {
  if (items.length < MAX_SHOWN) return items;
  const at = items.findIndex((t) => t.tone !== 'error');
  return at < 0 ? items.slice(1) : items.filter((_, i) => i !== at);
}

/**
 * Show a toast; returns the queue and the new toast's id — `id` when the
 * caller allocates it (the provider does, outside React's updater), else the
 * next in sequence.
 */
export function push(
  queue: ToastQueue,
  input: ToastInput,
  now: number,
  id: number = queue.seq + 1,
): { readonly queue: ToastQueue; readonly id: number } {
  const duration = stayFor(input);
  const base: ToastItem = {
    id,
    text: input.text,
    tone: input.tone ?? 'info',
    ...(input.undo === undefined ? {} : { undo: input.undo }),
    ...(input.mark === undefined ? {} : { mark: input.mark }),
    duration,
    expiresAt: null,
    remaining: null,
    undoing: false,
  };
  const item = timed(base, duration, queue.paused, now);
  return {
    queue: { ...queue, seq: Math.max(queue.seq, id), items: [...evict(queue.items), item] },
    id,
  };
}

export function dismiss(queue: ToastQueue, id: number): ToastQueue {
  return { ...queue, items: queue.items.filter((t) => t.id !== id) };
}

/** Hover or focus entered the stack: every running timer holds what it had left. */
export function pause(queue: ToastQueue, now: number): ToastQueue {
  if (queue.paused) return queue;
  return {
    ...queue,
    paused: true,
    items: queue.items.map((t) =>
      t.expiresAt === null
        ? t
        : { ...t, expiresAt: null, remaining: Math.max(0, t.expiresAt - now) },
    ),
  };
}

/** Hover and focus left: each timer runs on from where it stopped. */
export function resume(queue: ToastQueue, now: number): ToastQueue {
  if (!queue.paused) return queue;
  return {
    ...queue,
    paused: false,
    items: queue.items.map((t) =>
      t.remaining === null || t.undoing
        ? t
        : { ...t, expiresAt: now + t.remaining, remaining: null },
    ),
  };
}

/** Drop every toast whose time is up. */
export function expire(queue: ToastQueue, now: number): ToastQueue {
  const kept = queue.items.filter((t) => t.expiresAt === null || t.expiresAt > now);
  return kept.length === queue.items.length ? queue : { ...queue, items: kept };
}

/** When the next toast goes, for the one timer; `undefined` when none is running. */
export function nextDeadline(queue: ToastQueue): number | undefined {
  let soonest: number | undefined;
  for (const t of queue.items) {
    if (t.expiresAt !== null && (soonest === undefined || t.expiresAt < soonest)) {
      soonest = t.expiresAt;
    }
  }
  return soonest;
}

/** Whole seconds left on a toast, for the Undo countdown; `null` for one that persists. */
export function secondsLeft(item: ToastItem, now: number): number | null {
  const left = item.expiresAt === null ? item.remaining : item.expiresAt - now;
  return left === null ? null : Math.max(0, Math.ceil(left / 1000));
}

/** Undo was pressed: the toast stays, its button waits, its timer holds. */
export function startUndo(queue: ToastQueue, id: number, now: number): ToastQueue {
  return {
    ...queue,
    items: queue.items.map((t) => {
      if (t.id !== id || t.undo === undefined) return t;
      const left = t.expiresAt === null ? t.remaining : Math.max(0, t.expiresAt - now);
      return { ...t, undoing: true, expiresAt: null, remaining: left };
    }),
  };
}

/**
 * The server answered the Undo: the same toast — so focus on it is not lost —
 * now says what happened, with no Undo, and runs a fresh short clock (an
 * error persists).
 */
export function settleUndo(
  queue: ToastQueue,
  id: number,
  outcome: { readonly text: string; readonly tone: ToastTone },
  now: number,
): ToastQueue {
  return {
    ...queue,
    items: queue.items.map((t) => {
      if (t.id !== id) return t;
      const duration = outcome.tone === 'error' ? null : INFO_MS;
      const settled: ToastItem = {
        id: t.id,
        text: outcome.text,
        tone: outcome.tone,
        ...(t.mark === undefined ? {} : { mark: t.mark }),
        duration,
        expiresAt: null,
        remaining: null,
        undoing: false,
      };
      return timed(settled, duration, queue.paused, now);
    }),
  };
}
