/**
 * What *Tracked on this task* says (`tracked-time-derive.ts`): hours and
 * minutes spelled with their units (LAI-830 retired the `1:09` clock), agent
 * time in minutes only (D-088 item 8), the reader's own drafts beside the
 * total and never in it, and the one timer a person has.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TaskTime } from '../../../../src/api/task-time.ts';
import type { Timer } from '../../../../src/api/time.ts';
import {
  agentLine,
  contributorsLine,
  draftLine,
  durationParts,
  shortDuration,
  timerState,
} from '../../../../src/routes/screens/task/tracked-time-derive.ts';

const view = (patch: Partial<TaskTime> = {}): TaskTime => ({
  total_minutes: 402,
  people: 3,
  entries: 7,
  agent_minutes: 125,
  my_draft_minutes: 72,
  ...patch,
});

const timer = (task: { id: string; key: string } | null, title: string | null = null): Timer => ({
  started_at: 0,
  resumed_at: 0,
  paused_at: null,
  accumulated_ms: 0,
  tz: 'UTC',
  task: task === null ? null : { ...task, title: 'A task' },
  kind: null,
  title,
});

void describe('the figure', () => {
  void test('hours and minutes, each with its unit, minutes padded only beside hours', () => {
    assert.equal(shortDuration(402), '6h 42m');
    assert.equal(shortDuration(365), '6h 05m');
    assert.equal(shortDuration(45), '45m');
    assert.equal(shortDuration(120), '2h');
    assert.equal(shortDuration(0), '0m');
  });

  void test('keeps hours past a day: working time, never calendar days', () => {
    assert.equal(shortDuration(30 * 60), '30h');
  });

  void test('splits number from unit, so the number can be drawn large', () => {
    assert.deepEqual(durationParts(402), [
      { value: '6', unit: 'h' },
      { value: '42', unit: 'm' },
    ]);
  });
});

void describe('the lines beside it', () => {
  void test('who it is from, as counts', () => {
    assert.equal(contributorsLine(view()), 'by 3 people · 7 entries');
    assert.equal(contributorsLine(view({ people: 1, entries: 1 })), 'by 1 person · 1 entry');
    assert.equal(contributorsLine(view({ total_minutes: 0, entries: 0, people: 0 })), null);
  });

  void test('the reader’s own drafts, only when there are some', () => {
    assert.equal(draftLine(view()), '+1h 12m in your drafts');
    assert.equal(draftLine(view({ my_draft_minutes: 0 })), null);
    // A token reads no drafts at all.
    assert.equal(draftLine(view({ my_draft_minutes: null })), null);
  });

  void test('agent time in minutes, never hours, and kept apart', () => {
    assert.equal(agentLine(view()), '125 agent min');
    assert.equal(agentLine(view({ agent_minutes: 0 })), null);
  });
});

void describe('the timer', () => {
  void test('none when time is off, or the day could not be read', () => {
    assert.equal(timerState(undefined, 't1').kind, 'unavailable');
    assert.equal(timerState({ mode: 'off', timer: null }, 't1').kind, 'unavailable');
  });

  void test('idle, running here, or running on something else', () => {
    assert.equal(timerState({ mode: 'manual', timer: null }, 't1').kind, 'idle');
    assert.equal(
      timerState({ mode: 'drafts', timer: timer({ id: 't1', key: 'LAI-1' }) }, 't1').kind,
      'here',
    );
    assert.deepEqual(
      timerState({ mode: 'drafts', timer: timer({ id: 't2', key: 'LAI-2' }) }, 't1'),
      {
        kind: 'elsewhere',
        label: 'LAI-2',
      },
    );
    assert.deepEqual(timerState({ mode: 'manual', timer: timer(null, 'Standup') }, 't1'), {
      kind: 'elsewhere',
      label: 'Standup',
    });
  });
});
