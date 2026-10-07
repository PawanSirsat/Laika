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
 * **Every card on screen is named, not a predicted few.** A card that did not
 * move animates from where it is to where it is — nothing to see — so naming
 * them all needs no prediction of where React will put things, and cannot get
 * it wrong. Cards that left the screen fade out; cards that arrived fade in.
 * Past {@link MAX_NAMED} the change is shown instantly: a swarm reads worse
 * than a cut.
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
  if (event.actor_kind === 'user' && meId !== undefined && event.actor_id === meId) return undefined;
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
  readonly drawerOpen: boolean;
}

/**
 * Whether a change may glide. Not while the person asked for less motion, not
 * in a hidden tab, not under a drag (the lanes must hold still), not on the
 * List (rows jump by sort and page — a slide would trace an arbitrary path),
 * and not behind the task drawer, where named cards would paint above it.
 */
export function motionAllowed(ctx: MotionContext): boolean {
  return (
    ctx.supported &&
    !ctx.reducedMotion &&
    ctx.visible &&
    !ctx.dragging &&
    ctx.boardView &&
    !ctx.drawerOpen
  );
}

type StartViewTransition = (update: () => void) => ViewTransition;

function startFor(doc: Document): StartViewTransition | undefined {
  const candidate = (doc as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  return typeof candidate === 'function' ? candidate.bind(doc) : undefined;
}

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
    ...app,
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

/** Name every card on screen except the one the person carried there. */
function nameCards(settled: string | undefined): number {
  let named = 0;
  for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
    const id = el.dataset.taskId;
    if (id === undefined || id === settled || !onScreen(el)) {
      el.style.removeProperty('view-transition-name');
      continue;
    }
    el.style.setProperty('view-transition-name', transitionName(id));
    named += 1;
  }
  return named;
}

function clearNames(): void {
  for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
    el.style.removeProperty('view-transition-name');
  }
}

let active: ViewTransition | undefined;
let generation = 0;

/**
 * Apply a board change, gliding the cards there. Returns whether it animated.
 *
 * `apply` is the commit's own: it writes the **latest** board state, so it is
 * safe to run late, and safe if a running transition is skipped for a newer
 * one (a skipped transition still runs its update). `settled` is a card the
 * person already carried to its place with a pointer — it stays unnamed, so it
 * does not fly from where it was picked up; only its neighbours make room.
 */
export function runBoardTransition(apply: () => void, settled?: string): boolean {
  const start = startFor(document);
  if (start === undefined) {
    apply();
    return false;
  }

  active?.skipTransition();

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

  const transition = start(() => {
    flushSync(apply);
    // The new DOM: a card that moved is a new element in its new lane.
    nameCards(settled);
  });
  active = transition;

  const cleanup = (): void => {
    if (mine !== generation) return;
    clearNames();
    root.classList.remove('board-motion');
    delete root.dataset.boardMotion;
    active = undefined;
  };
  transition.ready.then(
    () => {
      if (mine === generation) root.dataset.boardMotion = 'running';
    },
    () => undefined,
  );
  transition.finished.then(cleanup, cleanup);
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
        for (const el of document.querySelectorAll(`[data-task-id="${CSS.escape(id)}"][data-flash]`)) {
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
      const id = remoteTaskTouch(body as ActivityLike, meId);
      if (id !== undefined) touches.current.set(id, Date.now());
    });
  }, [slug, meId]);
  return touches;
}
