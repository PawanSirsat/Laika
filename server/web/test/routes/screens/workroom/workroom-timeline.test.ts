/**
 * `workroom-timeline.ts` — the execution timeline and the agent's notes
 * (LAI-1199). Rows are records, never inferred; notes are verbatim.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { Checkpoint } from '../../../../src/api/handoffs.ts';
import type { Round } from '../../../../src/api/review.ts';
import {
  agentNotes,
  groupRuns,
  latestSave,
  timelineRows,
} from '../../../../src/routes/screens/workroom/workroom-timeline.ts';

const save = (over: Partial<Checkpoint>): Checkpoint =>
  ({
    id: 'c1',
    task_id: 't1',
    session_id: 's1',
    agent_id: 'a1',
    agent_redacted: false,
    claim_generation: 2,
    repo: 'r',
    branch: 'LAI-1-x',
    remote_ref: 'refs/heads/LAI-1-x',
    commit_sha: 'abcdef0123456789',
    manifest: [{ path: 'a.ts' }, { path: 'b.ts' }],
    summary: null,
    summary_commit_sha: null,
    created_at: 100,
    verification: 'verified',
    verified_at: 101,
    pending_since: null,
    pending_notice: false,
    superseded: false,
    refs: [],
    ...over,
  }) as Checkpoint;

const claimTaken = (id: string, at: number, generation: number): ActivityEvent =>
  ({
    id,
    seq: at,
    type: 'task.status_changed',
    project_id: 'p',
    task_id: 't1',
    actor_id: null,
    actor_kind: 'agent',
    actor_token_id: null,
    agent_id: 'a1',
    agent_session: null,
    payload: { via: 'claim', claim_generation: generation, from: 'todo', to: 'in_progress' },
    created_at: at,
  }) as unknown as ActivityEvent;

const ROUND = {
  id: 'r1',
  number: 1,
  created_at: 300,
  branch: null,
  pull_request: { url: 'https://github.com/o/r/pull/9' },
  decision: { kind: 'sent_back', decided_by: 'u1', reason_md: 'no', created_at: 400 },
} as unknown as Round;

void describe('timelineRows', () => {
  void test('merges claims, saves, rounds and reviews, newest first, each badged by source', () => {
    const rows = timelineRows({
      activity: [claimTaken('e1', 50, 2)],
      checkpoints: [save({})],
      rounds: [ROUND],
    });
    assert.deepEqual(
      rows.map((r) => [r.source, r.title]),
      [
        ['review', 'Round 1 sent back'],
        ['round', 'Round 1 submitted'],
        ['save', 'Saved abcdef0 on LAI-1-x'],
        ['activity', 'Claim taken'],
      ],
    );
    assert.equal(rows.find((r) => r.source === 'save')?.detail, '2 files · verified');
  });

  void test('an activity row that records no claim is not a timeline row', () => {
    const comment = {
      ...claimTaken('e2', 60, 2),
      type: 'comment.created',
      payload: {},
    } as ActivityEvent;
    assert.deepEqual(timelineRows({ activity: [comment], checkpoints: [], rounds: [] }), []);
  });
});

void describe('groupRuns', () => {
  void test('consecutive rows of one claim share a run; rounds stand alone; order is kept', () => {
    const rows = timelineRows({
      activity: [claimTaken('e1', 50, 2), claimTaken('e0', 10, 1)],
      checkpoints: [
        save({ id: 'c1', created_at: 100 }),
        save({ id: 'c0', created_at: 20, claim_generation: 1 }),
      ],
      rounds: [ROUND],
    });
    const groups = groupRuns(rows);
    assert.deepEqual(
      groups.map((g) => [g.generation, g.rows.length]),
      [
        [null, 2],
        [2, 2],
        [1, 2],
      ],
    );
    assert.deepEqual(
      groups.flatMap((g) => g.rows),
      rows,
    );
  });
});

void describe('agentNotes', () => {
  void test('non-empty decisions and questions, newest first, verbatim', () => {
    const summary = (decisions: string, open_questions: string) => ({
      work_done: '',
      next_step: '',
      decisions,
      open_questions,
      failing: '',
    });
    const notes = agentNotes([
      save({ id: 'old', created_at: 1, summary: summary('- keep it\n- twice', '') }),
      save({ id: 'new', created_at: 2, summary: summary('  ', 'touch drag?') }),
      save({ id: 'none', created_at: 3, summary: null }),
    ]);
    assert.deepEqual(
      notes.decisions.map((n) => [n.checkpointId, n.text]),
      [['old', '- keep it\n- twice']],
    );
    assert.deepEqual(
      notes.questions.map((n) => [n.checkpointId, n.text]),
      [['new', 'touch drag?']],
    );
  });
});

void describe('latestSave', () => {
  void test('the newest checkpoint, or none', () => {
    assert.equal(
      latestSave([save({ id: 'a', created_at: 1 }), save({ id: 'b', created_at: 9 })])?.id,
      'b',
    );
    assert.equal(latestSave([]), undefined);
  });
});
