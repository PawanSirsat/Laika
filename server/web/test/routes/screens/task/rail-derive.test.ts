/** `src/routes/screens/task/rail-derive.ts` — the rail's status sub-line and token headline (LAI-1117). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';
import type { SimilarTask, SimilarTaskRef } from '../../../../src/api/estimates.ts';
import {
  createdViaLine,
  firstLine,
  priorityWords,
  pullRequestLine,
  reviewSince,
  similarRows,
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

void describe('priorityWords', () => {
  void test('says each level as the design does', () => {
    assert.deepEqual(priorityWords('p1'), { code: 'P1', word: 'High' });
    assert.deepEqual(priorityWords('p2'), { code: 'P2', word: 'Medium' });
    assert.deepEqual(priorityWords('p3'), { code: 'P3', word: 'Low' });
  });
});

void describe('pullRequestLine', () => {
  const url = 'https://github.com/PawanSirsat/Laika/pull/260';
  void test('names a GitHub pull request by number, with merged when GitHub said', () => {
    assert.equal(pullRequestLine(url, false), '#260 · not merged');
    assert.equal(pullRequestLine(url, true), '#260 · merged');
    assert.equal(pullRequestLine(url, null), '#260');
    assert.equal(pullRequestLine(`${url}/files`, true), '#260 · merged');
  });

  void test('says any other address as it is', () => {
    assert.equal(pullRequestLine('https://example.test/mr/4', false), 'https://example.test/mr/4');
    assert.equal(pullRequestLine('#12', null), '#12');
  });
});

void describe('firstLine', () => {
  void test('is the first line with words on it', () => {
    assert.equal(
      firstLine('\n  The rebuild drops the triggers\nand more'),
      'The rebuild drops the triggers',
    );
    assert.equal(firstLine(''), '');
  });
});

void describe('similarRows', () => {
  const ref = (key: string, buildMs: number): SimilarTaskRef => ({
    task_id: key.toLowerCase(),
    key,
    title: `${key} title`,
    build_ms: buildMs,
    similarity: 0.5,
  });
  const read = (key: string, reasons: string[]): SimilarTask => ({
    task_id: key.toLowerCase(),
    key,
    title: `${key} title`,
    status: 'done',
    similarity: 0.5,
    rounds: reasons.length + 1,
    send_backs: reasons.map((reason, i) => ({ round: i + 1, reason })),
  });

  void test('the estimate’s tasks with their times, and the reasons the read adds', () => {
    const rows = similarRows(
      [ref('LAI-1088', 44 * MIN), ref('LAI-1097', 38 * MIN)],
      [read('LAI-1097', ['Tests missing\nsee the log']), read('LAI-1102', ['Wrong file'])],
    );
    assert.deepEqual(
      rows.map((r) => [r.key, r.took, r.sentBack.map((b) => b.reason)]),
      [
        ['LAI-1088', 'took 44 min', []],
        ['LAI-1097', 'took 38 min', ['Tests missing']],
        ['LAI-1102', null, ['Wrong file']],
      ],
    );
  });

  void test('without the read, the estimate’s list stands alone', () => {
    assert.deepEqual(
      similarRows([ref('LAI-1088', 44 * MIN)], undefined).map((r) => r.took),
      ['took 44 min'],
    );
    assert.deepEqual(similarRows([], undefined), []);
  });
});

void describe('createdViaLine', () => {
  void test('the way in, then the agent’s own name when it gave one', () => {
    assert.equal(
      createdViaLine({ created_via: 'mcp', created_by_client: 'claude-code' }),
      'MCP · claude-code',
    );
    assert.equal(createdViaLine({ created_via: 'web', created_by_client: null }), 'the web');
    assert.equal(createdViaLine({ created_via: 'other', created_by_client: null }), 'other');
  });
});
