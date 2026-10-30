import {
  liveToken,
  type AgentGrant,
  type AgentGrantScope,
  type RegisteredAgent,
  type TokenSeen,
} from '../../../api/agents.ts';
import type { TokenView } from '../../../api/tokens.ts';
import { ApiError } from '../../../api/errors.ts';
import { LIVE_BUDGET_MS, LIVE_POLL_MS } from '../connect/connect-live.ts';

/**
 * Registering an agent, as five steps (proposal §6, LAI-537): harness and
 * device (D-120: nothing else names it) → projects and permissions → credential → harness instructions
 * → verify a request from **this** agent.
 *
 * Adapted from Connect's wizard (`connect-wizard.ts`), and different from it
 * in one load-bearing way: the credential is the **agent's**, minted by
 * registering it, so steps 4 and 5 are closed until registration answered —
 * there is no "I brought my own token" path, because a token the reader
 * brought is theirs, not the agent's.
 *
 * Pure: no React, no DOM, so `agent-wizard.test.ts` asserts it directly.
 */

export type AgentStep = 1 | 2 | 3 | 4 | 5;

/** Step `n` is named by `REGISTRATION_STEPS[n - 1]`, LAI-536's list (LAI-565). */
export const AGENT_STEPS: readonly AgentStep[] = [1, 2, 3, 4, 5];

/**
 * Steps 1 to 3 are open from the start; 4 and 5 need the agent to exist.
 * **Back past step 3 is closed once it does**: the agent is registered, and
 * editing its device or grants from here would silently be a second write
 * the reader did not ask for — the list's *Access* is where grants change.
 */
export function agentStepOpen(step: AgentStep, registered: boolean): boolean {
  return registered ? step >= 3 : step <= 3;
}

/** What *Rename* must hold — a legacy duplicate's mark, the one place a typed name still shows. */
export function nameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the agent a name.';
  if (trimmed.length > 80) return 'At most 80 characters.';
  return undefined;
}

/**
 * Step 1's one field (D-120): the device is **required**, because an agent is
 * its harness on its device and the label is that pair.
 */
export function deviceProblem(device: string): string | undefined {
  const trimmed = device.trim();
  if (trimmed === '') return 'Say which device it runs on — Belka, Strelka, Cloud.';
  return trimmed.length > 80 ? 'At most 80 characters.' : undefined;
}

/** The device key the server compares (SPEC §4.63): trimmed, any case. */
export function deviceKeyOf(device: string | null): string {
  return (device ?? '').trim().toLowerCase();
}

/** A device the server treats as a cloud runner (LAI-592): `Cloud`, in any case. */
export function isCloudDevice(device: string | null): boolean {
  return deviceKeyOf(device) === 'cloud';
}

/**
 * The longest a cloud agent's token may live — `CLOUD_TOKEN_MAX_TTL_MS` in
 * `server/src/services/agents.ts`, one day. Asked for {@link CLOUD_TTL_MARGIN_MS}
 * short of it, so a browser clock a little ahead of the server's is not
 * refused for asking a minute too long.
 */
export const CLOUD_TOKEN_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const CLOUD_TTL_MARGIN_MS = 5 * 60 * 1000;

/** The expiry the wizard and *Rotate* ask for a cloud agent's token. */
export function cloudExpiry(now: number): number {
  return now + CLOUD_TOKEN_MAX_TTL_MS - CLOUD_TTL_MARGIN_MS;
}

/**
 * The name sent to the server, which still requires one (1–80 characters).
 * **Derived, never typed, never the label** (D-120): `<slug> on <device>` —
 * the token takes the agent's name, and the server identifies a client that
 * names itself generically by the token name's **first word**, so the slug
 * leads (LAI-736, as Connect's `suggestTokenName`).
 */
export function derivedAgentName(tokenWord: string, device: string): string {
  const name = `${tokenWord} on ${device.trim()}`;
  return name.length <= 80 ? name : name.slice(0, 80).trimEnd();
}

/**
 * The token *Rotate* replaces: the live one, or — for a **Cloud** agent whose
 * day-long token has run out — its newest token not revoked (LAI-592). The
 * server rotates an expired, unrevoked token with a fresh expiry inside a
 * day, so a Cloud agent's expiry is the routine case, never a reason to
 * revoke it and register again. `undefined` when every token is revoked:
 * nothing is left to rotate.
 */
export function rotatableToken(agent: RegisteredAgent, now: number): TokenView | undefined {
  const live = liveToken(agent, now);
  if (live !== undefined || agent.status !== 'active' || !isCloudDevice(agent.device_label)) {
    return live;
  }
  // `tokens` is newest first.
  return agent.tokens.find((token) => token.revoked_at === null);
}

/** The existing agent a `409 agent_exists_for_harness_device` names (D-120, LAI-1000). */
export interface HarnessDeviceConflict {
  readonly agentId: string;
}

export function harnessDeviceConflict(cause: unknown): HarnessDeviceConflict | undefined {
  if (!(cause instanceof ApiError) || cause.status !== 409) return undefined;
  const details = cause.details as { reason?: unknown; agent_id?: unknown } | null;
  if (details?.reason !== 'agent_exists_for_harness_device') return undefined;
  return typeof details.agent_id === 'string' ? { agentId: details.agent_id } : undefined;
}

