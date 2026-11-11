import type { TaskSummary } from '../../../api/tasks.ts';
import { workroomHref } from '../../task-href.ts';

export interface TaskHierarchyProps {
  readonly task: TaskSummary;
  readonly parent: TaskSummary | undefined;
  readonly byId: ReadonlyMap<string, TaskSummary>;
  /** Open another task's Workroom — a pushed entry. */
  readonly onOpenKey: (key: string) => void;
}

function TaskLink({
  task,
  onOpenKey,
}: {
  readonly task: TaskSummary;
  readonly onOpenKey: (key: string) => void;
}) {
  return (
    <a
      className="wr-link"
      href={workroomHref(task.key)}
      data-category={task.status}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenKey(task.key);
      }}
    >
      <span className="wr-link-key">{task.key}</span>
      <span className="wr-link-title">{task.title}</span>
      <span className="wr-link-status">{task.status_name}</span>
    </a>
  );
}

function Group({
  title,
  ids,
  byId,
  empty,
  onOpenKey,
}: {
  readonly title: string;
  readonly ids: readonly string[];
  readonly byId: ReadonlyMap<string, TaskSummary>;
  readonly empty: string;
  readonly onOpenKey: (key: string) => void;
}) {
  return (
    <div className="wr-group" data-group={title}>
      <h3 className="wr-group-title">
        {title} <span className="wr-count">{String(ids.length)}</span>
      </h3>
      {ids.length === 0 ? (
        <p className="wr-empty">{empty}</p>
      ) : (
        <ul className="wr-links">
          {ids.map((id) => {
            const linked = byId.get(id);
            return (
              <li key={id}>
                {linked === undefined ? (
                  <span className="wr-link wr-link-gone">A task this space did not return</span>
                ) : (
                  <TaskLink task={linked} onOpenKey={onOpenKey} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Where the task sits (LAI-1199): its parent, its subtasks, what blocks it
 * and what it blocks, and the task it was discovered from — each a link to
 * that task's own Workroom.
 */
export function TaskHierarchy({ task, parent, byId, onOpenKey }: TaskHierarchyProps) {
  const subtasks = [...byId.values()].filter((t) => t.parent_task_id === task.id).map((t) => t.id);
  return (
    <div className="wr-hierarchy">
      <div className="wr-group" data-group="Parent">
        <h3 className="wr-group-title">Parent</h3>
        {task.parent_task_id === null ? (
          <p className="wr-empty">Not a subtask.</p>
        ) : parent === undefined ? (
          <p className="wr-link wr-link-gone">A task this space did not return</p>
        ) : (
          <TaskLink task={parent} onOpenKey={onOpenKey} />
        )}
      </div>
      <Group title="Subtasks" ids={subtasks} byId={byId} empty="No subtasks." onOpenKey={onOpenKey} />
      <Group
        title="Blocked by"
        ids={task.blocked_by}
        byId={byId}
        empty="Nothing blocks this."
        onOpenKey={onOpenKey}
      />
      <Group
        title="Blocks"
        ids={task.blocks}
        byId={byId}
        empty="It blocks nothing."
        onOpenKey={onOpenKey}
      />
      <Group
        title="Related"
        ids={task.discovered_from === null ? [] : [task.discovered_from]}
        byId={byId}
        empty="Not discovered from another task."
        onOpenKey={onOpenKey}
      />
    </div>
  );
}
