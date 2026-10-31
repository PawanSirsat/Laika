/**
 * A task's selected agent, as the screens read it (LAI-538, server LAI-535).
 *
 * The rules the drawer, the card, the List and the activity rows share: which
 * agents the picker offers and why one cannot be picked, what a `422` says,
 * how an agent is named, what the filter keeps, and who an agent's row says
 * acted.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../src/api/agents.ts';
import { ApiError } from '../../src/api/errors.ts';
import {
  AGENT_FILTER_ANY,
  AGENT_FILTER_NONE,
  agentFilterLabel,
  agentLabel,
  harnessName,
  agentNamesFrom,
  agentsOnTasks,
  agentVia,
  AVAILABLE_WITHIN_MS,
  describeAgentSelected,
  distinctDevices,
  ineligibleReason,
  matchesAgentFilter,
  middleCut,
  pickerChoices,
  REFUSAL_WORDS,
  refusalOf,
  SELECTED_AGENT_REFUSALS,
  selectionErrorWords,
  twinNames,
  twinsOnTasks,
  type SelectedAgent,
} from '../../src/api/selected-agent.ts';
import { AVAILABILITY_WORDS } from '../../src/components/agent/agent-states.ts';

const NOW = 1_800_000_000_000;

const registered = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: 'Laptop agent',
  harness: 'claude-code',
  device_label: 'laptop-1',
  status: 'active',
  grants: [{ project_id: 'p1', scope: 'full' }],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: NOW - 60_000,
  ...over,
});

const selected = (over: Partial<SelectedAgent> & { id: string }): SelectedAgent => ({
  display_name: 'Laptop agent',
  harness: 'claude-code',
  device_label: 'laptop-1',
  status: 'active',
  owner: { id: 'u1', name: 'Ada Lovelace' },
  ...over,
});

void describe('the refusals mirror the server', () => {
  void test('every reason the server can send is in the list, and no other', async () => {
    // Names from both sides, never a count.
    const source = await readFile(
      new URL('../../../src/services/work-requests.ts', import.meta.url),
      'utf8',
    );
    const block = /SELECTED_AGENT_REFUSALS = \[([\s\S]*?)\]/.exec(source)?.[1];
    assert.ok(block !== undefined, 'SELECTED_AGENT_REFUSALS not found in the server');
    const server = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...SELECTED_AGENT_REFUSALS], server);
  });

  void test('every reason has words', () => {
    for (const reason of SELECTED_AGENT_REFUSALS) {
      assert.ok(REFUSAL_WORDS[reason].length > 10, `${reason} has no sentence`);
    }
  });

  void test('a 422 about selected_agent_id is read by its reason, in words', () => {
    const error = new ApiError('unprocessable', 'server words', 422, {
      field: 'selected_agent_id',
      reason: 'agent_not_granted',
      selected_agent_id: 'ag1',
    });
    assert.equal(refusalOf(error), 'agent_not_granted');
    assert.equal(selectionErrorWords(error), REFUSAL_WORDS.agent_not_granted);
  });

  void test('another 422, or an unknown reason, keeps the server’s own message', () => {
    const other = new ApiError('unprocessable', 'Title is required', 422, { field: 'title' });
    assert.equal(refusalOf(other), undefined);
    assert.equal(selectionErrorWords(other), 'Title is required');
    const unknown = new ApiError('unprocessable', 'New reason', 422, {
      field: 'selected_agent_id',
      reason: 'agent_on_holiday',
    });
    assert.equal(selectionErrorWords(unknown), 'New reason');
  });
});

void describe('who the picker offers', () => {
  void test('the server’s eligibility checks, in its order', () => {
    assert.equal(ineligibleReason(registered({ id: 'a' }), 'p1', true), undefined);
    assert.equal(
      ineligibleReason(registered({ id: 'a', status: 'revoked', grants: [] }), 'p1', true),
      'agent_revoked',
    );
    assert.equal(
      ineligibleReason(registered({ id: 'a', grants: [] }), 'p1', true),
      'agent_not_granted',
    );
    assert.equal(
      ineligibleReason(
        registered({ id: 'a', grants: [{ project_id: 'p1', scope: 'read_only' }] }),
        'p1',
        true,
      ),
      'agent_read_only',
    );
    assert.equal(ineligibleReason(registered({ id: 'a' }), 'p1', false), 'agents_off');
  });

  void test('available first, offline still pickable, ineligible disabled with a reason', () => {
    const rows = pickerChoices({
      agents: [
        registered({ id: 'ungranted', grants: [] }),
        registered({ id: 'quiet', last_seen_at: NOW - AVAILABLE_WITHIN_MS - 1 }),
        registered({ id: 'live' }),
      ],
      ownerName: 'Ada Lovelace',
      projectId: 'p1',
      agentsAllowed: true,
      current: null,
      now: NOW,
    });
    assert.deepEqual(
      rows.map((r) => [r.id, r.availability, r.reason]),
      [
        ['live', 'available', undefined],
        ['quiet', 'offline', undefined],
        ['ungranted', 'unavailable', 'Not granted on this space'],
      ],
    );
    // The availability union is the components' one.
    for (const row of rows) assert.ok(row.availability in AVAILABILITY_WORDS);
  });

  void test('a revoked agent is left out, unless it is the current choice', () => {
    const agents = [registered({ id: 'gone', status: 'revoked' })];
    const base = { agents, ownerName: 'A', projectId: 'p1', agentsAllowed: true, now: NOW };
    assert.equal(pickerChoices({ ...base, current: null }).length, 0);
    const kept = pickerChoices({ ...base, current: selected({ id: 'gone', status: 'revoked' }) });
    assert.deepEqual(
      kept.map((r) => [r.id, r.reason]),
      [['gone', 'Revoked']],
    );
  });

  void test('another member’s selected agent is shown, disabled, so the field can say it', () => {
    const rows = pickerChoices({
      agents: [],
      ownerName: 'Ada Lovelace',
      projectId: 'p1',
      agentsAllowed: true,
      current: selected({ id: 'theirs', owner: { id: 'u2', name: 'Bob' } }),
      now: NOW,
    });
    assert.deepEqual(
      rows.map((r) => [r.id, r.owner, r.availability, r.reason]),
      [['theirs', 'Bob', 'unavailable', 'Another member’s agent']],
    );
  });
});

void describe('naming an agent', () => {
  void test('product and device: Claude Code · laptop-1', () => {
    assert.equal(agentLabel(selected({ id: 'a' })), 'Claude Code · laptop-1');
  });

  void test('the registered name is never the label (D-120): Polly on omnigent, Belka', () => {
    assert.equal(
      agentLabel(
        selected({ id: 'a', harness: 'omnigent', display_name: 'Polly', device_label: 'Belka' }),
      ),
      'Omnigent · Belka',
    );
    assert.equal(
      agentLabel(
        selected({ id: 'a', harness: 'codex', display_name: 'runner', device_label: 'Cloud' }),
      ),
      'Codex · Cloud',
    );
  });

  void test('no device reads No device, an unknown harness Other harness — never the name', () => {
    assert.equal(agentLabel(selected({ id: 'a', device_label: null })), 'Claude Code · No device');
    assert.equal(agentLabel(selected({ id: 'a', device_label: '   ' })), 'Claude Code · No device');
    assert.equal(
      agentLabel(selected({ id: 'a', harness: 'made-up', display_name: 'Rig' })),
      'Other harness · laptop-1',
    );
  });

  void test('the shared harness word: a known product, or Other harness — never another agent', () => {
    assert.equal(harnessName('omnigent'), 'Omnigent');
    assert.equal(harnessName('other'), 'Other harness');
  });

  void test('a device is trimmed, so the label is the pair the server compares', () => {
    assert.equal(
      agentLabel(selected({ id: 'a', device_label: '  Belka ' })),
      'Claude Code · Belka',
    );
  });
});

void describe('the agent filter', () => {
  const withAgent = { selected_agent: selected({ id: 'ag1' }) };
  const without = { selected_agent: null };
  const legacy = {};

  void test('no value keeps everything', () => {
    for (const t of [withAgent, without, legacy])
      assert.equal(matchesAgentFilter(t, undefined), true);
  });

  void test('any, none and one agent', () => {
    assert.equal(matchesAgentFilter(withAgent, AGENT_FILTER_ANY), true);
    assert.equal(matchesAgentFilter(without, AGENT_FILTER_ANY), false);
    assert.equal(matchesAgentFilter(legacy, AGENT_FILTER_NONE), true, 'a pre-LAI-535 view');
    assert.equal(matchesAgentFilter(withAgent, 'ag1'), true);
    assert.equal(matchesAgentFilter(withAgent, 'ag2'), false);
  });

  void test('offers only the agents on the tasks, once each, by label', () => {
    const offered = agentsOnTasks([
      { selected_agent: selected({ id: 'b', device_label: 'zeta' }) },
      { selected_agent: selected({ id: 'a', device_label: 'alpha' }) },
      { selected_agent: selected({ id: 'b', device_label: 'zeta' }) },
      { selected_agent: null },
    ]);
    assert.deepEqual(
      offered.map((a) => a.id),
      ['a', 'b'],
    );
  });

  void test('the chip says which agent, and waits rather than guessing', () => {
    const agents = new Map([['ag1', selected({ id: 'ag1' })]]);
    assert.equal(agentFilterLabel('ag1', agents, true), 'Agent: Claude Code · laptop-1');
    assert.equal(agentFilterLabel('any', agents, true), 'Agent: Any agent');
    assert.equal(agentFilterLabel('none', agents, true), 'Agent: No agent');
    assert.equal(agentFilterLabel('zz', agents, false), 'Agent: …');
    assert.equal(agentFilterLabel('zz', agents, true), 'Agent: Unknown agent');
  });
});

void describe('who an agent’s row says acted', () => {
  const agents = new Map([['ag1', selected({ id: 'ag1' })]]);

  void test('a person’s and Laika’s rows have no via', () => {
    assert.equal(agentVia({ actor_kind: 'user', agent_id: null }, agents), undefined);
    assert.equal(agentVia({ actor_kind: 'system' }, agents), undefined);
  });

  void test('a registered agent by name, else said honestly', () => {
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: 'ag1' }, agents),
      'Claude Code · laptop-1',
    );
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: 'other' }, agents),
      'a registered agent',
    );
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: null }, agents),
      'agent (unregistered token)',
    );
    assert.equal(agentVia({ actor_kind: 'agent' }, agents), 'agent (unregistered token)');
  });

  void test('task.agent_selected names the agent, or says it was withdrawn', () => {
    assert.equal(
      describeAgentSelected({ from: null, to: 'ag1' }, agents),
      'selected Claude Code · laptop-1 for this task',
    );
    assert.equal(
      describeAgentSelected({ from: 'ag1', to: null }, agents),
      'withdrew the agent from this task',
    );
    assert.equal(
      describeAgentSelected({ from: null, to: 'unseen' }, agents),
      'selected an agent for this task',
    );
    assert.equal(describeAgentSelected(null, agents), undefined);
  });

  // LAI-1011: the server sets `agent_redacted` when it withheld an agent, so a
  // null reads as "an agent" and never as a legacy token or a withdrawal.
  void test('a row the server withheld an agent from says "an agent", never a guess', () => {
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: null, agent_redacted: true }, agents),
      'an agent',
    );
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: null, agent_redacted: false }, agents),
      'agent (unregistered token)',
    );
    assert.equal(
      describeAgentSelected({ from: null, to: null }, agents, true),
      'changed the agent selection on this task',
    );
    // Not redacted: a null `to` really is a withdrawal.
    assert.equal(
      describeAgentSelected({ from: 'ag1', to: null }, agents, false),
      'withdrew the agent from this task',
    );
    // Redacted, but the new agent is one the reader may see: named as before.
    assert.equal(
      describeAgentSelected({ from: null, to: 'ag1' }, agents, true),
      'selected Claude Code · laptop-1 for this task',
    );
  });

  void test('names come from the reader’s own agents and the tasks they hold, nothing else', () => {
    const names = agentNamesFrom(
      [registered({ id: 'mine', harness: 'cursor', device_label: 'tablet' })],
      [{ selected_agent: selected({ id: 'onTask', harness: 'codex', device_label: 'desktop-2' }) }],
    );
    assert.deepEqual([...names.keys()].sort(), ['mine', 'onTask']);
    assert.equal(agentVia({ actor_kind: 'agent', agent_id: 'mine' }, names), 'Cursor · tablet');
    assert.equal(agentVia({ actor_kind: 'agent', agent_id: 'onTask' }, names), 'Codex · desktop-2');
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: 'theirs' }, names),
      'a registered agent',
    );
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: null }, names),
      'agent (unregistered token)',
    );
  });
});

/*
 * **Two agents that share a harness and a device can be told apart**
 * (LAI-583). Measured live in LAI-582: the label is `harness · device`, so two
 * Claude Code agents on Belka read the same on the card, in the picker, in the
 * List and in History. D-118 keeps that name; only a collision adds the name
 * the owner registered.
 */
