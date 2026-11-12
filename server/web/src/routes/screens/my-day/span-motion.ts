/**
 * The View's movement (LAI-1174, the owner's *My Day Calendar Zoom*): moving
 * to a finer view, the part the reader opened — a month, a week, a day —
 * grows to fill the stage while the finer view grows out of it; moving to a
 * coarser one is the same played back. Prev and next slide sideways.
 *
 * The design's timing and curve, kept: 520 ms on `cubic-bezier(.32,.72,0,1)`,
 * the coarse layer gone by 55 % of the way and the fine one in by 40 %. **One
 * change from it, on the owner's word**: the scale is **even** — the design
 * stretched width and height apart, which bends the text mid-zoom.
 *
 * Web Animations only, so nothing is left behind in a stylesheet: a reader
 * who asks for less motion, a hidden tab, or a browser without
 * `Element.animate` gets a 200 ms fade or nothing — never a half-run zoom.
 */

export const ZOOM_MS = 520;
export const FADE_MS = 200;
export const EASE = 'cubic-bezier(.32,.72,0,1)';

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type Direction = 'in' | 'out';

export function motionAllowed(win: Window = window): boolean {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return false;
  }
  if (win.document.hidden) return false;
  return !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The two transforms, with `transform-origin: 0 0` on both layers: `big` puts
 * the anchor's centre on the stage's centre at the scale that makes it cover
 * the stage; `small` fits the whole stage inside the anchor, centred on it.
 * Each is one number for both axes — the even scale.
 */
export function zoomTransforms(stage: Box, anchor: Box): { big: string; small: string } {
  const x = anchor.left - stage.left;
  const y = anchor.top - stage.top;
  const cx = x + anchor.width / 2;
  const cy = y + anchor.height / 2;
  const grow = Math.max(stage.width / anchor.width, stage.height / anchor.height);
  const shrink = Math.min(anchor.width / stage.width, anchor.height / stage.height);
  const big = `translate(${px(stage.width / 2 - cx * grow)}, ${px(stage.height / 2 - cy * grow)}) scale(${num(grow)})`;
  const small = `translate(${px(cx - (stage.width / 2) * shrink)}, ${px(cy - (stage.height / 2) * shrink)}) scale(${num(shrink)})`;
  return { big, small };
}

const ID = 'translate(0px, 0px) scale(1)';
const num = (n: number): string => String(Math.round(n * 1000) / 1000);
const px = (n: number): string => `${num(n)}px`;

/**
 * The keyframes for the layer leaving and the layer arriving. In: the coarse
 * layer leaves growing, the fine one arrives from the anchor. Out: the fine
 * layer leaves shrinking into the anchor, the coarse one arrives settling.
 */
export function zoomFrames(
  stage: Box,
  anchor: Box,
  dir: Direction,
): { leaving: Keyframe[]; entering: Keyframe[] } {
  const { big, small } = zoomTransforms(stage, anchor);
  if (dir === 'in') {
    return {
      leaving: [
        { transform: ID, opacity: 1 },
        { opacity: 0, offset: 0.55 },
        { transform: big, opacity: 0 },
      ],
      entering: [
        { transform: small, opacity: 0 },
        { opacity: 1, offset: 0.4 },
        { transform: ID, opacity: 1 },
      ],
    };
  }
  return {
    leaving: [
      { transform: ID, opacity: 1 },
      { opacity: 1, offset: 0.35 },
      { transform: small, opacity: 0 },
    ],
    entering: [
      { transform: big, opacity: 0 },
      { opacity: 1, offset: 0.6 },
      { transform: ID, opacity: 1 },
    ],
  };
}

const usable = (b: Box | undefined): b is Box => b !== undefined && b.width >= 2 && b.height >= 2;

/**
 * Run the zoom on whichever layers are there — one of them may be the Day,
 * which lives outside the stage — or the fade when the anchor cannot be
 * measured. Resolves when both have finished, or at once without motion.
 */
export async function zoomLayers(
  leaving: HTMLElement | null,
  entering: HTMLElement | null,
  stage: Box,
  anchor: Box | undefined,
  dir: Direction,
): Promise<void> {
  if (!motionAllowed()) return;
  const runs: Animation[] = [];
  let arrive: Animation | undefined;
  if (usable(anchor)) {
    const frames = zoomFrames(stage, anchor, dir);
    const timing: KeyframeAnimationOptions = { duration: ZOOM_MS, easing: EASE, fill: 'both' };
    if (leaving !== null) runs.push(leaving.animate(frames.leaving, timing));
    if (entering !== null) arrive = entering.animate(frames.entering, timing);
  } else {
    const timing: KeyframeAnimationOptions = { duration: FADE_MS, easing: 'ease', fill: 'both' };
    if (leaving !== null) runs.push(leaving.animate([{ opacity: 1 }, { opacity: 0 }], timing));
    if (entering !== null) arrive = entering.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }
  if (arrive !== undefined) runs.push(arrive);
  await settle(runs, ZOOM_MS + 900);
  // The arriving layer is let go of; the leaving one stays at its last frame
  // until the caller unmounts it, so it never flashes back for a frame.
  arrive?.cancel();
}

/** Prev and next: out 44 px the way the reader went, in from the other side. */
export async function slideOut(el: HTMLElement | null, by: 1 | -1): Promise<void> {
  if (el === null || !motionAllowed()) return;
  const run = el.animate(
    [
      { transform: 'translateX(0px)', opacity: 1 },
      { transform: `translateX(${String(-by * 44)}px)`, opacity: 0 },
    ],
    { duration: 130, easing: 'ease-in', fill: 'forwards' },
  );
  await settle([run], 260);
}

export function slideIn(el: HTMLElement | null, by: 1 | -1): void {
  if (el === null || !motionAllowed()) return;
  el.getAnimations().forEach((a) => {
    a.cancel();
  });
  el.animate(
    [
      { transform: `translateX(${String(by * 44)}px)`, opacity: 0 },
      { transform: 'translateX(0px)', opacity: 1 },
    ],
    { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
}

/** Every run finished, or the failsafe — a stalled animation never strands the page. */
function settle(runs: readonly Animation[], failsafe: number): Promise<void> {
  return Promise.race([
    Promise.all(runs.map((r) => r.finished.catch(() => undefined))).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, failsafe)),
  ]);
}

export const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
