import type { CheckpointConsent, RegisteredAgent } from '../../../api/agents.ts';
import type { MeProfile } from '../../../api/me.ts';
import { dateTime } from '../../../api/time-label.ts';

/**
 * The owner's switch for automatic checkpoints (LAI-1007, D-115 item 2): the
 * rules rather than the rendering — who sees it, when it can change, and the
 * line that says what the server holds.
 */

/** The switch's name: what it allows, not just *On*. */
export const CONSENT_LABEL = 'Save checkpoints automatically';

/** The one sentence under it (D-115 item 2). */
export const CONSENT_MEANING =
  'Lets the helper commit and push work in progress to the task’s branch and tag it, after tool activity or at a session’s end, without asking each time — never to master. Nothing is saved automatically without this; saving by hand never needs it.';

/**
 * Only the agent's owner sees it (D-121). The list is already the reader's
 * own, but the switch does not lean on that: an agent whose owner is not the
 * signed-in reader — or a reader not yet known — shows nothing at all.
 */
export function showsConsent(
  agent: Pick<RegisteredAgent, 'owner_user_id'>,
  me: Pick<MeProfile, 'id'> | undefined,
): boolean {
  return me?.id === agent.owner_user_id;
}

/**
 * Why it cannot be changed, or `undefined` when it can. A revoked agent keeps
 * its last state, read only; without `agent.manage_own` (a token, not a
 * signed-in session) the server would refuse, so the screen says so first.
 */
export function consentLocked(
  agent: Pick<RegisteredAgent, 'status'>,
  canManage: boolean,
): string | undefined {
  if (agent.status === 'revoked') return 'Read only: this agent is revoked.';
  if (!canManage) return 'Changing it needs a signed-in browser session.';
  return undefined;
}

/** What the server holds, in words: on since when and by whom, or off and why. */
export function consentStateLine(
  consent: CheckpointConsent,
  me: Pick<MeProfile, 'id'> | undefined,
  now: number,
): string {
  if (consent.given && consent.given_at !== null) {
    const by =
      consent.given_by_user_id !== null && consent.given_by_user_id === me?.id
        ? 'you'
        : 'another person';
    return `On — given ${dateTime(consent.given_at, now)} by ${by}.`;
  }
  if (consent.withdrawn_at !== null) {
    return `Off — withdrawn ${dateTime(consent.withdrawn_at, now)}.`;
  }
  return 'Off — never given.';
}
