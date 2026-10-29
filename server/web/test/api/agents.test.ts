/**
 * Registered agents on the client (LAI-537): the rules the Agents tab reads
 * an agent's row by, without a browser.
 *
 * The one that matters most is {@link mintedTokenSeen}: step 5 of the wizard
 * must stay pending until **the token the wizard minted** is used. The owner's
 * own activity, and the agent's *other* credentials, live on rows or fields
 * this function never reads, and the fixtures below put fresh stamps on
 * exactly those to prove it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_STATE_LABELS,
  agentHarness,
  agentState,
  liveToken,
  mintedTokenSeen,
  overlayWrites,
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
    owner_display_name: 'Ada',
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

void describe('mintedTokenSeen: only the minted token completes step 5', () => {
  void test('a fresh agent is unseen', () => {
    assert.equal(mintedTokenSeen(agent(), token()), 'unseen');
  });

  void test("the minted token's own use, or its MCP stamp, at or after the mint completes it", () => {
    assert.equal(
      mintedTokenSeen(agent({ tokens: [token({ last_used_at: MINT })] }), token()),
      'seen',
    );
    assert.equal(
      mintedTokenSeen(agent({ tokens: [token({ last_mcp_at: MINT + 1 })] }), token()),
      'seen',
    );
  });

  void test("the agent's last_seen_at alone does not: any of its credentials moves it", () => {
    // Review round 1: rotated elsewhere, the replacement is used, the agent is
    // stamped — and the setup the wizard shows still holds the old secret.
    assert.equal(mintedTokenSeen(agent({ last_seen_at: MINT + 5 }), token()), 'unseen');
  });

  void test('a stamp from before the mint is not this credential', () => {
    const old = agent({ tokens: [token({ last_used_at: MINT - 1 })] });
    assert.equal(mintedTokenSeen(old, token()), 'unseen');
  });

  void test('rotated away: the minted token revoked, the replacement used — gone, never seen', () => {
    const rotated = agent({
      last_seen_at: MINT + 9,
      tokens: [
        token({ id: 't-new', created_at: MINT + 5, last_used_at: MINT + 9 }),
        token({ revoked_at: MINT + 5 }),
      ],
    });
    assert.equal(mintedTokenSeen(rotated, token()), 'gone');
  });

  void test('a revoked agent, or a token it no longer lists, is gone', () => {
    const revoked = agent({ status: 'revoked', tokens: [token({ last_used_at: MINT + 1 })] });
    assert.equal(mintedTokenSeen(revoked, token()), 'gone');
    assert.equal(mintedTokenSeen(agent({ tokens: [] }), token()), 'gone');
  });

  void test("the owner's own token, however fresh, is not on the agent at all", () => {
    const busyOwner = agent({
      tokens: [token(), token({ id: 't-owner', created_at: 1, last_used_at: MINT + 100 })],
    });
    assert.equal(mintedTokenSeen(busyOwner, token()), 'unseen');
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

void describe('overlayWrites: an older list read never erases a newer write', () => {
  const a1 = agent({ id: 'a1', display_name: 'one' });
  const a2 = agent({ id: 'a2', display_name: 'two' });

  void test('a row written after the read began is added, though the read lacks it', () => {
    // Review round 3: Cancel's reload was asked before the late registration
    // existed, and used to land last and erase its row.
    const late = agent({ id: 'a3', display_name: 'late' });
    const rows = overlayWrites([a1, a2], [{ agent: late, seq: 5 }], 4);
    assert.deepEqual(
      rows.map((r) => r.id),
      ['a3', 'a1', 'a2'],
    );
  });

  void test('a row changed after the read began keeps its change', () => {
    const revoked = agent({ id: 'a1', display_name: 'one', status: 'revoked' });
    const rows = overlayWrites([a1, a2], [{ agent: revoked, seq: 2 }], 1);
    assert.equal(rows.find((r) => r.id === 'a1')?.status, 'revoked');
  });

  void test('a write from before the read began is already in it, and left alone', () => {
    const stale = agent({ id: 'a1', display_name: 'old name' });
    const rows = overlayWrites([a1], [{ agent: stale, seq: 3 }], 3);
    assert.equal(rows[0]?.display_name, 'one');
  });

  void test('several new rows land newest first', () => {
    const x = agent({ id: 'x' });
    const y = agent({ id: 'y' });
    const rows = overlayWrites(
      [a1],
      [
        { agent: y, seq: 7 },
        { agent: x, seq: 6 },
      ],
      5,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['y', 'x', 'a1'],
    );
  });
});
