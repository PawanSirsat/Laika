/** `src/routes/screens/task/rail-derive.ts` — the rail's status sub-line and token headline (LAI-1117). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';
import {
  reviewSince,
  statusSubline,
  tokensOfLine,
} from '../../../../src/routes/screens/task/rail-derive.ts';

const MIN = 60_000;
type Sub = Pick<TaskSummary, 'status' | 'started_at' | 'completed_at' | 'send_back' | 'claim'>;
const base: Sub = {
  status: 'backlog',
  started_at: null,
  completed_at: null,
  send_back: null,
  claim: null,
};

void describe('statusSubline', () => {
  void test('reads each status as the design writes it', () => {
    assert.equal(
      statusSubline({ ...base, status: 'review' }, { rounds: 1, reviewSince: 0, now: 24 * MIN }),
      'In review for 24 min · round 1',
    );
    assert.equal(statusSubline(base, { rounds: 0, reviewSince: null, now: 0 }), 'Not started');
    assert.equal(
      statusSubline(
        {
          ...base,
          status: 'in_progress',
          send_back: { reason_md: 'r', decided_by: 'u', created_at: 0 },
        },
        { rounds: 1, reviewSince: null, now: 6 * MIN },
      ),
      'Sent back 6 min ago · round 2',
    );
    assert.equal(
      statusSubline(
        { ...base, status: 'in_progress', started_at: 0 },
        { rounds: 0, reviewSince: null, now: 18 * MIN },
      ),
      'Started 18 min ago',
    );
    assert.equal(
      statusSubline({ ...base, status: 'cancelled' }, { rounds: 0, reviewSince: null, now: 0 }),
      null,
    );
  });
});

void describe('reviewSince', () => {
  void test('takes the newest move into review', () => {
    const move = (to: string, at: number): ActivityEvent => ({
      id: String(at),
      seq: at,
      type: 'task.status_changed',
      project_id: 'p',
      task_id: 't',
      actor_id: 'u',
      actor_kind: 'user',
      actor_token_id: null,
      payload: { from: 'in_progress', to },
      created_at: at,
    });
    assert.equal(reviewSince([move('review', 5), move('in_progress', 9), move('review', 7)]), 7);
    assert.equal(reviewSince([]), null);
  });
});

void describe('tokensOfLine', () => {
  void test('against the estimate’s high end, or so far without one', () => {
    assert.equal(tokensOfLine(597_000, 716_000), '597K of 716K (83%)');
    assert.equal(tokensOfLine(212_000, null), '212K so far');
  });
});
