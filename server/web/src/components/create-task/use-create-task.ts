import { createContext, useContext } from 'react';

export interface CreateTaskOpenOptions {
  /**
   * The space to start in — a lane's own +, a space's `c`. Absent: the space
   * on screen, else the last one created in, else the first allowed
   * (`defaultCreateSpace`). The reader can change it in the dialog.
   */
  readonly slug?: string | undefined;
  /** A column to start in — a lane's own control passes its status. */
  readonly statusId?: string | undefined;
}

export interface CreateTask {
  /** Open the dialog; a no-op for a reader who may create a task nowhere. */
  readonly open: (options?: CreateTaskOpenOptions) => void;
  readonly close: () => void;
  /** Whether the reader may create a task in some space, as the server's grants say. */
  readonly mayCreate: boolean;
  /** Whether they may in the space on screen (none: `false`) — what a space's own `+` asks. */
  readonly mayCreateHere: boolean;
  /** Why Create is unavailable, for its tooltip; `undefined` when it is available. */
  readonly whyNot: string | undefined;
}

export const CreateTaskContext = createContext<CreateTask | undefined>(undefined);

/**
 * The app's Create task dialog (LAI-1167, D-145; app-wide since LAI-1227);
 * only under `CreateTaskProvider`, which the shell mounts for a signed-in
 * reader.
 */
export function useCreateTask(): CreateTask {
  const value = useContext(CreateTaskContext);
  if (value === undefined) {
    throw new Error('useCreateTask needs CreateTaskProvider above it (AppShell mounts it)');
  }
  return value;
}
