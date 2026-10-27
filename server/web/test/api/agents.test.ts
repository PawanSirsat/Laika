/**
 * Registered agents on the client (LAI-537): the rules the Agents tab reads
 * an agent's row by, without a browser.
 *
 * The one that matters most is {@link seenSince}: step 5 of the wizard must
 * stay pending until a request authenticated **as this agent** arrives. The
 * owner's own activity — their session, their other tokens, their other
 * agents — lives on rows this function never reads, and the fixtures below
 * put fresh stamps on exactly those to prove it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_STATE_LABELS,
  agentHarness,
  agentState,
  liveToken,
  seenSince,
  type RegisteredAgent,
} from '../../src/api/agents.ts';
import type { TokenView } from '../../src/api/tokens.ts';

const MINT = 1_000_000;

function token(over: Partial<TokenView> = {}): TokenView {
  return {
    id: 't-agent',
    name: 'claude-code on macOS',
    prefix: 'lai_abcd',
    scope: 'full',
    project_ids: ['p1'],
    last_used_at: null,
    last_mcp_at: null,
    last_client: null,
    last_client_name: null,
    expires_at: null,
    revoked_at: null,
    created_at: MINT,
    ...over,
  };
}

function agent(over: Partial<RegisteredAgent> = {}): RegisteredAgent {
  return {
    id: 'a1',
    owner_user_id: 'u1',
    display_name: 'claude-code on macOS',
    harness: 'claude-code',
    device_label: null,
    status: 'active',
    grants: [{ project_id: 'p1', scope: 'full' }],
    tokens: [token()],
    created_at: MINT,
    revoked_at: null,
    last_seen_at: null,
    ...over,
  };
}

void describe('seenSince: only this agent completes step 5', () => {
  void test('a fresh agent is not seen', () => {
    assert.equal(seenSince(agent(), token()), false);
  });

  void test("the agent's own last_seen_at at or after the mint completes it", () => {
    assert.equal(seenSince(agent({ last_seen_at: MINT }), token()), true);
    assert.equal(seenSince(agent({ last_seen_at: MINT + 5 }), token()), true);
  });

  void test("the minted token's own use completes it", () => {
    const used = agent({ tokens: [token({ last_used_at: MINT + 1 })] });
    assert.equal(seenSince(used, token()), true);
  });

  void test('a stamp from before the mint is not this credential', () => {
    // After a rotation the agent may carry a last_seen_at from its old token.
    assert.equal(seenSince(agent({ last_seen_at: MINT - 1 }), token()), false);
    const old = agent({ tokens: [token({ last_used_at: MINT - 1 })] });
    assert.equal(seenSince(old, token()), false);
  });

  void test("another token's use — the owner's, or the agent's revoked one — does not", () => {
    const others = agent({
      tokens: [
        token(),
        // The previous credential, revoked by the rotation, used afterwards
        // (which the server would refuse) must not count for the new one.
        token({ id: 't-old', created_at: MINT - 10, revoked_at: MINT, last_used_at: MINT + 9 }),
      ],
    });
    assert.equal(seenSince(others, token()), false);
  });

  void test('a revoked agent is never verified', () => {
    assert.equal(seenSince(agent({ status: 'revoked', last_seen_at: MINT + 1 }), token()), false);
  });
});

void describe('agentState keeps the states apart', () => {
  const now = MINT + 1_000;

  void test('credential created, connected, revoked, no live credential', () => {
    assert.equal(agentState(agent(), now), 'credential-created');
    assert.equal(agentState(agent({ last_seen_at: MINT + 1 }), now), 'connected');
    assert.equal(agentState(agent({ status: 'revoked', revoked_at: now }), now), 'revoked');
    const expired = agent({ tokens: [token({ expires_at: now - 1 })] });
    assert.equal(agentState(expired, now), 'no-credential');
  });

  void test('ready-for-recovery is never claimed: no API reports it before Phase 3', () => {
    assert.deepEqual(Object.keys(AGENT_STATE_LABELS).sort(), [
      'connected',
      'credential-created',
      'no-credential',
      'revoked',
    ]);
  });
});

void describe('reading one agent', () => {
  void test('liveToken is the newest token neither revoked nor expired', () => {
    const now = MINT + 1_000;
    const a = agent({
      tokens: [token({ id: 't-new', revoked_at: null }), token({ id: 't-old', revoked_at: MINT })],
    });
    assert.equal(liveToken(a, now)?.id, 't-new');
    assert.equal(liveToken(agent({ tokens: [token({ revoked_at: MINT })] }), now), undefined);
  });

  void test('a harness the client does not know reads as other, never as itself', () => {
    assert.equal(agentHarness({ harness: 'codex' }), 'codex');
    assert.equal(agentHarness({ harness: '<script>' }), 'other');
  });
});
