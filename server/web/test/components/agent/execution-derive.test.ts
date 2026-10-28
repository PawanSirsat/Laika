/**
 * LAI-543: what a card and the drawer say about an agent's work, derived only
 * from what the server serves — the task view's `selected_agent` and status,
 * and the task's claim rows (LAI-541).
 *
 * The rows are built in the **shapes the server writes**, and the last block
 * reads `server/src` to prove those shapes are still the ones written: a claim
 * row whose payload key moved would otherwise leave every assertion here green
 * against a payload that no longer exists.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../src/api/activity.ts';
import type { SelectedAgent } from '../../../src/api/selected-agent.ts';
import type { TaskStatus } from '../../../src/api/tasks.ts';
import {
  cardExecutionState,
  changesExecution,
  claimHistory,
  executionSignal,
  executionView,
  hasExecution,
} from '../../../src/components/agent/execution-derive.ts';
import {
  CLAIM_EXPIRED_WORDS,
  EXECUTION_STATE_WORDS,
} from '../../../src/components/agent/agent-states.ts';

const LAPTOP: SelectedAgent = {
  id: 'ag-laptop',
  display_name: 'Laptop agent',
  harness: 'claude-code',
  device_label: 'laptop-1',
  status: 'active',
  owner: { id: 'u1', name: 'Ada Lovelace' },
};

let seq = 0;
function row(
  over: Partial<ActivityEvent> & Pick<ActivityEvent, 'type' | 'payload'>,
): ActivityEvent {
  seq += 1;
  return {
    id: `ev-${String(seq).padStart(4, '0')}`,
    seq,
    project_id: 'p1',
    task_id: 't1',
    actor_id: 'u1',
    actor_kind: 'agent',
    actor_token_id: 'tok-1',
    agent_id: 'ag-laptop',
    created_at: 1_000 * seq,
    ...over,
  };
}

/** `services/tasks.ts`: the claim of a task not yet in progress. */
const taken = (generation: number, at: number) =>
  row({
    type: 'task.status_changed',
    payload: {
      from: 'todo',
      to: 'in_progress',
      // No `assignee_id`: a claim does not assign (LAI-541 round 2).
      via: 'claim',
      claim_generation: generation,
    },
    created_at: at,
  });

/** `services/claims.ts`: the expiry scan, written by the system. */
const expired = (generation: number, at: number) =>
  row({
    type: 'task.claim_expired',
    actor_id: null,
    actor_kind: 'system',
    actor_token_id: null,
    agent_id: null,
    payload: { generation, session_id: 'ses-1', agent_id: 'ag-laptop', lease_expires_at: at - 1 },
    created_at: at,
  });

/** `services/claims.ts`: the explicit reclaim. */
const reclaimed = (generation: number, at: number) =>
  row({
    type: 'task.claim_reclaimed',
    payload: {
      from_generation: generation - 1,
      generation,
      session_id: 'ses-2',
      agent_id: 'ag-laptop',
    },
    created_at: at,
  });

const AGENTS = new Map([[LAPTOP.id, LAPTOP]]);

void describe('cardExecutionState', () => {
  void test('an agent picked for a task not started is Waiting for agent', () => {
    for (const status of ['backlog', 'todo'] as const) {
      assert.equal(cardExecutionState({ status, selected_agent: LAPTOP }), 'waiting_for_agent');
    }
  });

  void test('no state once work started, without an agent, or for a revoked one', () => {
    assert.equal(cardExecutionState({ status: 'in_progress', selected_agent: LAPTOP }), null);
    assert.equal(cardExecutionState({ status: 'done', selected_agent: LAPTOP }), null);
    assert.equal(cardExecutionState({ status: 'todo', selected_agent: null }), null);
    // A view served before LAI-535 has no field at all.
    assert.equal(cardExecutionState({ status: 'todo' }), null);
    assert.equal(
      cardExecutionState({ status: 'todo', selected_agent: { ...LAPTOP, status: 'revoked' } }),
      null,
    );
  });

  void test('never derives Working or Connection lost: no task read serves the live claim (LAI-568)', () => {
    for (const status of [
      'backlog',
      'todo',
      'in_progress',
      'review',
      'done',
      'cancelled',
    ] satisfies TaskStatus[]) {
      const state = cardExecutionState({ status, selected_agent: LAPTOP });
      assert.ok(state === null || state === 'waiting_for_agent', `${status} gave ${String(state)}`);
    }
  });
});

