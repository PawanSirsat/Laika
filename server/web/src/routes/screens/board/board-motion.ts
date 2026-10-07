import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { subscribeToEvents } from '../../../api/event-stream.ts';

/**
 * Cards glide to where they now belong, and another person's change glows
 * (LAI-708, D-071).
 *
 * **View Transitions, not a FLIP clone.** The browser draws the moving cards
 * in a layer above the page, so a card crossing lanes is not clipped by
 * `.lane-body`'s overflow, and nothing is cloned into the DOM — tests and
 * styles that match `.card` and count `.lane`s see the board as it is.
 * Browsers without the API get the change instantly, as before.
 *
 * **Before the change every card on screen is named; after it, only the ones
 * that moved.** The old picture has to be taken before anyone knows what will
 * move, so it takes them all — no prediction of where React will put things to
 * get wrong. Afterwards each card is measured: one that moved, or arrived, is
 * named again and glides or fades in; one that did not stays the live element,
 * and its old picture fades out exactly on top of it, which shows nothing.
 * That matters because **a named card cannot be clicked** while the browser
 * draws it — Chrome does not hit-test it — so a card standing still has to be
 * the real one. Past {@link MAX_NAMED} the change is shown instantly: a swarm
 * reads worse than a cut.
 */

/** How long a card takes to glide — the top of the 90–200 ms range the app already uses. */
export const MOTION_MS = 200;
/** How long another person's change glows — the design prototype's `flash`. */
export const FLASH_MS = 3600;
/** How long a stream frame marks a task as someone else's change. */
export const TOUCH_TTL_MS = 10_000;
/** More named cards than this and the change is shown without motion. */
export const MAX_NAMED = 120;