/**
 * The owner's own active agent already on this harness and device, if their
 * list shows one — so step 1 says so before the server has to. The server's
 * `409` stays the authority: a list that has not loaded, or is stale, finds
 * nothing here and the refusal still arrives.
 */
export function existingOnPair<
  A extends {
    readonly id: string;
    readonly harness: string;
    readonly device_label: string | null;
    readonly status: string;
  },
>(agents: readonly A[] | undefined, harness: string, device: string): A | undefined {
  if (deviceKeyOf(device) === '') return undefined;
  return agents?.find(
    (agent) =>
      agent.status === 'active' &&
      agent.harness === harness &&
      deviceKeyOf(agent.device_label) === deviceKeyOf(device),
  );
}

/**
 * A cloud agent's `422` in words (LAI-592): `cloud_token_expiry_required` and
 * `cloud_token_expiry_too_long`, each naming the 24-hour rule and what to do.
 * Any other answer is `undefined`, for the caller's own wording.
 */
export function cloudExpiryProblem(cause: unknown): string | undefined {
  if (!(cause instanceof ApiError) || cause.status !== 422) return undefined;
  const reason = (cause.details as { reason?: unknown } | null)?.reason;
  if (reason === 'cloud_token_expiry_required') {
    return 'A Cloud agent’s token must expire, within 24 hours — Laika refused one that would not. Nothing was created; try again.';
  }
  if (reason === 'cloud_token_expiry_too_long') {
    return 'A Cloud agent’s token may live at most 24 hours, and this one asked for longer — is this computer’s clock ahead? Nothing was created.';
  }
  return undefined;
}

/**
 * One project's choice in step 2: not granted, read only, or full. The server
 * stores only the two grant words; `none` is the absence of a row.
 */
export type GrantChoice = 'none' | AgentGrantScope;

/**
 * The grants a set of choices sends, in the order the projects were listed,
 * dropping `none`. **A viewer's `full` is sent as `read_only`**: the server
 * forces the token to read only for a viewer whatever the grant says, so
 * offering `full` would grant something the agent cannot use.
 */
export function grantsFrom(
  choices: ReadonlyMap<string, GrantChoice>,
  order: readonly string[],
  viewer: boolean,
): AgentGrant[] {
  const grants: AgentGrant[] = [];
  for (const projectId of order) {
    const choice = choices.get(projectId) ?? 'none';
    if (choice === 'none') continue;
    grants.push({ project_id: projectId, scope: viewer ? 'read_only' : choice });
  }
  return grants;
}

/** The choices a set of grants reads back as — for *Manage access*. */
export function choicesFrom(grants: readonly AgentGrant[]): Map<string, GrantChoice> {
  return new Map(grants.map((g) => [g.project_id, g.scope]));
}

/** Whether two grant lists say the same thing, order aside — so *Save* knows there is nothing to save. */
export function sameGrants(a: readonly AgentGrant[], b: readonly AgentGrant[]): boolean {
  if (a.length !== b.length) return false;
  const byProject = new Map(a.map((g) => [g.project_id, g.scope]));
  return b.every((g) => byProject.get(g.project_id) === g.scope);
}

/**
 * Step 5's watch (LAI-537 review round 1).
 *
 * **Bounded by the clock, not by answers.** The first version counted
 * *answered* polls against Connect's budget, so a request that never answered
 * never counted, and the interval it ran on kept firing — a reviewer saw
 * 1,001 polls. Now:
 *
 * - the watch ends at {@link VERIFY_BUDGET_MS} after it started, by
 *   wall-clock time, whatever the requests are doing;
 * - each request is abandoned after {@link VERIFY_REQUEST_TIMEOUT_MS};
 * - the next request is scheduled only once the last one has settled, so
 *   two are never in flight.
 *
 * The budget is Connect's (`LIVE_BUDGET_MS`, three minutes) and the spacing
 * is Connect's (`LIVE_POLL_MS`), so neither page polls forever.
 */
export const VERIFY_BUDGET_MS = LIVE_BUDGET_MS;
export const VERIFY_POLL_MS = LIVE_POLL_MS;
export const VERIFY_REQUEST_TIMEOUT_MS = 10_000;

export type VerifyState =
  | { readonly kind: 'watching' }
  | { readonly kind: 'verified' }
  /** The wizard's token was rotated or revoked meanwhile: its setup cannot work. */
  | { readonly kind: 'replaced' }
  | { readonly kind: 'spent' }
  | { readonly kind: 'error'; readonly error: unknown };

/** One answer, `elapsedMs` after the watch started. */
export function verifyStateFrom(seen: TokenSeen, elapsedMs: number): VerifyState {
  if (seen === 'seen') return { kind: 'verified' };
  if (seen === 'gone') return { kind: 'replaced' };
  return elapsedMs >= VERIFY_BUDGET_MS ? { kind: 'spent' } : { kind: 'watching' };
}

/** The muted line in the footer. */
export function agentFooterHint(step: AgentStep, registered: boolean, verified: boolean): string {
  switch (step) {
    case 1:
      return 'Its harness and device, then what it may reach';
    case 2:
      return 'Projects it may reach, and how';
    case 3:
      return registered
        ? 'Copy the credential, then continue'
        : 'Create the credential to continue';
    case 4:
      return 'Configure the harness, then continue';
    case 5:
      return verified ? 'Verified' : 'Waiting for a request from this agent’s credential';
  }
}
