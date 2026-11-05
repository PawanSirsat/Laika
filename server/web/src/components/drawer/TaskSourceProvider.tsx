import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Member, TaskSummary } from '../../api/tasks.ts';
import type { ProjectStatus } from '../../api/statuses.ts';
import type { Sprint } from '../../api/sprints.ts';

/**
 * What the task drawer reads about the space it is open over (LAI-1127) — the
 * seam the Workroom spec calls `TaskEnvironment` (task-workroom.md §3).
 */
export interface TaskEnvironment {
  readonly slug: string;
  /** The project's task set by id: the shown task, its parent, its links. */
  readonly byId: ReadonlyMap<string, TaskSummary>;
  /** The set is still on its first read — a task not in it may yet arrive. */
  readonly loading: boolean;
  readonly members: ReadonlyMap<string, Member>;
  readonly statuses: readonly ProjectStatus[];
  readonly sprints: readonly Sprint[];
  /** The space's `agents_allowed`; absent reads as allowed. */
  readonly agentsAllowed?: boolean | undefined;
  /** When the set was last read (`asOf`), and when that read started. */
  readonly listReadAt: number | null;
  readonly listReadOrder: number;
}

/** What the drawer may ask the view to do — the spec's `TaskActions`. */
export interface TaskActions {
  /** The id being moved now, if any. */
  readonly movingId: string | undefined;
  /** The server's reason for refusing the last move. */
  readonly moveError: string | undefined;
  /** Into a project status, by id — the view's own move (LAI-056). */
  readonly onMove: (taskId: string, toStatusId: string) => void;
  /** Re-read the view's set after an edit made from the drawer. */
  readonly refresh: () => void;
  /** The newest live frame that changes a task's execution (LAI-543). */
  readonly executionSignal?: ((taskId: string) => number | undefined) | undefined;
}

/**
 * A view's live copy of the task set, offered to the drawer.
 *
 * The board and the list hold a store with local, optimistic writes (a card
 * dragged a moment ago, a move still in flight). The drawer reads **that**
 * copy when the view offers it, so the panel and the card under it never
 * disagree; every other view leaves the drawer to its own reads.
 */
export interface TaskSource extends TaskEnvironment, TaskActions {}

type Register = (source: TaskSource | undefined) => void;

const RegisterContext = createContext<Register | undefined>(undefined);

export interface TaskSourceProviderProps {
  /** Told of every offer, and of `undefined` when the view withdraws it. */
  readonly onSource: Register;
  readonly children: ReactNode;
}

/**
 * Where a view offers its task set to the drawer host (LAI-1127).
 *
 * **The setter is the only thing in context**, and it must be stable: a view
 * that read the offered source back through context would re-render on every
 * offer it made, and offer again. The host gets the source as a prop instead.
 */
export function TaskSourceProvider({ onSource, children }: TaskSourceProviderProps) {
  return <RegisterContext.Provider value={onSource}>{children}</RegisterContext.Provider>;
}

/**
 * Offer `source` to the drawer while this view is mounted. Pass a memoised
 * object — a new one on every render is a new offer on every render. Outside
 * a space (no provider) it does nothing.
 */
export function useOfferTaskSource(source: TaskSource | undefined): void {
  const register = useContext(RegisterContext);
  useEffect(() => {
    register?.(source);
  }, [register, source]);
  useEffect(
    () => () => {
      register?.(undefined);
    },
    [register],
  );
}
