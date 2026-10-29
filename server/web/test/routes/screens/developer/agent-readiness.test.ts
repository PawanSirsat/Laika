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
import { agentReadiness } from '../../../../src/routes/screens/developer/agent-readiness.ts';

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

const facts = (reached: ReadonlySet<string> | undefined): readonly string[] | undefined =>
  reached === undefined ? undefined : READINESS.filter((f) => reached.has(f));

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

  void test('every token revoked or expired: no credential, even once seen', () => {
    const expired = agent({ tokens: [token({ expires_at: NOW - 1 })], last_seen_at: MINT + 1 });
    assert.deepEqual(facts(agentReadiness(expired, NOW)), []);
    const revokedToken = agent({ tokens: [token({ revoked_at: MINT + 1 })] });
    assert.deepEqual(facts(agentReadiness(revokedToken, NOW)), []);
  });

  void test('a revoked agent has no readiness to show', () => {
    const revoked = agent({ status: 'revoked', revoked_at: NOW, last_seen_at: MINT + 1 });
    assert.equal(agentReadiness(revoked, NOW), undefined);
  });

  void test('ready for recovery is never claimed: no API reports it before Phase 3', () => {
    for (const a of [agent(), agent({ last_seen_at: MINT + 1 })]) {
      const reached = agentReadiness(a, NOW);
      assert.ok(reached !== undefined);
      assert.equal(reached.has('ready_for_recovery'), false);
    }
  });
});
