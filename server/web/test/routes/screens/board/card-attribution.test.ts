/**
 * The card's attribution line (LAI-1206): the agent named once, its relation
 * to the accountable person in words, and never "assigned".
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cardAttribution,
  createdThroughAgentTitle,
  stateLineNamesAgent,
} from '../../../../src/routes/screens/board/card-attribution.ts';
import type { TaskLiveClaim } from '../../../../src/api/tasks.ts';
import type { SelectedAgent } from '../../../../src/api/selected-agent.ts';

const AGENT: SelectedAgent = {
  id: 'ag-belka',
  display_name: null,
  harness: 'codex',
  device_label: 'Belka',
  status: 'active',
  owner: { id: 'u-y', name: 'Yashraaj' },
};

const claim = (agentId: string): TaskLiveClaim => ({
  generation: 1,
  state: 'active',
  agent_id: agentId,
  session_id: 's1',
  lease_expires_at: 2,
  last_heartbeat_at: 1,
  connection: 'live',
  suspect_after_ms: 60_000,
  device_label: 'Belka',
});

const LABEL = 'Codex · Belka';

void describe('cardAttribution', () => {
  void test('no agent selected: no line', () => {
    assert.equal(cardAttribution({ selected_agent: null, claim: null }, LABEL, 'Ada'), null);
    assert.equal(cardAttribution({}, LABEL, 'Ada'), null);
  });

  void test('selected, not yet working: requested for the accountable person', () => {
    const a = cardAttribution({ selected_agent: AGENT, claim: null }, LABEL, 'Ada Lovelace');
    assert.ok(a);
    assert.equal(a.lane, 'requested');
    assert.equal(a.relation, 'requested for Ada Lovelace');
    assert.equal(a.spoken, 'Agent requested: Codex · Belka, for Ada Lovelace.');
    assert.equal(a.namesClaimHolder, false);
  });

  void test('the selected agent holds the claim: it is doing the work, for the person', () => {
    const a = cardAttribution(
      { selected_agent: AGENT, claim: claim('ag-belka') },
      LABEL,
      'Yashraaj',
    );
    assert.ok(a);
    assert.equal(a.lane, 'executing');
    assert.equal(a.relation, 'for Yashraaj');
    assert.equal(a.spoken, 'Agent doing the work: Codex · Belka, for Yashraaj.');
    // So the state line above drops its own copy of the agent's name.
    assert.equal(stateLineNamesAgent(a), false);
  });

  void test('another agent holds the claim: the selected one stays requested', () => {
    const a = cardAttribution({ selected_agent: AGENT, claim: claim('ag-other') }, LABEL, 'Ada');
    assert.ok(a);
    assert.equal(a.lane, 'requested');
    // And the state line keeps naming who actually holds it.
    assert.equal(stateLineNamesAgent(a), true);
  });

  void test('nobody accountable: the relation says only what is true', () => {
    assert.equal(
      cardAttribution({ selected_agent: AGENT, claim: null }, LABEL, undefined)?.relation,
      'requested',
    );
    assert.equal(
      cardAttribution({ selected_agent: AGENT, claim: claim('ag-belka') }, LABEL, undefined)
        ?.relation,
      '',
    );
  });

  void test('an agent is selected, never assigned', () => {
    for (const c of [null, claim('ag-belka'), claim('ag-other')]) {
      for (const who of ['Ada', undefined]) {
        const a = cardAttribution({ selected_agent: AGENT, claim: c }, LABEL, who);
        assert.doesNotMatch(`${a?.relation ?? ''} ${a?.spoken ?? ''}`, /assign/i);
      }
    }
  });
});

void describe('the created-through-an-agent badge', () => {
  void test('names the creator, not the assignee', () => {
    assert.equal(createdThroughAgentTitle('Pawan'), 'Created through an agent by Pawan');
    assert.equal(createdThroughAgentTitle(undefined), 'Created through an agent');
  });
});
