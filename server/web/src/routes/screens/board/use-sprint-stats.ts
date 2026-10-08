import { useEffect, useMemo, useState } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import { listTasks, type Task, type TaskFilter } from '../../../api/tasks.ts';
import type { BoardState } from '../../../api/use-board.ts';
import { countStats, narrowsBeyondSprint, type StatCounts } from './sprint-stats.ts';

export interface SprintStatsFigures {
  /** `undefined` until the set they are counted from has been read. */
  readonly counts: StatCounts | undefined;
  /** The read stopped at its page cap, so every figure is a floor. */
  readonly partial: boolean;
  /**
   * Counted from the board's filtered set rather than the whole scope — only
   * on *All sprints* with a server-side filter, and said on screen (LAI-727).
   */
  readonly filtered: boolean;
}

interface SprintRead {
  readonly key: string;
  readonly tasks: readonly Task[];
  readonly truncated: boolean;
}

/**
 * Which tasks the toolbar's DONE / BLK / LEFT are counted from (LAI-727).
 *
 * The strip counted them from **its own walk of the whole project**, re-read
 * on every refresh. That walk is gone. Instead:
 *
 * - **The board's own set**, when the board's read is the sprint and nothing
 *   narrower. The server returns exactly the tasks the strip filtered down to,
 *   so the figures are the strip's with no request at all. This is the
 *   default board — LAI-713 opens it on the active sprint.
 * - **One `?sprint=` read**, when a server-side filter (assignee, status,
 *   priority, tag, ready, updated) narrows the board. The strip ignored
 *   filters, so its figures were the whole sprint's; one small read keeps them
 *   that, rather than quietly turning *DONE 7/30* into *DONE 2/4*. It follows
 *   the board's refreshes, which is what `asOf` marks.
 * - **The board's filtered set, labelled**, on *All sprints* with such a
 *   filter. The unfiltered answer there is the whole-project walk this task
 *   removed, so the figures describe what is loaded and say so instead.
 */
export function useSprintStats(
  slug: string | undefined,
  filter: TaskFilter,
  board: Pick<BoardState, 'status' | 'tasks' | 'truncated' | 'asOf'>,
): SprintStatsFigures {
  const sprint = filter.sprint;
  const ownRead = sprint !== undefined && narrowsBeyondSprint(filter);
  const key = ownRead && slug !== undefined ? `${slug}\u0000${sprint}` : undefined;
  const [read, setRead] = useState<SprintRead | undefined>(undefined);

  useEffect(() => {
    // After the board has answered, so opening a filtered board is one read
    // of each, not two of this.
    if (key === undefined || slug === undefined || sprint === undefined) return;
    if (board.asOf === null) return;
    const controller = new AbortController();
    everyPage((cursor) =>
      listTasks(
        slug,
        cursor === undefined ? { sprint, limit: 200 } : { sprint, limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items, truncated }) => {
        setRead({ key, tasks: items, truncated });
      })
      .catch(() => {
        // A failed re-read keeps the last figures; a new scope shows none.
      });
    return () => {
      controller.abort();
    };
  }, [key, slug, sprint, board.asOf]);

  const fromBoard = useMemo(
    () => (board.status === 'ready' ? countStats(board.tasks) : undefined),
    [board.status, board.tasks],
  );
  const fromRead = useMemo(
    () => (read !== undefined && read.key === key ? countStats(read.tasks) : undefined),
    [read, key],
  );

  if (key !== undefined) {
    return {
      counts: fromRead,
      partial: read?.key === key && read.truncated,
      filtered: false,
    };
  }
  return {
    counts: fromBoard,
    partial: board.truncated,
    filtered: sprint === undefined && narrowsBeyondSprint(filter),
  };
}
