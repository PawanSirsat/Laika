/**
 * LAI-587 (D-118, D-119; server LAI-586): the one line that says which agent
 * did the work and what its session said ran, and D-119's refusal in words.
 *
 * Every part of the line is self-reported, so the rule pinned hardest is the
 * one about gaps: a part the session did not send is left out, and a row with
 * no snapshot is the agent alone — nothing is filled in.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../src/api/activity.ts';
import { agentLine, sessionHarnessName, sessionWords } from '../../src/api/agent-session.ts';
import { ApiError } from '../../src/api/errors.ts';
import { selectedForAnotherAgentWords, selectionErrorWords } from '../../src/api/selected-agent.ts';
import { describeActor, actorLine } from '../../src/routes/screens/board/actor-presentation.ts';
import { claimHistory, executionView } from '../../src/components/agent/execution-derive.ts';

const SESSION = { id: '01SESS', harness: 'codex', harness_version: '0.47.0', model: 'gpt-5.5' };

void describe('the agent line', () => {
  void test('agent, then the session harness by its product name, then the model', () => {
    assert.equal(
      agentLine('Claude Code · Belka', SESSION),
      'Claude Code · Belka · Codex · gpt-5.5',
    );
  });

  void test('a row with no snapshot is the agent alone — null and absent alike', () => {
    assert.equal(agentLine('Claude Code · Belka', null), 'Claude Code · Belka');
    assert.equal(agentLine('Claude Code · Belka', undefined), 'Claude Code · Belka');
  });

  void test('a part the session did not report is left out, never guessed', () => {
    assert.equal(
      agentLine('Claude Code · Belka', { ...SESSION, model: null }),
      'Claude Code · Belka · Codex',
    );
    assert.equal(
      agentLine('Claude Code · Belka', { ...SESSION, harness: null }),
      'Claude Code · Belka · gpt-5.5',
    );
    assert.equal(
      agentLine('Claude Code · Belka', { ...SESSION, harness: '  ', model: '' }),
      'Claude Code · Belka',
    );
    assert.equal(sessionWords({ ...SESSION, harness: null, model: null }), undefined);
  });

  void test('a harness Laika does not know reads as the session sent it, not as "another agent"', () => {
    assert.equal(sessionHarnessName('claude-code'), 'Claude Code');
    assert.equal(sessionHarnessName('aider'), 'aider');
    assert.equal(sessionHarnessName('other'), 'other');
  });
});

const AGENTS = new Map([
  ['ag-1', { harness: 'claude-code', display_name: 'Belka agent', device_label: 'Belka' }],
]);

const row = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: 'e1',
  seq: 1,
  type: 'task.updated',
  project_id: 'p',
  task_id: 't',
  actor_id: 'u1',
  actor_kind: 'agent',
  actor_token_id: 'tok',
  agent_id: 'ag-1',
  payload: {},
  created_at: 1,
  ...over,
});

void describe('who wrote an activity row', () => {
  const members = new Map([
    ['u1', { user_id: 'u1', name: 'Ada', email: 'a@x', role: 'lead', created_at: 1 }],
  ]);

  void test('an agent row with a snapshot names what ran', () => {
    const actor = describeActor(row({ agent_session: SESSION }), members, AGENTS);
    assert.equal(actorLine(actor), 'Ada via Claude Code · Belka · Codex · gpt-5.5');
  });

  void test('an older row — no snapshot, or no key at all — is the agent alone', () => {
    assert.equal(
      actorLine(describeActor(row({ agent_session: null }), members, AGENTS)),
      'Ada via Claude Code · Belka',
    );
    assert.equal(actorLine(describeActor(row({}), members, AGENTS)), 'Ada via Claude Code · Belka');
  });

  void test('a person’s row carries no agent and no session', () => {
    const actor = describeActor(
      row({ actor_kind: 'user', agent_id: null, agent_session: SESSION }),
      members,
      AGENTS,
    );
    assert.equal(actorLine(actor), 'Ada');
  });
});

void describe('the drawer’s claim', () => {
  const taken = (over: Partial<ActivityEvent>) =>
    row({
      type: 'task.status_changed',
      payload: { from: 'todo', to: 'in_progress', via: 'claim', claim_generation: 4 },
      ...over,
    });
  const task = { status: 'in_progress' as const, selected_agent: null };

  void test('the claim row’s snapshot becomes the line and the Details facts', () => {
    const view = executionView(task, [taken({ agent_session: SESSION, created_at: 5 })], AGENTS);
    assert.equal(view.claim?.line, 'Claude Code · Belka · Codex · gpt-5.5');
    assert.equal(view.claim?.sessionId, '01SESS');
    assert.equal(view.claim?.harnessVersion, '0.47.0');
    assert.equal(view.claim?.model, 'gpt-5.5');
    assert.equal(view.claim?.at, 5);
    assert.equal(view.generation, 4);
  });

  void test('a claim row with no snapshot draws no line and invents no session', () => {
    const view = executionView(task, [taken({ agent_session: null })], AGENTS);
    assert.equal(view.claim?.line, undefined);
    assert.equal(view.claim?.sessionId, null);
    assert.equal(view.claim?.harnessVersion, null);
  });

  void test('an expiry — the system’s row — keeps the snapshot of the take it ended', () => {
    const expiry = row({
      seq: 2,
      type: 'task.claim_expired',
      actor_id: null,
      actor_kind: 'system',
      agent_id: null,
      agent_session: null,
      payload: { generation: 4, session_id: '01SESS', agent_id: 'ag-1' },
    });
    const history = claimHistory([taken({ agent_session: SESSION }), expiry]);
    if (history.kind !== 'expired') throw new Error(`replayed as ${history.kind}`);
    assert.deepEqual(history.fact.session, SESSION);

    // A different generation is a different claim: nothing carries across.
    const other = claimHistory([
      taken({ agent_session: SESSION }),
      { ...expiry, payload: { generation: 5, session_id: '01OTHER', agent_id: 'ag-1' } },
    ]);
    assert.equal(other.kind === 'none' ? 'none' : other.fact.session, null);
  });
});

void describe('D-119: the selected agent owns the claim', () => {
  const refusal = (details: unknown) =>
    new ApiError('conflict', 'Selected for another agent', 409, details);

  void test('names the selected agent when the server named it', () => {
    const error = refusal({
      reason: 'selected_for_another_agent',
      selected_agent_id: 'ag-2',
      selected_agent: {
        id: 'ag-2',
        display_name: 'Polly',
        harness: 'omnigent',
        device_label: 'Belka',
      },
    });
    assert.equal(
      selectedForAnotherAgentWords(error),
      'Selected for Omnigent · Belka — only that agent can start it.',
    );
    assert.equal(selectionErrorWords(error), selectedForAnotherAgentWords(error));
  });

  void test('says it plainly, naming nobody, when the server named nobody', () => {
    assert.equal(
      selectedForAnotherAgentWords(refusal({ reason: 'selected_for_another_agent' })),
      'Selected for another agent — only that agent can start it.',
    );
  });

  void test('any other conflict is not this refusal', () => {
    assert.equal(selectedForAnotherAgentWords(refusal({ reason: 'claim_held' })), undefined);
    assert.equal(
      selectedForAnotherAgentWords(
        new ApiError('unprocessable', 'x', 422, { reason: 'selected_for_another_agent' }),
      ),
      undefined,
    );
    assert.equal(selectedForAnotherAgentWords(new Error('boom')), undefined);
  });
});
