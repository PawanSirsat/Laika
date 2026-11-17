/**
 * `agent-lanes.ts` — the Workroom's four lanes (LAI-1199). Each lane is read
 * from its own field and says "nothing" in words when the field is empty;
 * no lane ever says a task is assigned to an agent.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { HandoffOffer } from '../../../../src/api/handoffs.ts';
import type { Round } from '../../../../src/api/review.ts';
import type { SelectedAgent } from '../../../../src/api/selected-agent.ts';
import type { TaskLiveClaim } from '../../../../src/api/tasks.ts';
import type { ClaimHistory } from '../../../../src/components/agent/execution-derive.ts';
import { agentLanes, type LaneInput } from '../../../../src/routes/screens/workroom/agent-lanes.ts';

const NOW = 1_000_000_000;

const AGENT: SelectedAgent = {
  id: 'a1',
  display_name: 'shell-cc',
  harness: 'claude-code',
  device_label: 'belka',
  status: 'active',
  owner: { id: 'u1', name: 'Ada' },
};

const CLAIM: TaskLiveClaim = {
  generation: 3,
  state: 'active',
  agent_id: 'a1',
  session_id: 's1',
  lease_expires_at: NOW + 60_000,
  last_heartbeat_at: NOW - 30_000,
  heartbeat_age_ms: 30_000,
  connection: 'live',
  suspect_after_ms: 120_000,
  device_label: 'belka',
};

const round = (over: Partial<Round>): Round => ({
  id: 'r1',
  task_id: 't1',
  number: 2,
  finished_by: 'u1',
  client_name: null,
  agent: null,
  by_registered_agent: false,
  summary_md: '',
  commits: [],
  branch: null,
  pull_request: null,
  tests: [],
  ci: null,
  decision: null,
  created_at: NOW - 1000,
  ...over,
});

const empty: LaneInput = {
  task: { assignee_id: null, status: 'todo', selected_agent: null, claim: null, send_back: null },
  personName: () => undefined,
  offers: [],
  history: { kind: 'none' },
  rounds: [],
  roundsFailed: false,
  now: NOW,
};

const lane = (input: LaneInput, id: string) => {
  const found = agentLanes(input).find((l) => l.id === id);
  assert.ok(found, `no ${id} lane`);
  return found;
};

void describe('agentLanes', () => {
  void test('four lanes, always in the same order', () => {
    assert.deepEqual(
      agentLanes(empty).map((l) => l.label),
      ['Accountable', 'Requested', 'Executing', 'Outcome'],
    );
  });

  void test('a task nobody is on: every lane says so in its own words', () => {
    const lanes = agentLanes(empty);
    assert.deepEqual(
      lanes.map((l) => [l.state, l.value]),
      [
        ['empty', 'No one yet'],
        ['empty', 'No agent selected'],
        ['empty', 'No agent has worked this yet'],
        ['empty', 'Nothing submitted yet'],
      ],
    );
  });

  void test('Accountable is the assignee, a person — never the agent', () => {
    const input: LaneInput = {
      ...empty,
      task: { ...empty.task, assignee_id: 'u1', selected_agent: AGENT },
      personName: (id) => (id === 'u1' ? 'Ada Lovelace' : undefined),
    };
    assert.equal(lane(input, 'accountable').value, 'Ada Lovelace');
    assert.equal(lane(input, 'accountable').source, 'Assignee');
  });

  void test('Requested is the selected agent, with its open work request', () => {
    const offer = {
      id: 'o1',
      kind: 'work_request',
      state: 'open',
      to_agent_id: 'a1',
      created_at: NOW - 5,
    } as HandoffOffer;
    const input: LaneInput = {
      ...empty,
      task: { ...empty.task, selected_agent: AGENT },
      offers: [offer],
    };
    const requested = lane(input, 'requested');
    assert.equal(requested.value, 'shell-cc');
    assert.equal(requested.detail, 'Selected · work request open');
    const pending = lane(
      { ...input, offers: [{ ...offer, state: 'pending_approval' }] },
      'requested',
    );
    assert.equal(pending.detail, 'Selected · the work request waits for approval');
    assert.equal(pending.tone, 'warn');
  });

  void test('no agent lane ever says "assigned" — only Accountable names the assignee', () => {
    const input: LaneInput = {
      ...empty,
      task: {
        assignee_id: 'u1',
        status: 'in_progress',
        selected_agent: AGENT,
        claim: CLAIM,
        send_back: null,
      },
      personName: () => 'Ada',
    };
    for (const l of agentLanes(input).filter((x) => x.id !== 'accountable')) {
      assert.doesNotMatch(`${l.value} ${l.detail ?? ''} ${l.source}`, /assign/i);
    }
  });

  void test('Executing is the live claim: Working while heard, Connection lost once stale', () => {
    const input: LaneInput = { ...empty, task: { ...empty.task, claim: CLAIM } };
    const live = lane(input, 'executing');
    assert.equal(live.value, 'Working');
    assert.match(live.detail ?? '', /^Claim 3 · last heard /);
    const stale = lane(
      { ...input, task: { ...input.task, claim: { ...CLAIM, heartbeat_age_ms: 600_000 } } },
      'executing',
    );
    assert.equal(stale.value, 'Connection lost');
  });

  void test('a paused claim is never called paused', () => {
    const input: LaneInput = {
      ...empty,
      task: { ...empty.task, claim: { ...CLAIM, state: 'paused' } },
    };
    assert.doesNotMatch(lane(input, 'executing').value, /pause/i);
  });

  void test('with no live claim, Executing reads the activity — and is unknown before it', () => {
    const fact = {
      kind: 'expired',
      generation: 2,
      sessionId: null,
      agentId: null,
      at: 1,
      session: null,
    } as const;
    const expired: ClaimHistory = { kind: 'expired', fact };
    assert.equal(lane({ ...empty, history: expired }, 'executing').value, 'Last claim expired');
    const released: ClaimHistory = { kind: 'released', fact: { ...fact, kind: 'taken' } };
    assert.equal(lane({ ...empty, history: released }, 'executing').detail, 'Last claim 2 ended');
    assert.equal(lane({ ...empty, history: undefined }, 'executing').state, 'unknown');
  });

  void test('Outcome follows the newest round and its decision', () => {
    const inReview: LaneInput = {
      ...empty,
      task: { ...empty.task, status: 'review' },
      rounds: [round({})],
    };
    assert.equal(lane(inReview, 'outcome').value, 'In review');
    assert.equal(lane(inReview, 'outcome').detail, 'Round 2 · waiting for a decision');
    const decided = (kind: 'accepted' | 'sent_back') =>
      lane(
        {
          ...inReview,
          rounds: [
            round({ decision: { kind, decided_by: 'u1', reason_md: null, created_at: NOW } }),
          ],
        },
        'outcome',
      ).value;
    assert.equal(decided('accepted'), 'Accepted');
    assert.equal(decided('sent_back'), 'Sent back');
  });

  void test('Outcome is unknown, not empty, while the rounds are unread or failed', () => {
    assert.equal(lane({ ...empty, rounds: undefined }, 'outcome').state, 'unknown');
    assert.equal(
      lane({ ...empty, rounds: undefined, roundsFailed: true }, 'outcome').value,
      'Could not read the rounds',
    );
  });
});
