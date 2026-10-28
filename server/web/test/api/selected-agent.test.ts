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
  agentNamesFrom,
  agentsOnTasks,
  agentVia,
  AVAILABLE_WITHIN_MS,
  describeAgentSelected,
  ineligibleReason,
  matchesAgentFilter,
  pickerChoices,
  REFUSAL_WORDS,
  refusalOf,
  SELECTED_AGENT_REFUSALS,
  selectionErrorWords,
  type SelectedAgent,
} from '../../src/api/selected-agent.ts';
import { AVAILABILITY_WORDS } from '../../src/components/agent/agent-states.ts';

const NOW = 1_800_000_000_000;

const registered = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
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

  void test('no device falls back to the agent’s own name; an unknown harness to its name too', () => {
    assert.equal(
      agentLabel(selected({ id: 'a', device_label: null })),
      'Claude Code · Laptop agent',
    );
    assert.equal(
      agentLabel(selected({ id: 'a', harness: 'made-up', display_name: 'Rig' })),
      'Rig · laptop-1',
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