/** `task-<id>`, safe as a CSS identifier whatever the id holds. */
export function transitionName(id: string): string {
  return `task-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** The fields of a stream frame this file reads. */
export interface ActivityLike {
  readonly task_id?: string | null;
  readonly actor_id?: string | null;
  readonly actor_kind?: string;
}

/**
 * The task a frame is **someone else's** change to, or nothing.
 *
 * "Someone else" is anyone but the person in this tab acting as themselves —
 * their own agent included, because they did not make that change here. A
 * person's own move is already on their screen; its echo must not glow.
 */
export function remoteTaskTouch(event: ActivityLike, meId: string | undefined): string | undefined {
  if (typeof event.task_id !== 'string' || event.task_id === '') return undefined;
  if (event.actor_kind === 'user' && meId !== undefined && event.actor_id === meId)
    return undefined;
  return event.task_id;
}

/** Of `ids`, the ones someone else touched within the TTL. Prunes expired touches. */
export function recentlyTouched(
  touches: Map<string, number>,
  ids: Iterable<string>,
  now: number,
): string[] {
  for (const [id, at] of touches) {
    if (now - at > TOUCH_TTL_MS) touches.delete(id);
  }
  return [...ids].filter((id) => touches.has(id));
}

export interface MotionContext {
  readonly supported: boolean;
  readonly reducedMotion: boolean;
  readonly visible: boolean;
  readonly dragging: boolean;
  readonly boardView: boolean;
  /** The task drawer, a dialog or a popover is open. */
  readonly overlayOpen: boolean;
}

/**
 * Whether a change may glide. Not while the person asked for less motion, not
 * in a hidden tab, not under a drag (the lanes must hold still), not on the
 * List (rows jump by sort and page — a slide would trace an arbitrary path),
 * and not under the task drawer, a dialog or a popover: a moving card is drawn
 * above the whole page, so it would cross whatever the reader has open.
 */
export function motionAllowed(ctx: MotionContext): boolean {
  return (
    ctx.supported &&
    !ctx.reducedMotion &&
    ctx.visible &&
    !ctx.dragging &&
    ctx.boardView &&
    !ctx.overlayOpen
  );
}

type StartViewTransition = (update: () => void) => ViewTransition;

/** The API where the browser has it — the types promise it, older engines do not. */
function startFor(doc: Document): StartViewTransition | undefined {
  const maybe: Partial<Pick<Document, 'startViewTransition'>> = doc;
  if (maybe.startViewTransition === undefined) return undefined;
  return (update) => doc.startViewTransition(update);
}

/** Anything open above the board — every one of them is a dialog in the DOM. */
const OVERLAY = '[role="dialog"], [aria-modal="true"], dialog[open]';

/** Read the parts of the context only the browser knows. */
export function readMotionContext(app: {
  readonly dragging: boolean;
  readonly boardView: boolean;
  readonly drawerOpen: boolean;
}): MotionContext {
  return {
    supported: startFor(document) !== undefined,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    visible: document.visibilityState === 'visible',
    dragging: app.dragging,
    boardView: app.boardView,
    overlayOpen: app.drawerOpen || document.querySelector(OVERLAY) !== null,
  };
}

/** A lane item that is visible: inside the viewport and inside its lane's scroll box. */
function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) {
    return false;
  }
  const box = el.closest('.lane-body')?.getBoundingClientRect();
  return box === undefined || (r.bottom > box.top && r.top < box.bottom);
}

const ITEMS = '.lane-item[data-task-id]';

/** Where each named card was before the change. */
let before = new Map<string, DOMRect>();

/** Moved by more than rounding. */
function moved(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

/** The old picture: every card on screen except the one the person carried there. */
function nameCards(settled: string | undefined): number {
  before = new Map();
  for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
    const id = el.dataset.taskId;
    if (id === undefined || id === settled || !onScreen(el)) {
      el.style.removeProperty('view-transition-name');
      continue;
    }
    el.style.setProperty('view-transition-name', transitionName(id));
    before.set(id, el.getBoundingClientRect());
  }
  return before.size;
}

/**
 * The new picture: only the cards that moved or arrived. Returns whether
 * anything is left to show — a card that moved, arrived, or left the screen.
 */
function nameMoved(settled: string | undefined): boolean {
  let changes = 0;
  const stayed = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
    const id = el.dataset.taskId;
    const was = id === undefined ? undefined : before.get(id);
    const visible = id !== undefined && id !== settled && onScreen(el);
    if (visible && was !== undefined) stayed.add(id);
    const name = visible && (was === undefined || moved(was, el.getBoundingClientRect()));
    if (name) {
      el.style.setProperty('view-transition-name', transitionName(id));
      changes += 1;
    } else {
      el.style.removeProperty('view-transition-name');
    }
  }
  for (const id of before.keys()) if (!stayed.has(id)) changes += 1;
  return changes > 0;
}

function clearNames(): void {
  for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
    el.style.removeProperty('view-transition-name');
  }
}

/** The task whose card the keyboard is on, if it is on one. */
function focusedCard(): string | undefined {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.matches('.card-open')) return undefined;
  return el.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;
}

/**
 * Put the keyboard back on that card if the change took it away.
 *
 * A card that changes lane is a new element, and the old one leaves with the
 * focus. LaneRow restores it after an Alt+Arrow move — but it does so when it
 * renders, and under a transition the cards move a frame after that, so its
 * restore lands on the card that is about to be replaced. Only when the focus
 * was dropped, never taken from wherever the reader has since put it.
 */
function restoreFocus(id: string | undefined): void {
  if (id === undefined) return;
  const now = document.activeElement;
  if (now !== null && now !== document.body) return;
  document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"] .card-open`)?.focus();
}

let active: ViewTransition | undefined;
let generation = 0;
/** Changes that landed during a glide, shown together when it ends. */
let queued: { readonly applies: (() => void)[]; settled: string | undefined } | undefined;

/**
 * Apply a board change, gliding the cards there. Returns whether it animated.
 *
 * `apply` is the commit's own: it writes the **latest** board state, so it is
 * safe to run late. `settled` is a card the person already carried to its
 * place with a pointer — it stays unnamed, so it does not fly from where it was
 * picked up; only its neighbours make room.
 *
 * **One glide at a time.** A change that lands during one — the server's
 * answer to the move being animated, usually, a few milliseconds in — waits
 * for it to end and is then shown as the next glide, every waiting change
 * together. Starting it at once would skip the first to its end: the card
 * would jump the moment the server agreed with it. A server that agreed moves
 * nothing, and that glide is dropped the moment that is known; one that
 * refused moves the card back, and it glides back.
 */
