/**
 * The reader's own agents, as the drawer and the Activity screen hold them
 * (LAI-538).
 *
 * `node --test` cannot render a hook, so the reading is pinned here and the
 * hook's behaviour on screen is `test/browser/agent-field.test.ts`'s.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../src/api/agents.ts';
import { agentsOf } from '../../src/api/use-my-agents.ts';

const agent = { id: 'ag1' } as RegisteredAgent;

void describe('agentsOf', () => {
  void test('is the agents once they have arrived', () => {
    assert.deepEqual(agentsOf({ kind: 'ready', agents: [agent] }), [agent]);
  });

  void test('is none while loading and after a failure — never a stale or guessed list', () => {
    assert.deepEqual(agentsOf({ kind: 'loading' }), []);
    assert.deepEqual(agentsOf({ kind: 'error', message: 'nope' }), []);
  });
});

void describe('useMyAgents', () => {
  void test('reads every page of the caller’s own agents, and nothing else', async () => {
    const source = await readFile(
      new URL('../../src/api/use-my-agents.ts', import.meta.url),
      'utf8',
    );
    // Every page: a person with more than one page of agents is not cut short.
    assert.match(source, /everyPage\(/);
    // `GET /agents` answers the caller's agents only (§3.1 agent.read_own).
    assert.match(source, /listAgents\(/);
    assert.doesNotMatch(source, /request\(/, 'a second, hand-built read of agents');
  });
});
