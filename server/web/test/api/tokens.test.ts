/**
 * `src/api/tokens.ts` — personal access tokens (SPEC §4.9, screen by LAI-410).
 *
 * Two rules here are worth testing rather than trusting. **The viewer's scope is
 * forced, not validated**: the server gives a viewer `read_only` whatever they
 * ask for, so a UI that offered the choice would not fail — it would quietly
 * mint something other than what was requested. And **"never used" is the common
 * case**, because a token is minted before it is wired up.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  agentRevokeImpact,
  forcedTokenScope,
  lastUsedLabel,
  listTokens,
  listUserTokens,
  mayChooseScope,
  tokenAgentLabel,
  tokensByKind,
  tokenState,
  type TokenView,
} from '../../src/api/tokens.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function token(patch: Partial<TokenView>): TokenView {
  return {
    id: 't1',
    name: 'mira-cli',
    prefix: 'lai_GGkS',
    scope: 'full',
    project_ids: null,
    last_used_at: null,
    last_mcp_at: null,
    last_client: null,
    last_client_name: null,
    kind: 'personal',
    agent_id: null,
    agent_label: null,
    expires_at: null,
    revoked_at: null,
    created_at: NOW - DAY,
    ...patch,
  };
}

void describe('a viewer’s scope is decided, not offered', () => {
  void test('a viewer asking for full still gets read_only', () => {
    // The server forces rather than refuses (§3.1). Offering the choice would
    // mint something other than what was asked for, with no error to show it.
    assert.equal(forcedTokenScope('viewer', 'full'), 'read_only');
  });

  void test('everyone else keeps what they asked for', () => {
    for (const role of ['owner', 'admin', 'member']) {
      assert.equal(forcedTokenScope(role, 'full'), 'full', `${role} lost their scope`);
      assert.equal(forcedTokenScope(role, 'read_only'), 'read_only');
    }
  });

  void test('the control is hidden from exactly the role whose choice is ignored', () => {
    assert.equal(mayChooseScope('viewer'), false);
    for (const role of ['owner', 'admin', 'member']) {
      assert.equal(mayChooseScope(role), true, `${role} was denied a real choice`);
    }
  });

  void test('the two agree — nobody is offered a choice that is then overridden', () => {
    // The assertion that fails if they ever drift apart. Offering the control
    // to someone whose request is forced is the exact defect AC5 names.
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const offered = mayChooseScope(role);
      const honoured = forcedTokenScope(role, 'full') === 'full';
      assert.equal(offered, honoured, `${role} is offered a choice the server overrides`);
    }
  });
});

void describe('a token’s state is more than revoked or not', () => {
  void test('a live token is active', () => {
    assert.equal(tokenState(token({}), NOW), 'active');
  });

  void test('revoked wins over everything', () => {
    assert.equal(tokenState(token({ revoked_at: NOW - HOUR }), NOW), 'revoked');
  });

  void test('an expiry in the past is expired, not active', () => {
    // It is not revoked and it does not work. Rendering it as active is a lie
    // the holder discovers only when a request fails.
    assert.equal(tokenState(token({ expires_at: NOW - MINUTE }), NOW), 'expired');
  });

  void test('expiring exactly now is already expired', () => {
    assert.equal(tokenState(token({ expires_at: NOW }), NOW), 'expired');
  });

  void test('a future expiry is still active', () => {
    assert.equal(tokenState(token({ expires_at: NOW + DAY }), NOW), 'active');
  });

  void test('a revoked token that also expired reads revoked', () => {
    const both = token({ revoked_at: NOW - DAY, expires_at: NOW - HOUR });
    assert.equal(tokenState(both, NOW), 'revoked', 'the deliberate act should win');
  });
});

void describe('last used says something, never a dash', () => {
  void test('never used is a sentence, not missing data', () => {
    // The common case: a token is minted before it is wired up. A dash reads as
    // "we do not know", which is a different claim.
    assert.equal(lastUsedLabel(null, NOW), 'Never used');
  });

  void test('it scales through minutes, hours and days', () => {
    assert.equal(lastUsedLabel(NOW - 30_000, NOW), 'Used just now');
    assert.equal(lastUsedLabel(NOW - 5 * MINUTE, NOW), 'Used 5m ago');
    assert.equal(lastUsedLabel(NOW - 3 * HOUR, NOW), 'Used 3h ago');
    assert.equal(lastUsedLabel(NOW - 9 * DAY, NOW), 'Used 9d ago');
  });

  void test('every branch says "used" except the one that never was', () => {
    const used = [30_000, 5 * MINUTE, 3 * HOUR, 9 * DAY].map((ago) =>
      lastUsedLabel(NOW - ago, NOW),
    );
    for (const label of used) assert.match(label, /^Used /);
    assert.ok(!lastUsedLabel(null, NOW).startsWith('Used '));
  });
});

// ------------------------------------------------------------------ kind (LAI-1046)

function credential(id: string, agentId: string, patch: Partial<TokenView> = {}): TokenView {
  return token({
    id,
    name: 'Secret registered name',
    kind: 'agent',
    agent_id: agentId,
    agent_label: 'claude-code · Belka',
    ...patch,
  });
}

void describe('an agent credential is named as its agent (D-120)', () => {
  void test('the harness slug reads as the product, the device as sent', () => {
    assert.equal(tokenAgentLabel(credential('t', 'a')), 'Claude Code · Belka');
    assert.equal(
      tokenAgentLabel(credential('t', 'a', { agent_label: 'mystery · No device' })),
      'Other harness · No device',
    );
  });

  void test('a device with the separator in it keeps it', () => {
    assert.equal(
      tokenAgentLabel(credential('t', 'a', { agent_label: 'codex · ci · runner' })),
      'Codex · ci · runner',
    );
  });

  void test('a personal token, or a reply without the field, has none', () => {
    assert.equal(tokenAgentLabel(token({})), null);
    const { agent_label: _dropped, ...old } = token({});
    assert.equal(tokenAgentLabel(old as unknown as TokenView), null);
  });
});

void describe('tokensByKind', () => {
  void test('splits in order, and a row without kind counts as personal', () => {
    const { kind: _dropped, ...old } = token({ id: 'old' });
    const all = [
      token({ id: 'p1' }),
      credential('c1', 'a'),
      old as unknown as TokenView,
      credential('c2', 'b'),
    ];
    const { personal, agent } = tokensByKind(all);
    assert.deepEqual(
      personal.map((t) => t.id),
      ['p1', 'old'],
    );
    assert.deepEqual(
      agent.map((t) => t.id),
      ['c1', 'c2'],
    );
  });
});

void describe('what revoking an agent credential stops', () => {
  void test('its only live credential: the tool stops, and stays registered', () => {
    const only = credential('c1', 'a');
    const said = agentRevokeImpact(only, 'Ada', [only], NOW);
    assert.match(said, /^This is Claude Code · Belka’s only live credential\./);
    assert.match(said, /stops that tool at once/);
    assert.match(said, /its open event streams close/);
    assert.match(said, /claims its sessions hold lapse/);
    assert.match(said, /stays registered with no live credential until Ada reconnects it/);
    assert.doesNotMatch(said, /Secret registered name/);
  });

  void test('another live credential of the same agent: the tool keeps working', () => {
    const one = credential('c1', 'a');
    const two = credential('c2', 'a');
    assert.match(agentRevokeImpact(one, 'Ada', [one, two], NOW), /the tool does not stop/);
  });

  void test('a revoked sibling, or another agent’s, does not count', () => {
    const one = credential('c1', 'a');
    const dead = credential('c2', 'a', { revoked_at: NOW - DAY });
    const other = credential('c3', 'b');
    assert.match(agentRevokeImpact(one, 'Ada', [one, dead, other], NOW), /only live credential/);
  });
});

void describe('?kind= on the two lists', () => {
  const realFetch = globalThis.fetch;

  function stub(): string[] {
    const urls: string[] = [];
    globalThis.fetch = ((input: string | URL) => {
      urls.push(input instanceof URL ? input.href : input);
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], next_cursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    return urls;
  }

  void test('absent sends no kind, as before; set, it follows the page', async () => {
    const urls = stub();
    try {
      await listTokens(undefined, {});
      await listTokens(undefined, { limit: 200 }, 'personal');
      await listTokens(undefined, {}, 'agent');
      await listUserTokens('u 1', undefined, { cursor: 'c' }, 'agent');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(
      urls.map((u) => u.replace(/^.*\/api\/v1/, '')),
      [
        '/tokens',
        '/tokens?limit=200&kind=personal',
        '/tokens?kind=agent',
        '/users/u%201/tokens?cursor=c&kind=agent',
      ],
    );
  });
});
