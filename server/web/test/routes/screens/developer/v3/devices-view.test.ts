/**
 * What the V3 Devices and Tools tabs say (LAI-1054, LAI-1080), from
 * `GET /devices` alone: each tool's status word — never *Ready*, *Connected*
 * only from the agent's own recent request — the conflicts section, the
 * revoked toggles' counts, and what a disconnect names. And the one place a
 * row may say *Ready*: `listedStatus`, from the tool's own verification.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentSession, RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { Device } from '../../../../../src/api/devices.ts';
import type { TokenView } from '../../../../../src/api/tokens.ts';
import type { AgentVerification } from '../../../../../src/api/tool-setup.ts';
import {
  ACTIVE_MS,
  OFFLINE_MS,
} from '../../../../../src/routes/screens/developer/v3/overview-state.ts';
import {
  anyPaired,
  chipTone,
  conflictsToReview,
  deviceChip,
  deviceCounts,
  deviceLine,
  deviceLive,
  deviceOf,
  deviceTools,
  devicesSummary,
  disconnectImpact,
  everyDeviceRevoked,
  findTool,
  kindName,
  kindWord,
  listedStatus,
  listedTools,
  needsConfirm,
  revokedDevice,
  runningSessions,
  sessionLine,
  toolAction,
  toolLine,
  toolStatus,
  withAgent,
  withConfirmed,
  withRevokedAgents,
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
    // The warn tone (LAI-1097), as readiness() gives it.
    assert.equal(s.tone, 'warn');
  });

  void test('no live credential is Needs setup, whatever the agent did before', () => {
    const revokedToken = agent({
      id: 'a1',
      last_seen_at: NOW - 60_000,
      tokens: [token({ revoked_at: NOW - 1 })],
    });
    assert.equal(toolStatus(revokedToken, NOW).word, 'Needs setup');
    assert.equal(toolStatus(revokedToken, NOW).tone, 'warn');
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
  const importedEmpty = device({ id: 'd5', origin: 'imported', confirmed: false, agents: [] });

  void test('which devices list without Show revoked', () => {
    assert.equal(deviceLive(live), true);
    assert.equal(deviceLive(allRevoked), false);
    assert.equal(deviceLive(revokedEmpty), false);
    assert.equal(deviceLive(pairedEmpty), true);
    // An imported label no agent carries any more is not a device to show.
    assert.equal(deviceLive(importedEmpty), false);
  });

  void test('counts exclude revoked; each toggle counts what it would add', () => {
    const c = deviceCounts([live, allRevoked, revokedEmpty, pairedEmpty, importedEmpty]);
    // Devices' toggle adds allRevoked and revokedEmpty; Tools' adds a2 and a3.
    // The empty imported label is neither listed nor revoked.
    assert.deepEqual(c, { devices: 2, tools: 1, revokedDevices: 2, revokedTools: 2 });
    assert.equal(devicesSummary(c), '2 devices, 1 tool.');
    assert.equal(revokedDevice(allRevoked), true);
    assert.equal(revokedDevice(revokedEmpty), true);
    assert.equal(revokedDevice(importedEmpty), false);
    assert.equal(revokedDevice(live), false);
  });
  // LAI-1070: pair Walkbook, add one tool, disconnect it. The device is still
  // active and paired — the one the next tool goes on — so it stays listed.
  const pairedAllRevoked = device({
    id: 'd6',
    display_name: 'Walkbook',
    origin: 'paired',
    paired_at: 1,
    agents: [agent({ id: 'a6', status: 'revoked' })],
  });
  const pairedSomeRevoked = device({
    id: 'd7',
    origin: 'paired',
    paired_at: 1,
    agents: [agent({ id: 'a7' }), agent({ id: 'a8', harness: 'codex', status: 'revoked' })],
  });

  void test('a paired active device stays listed whatever its tools state (LAI-1070)', () => {
    assert.equal(deviceLive(pairedAllRevoked), true);
    assert.equal(deviceLive(pairedSomeRevoked), true);
    // A revoked paired device is still history.
    assert.equal(deviceLive({ ...pairedAllRevoked, status: 'revoked' }), false);
    // An imported device whose tools are all revoked keeps today's behaviour.
    assert.equal(deviceLive(allRevoked), false);
    const c = deviceCounts([pairedAllRevoked]);
    assert.deepEqual(c, { devices: 1, tools: 0, revokedDevices: 0, revokedTools: 1 });
    assert.equal(devicesSummary(c), '1 device, 0 tools.');
  });

  void test('"every device is revoked" only when every device is', () => {
    assert.equal(everyDeviceRevoked([revokedEmpty]), true);
    assert.equal(everyDeviceRevoked([revokedEmpty, pairedAllRevoked]), false);
    assert.equal(everyDeviceRevoked([allRevoked]), false);
    assert.equal(everyDeviceRevoked([]), false);
  });
});

void describe('needsConfirm', () => {
  void test('only an active imported device nobody confirmed, while an agent carries its label', () => {
    const agents = [agent({ id: 'a1' })];
    const ask = (over: Partial<Device>) =>
      needsConfirm({ origin: 'imported', confirmed: false, status: 'active', agents, ...over });
    assert.equal(ask({}), true);
    assert.equal(ask({ confirmed: true }), false);
    assert.equal(ask({ origin: 'paired' }), false);
    assert.equal(ask({ status: 'revoked' }), false);
    // Confirming a label no agent carries is a 404 on the server.
    assert.equal(ask({ agents: [] }), false);
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
    // Claims lapse; the server never releases them on a revoke.
    assert.equal(
      impact.claims,
      'Any task it holds stays claimed until its claim lapses, then it can be recovered.',
    );
    assert.doesNotMatch(`${impact.sessionsLine} ${impact.claims}`, /releas/i);
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

  void test('withRevokedAgents changes only the ids the server named, and recounts', () => {
    const d = device({
      id: 'd1',
      agents: [agent({ id: 'a1' }), agent({ id: 'a2', harness: 'codex' })],
    });
    const [next] = withRevokedAgents([d], ['a1'], NOW);
    assert.equal(next?.agents[0]?.status, 'revoked');
    assert.equal(next?.agents[1]?.status, 'active');
    assert.equal(next?.active_count, 1);
    assert.equal(next?.revoked_count, 1);
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

// ------------------------------------------------------------------ LAI-1080: one line a row

const check = <D>(state: 'pass' | 'fail', detail: D, at: number | null = null) => ({
  state,
  at,
  detail,
});

/** A verification for one agent: `ready` is its own request lately, with a session. */
const verification = (
  agentId: string,
  harness: string,
  how: 'ready' | 'used' | 'unused',
): AgentVerification => ({
  agent_id: agentId,
  harness,
  status: 'active',
  now: NOW,
  last_seen_at: how === 'unused' ? null : NOW - 60_000,
  checks: {
    device_paired: check('pass', { device_id: 'd1' }, NOW - 600_000),
    credential_installed: check('pass', { token_id: 't1', via_exchange: true }, NOW - 600_000),
    credential_used: check(how === 'unused' ? 'fail' : 'pass', null),
    tool_request: check(
      how === 'ready' ? 'pass' : 'fail',
      {
        evidence: how === 'ready' ? ('client_info' as const) : null,
        mcp_client_name: 'specific' as const,
        client_slug: how === 'ready' ? harness : null,
        client_name: how === 'ready' ? harness : null,
        client_version: null,
        self_reported: true as const,
      },
      how === 'ready' ? NOW - 60_000 : null,
    ),
    required_capabilities: check('pass', { required: [], missing: [] }),
    session_hooks: check(
      how === 'ready' ? 'pass' : 'fail',
      { harness: how === 'ready' ? harness : null },
      how === 'ready' ? NOW - 60_000 : null,
    ),
  },
  client_report: null,
});

