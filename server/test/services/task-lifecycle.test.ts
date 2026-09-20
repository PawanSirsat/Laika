import { describe, expect, it } from 'vitest';
import { type TaskStatus } from '../../src/db/enums.ts';
import { ApiError } from '../../src/errors.ts';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  isReady,
  READY_STATUSES,
  transitionsFrom,
} from '../../src/services/task-lifecycle.ts';

const ALL: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];

/*
 * **Everything below the human block is about the `'agent'` table** — the one
 * `ALLOWED_TRANSITIONS` declares, unchanged by LAI-266. The assertions were
 * written before the split and are still exactly right about it; threading
 * `'agent'` through them is not a weakening.
 */

describe('the §5 forward path, for an agent', () => {
  it('allows every edge the diagram draws', () => {
    expect(canTransition('backlog', 'todo', 'agent')).toBe(true);
    expect(canTransition('todo', 'in_progress', 'agent')).toBe(true);
    expect(canTransition('in_progress', 'review', 'agent')).toBe(true);
    expect(canTransition('review', 'done', 'agent')).toBe(true);
  });

  it('does not allow skipping straight from backlog to done', () => {
    // A task that was never in review was never approved by anyone.
    expect(canTransition('backlog', 'done', 'agent')).toBe(false);
    expect(canTransition('todo', 'done', 'agent')).toBe(false);
    expect(canTransition('in_progress', 'done', 'agent')).toBe(false);
  });
});

describe('the reverse edges §5 does not enumerate, for an agent', () => {
  it('lets grooming move both ways', () => {
    expect(canTransition('backlog', 'todo', 'agent')).toBe(true);
    expect(canTransition('todo', 'backlog', 'agent')).toBe(true);
  });

  it('lets work go back when it turns out to be blocked', () => {
    expect(canTransition('in_progress', 'todo', 'agent')).toBe(true);
    expect(canTransition('in_progress', 'backlog', 'agent')).toBe(true);
  });

  it('lets a review be rejected', () => {
    expect(canTransition('review', 'in_progress', 'agent')).toBe(true);
  });

  it('lets a done task be reopened, but only into in_progress', () => {
    // A finished thing needing more work is in progress, not unrefined.
    expect(canTransition('done', 'in_progress', 'agent')).toBe(true);
    expect(canTransition('done', 'backlog', 'agent')).toBe(false);
    expect(canTransition('done', 'todo', 'agent')).toBe(false);
    expect(canTransition('done', 'review', 'agent')).toBe(false);
  });

  it('does not allow cancelling something already done', () => {
    // Reopening is the operation that was actually wanted.
    expect(canTransition('done', 'cancelled', 'agent')).toBe(false);
  });

  it('allows cancelling from every unfinished state, and undoing it', () => {
    for (const from of ['backlog', 'todo', 'in_progress', 'review'] as const) {
      expect(canTransition(from, 'cancelled', 'agent'), from).toBe(true);
    }
    expect(canTransition('cancelled', 'backlog', 'agent')).toBe(true);
  });
});

describe('assertTransition', () => {
  it('refuses a move to the same status as conflict', () => {
    // It would otherwise write an activity row claiming a change happened.
    try {
      assertTransition('todo', 'todo', 'agent');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
    }
  });

  it('refuses an illegal move as unprocessable, listing what is allowed', () => {
    try {
      assertTransition('backlog', 'done', 'agent');
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
            assertTransition(from, to, 'agent');
          }, `${from} → ${to}`).not.toThrow();
        } else {
          expect(() => {
            assertTransition(from, to, 'agent');
          }, `${from} → ${to}`).toThrow(ApiError);
        }
      }
    }
  });
});

describe('the human table (LAI-266)', () => {
  const OPEN: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];

  it('opens every move an agent is refused between open statuses', () => {
    // These four are the gestures custom columns make ordinary and the agent
    // table refuses. Named individually rather than only swept below, because
    // the sweep would still pass if `humanTransitions` returned everything.
    expect(canTransition('todo', 'done', 'human')).toBe(true);
    expect(canTransition('backlog', 'review', 'human')).toBe(true);
    expect(canTransition('done', 'todo', 'human')).toBe(true);
    expect(canTransition('review', 'backlog', 'human')).toBe(true);

    for (const from of OPEN) {
      for (const to of OPEN) {
        if (from === to) continue;
        expect(canTransition(from, to, 'human'), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('still refuses cancelling something already done', () => {
    // The widening is about the *path* through open statuses. Cancellation
    // keeps its own argument, and that argument did not change.
    expect(canTransition('done', 'cancelled', 'human')).toBe(false);
  });

  it('still leaves cancelled only by way of backlog', () => {
    expect(canTransition('cancelled', 'backlog', 'human')).toBe(true);

    for (const to of ['todo', 'in_progress', 'review', 'done'] as const) {
      expect(canTransition('cancelled', to, 'human'), to).toBe(false);
    }
  });

  it('still allows cancelling from every unfinished state', () => {
    for (const from of ['backlog', 'todo', 'in_progress', 'review'] as const) {
      expect(canTransition(from, 'cancelled', 'human'), from).toBe(true);
    }
  });

  it('still refuses a no-op as conflict', () => {
    try {
      assertTransition('todo', 'todo', 'human');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
    }
  });

  it('reports the human list when a human is refused', () => {
    // The `allowed` array must come from the table that produced the refusal.
    // Reporting the agent list beside a human refusal would make the error body
    // contradict the error — and `done → cancelled` is the only pair that can
    // catch it, because it is the only human refusal that is not a no-op.
    try {
      assertTransition('done', 'cancelled', 'human');
      throw new Error('should have thrown');
    } catch (err) {
      const details = (err as ApiError).details as { allowed: TaskStatus[] };
      expect((err as ApiError).code).toBe('unprocessable');
      expect([...details.allowed].sort()).toEqual(['backlog', 'in_progress', 'review', 'todo']);
      expect(details.allowed).not.toContain('cancelled');
    }
  });

  it('is derived from the agent table rather than written out twice', () => {
    // The property that keeps the two from drifting: wherever the agent table
    // permits cancellation, so does the human one, and nowhere else. If someone
    // hand-writes the human table later, this is what notices.
    for (const from of ALL) {
      expect(transitionsFrom(from, 'human').includes('cancelled'), `${from} → cancelled`).toBe(
        ALLOWED_TRANSITIONS[from].includes('cancelled'),
      );
    }
  });

  it('never narrows what an agent may already do', () => {
    // A human can do at least everything an agent can. Stated as a property
    // because the two tables are built differently and could diverge anywhere.
    for (const from of ALL) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(canTransition(from, to, 'human'), `${from} → ${to}`).toBe(true);
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