void describe('two agents that share a harness and a device', () => {
  const polly = registered({ id: 'ag-0001', display_name: 'polly workers', device_label: 'Belka' });
  const direct = registered({ id: 'ag-0002', display_name: 'by hand', device_label: 'Belka' });
  const strelka = registered({ id: 'ag-0003', display_name: 'x', device_label: 'Strelka' });

  void test('alone, an agent is its harness and device; a pair gets its registered name', () => {
    const devices = distinctDevices([polly, direct, strelka]);
    assert.equal(devices.get('ag-0001'), 'Belka (polly workers)');
    assert.equal(devices.get('ag-0002'), 'Belka (by hand)');
    assert.equal(devices.get('ag-0003'), 'Strelka');
    assert.equal(distinctDevices([polly]).get('ag-0001'), 'Belka');
  });

  void test('a name that adds nothing falls back to the id, so the pair still differs', () => {
    const a = registered({
      id: 'ag-aaaa',
      display_name: 'Claude Code · Belka',
      device_label: 'Belka',
    });
    const b = registered({
      id: 'ag-bbbb',
      display_name: 'Claude Code · Belka',
      device_label: 'Belka',
    });
    const devices = distinctDevices([a, b]);
    assert.equal(devices.get('ag-aaaa'), 'Belka (aaaa)');
    assert.equal(devices.get('ag-bbbb'), 'Belka (bbbb)');
  });

  void test('the same agent listed twice is not a collision', () => {
    assert.equal(distinctDevices([polly, { ...polly }]).get('ag-0001'), 'Belka');
  });

  void test('the picker, the filter, the cards and History all tell them apart', () => {
    const rows = pickerChoices({
      agents: [polly, direct],
      ownerName: 'Pawan',
      projectId: 'p1',
      agentsAllowed: true,
      current: null,
      now: NOW,
    });
    assert.deepEqual(rows.map((r) => r.device).sort(), [
      'Belka (by hand)',
      'Belka (polly workers)',
    ]);

    const onPolly = { selected_agent: selected({ ...polly, id: 'ag-0001' }) };
    const onDirect = { selected_agent: selected({ ...direct, id: 'ag-0002' }) };
    assert.deepEqual(agentsOnTasks([onPolly, onDirect]).map(agentLabel), [
      'Claude Code · Belka (by hand)',
      'Claude Code · Belka (polly workers)',
    ]);
    const board = new Map([
      ['t1', onPolly],
      ['t2', onDirect],
    ]);
    assert.equal(twinsOnTasks(board).get('ag-0001'), 'polly workers');
    assert.equal(twinsOnTasks(board), twinsOnTasks(board), 'kept per board, not per card');

    // History: one is on a task, the other is only the reader's own.
    const names = agentNamesFrom([direct], [onPolly]);
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: 'ag-0001' }, names),
      'Claude Code · Belka (polly workers)',
    );
    assert.equal(
      agentVia({ actor_kind: 'agent', agent_id: 'ag-0002' }, names),
      'Claude Code · Belka (by hand)',
    );
  });
});

