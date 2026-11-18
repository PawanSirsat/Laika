/**
 * Developer access V3 → Activity's checklist (LAI-1327): each step's state
 * from its own signal, locked in order, and the lines, links and headline the
 * tab draws from them.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { Device } from '../../../../../src/api/devices.ts';
import type { TokenView } from '../../../../../src/api/tokens.ts';
import {
  ACTIVITY_STEP_NAMES,
  activityCommands,
  activityHeadline,
  activitySteps,
  TROUBLES,
  type ActivityInputs,
} from '../../../../../src/routes/screens/developer/v3/activity-state.ts';
import {
  OVERVIEW_ADDRESSES,
  toolAddress,
} from '../../../../../src/routes/screens/developer/v3/overview-state.ts';
import { NEVER_REPORTED } from '../../../../helpers/launcher.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

/** A tool's own credential, as the Overview's fixtures give one. */
const credential: TokenView = {
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
};

const agent = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [credential],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  launcher: NEVER_REPORTED,
  ...over,
});

const device = (over: Partial<Device> & { id: string; agents: RegisteredAgent[] }): Device => {
  const active = over.agents.filter((a) => a.status === 'active').length;
  return {
    display_name: 'Belka',
    device_label: 'belka',
    kind: 'local',
    origin: 'paired',
    status: 'active',
    confirmed: true,
    confirmed_at: null,
    paired_at: 1,
    key_fingerprint: null,
    last_seen_at: null,
    active_count: active,
    revoked_count: over.agents.length - active,
    created_at: 1,
    revoked_at: null,
    launcher: NEVER_REPORTED,
    ...over,
  };
};

/** A tool whose own credential reached the board a minute ago. */
const connected = (id: string) => agent({ id, last_seen_at: NOW - MIN });

const inputs = (over: Partial<ActivityInputs> = {}): ActivityInputs => ({
  orgEnabled: true,
  devices: [],
  lastReceivedAt: null,
  collectors: 0,
  now: NOW,
  ...over,
});

const states = (over: Partial<ActivityInputs>) =>
  activitySteps(inputs(over)).map((step) => [step.key, step.state, step.locked ?? '']);

