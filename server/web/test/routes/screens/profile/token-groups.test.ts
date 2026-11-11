import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TokenView } from '../../../../src/api/tokens.ts';
import {
  IDLE_AFTER_MS,
  groupTokens,
  shownRows,
  tokenName,
  tokenSummary,
  tokenUse,
  unusedCount,
} from '../../../../src/routes/screens/profile/token-groups.ts';

const NOW = Date.UTC(2026, 10, 4, 12, 0);
const DAY = 24 * 60 * 60 * 1000;

const token = (id: string, name: string, over: Partial<TokenView> = {}): TokenView => ({
  id,
  name,
  prefix: `lai_${id}`,
  scope: 'full',
  project_ids: null,
  last_used_at: NOW - 3_600_000,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: null,
  revoked_at: null,
  created_at: NOW - 40 * DAY,
  kind: 'personal',
  agent_id: null,
  agent_label: null,
  ...over,
});

void describe('their tokens, grouped (LAI-321)', () => {
  void test('same-named tokens fold into one group, the latest used first', () => {
    const groups = groupTokens([
      token('k1', 'claude-code on macOS', { last_used_at: NOW - 20 * DAY }),
      token('k2', 'claude-token', { last_used_at: NOW - 2 * DAY }),
      token('k3', 'claude-code on macOS', { last_used_at: null }),
      token('k4', 'claude-code on macOS', { last_used_at: NOW - 60_000 }),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.label, g.tokens.map((t) => t.id)]),
      [
        ['claude-code on macOS', ['k4', 'k1', 'k3']],
        ['claude-token', ['k2']],
      ],
    );
    assert.equal(groups[0]!.lastUsedAt, NOW - 60_000);
  });

  void test('a group nobody used sorts last, and its latest use is null', () => {
    const groups = groupTokens([
      token('k1', 'never', { last_used_at: null }),
      token('k2', 'used', { last_used_at: NOW - 30 * DAY }),
    ]);
    assert.deepEqual(
      groups.map((g) => g.label),
      ['used', 'never'],
    );
    assert.equal(groups[1]!.lastUsedAt, null);
  });

  void test('a tool credential is named by its tool, never its registered name', () => {
    const credential = token('k5', 'Secret registered name', {
      kind: 'agent',
      agent_id: 'a1',
      agent_label: 'codex · Strelka',
    });
    assert.equal(tokenName(credential), 'Codex · Strelka');
    assert.deepEqual(
      groupTokens([credential]).map((g) => g.label),
      ['Codex · Strelka'],
    );
  });

  void test('idle from fourteen days unused; never used is its own state', () => {
    assert.equal(tokenUse(null, NOW), 'never');
    assert.equal(tokenUse(NOW - IDLE_AFTER_MS + 1, NOW), 'recent');
    assert.equal(tokenUse(NOW - IDLE_AFTER_MS, NOW), 'idle');
    const [group] = groupTokens([
      token('k1', 'x', { last_used_at: null }),
      token('k2', 'x', { last_used_at: NOW - 20 * DAY }),
      token('k3', 'x', { last_used_at: NOW - DAY }),
    ]);
    assert.equal(unusedCount(group!, NOW), 2);
  });

  void test('the summary names each kind it has, and only those', () => {
    const personal = { kind: 'personal' as const };
    const agent = { kind: 'agent' as const };
    assert.equal(
      tokenSummary([
        ...Array<typeof personal>(10).fill(personal),
        ...Array<typeof agent>(5).fill(agent),
      ]),
      '15 working · 10 personal · 5 tool credentials',
    );
    assert.equal(tokenSummary([agent]), '1 working · 1 tool credential');
    assert.equal(tokenSummary([personal, personal]), '2 working · 2 personal');
  });

  void test('the first three rows, then all of them once asked', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(shownRows(rows, false), { shown: ['a', 'b', 'c'], hidden: 2 });
    assert.deepEqual(shownRows(rows, true), { shown: rows, hidden: 0 });
    assert.deepEqual(shownRows(['a', 'b', 'c'], false), { shown: ['a', 'b', 'c'], hidden: 0 });
  });
});
