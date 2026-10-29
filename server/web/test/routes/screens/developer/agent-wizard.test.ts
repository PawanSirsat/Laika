/**
 * Registering an agent as five steps (LAI-537): the parts of the wizard that
 * are rules rather than rendering — which steps are open, what step 2 sends,
 * and how long step 5 asks.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_STEPS,
  agentFooterHint,
  agentStepOpen,
  choicesFrom,
  deviceProblem,
  grantsFrom,
  nameProblem,
  sameGrants,
  VERIFY_BUDGET_MS,
  VERIFY_POLL_MS,
  VERIFY_REQUEST_TIMEOUT_MS,
  verifyStateFrom,
} from '../../../../src/routes/screens/developer/agent-wizard.ts';
import { REGISTRATION_STEPS } from '../../../../src/components/agent/agent-states.ts';
import {
  LIVE_BUDGET_MS,
  LIVE_POLL_MS,
} from '../../../../src/routes/screens/connect/connect-live.ts';

void describe('the five steps', () => {
  void test('each has a name in LAI-536’s list, and the list has no step without one', () => {
    // The tab names step n by REGISTRATION_STEPS[n - 1] (LAI-565).
    assert.deepEqual(
      AGENT_STEPS.map((n) => REGISTRATION_STEPS[n - 1]),
      [...REGISTRATION_STEPS],
    );
  });

  void test('4 and 5 open only once the agent exists; 1 and 2 close once it does', () => {
    assert.deepEqual(
      AGENT_STEPS.map((n) => agentStepOpen(n, false)),
      [true, true, true, false, false],
    );
    assert.deepEqual(
      AGENT_STEPS.map((n) => agentStepOpen(n, true)),
      [false, false, true, true, true],
    );
  });

  void test('the footer says what is pending, never that it is verified before it is', () => {
    assert.match(agentFooterHint(3, false, false), /Create the credential/);
    assert.equal(
      agentFooterHint(5, true, false),
      'Waiting for a request from this agent’s credential',
    );
    assert.equal(agentFooterHint(5, true, true), 'Verified');
  });
});

void describe('step 1', () => {
  void test('a name is 1 to 80 characters once trimmed, as the server cleans it', () => {
    assert.ok(nameProblem('   ') !== undefined);
    assert.equal(nameProblem(' a '), undefined);
    assert.equal(nameProblem('x'.repeat(80)), undefined);
    assert.ok(nameProblem('x'.repeat(81)) !== undefined);
  });

  void test('a device is optional and at most 80', () => {
    assert.equal(deviceProblem(''), undefined);
    assert.ok(deviceProblem('x'.repeat(81)) !== undefined);
  });
});

void describe('step 2: grants', () => {
  const order = ['p1', 'p2', 'p3'];

  void test('sends the chosen projects in listed order, and none for No access', () => {
    const choices = new Map([
      ['p3', 'read_only' as const],
      ['p1', 'full' as const],
      ['p2', 'none' as const],
    ]);
    assert.deepEqual(grantsFrom(choices, order, false), [
      { project_id: 'p1', scope: 'full' },
      { project_id: 'p3', scope: 'read_only' },
    ]);
  });

  void test('a viewer’s full is sent as read only — the most their token can be', () => {
    assert.deepEqual(grantsFrom(new Map([['p1', 'full' as const]]), order, true), [
      { project_id: 'p1', scope: 'read_only' },
    ]);
  });

  void test('a project not listed is never sent, whatever the choices say', () => {
    assert.deepEqual(grantsFrom(new Map([['p9', 'full' as const]]), order, false), []);
  });

  void test('reads back, and compares regardless of order', () => {
    const grants = [
      { project_id: 'p1', scope: 'full' as const },
      { project_id: 'p2', scope: 'read_only' as const },
    ];
    assert.deepEqual(grantsFrom(choicesFrom(grants), order, false), grants);
    assert.equal(sameGrants(grants, [...grants].reverse()), true);
    assert.equal(sameGrants(grants, [{ project_id: 'p1', scope: 'read_only' }]), false);
  });
});

void describe('step 5: the watch ends by the clock', () => {
  void test('seen is verified, gone is replaced, unseen watches until the deadline', () => {
    assert.deepEqual(verifyStateFrom('seen', 3), { kind: 'verified' });
    assert.deepEqual(verifyStateFrom('gone', 3), { kind: 'replaced' });
    assert.deepEqual(verifyStateFrom('unseen', VERIFY_BUDGET_MS - 1), { kind: 'watching' });
    assert.deepEqual(verifyStateFrom('unseen', VERIFY_BUDGET_MS), { kind: 'spent' });
  });

  void test("Connect's budget and spacing, and a request timeout that fits inside the budget", () => {
    assert.equal(VERIFY_BUDGET_MS, LIVE_BUDGET_MS);
    assert.equal(VERIFY_BUDGET_MS, 180_000);
    assert.equal(VERIFY_POLL_MS, LIVE_POLL_MS);
    assert.ok(VERIFY_REQUEST_TIMEOUT_MS > 0 && VERIFY_REQUEST_TIMEOUT_MS < VERIFY_BUDGET_MS);
  });
});
