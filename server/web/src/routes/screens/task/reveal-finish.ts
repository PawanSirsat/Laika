/**
 * The one contract between the state panel and the feed (LAI-1122): the
 * panel's *Full summary in activity ↓* asks for a round's finish summary, and
 * the feed's summary card for that round opens itself and comes into view.
 * Neither reaches into the other's markup.
 */

export const REVEAL_FINISH_EVENT = 'laika:reveal-finish';

export interface RevealFinishDetail {
  readonly round: number;
}

/** Ask the feed to open round `round`'s finish summary. True when a card took it. */
export function revealFinish(round: number, target: EventTarget = document): boolean {
  const event = new CustomEvent<RevealFinishDetail>(REVEAL_FINISH_EVENT, {
    detail: { round },
    cancelable: true,
  });
  target.dispatchEvent(event);
  // A card that answered calls `preventDefault`, so the caller knows not to
  // fall back to scrolling the feed itself.
  return event.defaultPrevented;
}

/** The round a reveal asks for, or `undefined` for an event that is not one. */
export function roundOf(event: Event): number | undefined {
  const detail = (event as CustomEvent<Partial<RevealFinishDetail> | null>).detail;
  return typeof detail?.round === 'number' ? detail.round : undefined;
}
