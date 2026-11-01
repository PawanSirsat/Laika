/**
 * What the V3 Devices tab says (LAI-1054), from `GET /devices` alone: each
 * tool's status word — never *Ready*, *Connected* only from the agent's own
 * recent request — the conflicts section, the revoked toggle's counts, and
 * what a disconnect names.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentSession, RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { Device } from '../../../../../src/api/devices.ts';
import type { TokenView } from '../../../../../src/api/tokens.ts';
import {
  ACTIVE_MS,
  OFFLINE_MS,
} from '../../../../../src/routes/screens/developer/v3/overview-state.ts';
import {
  deviceCounts,
  deviceLive,
  deviceOf,
  deviceTools,
  devicesSummary,
  disconnectImpact,
  kindWord,
  needsConfirm,
  runningSessions,
  sessionLine,
  toolStatus,
  withAgent,
  withConfirmed,
} from '../../../../../src/routes/screens/developer/v3/devices-view.ts';

const NOW = 1_800_000_000_000;

const token = (over: Partial<TokenView> = {}): TokenView => ({
  id: 't1',
  name: 't1',
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_id: 'a1',
  agent_label: 'Claude Code · Belka',
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  ...over,
});

const agent = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [token()],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  ...over,
});

const device = (over: Partial<Device> & { id: string; agents: RegisteredAgent[] }): Device => {
  const active = over.agents.filter((a) => a.status === 'active').length;
  return {
    display_name: 'Belka',
    device_label: 'belka',
    kind: 'local',
    origin: 'imported',
    status: 'active',
    confirmed: true,
    confirmed_at: null,
    paired_at: null,
    key_fingerprint: null,
    last_seen_at: null,
    active_count: active,
    revoked_count: over.agents.length - active,
    created_at: 1,
    revoked_at: null,
    ...over,
  };
};

const session = (over: Partial<AgentSession> & { id: string }): AgentSession => ({
  agent_id: 'a1',
  started_at: NOW - 5 * 60_000,
  last_heartbeat_at: NOW - 30_000,
  ended_at: null,
  end_reason: null,
  client_version: null,
  harness: null,
  harness_version: null,
  model: null,
  connection: 'live',
  ...over,
});

void describe('toolStatus', () => {
  void test('a live credential never used is Needs setup', () => {
    const s = toolStatus(agent({ id: 'a1' }), NOW);
    assert.equal(s.word, 'Needs setup');
    assert.equal(s.reason, 'Credential created, never used');
  });

  void test('no live credential is Needs setup, whatever the agent did before', () => {
    const revokedToken = agent({
      id: 'a1',
      last_seen_at: NOW - 60_000,
      tokens: [token({ revoked_at: NOW - 1 })],
    });
    assert.equal(toolStatus(revokedToken, NOW).word, 'Needs setup');
    assert.equal(toolStatus(revokedToken, NOW).reason, 'No live credential on this device');
    const expired = agent({ id: 'a1', tokens: [token({ expires_at: NOW - 1 })] });
    assert.equal(toolStatus(expired, NOW).reason, 'Its credential has expired');
  });

  void test('Connected only from the agent’s own request within 15 minutes', () => {
    assert.equal(
      toolStatus(agent({ id: 'a1', last_seen_at: NOW - 60_000 }), NOW).word,
      'Connected',
    );
    assert.equal(
      toolStatus(agent({ id: 'a1', last_seen_at: NOW - ACTIVE_MS }), NOW).word,
      'Connected',
    );
    assert.equal(
      toolStatus(agent({ id: 'a1', last_seen_at: NOW - ACTIVE_MS - 1 }), NOW).word,
      'Idle',
    );
  });

  void test('only the agent’s own last_seen_at reads as Connected, never a token stamp', () => {
    // `last_seen_at` is what the server moves on a request authenticated as
    // this agent; a token stamp is not read, so it can make no row Connected.
    const a = agent({ id: 'a1', tokens: [token({ last_used_at: NOW - 1000 })] });
    assert.equal(toolStatus(a, NOW).word, 'Needs setup');
  });

  void test('past seven days is Offline', () => {
    assert.equal(toolStatus(agent({ id: 'a1', last_seen_at: NOW - OFFLINE_MS }), NOW).word, 'Idle');
    assert.equal(
      toolStatus(agent({ id: 'a1', last_seen_at: NOW - OFFLINE_MS - 1 }), NOW).word,
      'Offline',
    );
  });

  void test('revoked reads as Revoked', () => {
    assert.equal(toolStatus(agent({ id: 'a1', status: 'revoked' }), NOW).word, 'Revoked');
  });

  void test('no state, ever, is Ready', () => {
    const seen = [null, NOW, NOW - ACTIVE_MS - 1, NOW - OFFLINE_MS - 1];
    for (const last of seen) {
      for (const status of ['active', 'revoked'] as const) {
        for (const tokens of [[token()], [], [token({ revoked_at: 1 })]]) {
          const s = toolStatus(agent({ id: 'a1', last_seen_at: last, status, tokens }), NOW);
          assert.notEqual(s.word, 'Ready');
          assert.doesNotMatch(s.reason, /ready/i);
        }
      }
    }
  });
});

void describe('deviceTools', () => {
  void test('one active agent per tool is a row; two of one tool are a conflict, both kept', () => {
    const d = device({
      id: 'd1',
      agents: [
        agent({ id: 'a1', harness: 'claude-code' }),
        agent({ id: 'a2', harness: 'codex' }),
        agent({ id: 'a3', harness: 'codex' }),
        agent({ id: 'a4', harness: 'cursor', status: 'revoked' }),
      ],
    });
    const t = deviceTools(d);
    assert.deepEqual(
      t.tools.map((a) => a.id),
      ['a1'],
    );
    assert.equal(t.conflicts.length, 1);
    assert.deepEqual(
      t.conflicts[0]?.agents.map((a) => a.id),
      ['a2', 'a3'],
    );
    assert.equal(t.conflicts[0]?.label, 'Codex · Belka');
    assert.deepEqual(
      t.revoked.map((a) => a.id),
      ['a4'],
    );
  });

  void test('an active agent beside a revoked one of the same tool is no conflict', () => {
    const d = device({
      id: 'd1',
      agents: [agent({ id: 'a1' }), agent({ id: 'a0', status: 'revoked' })],
    });
    const t = deviceTools(d);
    assert.equal(t.conflicts.length, 0);
    assert.deepEqual(
      t.tools.map((a) => a.id),
      ['a1'],
    );
  });
});

void describe('deviceLive and deviceCounts: revoked hidden and never counted', () => {
  const live = device({
    id: 'd1',
    agents: [agent({ id: 'a1' }), agent({ id: 'a2', status: 'revoked' })],
  });
  const allRevoked = device({
    id: 'd2',
    display_name: 'Old',
    agents: [agent({ id: 'a3', status: 'revoked' })],
  });
  const revokedEmpty = device({ id: 'd3', status: 'revoked', agents: [] });
  const pairedEmpty = device({ id: 'd4', origin: 'paired', agents: [] });

  void test('which devices list without Show revoked', () => {
    assert.equal(deviceLive(live), true);
    assert.equal(deviceLive(allRevoked), false);
    assert.equal(deviceLive(revokedEmpty), false);
    assert.equal(deviceLive(pairedEmpty), true);
  });

  void test('counts exclude revoked; the toggle counts what it would add', () => {
    const c = deviceCounts([live, allRevoked, revokedEmpty, pairedEmpty]);
    assert.deepEqual(c, { devices: 2, tools: 1, revoked: 3 });
    assert.equal(devicesSummary(c), '2 devices, 1 tool.');
  });
});

void describe('needsConfirm', () => {
  void test('only an active imported device nobody confirmed', () => {
    assert.equal(needsConfirm({ origin: 'imported', confirmed: false, status: 'active' }), true);
    assert.equal(needsConfirm({ origin: 'imported', confirmed: true, status: 'active' }), false);
    assert.equal(needsConfirm({ origin: 'paired', confirmed: false, status: 'active' }), false);
    assert.equal(needsConfirm({ origin: 'imported', confirmed: false, status: 'revoked' }), false);
  });

  void test('kind in words', () => {
    assert.equal(kindWord({ kind: 'cloud' }), 'Cloud');
    assert.equal(kindWord({ kind: 'local' }), 'Local');
  });
});

void describe('disconnectImpact: names exactly what stops', () => {
  void test('the credential by prefix and each running session by what it said ran', () => {
    const impact = disconnectImpact(
      agent({ id: 'a1' }),
      [
        session({
          id: 's1',
          harness: 'claude-code',
          harness_version: '2.1',
          model: 'claude-opus-5-5',
        }),
        session({ id: 's2', connection: 'suspect' }),
        session({ id: 's3', ended_at: NOW - 1, connection: 'ended' }),
      ],
      NOW,
    );
    assert.equal(impact.credential, 'Its credential lai_abcd… stops working at once.');
    assert.match(impact.sessionsLine, /^These 2 sessions end/);
    assert.deepEqual(impact.sessions, [
      'Claude Code 2.1 · claude-opus-5-5, started 5 min ago',
      'A session, started 5 min ago, not heard from lately',
    ]);
  });

  void test('sessions that could not be read are said so, never as none', () => {
    const impact = disconnectImpact(agent({ id: 'a1' }), undefined, NOW);
    assert.match(impact.sessionsLine, /could not be read/);
    assert.deepEqual(impact.sessions, []);
  });

  void test('no running session, and no live credential', () => {
    const impact = disconnectImpact(agent({ id: 'a1', tokens: [] }), [], NOW);
    assert.equal(impact.credential, 'It holds no live credential.');
    assert.equal(impact.sessionsLine, 'It has no running session.');
  });

  void test('runningSessions and sessionLine', () => {
    assert.equal(runningSessions([session({ id: 's', ended_at: 1 })]).length, 0);
    assert.equal(
      sessionLine(session({ id: 's', harness: 'some-new-tool' }), NOW),
      'some-new-tool, started 5 min ago',
    );
  });
});

void describe('what a write changes', () => {
  void test('withAgent replaces the row and recounts the device', () => {
    const d = device({
      id: 'd1',
      agents: [agent({ id: 'a1' }), agent({ id: 'a2', harness: 'codex' })],
    });
    const [next] = withAgent([d], agent({ id: 'a1', status: 'revoked' }));
    assert.equal(next?.active_count, 1);
    assert.equal(next?.revoked_count, 1);
    assert.equal(next?.agents[0]?.status, 'revoked');
  });

  void test('withConfirmed marks only that device', () => {
    const a = device({ id: 'd1', confirmed: false, agents: [] });
    const b = device({ id: 'd2', confirmed: false, agents: [] });
    const [x, y] = withConfirmed([a, b], 'd2');
    assert.equal(x?.confirmed, false);
    assert.equal(y?.confirmed, true);
  });

  void test('deviceOf finds the device holding an agent', () => {
    const d = device({ id: 'd1', agents: [agent({ id: 'a1' })] });
    assert.equal(deviceOf([d], 'a1')?.id, 'd1');
    assert.equal(deviceOf([d], 'zz'), undefined);
  });
});
