/**
 * What the V3 Overview says (LAI-1048), from the devices list alone: the
 * journey's next step, where *Continue* goes, and the returning summary.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentDevice } from '../../../../../src/api/agent-devices.ts';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import {
  ACTIVE_MS,
  OFFLINE_MS,
  OVERVIEW_ADDRESSES,
  overviewState,
  overviewSummary,
  toolActivity,
  toolAddress,
} from '../../../../../src/routes/screens/developer/v3/overview-state.ts';

const agent = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  ...over,
});

const device = (label: string, agents: RegisteredAgent[]): AgentDevice => {
  const active = agents.filter((a) => a.status === 'active').length;
  return {
    device_label: label.toLowerCase(),
    display_name: label,
    recognised: true,
    last_seen_at: null,
    active_count: active,
    revoked_count: agents.length - active,
    agents,
  };
};

void describe('overviewState: first run', () => {
  void test('nothing at all: the next step is a device, and Continue adds one', () => {
    const s = overviewState([]);
    assert.equal(s.kind, 'first-run');
    if (s.kind !== 'first-run') return;
    assert.equal(s.next, 'device');
    assert.equal(s.resume, OVERVIEW_ADDRESSES.addDevice);
    assert.deepEqual(
      s.steps.map((x) => [x.step, x.done]),
      [
        ['device', false],
        ['tool', false],
        ['project', false],
      ],
    );
  });

  void test('a registered agent nobody has heard from: device done, Continue goes to it', () => {
    const s = overviewState([device('Belka', [agent({ id: 'a1' })])]);
    assert.equal(s.kind, 'first-run');
    if (s.kind !== 'first-run') return;
    assert.equal(s.next, 'tool');
    assert.equal(s.steps[0].done, true);
    assert.equal(s.steps[0].sub, 'Belka');
    assert.equal(s.steps[1].done, false);
    assert.equal(s.pending?.id, 'a1');
    assert.equal(s.resume, toolAddress('a1'));
  });

  void test('a device with only revoked agents is no device', () => {
    const s = overviewState([
      device('Belka', [agent({ id: 'a1', status: 'revoked', last_seen_at: 5 })]),
    ]);
    assert.equal(s.kind, 'first-run');
    if (s.kind !== 'first-run') return;
    assert.equal(s.next, 'device');
    assert.equal(s.steps[0].done, false);
  });
});

void describe('overviewState: returning', () => {
  void test('one tool that has reached the board ends the funnel', () => {
    const s = overviewState([
      device('Belka', [
        agent({ id: 'a1', last_seen_at: 10, grants: [{ project_id: 'p1', scope: 'full' }] }),
        agent({ id: 'a2', created_at: 2, grants: [{ project_id: 'p1', scope: 'read_only' }] }),
        agent({ id: 'gone', status: 'revoked', grants: [{ project_id: 'p9', scope: 'full' }] }),
      ]),
      device('Strelka', [agent({ id: 'a3', grants: [{ project_id: 'p2', scope: 'full' }] })]),
    ]);
    assert.equal(s.kind, 'returning');
    if (s.kind !== 'returning') return;
    assert.equal(s.devices, 2);
    // Newest first, revoked left out of every count.
    assert.deepEqual(
      s.tools.map((t) => t.id),
      ['a2', 'a1', 'a3'],
    );
    assert.equal(s.projects, 2, 'p1 and p2; the revoked agent’s p9 does not count');
    assert.equal(s.notConnected, 2);
  });
});

void describe('toolActivity', () => {
  const now = 10 * OFFLINE_MS;
  void test('never seen, active, idle, offline — at the edges', () => {
    assert.equal(toolActivity({ last_seen_at: null }, now), 'not-connected');
    assert.equal(toolActivity({ last_seen_at: now }, now), 'active');
    assert.equal(toolActivity({ last_seen_at: now - ACTIVE_MS }, now), 'active');
    assert.equal(toolActivity({ last_seen_at: now - ACTIVE_MS - 1 }, now), 'idle');
    assert.equal(toolActivity({ last_seen_at: now - OFFLINE_MS }, now), 'idle');
    assert.equal(toolActivity({ last_seen_at: now - OFFLINE_MS - 1 }, now), 'offline');
  });
});

void describe('overviewSummary: what the live region says (review round 1)', () => {
  void test('first run names the next step', () => {
    assert.equal(overviewSummary(overviewState([])), 'Next step: Add a device.');
    assert.equal(
      overviewSummary(overviewState([device('Belka', [agent({ id: 'a1' })])])),
      'Next step: Add a coding tool.',
    );
  });

  void test('returning counts as connected only the tools the board has heard from', () => {
    // The browser test's returning fixture: a1 seen, a2 never.
    const s = overviewState([
      device('Belka', [agent({ id: 'a1', last_seen_at: 10 })]),
      device('Strelka', [agent({ id: 'a2', created_at: 2 })]),
    ]);
    assert.equal(overviewSummary(s), '2 tools on this board, 1 connected.');
    assert.doesNotMatch(overviewSummary(s), /2 tools connected/);
  });

  void test('one tool, seen, is one tool and one connected', () => {
    const s = overviewState([device('Belka', [agent({ id: 'a1', last_seen_at: 10 })])]);
    assert.equal(overviewSummary(s), '1 tool on this board, 1 connected.');
  });

  void test('revoked agents are in neither number', () => {
    const s = overviewState([
      device('Belka', [
        agent({ id: 'a1', last_seen_at: 10 }),
        agent({ id: 'gone', status: 'revoked', last_seen_at: 9 }),
      ]),
    ]);
    assert.equal(overviewSummary(s), '1 tool on this board, 1 connected.');
  });
});