export function runBoardTransition(apply: () => void, settled?: string): boolean {
  const start = startFor(document);
  if (start === undefined) {
    apply();
    return false;
  }

  if (active !== undefined) {
    queued ??= { applies: [], settled: undefined };
    queued.applies.push(apply);
    queued.settled = settled;
    return false;
  }

  const named = nameCards(settled);
  if (named === 0 || named > MAX_NAMED) {
    clearNames();
    apply();
    return false;
  }

  const root = document.documentElement;
  generation += 1;
  const mine = generation;
  root.classList.add('board-motion');
  root.dataset.boardMotion = 'pending';

  let transition: ViewTransition;
  try {
    transition = start(() => {
      const keep = focusedCard();
      flushSync(apply);
      restoreFocus(keep);
      // The new DOM: a card that changed lane is a new element in its new lane.
      if (!nameMoved(settled)) transition.skipTransition();
    });
  } catch {
    // Refused outright — the change still has to land.
    clearNames();
    root.classList.remove('board-motion');
    delete root.dataset.boardMotion;
    apply();
    return false;
  }
  active = transition;

  const cleanup = (): void => {
    if (mine !== generation) return;
    clearNames();
    root.classList.remove('board-motion');
    delete root.dataset.boardMotion;
    active = undefined;
    const next = queued;
    queued = undefined;
    if (next !== undefined) {
      runBoardTransition(() => {
        for (const run of next.applies) run();
      }, next.settled);
    }
  };
  transition.ready.then(
    () => {
      if (mine === generation) root.dataset.boardMotion = 'running';
    },
    () => undefined,
  );
  transition.finished.then(cleanup, cleanup);
  // A throw inside `apply` is React's to report; this only stops it surfacing
  // twice as an unhandled rejection.
  transition.updateCallbackDone.catch(() => undefined);
  return true;
}

const flashTimers = new Map<string, number>();

/**
 * Mark cards and list rows as just changed by someone else.
 *
 * An attribute rather than a class: React owns `className`, and this is set
 * after it renders. Re-marking restarts the animation; the mark clears itself
 * after {@link FLASH_MS}.
 */
export function flashTasks(ids: Iterable<string>): void {
  for (const id of ids) {
    const selector = `.card[data-task-id="${CSS.escape(id)}"], .list-row[data-task-id="${CSS.escape(id)}"]`;
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      el.removeAttribute('data-flash');
      // Reading layout restarts the animation on an element already flashing.
      void el.offsetWidth;
      el.setAttribute('data-flash', '');
    }
    window.clearTimeout(flashTimers.get(id));
    flashTimers.set(
      id,
      window.setTimeout(() => {
        for (const el of document.querySelectorAll(
          `[data-task-id="${CSS.escape(id)}"][data-flash]`,
        )) {
          el.removeAttribute('data-flash');
        }
        flashTimers.delete(id);
      }, FLASH_MS),
    );
  }
}

/**
 * Tasks someone else changed recently, from the shared stream — the one
 * connection the board already holds (`subscribeToEvents` is reference-counted),
 * so this opens nothing new.
 */
export function useRemoteTouches(
  slug: string | undefined,
  meId: string | undefined,
): { readonly current: Map<string, number> } {
  const touches = useRef(new Map<string, number>());
  useEffect(() => {
    if (slug === undefined) return;
    return subscribeToEvents(slug, (frame) => {
      if (frame.kind !== 'activity') return;
      let body: unknown;
      try {
        body = JSON.parse(frame.data);
      } catch {
        return;
      }
      if (typeof body !== 'object' || body === null) return;
      const id = remoteTaskTouch(body, meId);
      if (id !== undefined) touches.current.set(id, Date.now());
    });
  }, [slug, meId]);
  return touches;
}