void describe('claimHistory', () => {
  void test('nothing on record', () => {
    assert.deepEqual(claimHistory([]), { kind: 'none' });
  });

  void test('a take is recorded, whatever order the feed hands the rows in', () => {
    const rows = [taken(1, 10)];
    const history = claimHistory(rows);
    assert.equal(history.kind, 'recorded');
    assert.equal(history.kind === 'recorded' && history.fact.generation, 1);
  });

  void test('an expiry after the take is expired, and is never undone by time alone', () => {
    // Written in order (so `seq` rises with time, as on the server), then
    // handed over newest first, as the feed serves them.
    const take = taken(1, 10);
    const lapse = expired(1, 20);
    const history = claimHistory([lapse, take]);
    assert.equal(history.kind, 'expired');
    assert.equal(history.kind === 'expired' && history.fact.agentId, 'ag-laptop');
  });

  void test('a reclaim after the expiry is recorded at the next generation', () => {
    const history = claimHistory([taken(1, 10), expired(1, 20), reclaimed(2, 30)]);
    assert.equal(history.kind, 'recorded');
    assert.equal(history.kind === 'recorded' && history.fact.kind, 'reclaimed');
    assert.equal(history.kind === 'recorded' && history.fact.generation, 2);
    assert.equal(history.kind === 'recorded' && history.fact.sessionId, 'ses-2');
  });

  void test('a resumed claim recorded as `task.updated` field `claim` is a take', () => {
    const history = claimHistory([
      row({
        type: 'task.updated',
        payload: { field: 'claim', from: null, to: { generation: 4, session_id: 'ses-9' } },
        created_at: 5,
      }),
    ]);
    assert.equal(history.kind === 'recorded' && history.fact.generation, 4);
    assert.equal(history.kind === 'recorded' && history.fact.sessionId, 'ses-9');
  });

  void test('leaving In progress ends a claim, live or expired', () => {
    // Each history written in order, so `seq` rises with time as on the server.
    const out = () =>
      row({
        type: 'task.status_changed',
        payload: { from: 'in_progress', to: 'review' },
        created_at: 40,
      });
    const live = [taken(1, 10)];
    live.push(out());
    const lapsed = [taken(1, 10), expired(1, 20)];
    lapsed.push(out());
    assert.equal(claimHistory(live).kind, 'released');
    assert.equal(claimHistory(lapsed).kind, 'released');
  });

  void test('an ordinary edit or a person’s claim records no agent claim', () => {
    assert.equal(
      claimHistory([
        row({ type: 'task.updated', payload: { field: 'title' } }),
        row({
          type: 'task.status_changed',
          actor_kind: 'user',
          agent_id: null,
          payload: { from: 'todo', to: 'in_progress', via: 'claim' },
        }),
      ]).kind,
      'none',
    );
  });
});

