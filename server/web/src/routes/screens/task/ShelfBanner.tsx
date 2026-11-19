import type { Member, TaskSummary } from '../../../api/tasks.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { archivedBanner, trashBanner } from './archive-model.ts';
import type { ShelfActions } from './use-shelf-actions.ts';

export interface ShelfBannerProps {
  readonly task: TaskSummary;
  readonly members: ReadonlyMap<string, Member>;
  readonly actions: ShelfActions;
}

/**
 * **Where a put-away task stands** (LAI-1353, LAI-1354, LAI-1358): in Trash —
 * who, when, the days left — or archived — who and when — with *Restore* for
 * whoever may, and the last refusal under it. The drawer and the Workroom
 * draw this same banner, so they say the same thing.
 */
export function ShelfBanner({ task, members, actions }: ShelfBannerProps) {
  const nameOf = (id: string | null | undefined): string | undefined =>
    id == null ? undefined : members.get(id)?.name;
  return (
    <>
      {task.deleted_at != null && (
        <div className="panel-archived" data-trash-banner="" role="status">
          <Icon name="trash" size="small" />
          <span className="panel-archived-text">
            {trashBanner(task.deleted_at, nameOf(task.deleted_by), Date.now())}
          </span>
          {actions.mayDelete && (
            <button
              type="button"
              className="panel-archived-restore"
              onClick={() => {
                void actions.trash(false);
              }}
            >
              Restore
            </button>
          )}
        </div>
      )}
      {task.archived_at != null && task.deleted_at == null && (
        <div className="panel-archived" data-archived-banner="" role="status">
          <Icon name="archive" size="small" />
          <span className="panel-archived-text">
            {archivedBanner(task.archived_at, nameOf(task.archived_by), Date.now())}
          </span>
          {actions.mayArchive && (
            <button
              type="button"
              className="panel-archived-restore"
              onClick={() => {
                void actions.archive(false);
              }}
            >
              Restore
            </button>
          )}
        </div>
      )}
      {actions.error !== undefined && (
        <p className="panel-alert" role="alert">
          {actions.error}
        </p>
      )}
    </>
  );
}