/*
 * **Every label among the agents given is different** (LAI-583 review). The
 * first version appended the id's last four characters without checking the
 * result: two agents named alike whose ids end alike read the same, and a
 * fallback could equal another agent's registered name.
 */
void describe('the marks are checked, not hoped for', () => {
  const at = (id: string, display_name: string, device_label = 'Belka') =>
    registered({ id, display_name, device_label });
  const labels = (agents: readonly ReturnType<typeof at>[]) => {
    const devices = distinctDevices(agents);
    return agents.map((a) => `${agentLabel(a).split(' · ')[0] ?? ''} · ${devices.get(a.id) ?? ''}`);
  };
  const allDifferent = (list: readonly string[]) => new Set(list).size === list.length;

  void test('two named alike, ids ending alike: the id grows until they differ', () => {
    const a = at('01AAAAAAAAAAAAAAAAAAAA1234', 'worker');
    const b = at('01BBBBBBBBBBBBBBBBBBBB1234', 'worker');
    const marks = twinNames([a, b]);
    assert.equal(marks.get(a.id), 'A1234');
    assert.equal(marks.get(b.id), 'B1234');
    assert.ok(allDifferent(labels([a, b])), labels([a, b]).join(' | '));
  });

  void test('a fallback never equals another agent’s registered name', () => {
    const named = at('01CCCCCCCCCCCCCCCCCCCC9999', '1234');
    const plain = at('01DDDDDDDDDDDDDDDDDDDD1234', '');
    const marks = twinNames([named, plain]);
    assert.equal(marks.get(named.id), '1234');
    assert.equal(marks.get(plain.id), 'D1234');
    assert.ok(allDifferent(labels([named, plain])), labels([named, plain]).join(' | '));
  });

  void test('a device that already reads like a mark is caught by the final check', () => {
    const a = at('01EEEEEEEEEEEEEEEEEEEEAAAA', 'worker');
    const b = at('01FFFFFFFFFFFFFFFFFFFFBBBB', 'other');
    const c = at('01GGGGGGGGGGGGGGGGGGGGCCCC', 'x', 'Belka (worker)');
    const list = labels([a, b, c]);
    assert.ok(allDifferent(list), list.join(' | '));
  });

  void test('the answer does not depend on the order given', () => {
    const a = at('01HHHHHHHHHHHHHHHHHHHH1234', 'worker');
    const b = at('01JJJJJJJJJJJJJJJJJJJJ1234', 'worker');
    const c = at('01KKKKKKKKKKKKKKKKKKKK5678', 'worker');
    assert.deepEqual([...twinNames([a, b, c])].sort(), [...twinNames([c, a, b])].sort());
  });

  void test('a long name is cut in the middle, and two that differ only there are told apart by id', () => {
    assert.equal(middleCut('a-very-long-agent-name-number-one'), 'a-very-long-…-number-one');
    assert.equal(middleCut('short'), 'short');
    const a = at('01MMMMMMMMMMMMMMMMMMMM0001', 'a-very-long-agent-name-ALPHA-number-one');
    const b = at('01NNNNNNNNNNNNNNNNNNNN0002', 'a-very-long-agent-name-BRAVO-number-one');
    const marks = twinNames([a, b]);
    assert.equal(marks.get(a.id), '0001');
    assert.equal(marks.get(b.id), '0002');
  });

  void test('across many shapes, no two labels are ever the same', () => {
    const names = ['', 'worker', 'Worker', '1234', 'A1234', 'Claude Code · Belka', 'Belka'];
    const tails = ['1234', '1234', 'A1234', '5678'];
    let checked = 0;
    for (const n1 of names)
      for (const n2 of names)
        for (const n3 of names) {
          const agents = [n1, n2, n3].map((name, i) =>
            at(`01${String.fromCharCode(65 + i).repeat(18)}AB${tails[i] ?? ''}`, name),
          );
          const list = labels(agents);
          assert.ok(allDifferent(list), list.join(' | '));
          checked += 1;
        }
    assert.equal(checked, names.length ** 3);
  });
});

void describe('another owner’s agent arrives without its name (D-120, LAI-1001)', () => {
  void test('two withheld names on one pair are still told apart, by id', () => {
    const peer = (id: string) => ({
      id,
      display_name: null,
      harness: 'codex',
      device_label: 'Bob’s laptop',
    });
    const twins = twinNames([peer('ag-0001aaaa'), peer('ag-0002bbbb')]);
    assert.equal(twins.get('ag-0001aaaa'), 'aaaa');
    assert.equal(twins.get('ag-0002bbbb'), 'bbbb');
    assert.equal(agentLabel(peer('x')), 'Codex · Bob’s laptop');
  });
});
