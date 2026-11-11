import { createContext, useContext } from 'react';

export interface CreateTaskOpenOptions {
  /** A column to start in — a lane's own control could pass its status. */
  readonly statusId?: string | undefined;
}

export interface CreateTask {
  /** Open the dialog; a no-op for a reader who may not create here. */
  readonly open: (options?: CreateTaskOpenOptions) => void;
  readonly close: () => void;
  /** Whether this space lets the reader create a task at all. */
  readonly mayCreate: boolean;
}

export const CreateTaskContext = createContext<CreateTask | undefined>(undefined);

/**
 * The space's Create task dialog (LAI-1167, D-145); only under
 * `CreateTaskProvider`, which `SpaceLayout` mounts for every view of a space.
 */
export function useCreateTask(): CreateTask {
  const value = useContext(CreateTaskContext);
  if (value === undefined) {
    throw new Error('useCreateTask needs CreateTaskProvider above it (SpaceLayout mounts it)');
  }
  return value;
}