void describe('executionView', () => {
  void test('waiting: the intended agent and the state, no claim', () => {
    const view = executionView({ status: 'todo', selected_agent: LAPTOP }, [], AGENTS);
    assert.equal(view.state, 'waiting_for_agent');
    assert.deepEqual(view.intended, {
      client: 'claude-code',
      device: 'laptop-1',
      owner: 'Ada Lovelace',
    });
    assert.equal(view.claim, undefined);
    assert.equal(view.claimExpired, false);
    assert.equal(view.generation, null);
    // The Agent row says this one; the panel waits for a claim on record.
    assert.equal(hasExecution(view), false);
  });

  void test('expired: the notice, the agent named, the generation', () => {
    const view = executionView(
      { status: 'in_progress', selected_agent: LAPTOP },
      [taken(3, 10), expired(3, 20)],
      AGENTS,
    );
    assert.equal(view.state, null);
    assert.equal(view.claimExpired, true);
    assert.equal(view.generation, 3);
    assert.equal(view.claim?.verb, 'its claim expired');
    assert.equal(typeof view.claim?.agent === 'object' && view.claim.agent.device, 'laptop-1');
  });

  void test('an agent this reader cannot name is a registered agent, never a guess', () => {
    const view = executionView(
      { status: 'in_progress', selected_agent: null },
      [taken(1, 10)],
      new Map(),
    );
    assert.equal(view.claim?.agent, 'a registered agent');
    assert.equal(view.claim?.verb, 'took it');
  });

  void test('no claim on record: the panel stays away; one on record: it draws', () => {
    assert.equal(
      hasExecution(executionView({ status: 'todo', selected_agent: null }, [], AGENTS)),
      false,
    );
    assert.equal(
      hasExecution(
        executionView({ status: 'in_progress', selected_agent: null }, [taken(1, 10)], AGENTS),
      ),
      true,
    );
  });
});

void describe('rows written in the same millisecond replay in seq order, not by id', () => {
  // The LAI-543 review: an expiry and a reclaim land in one millisecond, and a
  // ULID is random within one, so the later row's id can sort first.
  const T = 50_000;

  /** One `created_at`, and ids that sort the **opposite** way to `seq`. */
  function tied(rows: readonly ActivityEvent[]): ActivityEvent[] {
    return rows.map((r, i) => ({
      ...r,
      created_at: T,
      id: `01ZZ${String(rows.length - i).padStart(4, '0')}`,
    }));
  }

  /** The feed's order (newest first) and the reverse — the answer must not depend on it. */
  function bothOrders(rows: readonly ActivityEvent[]): ActivityEvent[][] {
    return [[...rows].reverse(), [...rows]];
  }

  /** The setup really is adversarial: within the tie, a later `seq` has a smaller id. */
  function assertReversed(rows: readonly ActivityEvent[]): void {
    for (let i = 1; i < rows.length; i += 1) {
      const before = rows[i - 1];
      const after = rows[i];
      assert.ok(before !== undefined && after !== undefined);
      assert.equal(before.created_at, after.created_at);
      assert.ok(before.seq < after.seq, 'seq must rise');
      assert.ok(before.id > after.id, 'the id must sort the other way');
    }
  }

  const moved = (to: string) =>
    row({ type: 'task.status_changed', payload: { from: 'in_progress', to } });

  void test('expire then reclaim: generation 2, no expired notice', () => {
    const start = taken(1, T - 10_000);
    const tie = tied([expired(1, T), reclaimed(2, T)]);
    assertReversed(tie);
    for (const rows of bothOrders([start, ...tie])) {
      const history = claimHistory(rows);
      assert.equal(history.kind, 'recorded');
      assert.equal(history.kind === 'recorded' && history.fact.kind, 'reclaimed');
      const view = executionView({ status: 'in_progress', selected_agent: LAPTOP }, rows, AGENTS);
      assert.equal(view.generation, 2);
      assert.equal(view.claimExpired, false);
    }
  });

  void test('expire then moved to Done: no expired notice', () => {
    const start = taken(1, T - 10_000);
    const tie = tied([expired(1, T), moved('done')]);
    assertReversed(tie);
    for (const rows of bothOrders([start, ...tie])) {
      assert.equal(claimHistory(rows).kind, 'released');
      const view = executionView({ status: 'done', selected_agent: LAPTOP }, rows, AGENTS);
      assert.equal(view.claimExpired, false);
    }
  });

  void test('reclaim then expire: expired, at generation 2', () => {
    const start = [taken(1, T - 20_000), expired(1, T - 10_000)];
    const tie = tied([reclaimed(2, T), expired(2, T)]);
    assertReversed(tie);
    for (const rows of bothOrders([...start, ...tie])) {
      const view = executionView({ status: 'in_progress', selected_agent: LAPTOP }, rows, AGENTS);
      assert.equal(view.claimExpired, true);
      assert.equal(view.generation, 2);
    }
  });

  void test('rows without a numeric seq fall back to created_at, all of them', () => {
    const rows = [taken(1, 10), expired(1, 20), reclaimed(2, 30)].map(
      // Larger ids and seqs on the older rows, then seq removed: only time is left.
      (r, i) => ({ ...r, id: `01ZZ${String(9 - i)}`, seq: undefined }) as unknown as ActivityEvent,
    );
    for (const order of bothOrders(rows)) {
      const history = claimHistory(order);
      assert.equal(history.kind === 'recorded' && history.fact.generation, 2);
    }
  });
});

