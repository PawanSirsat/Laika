import { useState } from 'react';
import { holdsProjectAction, implicitlyLeads, usePermissions } from '../../../api/permissions.ts';
import { setTaskArchived, setTaskDeleted, type TaskSummary } from '../../../api/tasks.ts';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import {
  archivedToast,
  archiveRefusal,
  deleteConfirm,
  restoredToast,
  trashedToast,
  untrashedToast,
} from './archive-model.ts';

/** What a task view needs to put a task away and bring it back (LAI-1353, LAI-1354). */
export interface ShelfActions {
  readonly archived: boolean;
  readonly deleted: boolean;
  /** Archived or in Trash: read-only until restored. */
  readonly putAway: boolean;
  /** `task.archive` here. */
  readonly mayArchive: boolean;
  /** `task.delete` here, asked as the server will: a lead any task, a member one they created. */
  readonly mayDelete: boolean;
  /** Why the last Archive, Delete or Restore was refused. */
  readonly error: string | undefined;
  /** Archive (`true`) or restore from the archive (`false`), with an Undo toast. */
  readonly archive: (to: boolean) => Promise<void>;
  /** Into Trash (`true`, after a confirm) or back out (`false`), with an Undo toast. */
  readonly trash: (to: boolean) => Promise<void>;
}

export interface ShelfActionsOptions {
  /** The signed-in reader, for `task.delete`'s own-created rule. */
  readonly meId: string | undefined;
  /** The space's tasks the view holds, to count the subtasks that go too. */
  readonly siblings: Iterable<TaskSummary>;
  /** Re-read after a change, so the view follows the server. */
  readonly onChanged: () => void;
  /** Run first — the drawer closes its ⋯ menu. */
  readonly beforeAct?: (() => void) | undefined;
}

/**
 * **Archive and Trash, for any view of one task** (LAI-1353, LAI-1354,
 * LAI-1358) — the drawer and the full-page Workroom ask the same rules and
 * say the same words, so neither can drift from the other.
 *
 * - Archive: no confirm, an Undo toast; its subtasks go with it.
 * - Delete: a confirm first, since Trash is scrubbed after 30 days; then Undo.
 * - Each shows only to whoever may: `task.archive`, and `task.delete` with
 *   its own-created rule, so nobody is offered a button that answers `403`.
 */
export function useShelfActions(task: TaskSummary, options: ShelfActionsOptions): ShelfActions {
  const { meId, siblings, onChanged, beforeAct } = options;
  const { permissions } = usePermissions();
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState<string | undefined>(undefined);

  const archived = task.archived_at != null;
  const deleted = task.deleted_at != null;
  const projectRole =
    permissions?.me.projects.find((p) => p.project_id === task.project_id)?.role ?? null;
  const leads = projectRole === 'lead' || implicitlyLeads(permissions, task.project_id);
  const mayArchive = holdsProjectAction(permissions, task.project_id, 'task.archive');
  const mayDelete =
    holdsProjectAction(permissions, task.project_id, 'task.delete') &&
    (leads || (meId !== undefined && task.created_by === meId));

  /** The subtasks a move takes along: those not already where it is going. */
  const childrenGoing = (stillThere: (t: TaskSummary) => boolean): number =>
    [...siblings].filter((t) => t.parent_task_id === task.id && stillThere(t)).length;

  const archive = async (to: boolean): Promise<void> => {
    beforeAct?.();
    setError(undefined);
    const subtasks = childrenGoing((t) => (t.archived_at == null) === to);
    const said = (archivedNow: boolean): string =>
      archivedNow ? archivedToast(task.key, subtasks) : restoredToast(task.key);
    try {
      await setTaskArchived(task.id, to);
    } catch (cause) {
      setError(archiveRefusal(cause, to ? 'archive' : 'restore'));
      return;
    }
    onChanged();
    toast.show({
      text: said(to),
      tone: 'info',
      mark: 'data-archive-toast',
      // A real reversal: the server puts it back as it was.
      undo: async () => {
        await setTaskArchived(task.id, !to);
        onChanged();
        return said(!to);
      },
    });
  };

  const trash = async (to: boolean): Promise<void> => {
    beforeAct?.();
    setError(undefined);
    const subtasks = childrenGoing((t) => (t.deleted_at == null) === to);
    if (to) {
      const ask = deleteConfirm(task.key, subtasks);
      const yes = await confirm({
        title: ask.title,
        body: ask.body,
        confirmLabel: 'Move to Trash',
        danger: true,
      });
      if (!yes) return;
    }
    const said = (inTrash: boolean, stillArchived: boolean): string =>
      inTrash ? trashedToast(task.key, subtasks) : untrashedToast(task.key, stillArchived);
    let back: TaskSummary;
    try {
      back = await setTaskDeleted(task.id, to);
    } catch (cause) {
      setError(archiveRefusal(cause, to ? 'delete' : 'restore'));
      return;
    }
    onChanged();
    toast.show({
      text: said(to, back.archived_at != null),
      tone: 'info',
      mark: 'data-trash-toast',
      undo: async () => {
        const again = await setTaskDeleted(task.id, !to);
        onChanged();
        return said(!to, again.archived_at != null);
      },
    });
  };

  return {
    archived,
    deleted,
    putAway: archived || deleted,
    mayArchive,
    mayDelete,
    error,
    archive,
    trash,
  };
}