void describe('listedStatus: Ready only from the tool’s own verification', () => {
  const seen = agent({ id: 'a1', last_seen_at: NOW - 60_000 });

  void test('no verification yet is the agent’s own stamps, which never say Ready', () => {
    const s = listedStatus(seen, undefined, NOW);
    assert.equal(s.word, 'Connected');
    assert.equal(s.evidence, false);
  });

  void test('its own request and a session lately is Ready, from evidence', () => {
    const s = listedStatus(seen, verification('a1', 'claude-code', 'ready'), NOW);
    assert.equal(s.key, 'ready');
    assert.equal(s.word, 'Ready');
    assert.equal(s.evidence, true);
  });

  void test('a credential used by something else is Connected, not Ready', () => {
    const s = listedStatus(seen, verification('a1', 'claude-code', 'used'), NOW);
    assert.equal(s.key, 'connected');
    assert.notEqual(s.word, 'Ready');
  });

  void test('installed and never used is Needs setup', () => {
    const s = listedStatus(agent({ id: 'a1' }), verification('a1', 'claude-code', 'unused'), NOW);
    assert.equal(s.key, 'needs-setup');
  });

  void test('a revoked agent, or a kind the catalog has no checks for, never reads its verification', () => {
    const v = verification('a1', 'claude-code', 'ready');
    assert.equal(listedStatus(agent({ id: 'a1', status: 'revoked' }), v, NOW).word, 'Revoked');
    const other = agent({ id: 'a1', harness: 'some-new-tool', last_seen_at: NOW - 60_000 });
    const s = listedStatus(other, verification('a1', 'some-new-tool', 'ready'), NOW);
    assert.equal(s.evidence, false);
    assert.notEqual(s.word, 'Ready');
  });

  void test('the design chip has no blue: waiting is the accent, the rest keep their tone', () => {
    assert.equal(chipTone('waiting'), 'accent');
    assert.equal(chipTone('ok'), 'ok');
    assert.equal(chipTone('warn'), 'warn');
    assert.equal(chipTone('neutral'), 'neutral');
    assert.equal(chipTone('danger'), 'danger');
  });
});

