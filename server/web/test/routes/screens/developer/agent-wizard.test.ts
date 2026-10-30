/**
 * Registering an agent as five steps (LAI-537): the parts of the wizard that
 * are rules rather than rendering — which steps are open, what step 2 sends,
 * and how long step 5 asks.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_STEPS,
  agentFooterHint,
  agentStepOpen,
  choicesFrom,
  cloudExpiry,
  cloudExpiryProblem,
  CLOUD_TOKEN_MAX_TTL_MS,
  derivedAgentName,
  deviceProblem,
  existingOnPair,
  grantsFrom,
  harnessDeviceConflict,
  isCloudDevice,
  nameProblem,
  rotatableToken,
  sameGrants,
  VERIFY_BUDGET_MS,
  VERIFY_POLL_MS,
  VERIFY_REQUEST_TIMEOUT_MS,
  verifyStateFrom,
} from '../../../../src/routes/screens/developer/agent-wizard.ts';
import { REGISTRATION_STEPS } from '../../../../src/components/agent/agent-states.ts';
import { ApiError } from '../../../../src/api/errors.ts';
import type { RegisteredAgent } from '../../../../src/api/agents.ts';
import type { TokenView } from '../../../../src/api/tokens.ts';
import {
  LIVE_BUDGET_MS,
  LIVE_POLL_MS,
} from '../../../../src/routes/screens/connect/connect-live.ts';

void describe('the five steps', () => {
  void test('each has a name in LAI-536’s list, and the list has no step without one', () => {
    // The tab names step n by REGISTRATION_STEPS[n - 1] (LAI-565).
    assert.deepEqual(
      AGENT_STEPS.map((n) => REGISTRATION_STEPS[n - 1]),
      [...REGISTRATION_STEPS],
    );
  });

  void test('4 and 5 open only once the agent exists; 1 and 2 close once it does', () => {
    assert.deepEqual(
      AGENT_STEPS.map((n) => agentStepOpen(n, false)),
      [true, true, true, false, false],
    );
    assert.deepEqual(
      AGENT_STEPS.map((n) => agentStepOpen(n, true)),
      [false, false, true, true, true],
    );
  });

  void test('the footer says what is pending, never that it is verified before it is', () => {
    assert.match(agentFooterHint(3, false, false), /Create the credential/);
    assert.equal(
      agentFooterHint(5, true, false),
      'Waiting for a request from this agent’s credential',
    );
    assert.equal(agentFooterHint(5, true, true), 'Verified');
  });
});

void describe('step 1', () => {
  void test('a rename is 1 to 80 characters once trimmed, as the server cleans it', () => {
    assert.ok(nameProblem('   ') !== undefined);
    assert.equal(nameProblem(' a '), undefined);
    assert.equal(nameProblem('x'.repeat(80)), undefined);
    assert.ok(nameProblem('x'.repeat(81)) !== undefined);
  });

  void test('a device is required (D-120) and at most 80', () => {
    assert.match(deviceProblem('') ?? '', /which device/);
    assert.match(deviceProblem('   ') ?? '', /which device/);
    assert.equal(deviceProblem(' Belka '), undefined);
    assert.ok(deviceProblem('x'.repeat(81)) !== undefined);
  });

  void test('the name sent is derived: the slug first, for the server’s first-word match', () => {
    assert.equal(derivedAgentName('omnigent', ' Belka '), 'omnigent on Belka');
    assert.equal(derivedAgentName('claude-code', 'x'.repeat(80)).length, 80);
    assert.match(derivedAgentName('claude-code', 'x'.repeat(80)), /^claude-code on x+$/);
  });

  void test('Cloud is a cloud runner in any case and padding; nothing else is', () => {
    assert.equal(isCloudDevice(' cLoUd '), true);
    assert.equal(isCloudDevice('Cloudy'), false);
    assert.equal(isCloudDevice(null), false);
  });

  void test('a cloud token is asked for inside 24 hours, never at or past it', () => {
    const now = 1_000_000;
    assert.ok(cloudExpiry(now) > now);
    assert.ok(cloudExpiry(now) < now + CLOUD_TOKEN_MAX_TTL_MS);
    assert.equal(CLOUD_TOKEN_MAX_TTL_MS, 86_400_000);
  });
});

void describe('the server’s refusals, read', () => {
  const conflict = new ApiError('conflict', 'You already have…', 409, {
    reason: 'agent_exists_for_harness_device',
    agent_id: 'ag-1',
    harness: 'omnigent',
    device_label: 'belka',
  });

  void test('409 agent_exists_for_harness_device names the existing agent', () => {
    assert.deepEqual(harnessDeviceConflict(conflict), { agentId: 'ag-1' });
  });

  void test('another 409, or the reason on another status, is not that conflict', () => {
    const other = new ApiError('conflict', 'x', 409, { reason: 'stale_claim', agent_id: 'ag-1' });
    const wrongStatus = new ApiError('unprocessable', 'x', 422, {
      reason: 'agent_exists_for_harness_device',
      agent_id: 'ag-1',
    });
    assert.equal(harnessDeviceConflict(other), undefined);
    assert.equal(harnessDeviceConflict(wrongStatus), undefined);
    assert.equal(harnessDeviceConflict(new Error('x')), undefined);
  });

  void test('each cloud 422 says the 24-hour rule; another 422 is left to the caller', () => {
    const required = new ApiError('unprocessable', 'x', 422, {
      reason: 'cloud_token_expiry_required',
    });
    const long = new ApiError('unprocessable', 'x', 422, { reason: 'cloud_token_expiry_too_long' });
    assert.match(cloudExpiryProblem(required) ?? '', /must expire, within 24 hours/);
    assert.match(cloudExpiryProblem(long) ?? '', /at most 24 hours/);
    assert.equal(cloudExpiryProblem(new ApiError('unprocessable', 'x', 422, {})), undefined);
    assert.equal(cloudExpiryProblem(conflict), undefined);
  });

  void test('the list finds the owner’s active agent on the pair, by the server’s key', () => {
    const agents = [
      { id: 'old', harness: 'omnigent', device_label: 'Belka', status: 'revoked' },
      { id: 'cc', harness: 'claude-code', device_label: 'Belka', status: 'active' },
      { id: 'om', harness: 'omnigent', device_label: ' belka ', status: 'active' },
    ];
    assert.equal(existingOnPair(agents, 'omnigent', 'BELKA')?.id, 'om');
    assert.equal(existingOnPair(agents, 'omnigent', 'Strelka'), undefined);
    assert.equal(existingOnPair(agents, 'codex', 'Belka'), undefined);
    assert.equal(existingOnPair(agents, 'omnigent', ''), undefined);
    assert.equal(existingOnPair(undefined, 'omnigent', 'Belka'), undefined);
  });
});

void describe('step 2: grants', () => {
  const order = ['p1', 'p2', 'p3'];

  void test('sends the chosen projects in listed order, and none for No access', () => {
    const choices = new Map([
      ['p3', 'read_only' as const],
      ['p1', 'full' as const],
      ['p2', 'none' as const],
    ]);
    assert.deepEqual(grantsFrom(choices, order, false), [
      { project_id: 'p1', scope: 'full' },
      { project_id: 'p3', scope: 'read_only' },
    ]);
  });

  void test('a viewer’s full is sent as read only — the most their token can be', () => {
    assert.deepEqual(grantsFrom(new Map([['p1', 'full' as const]]), order, true), [
      { project_id: 'p1', scope: 'read_only' },
    ]);
  });

  void test('a project not listed is never sent, whatever the choices say', () => {
    assert.deepEqual(grantsFrom(new Map([['p9', 'full' as const]]), order, false), []);
  });

  void test('reads back, and compares regardless of order', () => {
    const grants = [
      { project_id: 'p1', scope: 'full' as const },
      { project_id: 'p2', scope: 'read_only' as const },
    ];
    assert.deepEqual(grantsFrom(choicesFrom(grants), order, false), grants);
    assert.equal(sameGrants(grants, [...grants].reverse()), true);
    assert.equal(sameGrants(grants, [{ project_id: 'p1', scope: 'read_only' }]), false);
  });
});

void describe('step 5: the watch ends by the clock', () => {
  void test('seen is verified, gone is replaced, unseen watches until the deadline', () => {
    assert.deepEqual(verifyStateFrom('seen', 3), { kind: 'verified' });
    assert.deepEqual(verifyStateFrom('gone', 3), { kind: 'replaced' });
    assert.deepEqual(verifyStateFrom('unseen', VERIFY_BUDGET_MS - 1), { kind: 'watching' });
    assert.deepEqual(verifyStateFrom('unseen', VERIFY_BUDGET_MS), { kind: 'spent' });
  });

  void test("Connect's budget and spacing, and a request timeout that fits inside the budget", () => {
    assert.equal(VERIFY_BUDGET_MS, LIVE_BUDGET_MS);
    assert.equal(VERIFY_BUDGET_MS, 180_000);
    assert.equal(VERIFY_POLL_MS, LIVE_POLL_MS);
    assert.ok(VERIFY_REQUEST_TIMEOUT_MS > 0 && VERIFY_REQUEST_TIMEOUT_MS < VERIFY_BUDGET_MS);
  });
});

void describe('what Rotate replaces (LAI-592)', () => {
  const now = 10_000;
  const token = (id: string, over: Partial<TokenView> = {}): TokenView => ({
    id,
    name: id,
    prefix: 'lai_x',
    scope: 'full',
    project_ids: null,
    last_used_at: null,
    last_mcp_at: null,
    last_client: null,
    last_client_name: null,
    expires_at: null,
    revoked_at: null,
    created_at: 1,
    ...over,
  });
  const agent = (device: string | null, tokens: TokenView[], over: Partial<RegisteredAgent> = {}) =>
    ({
      id: 'a',
      owner_user_id: 'u',
      owner_display_name: 'Ada',
      display_name: 'x',
      harness: 'codex',
      device_label: device,
      status: 'active',
      grants: [],
      tokens,
      created_at: 1,
      revoked_at: null,
      last_seen_at: null,
      ...over,
    }) satisfies RegisteredAgent;

  void test('the live token, wherever the agent runs', () => {
    const live = token('live', { expires_at: now + 1 });
    assert.equal(rotatableToken(agent('Belka', [live]), now)?.id, 'live');
    assert.equal(rotatableToken(agent('Cloud', [live]), now)?.id, 'live');
  });

  void test('a Cloud agent whose token expired rotates that token — the newest not revoked', () => {
    const tokens = [
      token('newest', { expires_at: now - 1 }),
      token('older', { expires_at: now - 100 }),
    ];
    assert.equal(rotatableToken(agent(' cloud ', tokens), now)?.id, 'newest');
    const revokedFirst = [token('gone', { revoked_at: 5 }), token('expired', { expires_at: 1 })];
    assert.equal(rotatableToken(agent('Cloud', revokedFirst), now)?.id, 'expired');
  });

  void test('nothing to rotate: every Cloud token revoked, a non-Cloud expiry, a revoked agent', () => {
    assert.equal(rotatableToken(agent('Cloud', [token('t', { revoked_at: 5 })]), now), undefined);
    assert.equal(rotatableToken(agent('Belka', [token('t', { expires_at: 1 })]), now), undefined);
    assert.equal(
      rotatableToken(agent('Cloud', [token('t', { expires_at: 1 })], { status: 'revoked' }), now),
      undefined,
    );
  });
});
