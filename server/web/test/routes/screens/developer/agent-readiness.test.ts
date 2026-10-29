/**
 * The Agents tab's row reads an agent's readiness through LAI-536's three
 * facts (LAI-565). Each fact is asserted both ways, against an agent that has
 * it and one that does not, so a constant answer fails.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../src/api/agents.ts';
import type { TokenView } from '../../../../src/api/tokens.ts';
import { READINESS } from '../../../../src/components/agent/agent-states.ts';
import {
  agentReadiness,
  type RowReadiness,
} from '../../../../src/routes/screens/developer/agent-readiness.ts';

const MINT = 1_000_000;
const NOW = MINT + 1_000;

function token(over: Partial<TokenView> = {}): TokenView {
  return {
    id: 't-agent',
    name: 'codex on Linux',
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
    display_name: 'codex on Linux',
    harness: 'codex',
    device_label: 'build box',
    status: 'active',
    grants: [],
    tokens: [token()],
    created_at: MINT,
    revoked_at: null,
    last_seen_at: null,
    ...over,
  };
}

const facts = (row: RowReadiness | undefined): readonly string[] | undefined =>
  row === undefined ? undefined : READINESS.filter((f) => row.reached.has(f));

void describe('agentReadiness', () => {
  void test('a live token never used: credential created, not connected', () => {
    assert.deepEqual(facts(agentReadiness(agent(), NOW)), ['credential_created']);
  });

  void test('seen: credential created and connected', () => {
    assert.deepEqual(facts(agentReadiness(agent({ last_seen_at: MINT + 1 }), NOW)), [
      'credential_created',
      'connected',
    ]);
  });

  void test('every token expired or revoked: no live credential, and being seen still counts', () => {
    const expired = agent({ tokens: [token({ expires_at: NOW - 1 })], last_seen_at: MINT + 1 });
    assert.deepEqual(facts(agentReadiness(expired, NOW)), ['connected']);
    assert.equal(agentReadiness(expired, NOW)?.credentialLapsed, true);
    const revokedToken = agent({ tokens: [token({ revoked_at: MINT + 1 })] });
    assert.deepEqual(facts(agentReadiness(revokedToken, NOW)), []);
    assert.equal(agentReadiness(revokedToken, NOW)?.credentialLapsed, true);
  });

  void test('never given a token: not yet created, not lapsed', () => {
    const never = agent({ tokens: [] });
    assert.deepEqual(facts(agentReadiness(never, NOW)), []);
    assert.equal(agentReadiness(never, NOW)?.credentialLapsed, false);
  });

  void test('a live token is never lapsed, whatever older tokens did', () => {
    const rotated = agent({ tokens: [token({ id: 't-new' }), token({ revoked_at: MINT + 1 })] });
    assert.equal(agentReadiness(rotated, NOW)?.credentialLapsed, false);
  });

  void test('a revoked agent has no readiness to show', () => {
    const revoked = agent({ status: 'revoked', revoked_at: NOW, last_seen_at: MINT + 1 });
    assert.equal(agentReadiness(revoked, NOW), undefined);
  });

  void test('ready for recovery is never claimed: no API reports it before Phase 3', () => {
    for (const a of [agent(), agent({ last_seen_at: MINT + 1 })]) {
      const row = agentReadiness(a, NOW);
      assert.ok(row !== undefined);
      assert.equal(row.reached.has('ready_for_recovery'), false);
    }
  });
});
