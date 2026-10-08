import { type PresenceEntry, type PresenceView } from '../../../api/presence.ts';

/**
 * Proof that a session actually connected (LAI-622).
 *
 * Pure, so the rules below are asserted without a browser or a clock.
 *
 * ## Why `is_agent` is the whole test
 *
 * A heartbeat is `is_agent` when it carried a token — which the plugin's hook
 * does and the browser never does. Matching on `user_id` alone would be
 * satisfied by the reader's own open tab, and a setup page that congratulates
 * you for looking at it is worse than no check at all: it reports success in
 * precisely the state where nothing was installed.
 */
export function findMySession(presence: PresenceView, myUserId: string): PresenceEntry | undefined {
  return presence.present.find((entry) => entry.user_id === myUserId && entry.is_agent);
}

/**
 * How often the page asks, and for how long.
 *
 * Five seconds because `SessionStart` fires within a second or two of
 * `laika-claude` starting, and someone is watching the page while it happens —
 * Capacity's twenty is right for a screen left open, not for this. Three
 * minutes because a watch with no end is a page that polls a server forever
 * because somebody left a tab open; when it runs out the page says so and
 * offers to look again, which is a state a person can act on.
 *
 * Presence's own window is five minutes, so a hit cannot be missed between
 * ticks. The ratio is asserted, so nobody can quietly turn this into a
 * forever-poll by editing one constant.
 */
export const LIVE_POLL_MS = 5_000;
export const LIVE_BUDGET_MS = 180_000;
export const LIVE_TICKS = LIVE_BUDGET_MS / LIVE_POLL_MS;

export type LiveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'watching'; readonly ticks: number }
  | { readonly kind: 'found'; readonly entry: PresenceEntry }
  | { readonly kind: 'spent' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * What one answer means, given where the watch had got to.
 *
 * **`enabled: false` is a fact the server states, never one inferred from an
 * empty list.** The two are opposite claims — *"this org does not record who is
 * working"* against *"nobody is working"* — and a page that guesses between
 * them tells an org with presence switched off that its setup failed.
 */
export function liveStateFrom(
  presence: PresenceView,
  myUserId: string,
  ticksSoFar: number,
): LiveState {
  if (!presence.enabled) return { kind: 'disabled' };

  const mine = findMySession(presence, myUserId);
  if (mine !== undefined) return { kind: 'found', entry: mine };

  return ticksSoFar >= LIVE_TICKS ? { kind: 'spent' } : { kind: 'watching', ticks: ticksSoFar };
}
