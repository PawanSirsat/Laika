import { useMemo } from 'react';
import { matchesTaskFilter } from '../../../api/task-filter.ts';
import type { TaskFilter } from '../../../api/tasks.ts';
import type { BoardState } from '../../../api/use-board.ts';
import { countStats, type StatCounts } from './sprint-stats.ts';

export interface SprintStatsFigures {
  /** `undefined` until the set they are counted from has been read. */
  readonly counts: StatCounts | undefined;
  /** The read stopped at its page cap, so every figure is a floor. */
  readonly partial: boolean;
}

/**
 * Which tasks the toolbar's DONE / BLK / LEFT are counted from (LAI-727).
 *
 * The strip counted them from **its own walk of the whole project**, re-read
 * on every refresh. That walk is gone, and the figures make no read of their
 * own either: the board holds the project's whole task set in the browser
 * (`board.all`, the shared store — LAI-724, D-075) and filters it in memory,
 * so the figures are that set **scoped to the sprint and nothing narrower** —
 * the sprint's tasks, the tasks with none, or every task for *All sprints*.
 *
 * The strip ignored filters, so an assignee or a status never turns
 * *DONE 7/30* into *DONE 2/4*; and a filter change or a sprint switch is a
 * recount, not a request. The scope is `matchesTaskFilter`'s, so `none` means
 * here what it means on the board.
 */
export function useSprintStats(
  filter: TaskFilter,
  board: Pick<BoardState, 'status' | 'all' | 'truncated'>,
): SprintStatsFigures {
  const sprint = filter.sprint;
  const counts = useMemo(() => {
    if (board.status !== 'ready') return undefined;
    if (sprint === undefined) return countStats(board.all);
    return countStats(board.all.filter((task) => matchesTaskFilter(task, { sprint })));
  }, [board.status, board.all, sprint]);
  return { counts, partial: board.truncated };
}