void describe('live frames', () => {
  void test('the claim verbs, a claim edit and a status change move the panel; a title edit does not', () => {
    assert.ok(changesExecution({ type: 'task.claim_expired', payload: {} }));
    assert.ok(changesExecution({ type: 'task.claim_reclaimed', payload: {} }));
    assert.ok(changesExecution({ type: 'task.status_changed', payload: {} }));
    assert.ok(changesExecution({ type: 'task.updated', payload: { field: 'claim' } }));
    assert.equal(changesExecution({ type: 'task.updated', payload: { field: 'title' } }), false);
    assert.equal(changesExecution({ type: 'comment.added', payload: {} }), false);
  });

  void test('the signal is the newest matching seq for that task only', () => {
    const frames = [
      { seq: 9, task_id: 't2', type: 'task.claim_expired', payload: {} },
      { seq: 7, task_id: 't1', type: 'task.claim_expired', payload: {} },
      { seq: 8, task_id: 't1', type: 'comment.added', payload: {} },
      { seq: 5, task_id: 't1', type: 'task.status_changed', payload: {} },
    ];
    assert.equal(executionSignal(frames, 't1'), 7);
    assert.equal(executionSignal(frames, 't3'), undefined);
  });
});

void describe('words', () => {
  void test('the expired claim says it must be reclaimed and nothing was restored', () => {
    assert.equal(CLAIM_EXPIRED_WORDS.label, 'Claim expired');
    assert.match(CLAIM_EXPIRED_WORDS.meaning, /must reclaim explicitly/);
    assert.match(CLAIM_EXPIRED_WORDS.meaning, /nothing was restored automatically/);
  });

  void test('Waiting for agent is spelled out', () => {
    assert.equal(EXECUTION_STATE_WORDS.waiting_for_agent.label, 'Waiting for agent');
  });
});

void describe('the server still writes these shapes (LAI-541)', () => {
  const SERVER = fileURLToPath(new URL('../../../../src/services/', import.meta.url));

  /** The object literal after `type: '<verb>'`, up to its `now,`. */
  function payloadAfter(source: string, verb: string): string {
    const at = source.indexOf(`type: '${verb}'`);
    assert.ok(at >= 0, `${verb} is no longer written where this test looks`);
    return source.slice(at, source.indexOf('now,', at));
  }

  void test('task.claim_expired carries generation, session_id and agent_id', async () => {
    const claims = await readFile(`${SERVER}claims.ts`, 'utf8');
    const body = payloadAfter(claims, 'task.claim_expired');
    for (const key of ['generation:', 'session_id:', 'agent_id:']) {
      assert.ok(body.includes(key), `claim_expired payload lost ${key}`);
    }
  });

  void test('task.claim_reclaimed carries generation, session_id and agent_id', async () => {
    const claims = await readFile(`${SERVER}claims.ts`, 'utf8');
    const body = payloadAfter(claims, 'task.claim_reclaimed');
    for (const key of ['generation:', 'session_id:', 'agent_id:']) {
      assert.ok(body.includes(key), `claim_reclaimed payload lost ${key}`);
    }
  });

  void test("a claim's status change carries via: 'claim' and claim_generation", async () => {
    const tasks = await readFile(`${SERVER}tasks.ts`, 'utf8');
    assert.match(tasks, /via: 'claim',\s*claim_generation: taken\.claim\.generation,/);
    assert.match(tasks, /field: 'claim',\s*from: null,\s*to: \{ generation:/);
  });
});