void describe('the checklist, in order (LAI-1327)', () => {
  void test('the five steps, by name, in the order a person meets them', () => {
    assert.deepEqual(
      activitySteps(inputs()).map((step) => step.name),
      [
        'Your organisation collects activity',
        'This machine is paired',
        'A coding tool is connected',
        'Turn it on on that machine',
        'First data arrives',
      ],
    );
    assert.deepEqual(Object.keys(ACTIVITY_STEP_NAMES), [
      'org',
      'device',
      'tool',
      'command',
      'data',
    ]);
  });

  void test('organisation off: step 1 is next, every later one locked on it', () => {
    assert.deepEqual(states({ orgEnabled: false }), [
      ['org', 'active', ''],
      ['device', 'pending', 'Developer insights must be on first'],
      ['tool', 'pending', 'Developer insights must be on first'],
      ['command', 'pending', 'Developer insights must be on first'],
      ['data', 'pending', 'Developer insights must be on first'],
    ]);
  });

  void test('collecting, no device: pair one — Add device opens that wizard', () => {
    const steps = activitySteps(inputs());
    assert.deepEqual(states({}), [
      ['org', 'done', ''],
      ['device', 'active', ''],
      ['tool', 'pending', 'Pair this machine first'],
      ['command', 'pending', 'Pair this machine first'],
      ['data', 'pending', 'Pair this machine first'],
    ]);
    assert.deepEqual(steps[1]?.action, {
      label: 'Add device',
      href: OVERVIEW_ADDRESSES.addDevice,
    });
    assert.equal(steps[1]?.line, 'Pair the machine you code on, once');
  });

  void test('a device, no tool: Add tool opens that wizard', () => {
    const steps = activitySteps(inputs({ devices: [device({ id: 'd1', agents: [] })] }));
    assert.equal(steps[1]?.line, '1 device · Belka');
    assert.deepEqual(steps[1]?.action, { label: 'Manage', href: OVERVIEW_ADDRESSES.devices });
    assert.equal(steps[2]?.state, 'active');
    assert.deepEqual(steps[2]?.action, { label: 'Add tool', href: OVERVIEW_ADDRESSES.addTool });
    assert.equal(steps[3]?.locked, 'Connect a coding tool first');
  });

  void test('a tool registered but never seen: Finish setup goes to its row', () => {
    const steps = activitySteps(
      inputs({ devices: [device({ id: 'd1', agents: [agent({ id: 'a1', harness: 'codex' })] })] }),
    );
    assert.equal(steps[2]?.state, 'active');
    assert.equal(steps[2]?.line, 'Codex · Belka registered, not connected yet');
    assert.deepEqual(steps[2]?.action, { label: 'Finish setup', href: toolAddress('a1') });
  });

  void test('a tool connected, nothing received: the commands are next, the data waits on them', () => {
    const over = { devices: [device({ id: 'd1', agents: [connected('a1')] })] };
    assert.deepEqual(states(over), [
      ['org', 'done', ''],
      ['device', 'done', ''],
      ['tool', 'done', ''],
      ['command', 'active', ''],
      ['data', 'pending', 'Turn it on on the machine first'],
    ]);
    const steps = activitySteps(inputs(over));
    assert.equal(steps[2]?.line, '1 tool connected');
    assert.deepEqual(steps[2]?.action, { label: 'Manage', href: OVERVIEW_ADDRESSES.tools });
    assert.equal(
      steps[3]?.line,
      'Run these on that machine: it uses its tool connection, no credential to paste',
    );
    assert.equal(steps[4]?.line, 'Waiting… start an agent session or run `laika activity sync`');
    assert.equal(steps[3]?.action, undefined, 'the commands are a copy block, not a link');
  });

  void test('data received: every step done, and when it last came', () => {
    const over = {
      devices: [device({ id: 'd1', agents: [connected('a1')] })],
      lastReceivedAt: NOW - 4 * MIN,
      collectors: 1,
    };
    assert.deepEqual(
      states(over).map(([key, state]) => [key, state]),
      [
        ['org', 'done'],
        ['device', 'done'],
        ['tool', 'done'],
        ['command', 'done'],
        ['data', 'done'],
      ],
    );
    assert.equal(activitySteps(inputs(over))[4]?.line, 'Received from one machine, last 4 min ago');
    assert.equal(
      activitySteps(inputs({ ...over, collectors: 2 }))[4]?.line,
      'Received from 2 machines, last 4 min ago',
    );
    // Nothing in the last 14 days, but something once.
    assert.equal(
      activitySteps(inputs({ ...over, collectors: 0, lastReceivedAt: NOW - 20 * 24 * 60 * MIN }))[4]
        ?.line,
      'Last received 20 d ago',
    );
  });

  void test('a step done is done whatever came before it: the organisation off later keeps the history', () => {
    const over = {
      orgEnabled: false,
      devices: [device({ id: 'd1', agents: [connected('a1')] })],
      lastReceivedAt: NOW - MIN,
      collectors: 1,
    };
    assert.deepEqual(
      states(over).map(([key, state]) => [key, state]),
      [
        ['org', 'active'],
        ['device', 'done'],
        ['tool', 'done'],
        ['command', 'done'],
        ['data', 'done'],
      ],
    );
  });

  void test('a revoked device is no device', () => {
    const steps = activitySteps(
      inputs({ devices: [device({ id: 'd1', status: 'revoked', agents: [] })] }),
    );
    assert.equal(steps[1]?.state, 'active');
  });
});

void describe('the headline, the commands, and what to do when it isn’t working', () => {
  void test('off, not set up, or collecting with when it last came', () => {
    assert.deepEqual(activityHeadline(inputs({ orgEnabled: false })), {
      kind: 'off',
      text: 'Off for the organisation',
    });
    assert.deepEqual(activityHeadline(inputs()), {
      kind: 'not-set-up',
      text: 'Not set up on any machine',
    });
    assert.deepEqual(activityHeadline(inputs({ lastReceivedAt: NOW - 4 * MIN })), {
      kind: 'collecting',
      text: 'Collecting · last received 4 min ago',
    });
  });

  void test('the commands: the CLI brought to this board’s build, then the collector on', () => {
    assert.equal(
      activityCommands('https://ksage.kvelld.com'),
      'laika update --board https://ksage.kvelld.com\nlaika activity on',
    );
  });

  void test('each thing the collector says when it cannot send has a fix', () => {
    assert.deepEqual(
      TROUBLES.map((t) => t.key),
      ['org-off', 'not-connected', 'refused', 'read-only'],
    );
    for (const trouble of TROUBLES) {
      assert.ok(trouble.says.length > 0 && trouble.fix.length > 0, trouble.key);
    }
    // Word for word what `laika activity on` prints (cli/src/activity-sync.ts, LAI-1325).
    assert.equal(
      TROUBLES.find((t) => t.key === 'not-connected')?.says,
      'This machine is not connected to a board',
    );
  });
});
