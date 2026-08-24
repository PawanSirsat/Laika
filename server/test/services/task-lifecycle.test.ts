import { describe, expect, it } from 'vitest';
import { type TaskStatus } from '../../src/db/enums.ts';
import { ApiError } from '../../src/errors.ts';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  isReady,
  READY_STATUSES,
} from '../../src/services/task-lifecycle.ts';

const ALL: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];

describe('the §5 forward path', () => {
  it('allows every edge the diagram draws', () => {
    expect(canTransition('backlog', 'todo')).toBe(true);
    expect(canTransition('todo', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'review')).toBe(true);
    expect(canTransition('review', 'done')).toBe(true);
  });

  it('does not allow skipping straight from backlog to done', () => {
    // A task that was never in review was never approved by anyone.
    expect(canTransition('backlog', 'done')).toBe(false);
    expect(canTransition('todo', 'done')).toBe(false);
    expect(canTransition('in_progress', 'done')).toBe(false);
  });
});

describe('the reverse edges §5 does not enumerate', () => {
  it('lets grooming move both ways', () => {
    expect(canTransition('backlog', 'todo')).toBe(true);
    expect(canTransition('todo', 'backlog')).toBe(true);
  });

  it('lets work go back when it turns out to be blocked', () => {
    expect(canTransition('in_progress', 'todo')).toBe(true);
    expect(canTransition('in_progress', 'backlog')).toBe(true);
  });

  it('lets a review be rejected', () => {
    expect(canTransition('review', 'in_progress')).toBe(true);
  });

  it('lets a done task be reopened, but only into in_progress', () => {
    // A finished thing needing more work is in progress, not unrefined.
    expect(canTransition('done', 'in_progress')).toBe(true);
    expect(canTransition('done', 'backlog')).toBe(false);
    expect(canTransition('done', 'todo')).toBe(false);
    expect(canTransition('done', 'review')).toBe(false);
  });

  it('does not allow cancelling something already done', () => {
    // Reopening is the operation that was actually wanted.
    expect(canTransition('done', 'cancelled')).toBe(false);
  });

  it('allows cancelling from every unfinished state, and undoing it', () => {
    for (const from of ['backlog', 'todo', 'in_progress', 'review'] as const) {
      expect(canTransition(from, 'cancelled'), from).toBe(true);
    }
    expect(canTransition('cancelled', 'backlog')).toBe(true);
  });
});

describe('assertTransition', () => {
  it('refuses a move to the same status as conflict', () => {
    // It would otherwise write an activity row claiming a change happened.
    try {
      assertTransition('todo', 'todo');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
    }
  });

  it('refuses an illegal move as unprocessable, listing what is allowed', () => {
    try {
      assertTransition('backlog', 'done');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('unprocessable');
      expect((err as ApiError).details).toMatchObject({
        from: 'backlog',
        to: 'done',
        allowed: ALLOWED_TRANSITIONS.backlog,
      });
    }
  });

  it('permits every edge in the table and refuses every other pair', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = ALLOWED_TRANSITIONS[from].includes(to);
        if (from === to) continue;

        if (allowed) {
          expect(() => {
            assertTransition(from, to);
          }, `${from} → ${to}`).not.toThrow();
        } else {
          expect(() => {
            assertTransition(from, to);
          }, `${from} → ${to}`).toThrow(ApiError);
        }
      }
    }
  });
});

describe('isReady (SPEC §4.5)', () => {
  it('counts both backlog and todo', () => {
    // The distinction is for humans triaging, not for readiness — omitting
    // `todo` would make list_ready_tasks miss the tasks most ready to start.
    expect(READY_STATUSES).toEqual(['backlog', 'todo']);

    for (const status of ['backlog', 'todo'] as const) {
      expect(isReady({ status, assigneeId: null, dependencyStatuses: [] }), status).toBe(true);
    }
  });

  it('is false for a task already being worked', () => {
    for (const status of ['in_progress', 'review', 'done', 'cancelled'] as const) {
      expect(isReady({ status, assigneeId: null, dependencyStatuses: [] }), status).toBe(false);
    }
  });

  it('is false once assigned', () => {
    expect(isReady({ status: 'todo', assigneeId: 'u1', dependencyStatuses: [] })).toBe(false);
  });

  it('is false while any dependency is unfinished', () => {
    expect(isReady({ status: 'todo', assigneeId: null, dependencyStatuses: ['done'] })).toBe(true);
    expect(
      isReady({ status: 'todo', assigneeId: null, dependencyStatuses: ['done', 'in_progress'] }),
    ).toBe(false);
    expect(isReady({ status: 'todo', assigneeId: null, dependencyStatuses: ['cancelled'] })).toBe(
      false,
    );
  });
});