void describe('one line a device, one line a tool', () => {
  void test('a device: its kind, its active tools and when it was last seen', () => {
    const d = device({
      id: 'd1',
      last_seen_at: NOW - 60_000,
      agents: [
        agent({ id: 'a1' }),
        agent({ id: 'a2', harness: 'codex' }),
        agent({ id: 'a3', harness: 'cursor', status: 'revoked' }),
      ],
    });
    assert.equal(deviceLine(d, NOW), 'Local computer · 2 tools · last seen 1 min ago');
    assert.equal(
      deviceLine(device({ id: 'd2', kind: 'cloud', agents: [] }), NOW),
      'Cloud runner · No tools yet · never seen',
    );
    assert.equal(kindName({ kind: 'local' }), 'Local computer');
  });

  void test('a tool: how many projects it reaches, and when it was seen', () => {
    assert.equal(toolLine(agent({ id: 'a1' }), NOW), 'No project yet · never seen');
    assert.equal(
      toolLine(
        agent({
          id: 'a1',
          last_seen_at: NOW - 60_000,
          grants: [{ project_id: 'p1', scope: 'full' }],
        }),
        NOW,
      ),
      '1 project · seen 1 min ago',
    );
  });

  void test('a device’s chip: how it got here, and whether it still works', () => {
    const one = [agent({ id: 'a1' })];
    assert.deepEqual(deviceChip(device({ id: 'd1', origin: 'paired', agents: one })), {
      word: 'Paired',
      tone: 'ok',
    });
    assert.equal(
      deviceChip(device({ id: 'd1', confirmed: false, agents: one })).word,
      'Imported — confirm it’s yours',
    );
    assert.equal(deviceChip(device({ id: 'd1', agents: one })).word, 'Imported');
    assert.equal(
      deviceChip(device({ id: 'd1', status: 'revoked', origin: 'paired', agents: [] })).word,
      'Revoked',
    );
  });
});

void describe('the Tools list agrees with Devices', () => {
  const belka = device({
    id: 'd1',
    agents: [
      agent({ id: 'a1' }),
      agent({ id: 'a2', harness: 'codex', display_name: 'old laptop' }),
      agent({ id: 'a3', harness: 'codex', display_name: 'new laptop' }),
      agent({ id: 'a4', harness: 'cursor', status: 'revoked' }),
    ],
  });
  const old = device({
    id: 'd2',
    display_name: 'Old',
    device_label: 'old',
    agents: [agent({ id: 'a9', device_label: 'Old', status: 'revoked' })],
  });

  void test('every active tool on a listed device, conflicts after; as many as the count', () => {
    const rows = listedTools([belka, old], false);
    assert.deepEqual(
      rows.map((r) => r.agent.id),
      ['a1', 'a2', 'a3'],
    );
    assert.equal(rows.length, deviceCounts([belka, old]).tools);
    assert.deepEqual(
      rows.map((r) => r.inConflict),
      [false, true, true],
    );
    assert.equal(rows[1]?.label, 'Codex · Belka (old laptop)');
  });

  void test('Show revoked adds every revoked agent, on any device', () => {
    const rows = listedTools([belka, old], true);
    assert.deepEqual(
      rows.map((r) => r.agent.id),
      ['a1', 'a2', 'a3', 'a4', 'a9'],
    );
    assert.equal(deviceCounts([belka, old]).revokedTools, 2);
  });

  void test('findTool finds any agent, revoked too, with its conflict', () => {
    assert.equal(findTool([belka], 'a2')?.inConflict, true);
    assert.equal(findTool([belka], 'a4')?.agent.status, 'revoked');
    assert.equal(findTool([belka], 'zz'), undefined);
  });

  void test('conflicts to review: the devices with pairs, and how many pairs', () => {
    const review = conflictsToReview([belka, old]);
    assert.deepEqual(
      review.devices.map((d) => d.id),
      ['d1'],
    );
    assert.equal(review.count, 1);
  });

  void test('Add a device first: only when no device is paired', () => {
    assert.equal(anyPaired([belka]), false);
    assert.equal(
      anyPaired([device({ id: 'd3', paired_at: 1, origin: 'paired', agents: [] })]),
      true,
    );
  });

  void test('a row’s action: Finish setup while it needs setup, Set up project after', () => {
    const paired = device({
      id: 'd5',
      origin: 'paired',
      paired_at: 1,
      agents: [agent({ id: 'a1' })],
    });
    const row = findTool([paired], 'a1');
    assert.ok(row !== undefined);
    assert.equal(toolAction(row, { key: 'needs-setup' }), 'finish-in-wizard');
    assert.equal(toolAction(row, { key: 'ready' }), 'set-up-project');
    // Imported: no key to redeem an exchange with, so its details finish it.
    const imported = findTool([belka], 'a1');
    assert.ok(imported !== undefined);
    assert.equal(toolAction(imported, { key: 'needs-setup' }), 'finish-in-details');
    const gone = findTool([belka], 'a4');
    assert.ok(gone !== undefined);
    assert.equal(toolAction(gone, { key: 'revoked' }), 'none');
  });
});
