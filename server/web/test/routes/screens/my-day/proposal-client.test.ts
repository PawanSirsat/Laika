import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evidenceLine } from '../../../../src/routes/screens/my-day/my-day-derive.ts';

/** A proposal's evidence line names the agent that proposed it, when the board says (LAI-835). */

const NONE = { prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 };

void describe('evidenceLine — which agent proposed it', () => {
  void test('names the agent when the board says which', () => {
    assert.equal(evidenceLine(NONE, 'agent', 'claude-code'), 'Proposed by claude-code');
  });

  void test('keeps the old words when it does not', () => {
    assert.equal(evidenceLine(NONE, 'agent', null), 'Proposed by one of your agents');
    assert.equal(evidenceLine(NONE, 'agent'), 'Proposed by one of your agents');
  });

  void test('a collector’s block names no agent', () => {
    assert.equal(evidenceLine(NONE, 'collector', 'claude-code'), 'No signals counted');
  });
});
