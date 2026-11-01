/**
 * `src/api/agent-devices.ts` — the reader's agents grouped by device (LAI-591,
 * API by LAI-590, SPEC §4.63 and §6.4). Each call goes to the path, method and
 * body §6.4 names, with the label the list gave it — `null` for the unnamed
 * group, never `''`; and what a revoke or a confirm changes on screen is only
 * what the server said it did.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  confirmAgentDevice,
  deviceKey,
  harnessRows,
  listAgentDevices,
  revokeAgentDevice,
  revokedOnly,
  revokeTargets,
  withRecognised,
  withRevoked,
  type AgentDevice,
} from '../../src/api/agent-devices.ts';
import type { RegisteredAgent } from '../../src/api/agents.ts';
import type { TokenView } from '../../src/api/tokens.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

function token(id: string, revokedAt: number | null = null): TokenView {
  return {
    id,
    name: id,
    prefix: 'lai_abcd',
    scope: 'full',
    project_ids: null,
    last_used_at: null,
    last_mcp_at: null,
    last_client: null,
    last_client_name: null,
    expires_at: null,
    revoked_at: revokedAt,
    created_at: 1,
  };
}

function agent(id: string, over: Partial<RegisteredAgent> = {}): RegisteredAgent {
  return {
    id,
    owner_user_id: 'u1',
    owner_display_name: 'Ada',
    display_name: id,
    harness: 'claude-code',
    device_label: 'Belka',
    status: 'active',
    grants: [],
    tokens: [token(`t-${id}`)],
    created_at: 1,
    revoked_at: null,
    last_seen_at: null,
    ...over,
  };
}

function device(over: Partial<AgentDevice> & Pick<AgentDevice, 'agents'>): AgentDevice {
  const active = over.agents.filter((a) => a.status === 'active').length;
  return {
    device_label: 'belka',
    display_name: 'Belka',
    recognised: true,
    last_seen_at: null,
    active_count: active,
    revoked_count: over.agents.length - active,
    ...over,
  };
}

void describe('the calls', () => {
  void test('the list is one GET of /agents/devices — never paged', async () => {
    const sent = stub({ data: [] });
    assert.deepEqual(await listAgentDevices(), { data: [] });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, 'GET');
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/agents\/devices$/);
  });

  void test('confirm and revoke POST the label the list gave, null for the unnamed group', async () => {
    const sent = stub({ revoked_agent_ids: ['a1'] });
    await revokeAgentDevice('belka');
    await revokeAgentDevice(null);
    await confirmAgentDevice(null);
    assert.deepEqual(
      sent.map((s) => [s.method, s.url.replace(/^.*\/api\/v1/, ''), s.body]),
      [
        ['POST', '/agents/devices/revoke', { device_label: 'belka' }],
        ['POST', '/agents/devices/revoke', { device_label: null }],
        ['POST', '/agents/devices/confirm', { device_label: null }],
      ],
    );
  });
});

void describe('reading a device', () => {
  void test('the unnamed group keys as the server keys it, and two labels never share a key', () => {
    assert.equal(deviceKey({ device_label: null }), '');
    assert.equal(deviceKey({ device_label: 'belka' }), 'belka');
    assert.notEqual(deviceKey({ device_label: 'strelka' }), deviceKey({ device_label: 'belka' }));
  });

  void test('revoke would end only the agents still active, in the order the server listed', () => {
    const d = device({
      agents: [agent('a3'), agent('a2', { status: 'revoked', revoked_at: 5 }), agent('a1')],
    });
    assert.deepEqual(
      revokeTargets(d).map((a) => a.id),
      ['a3', 'a1'],
    );
  });

  void test('a device with nothing active is revoked-only; one active agent is enough to be live', () => {
    assert.equal(
      revokedOnly(device({ agents: [agent('a1', { status: 'revoked', revoked_at: 2 })] })),
      true,
    );
    assert.equal(
      revokedOnly(
        device({ agents: [agent('a1', { status: 'revoked', revoked_at: 2 }), agent('a2')] }),
      ),
      false,
    );
  });
});

void describe('what a write changes', () => {
  const belka = device({
    agents: [agent('a1'), agent('a2'), agent('a0', { status: 'revoked', revoked_at: 3 })],
  });
  const strelka = device({
    device_label: 'strelka',
    display_name: 'Strelka',
    recognised: false,
    agents: [agent('s1', { device_label: 'Strelka' })],
  });

  void test('revoked: only the named ids change, with their tokens, and the counts are recounted', () => {
    const [b, s] = withRevoked([belka, strelka], ['a1', 'a2'], 99);
    assert.ok(b !== undefined && s !== undefined);
    assert.deepEqual(
      b.agents.map((a) => [a.id, a.status, a.revoked_at, a.tokens[0]?.revoked_at]),
      [
        ['a1', 'revoked', 99, 99],
        ['a2', 'revoked', 99, 99],
        // Already revoked: its own time stands.
        ['a0', 'revoked', 3, null],
      ],
    );
    assert.equal(b.active_count, 0);
    assert.equal(b.revoked_count, 3);
    assert.equal(s, strelka, 'another device is the same object, untouched');
  });

  void test('revoked: an id the server did not name stays active, even on the same device', () => {
    const [b] = withRevoked([belka], ['a1'], 99);
    assert.deepEqual(
      b?.agents.map((a) => a.status),
      ['revoked', 'active', 'revoked'],
    );
    assert.equal(b?.active_count, 1);
    assert.equal(b?.revoked_count, 2);
  });

  void test('revoked: an empty answer changes nothing', () => {
    const before = [belka, strelka];
    const after = withRevoked(before, [], 99);
    assert.equal(after[0], belka);
    assert.equal(after[1], strelka);
  });

  void test('recognised: only the confirmed label flips', () => {
    const [b, s] = withRecognised([belka, strelka], 'strelka');
    assert.equal(s?.recognised, true);
    assert.equal(b, belka);
  });

  void test('recognised: confirming the unnamed group does not touch a named one', () => {
    const unnamed = device({
      device_label: null,
      display_name: 'Unnamed device',
      recognised: false,
      agents: [agent('u1', { device_label: null })],
    });
    const [s, u] = withRecognised([strelka, unnamed], null);
    assert.equal(s?.recognised, false);
    assert.equal(u?.recognised, true);
  });
});

void describe('one row per harness (D-120, LAI-1001)', () => {
  void test('each harness on the device is one row, in the order the device lists them', () => {
    const rows = harnessRows(
      device({
        agents: [
          agent('om', { harness: 'omnigent' }),
          agent('cc', { harness: 'claude-code' }),
          agent('cx', { harness: 'codex', status: 'revoked' }),
        ],
      }),
    );
    assert.deepEqual(
      rows.map((r) => [r.harness, r.agents.map((a) => a.id), r.active, r.duplicate]),
      [
        ['omnigent', ['om'], 1, false],
        ['claude-code', ['cc'], 1, false],
        ['codex', ['cx'], 0, false],
      ],
    );
  });

  void test('two active agents of one harness are one row, flagged as a legacy duplicate', () => {
    const [row, ...rest] = harnessRows(
      device({
        agents: [
          agent('old', { harness: 'omnigent', status: 'revoked' }),
          agent('polly', { harness: 'omnigent' }),
          agent('by-hand', { harness: 'omnigent' }),
        ],
      }),
    );
    assert.equal(rest.length, 0);
    assert.equal(row?.duplicate, true);
    assert.equal(row?.active, 2);
    // Active first, the device's order kept within each.
    assert.deepEqual(
      row?.agents.map((a) => a.id),
      ['polly', 'by-hand', 'old'],
    );
  });

  void test('one active agent beside a revoked predecessor is no duplicate', () => {
    const [row] = harnessRows(
      device({
        agents: [
          agent('new', { harness: 'omnigent' }),
          agent('old', { harness: 'omnigent', status: 'revoked' }),
        ],
      }),
    );
    assert.equal(row?.duplicate, false);
    assert.equal(row?.agents.length, 2);
  });

  void test('harnesses Laika does not know share the one Other row', () => {
    const rows = harnessRows(
      device({ agents: [agent('a', { harness: 'made-up' }), agent('b', { harness: 'other' })] }),
    );
    assert.deepEqual(
      rows.map((r) => [r.harness, r.duplicate]),
      [['other', true]],
    );
  });
});
