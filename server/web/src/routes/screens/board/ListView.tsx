import { useState } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { blockedState, COLUMN_LABELS } from '../../../api/board-derive.ts';
import type { Member, Task } from '../../../api/tasks.ts';

export interface ListViewProps {
  readonly tasks: readonly Task[];
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  readonly filtered: boolean;
}

type SortKey = 'key' | 'title' | 'status' | 'assignee' | 'priority' | 'deps' | 'updated';

/**
 * The same tasks as a dense table (§11.4.1).
 *
 * "Same tasks, same filters" is the contract — this takes the list the board
 * already has rather than fetching its own, so the two views cannot disagree.
 */
export function ListView({ tasks, byId, members, filtered }: ListViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'key', asc: true });

  const name = (task: Task): string =>
    task.assignee_id === null ? '' : (members.get(task.assignee_id)?.name ?? task.assignee_id);

  const value = (task: Task, key: SortKey): string | number => {
    switch (key) {
      case 'key':
        return task.number;
      case 'title':
        return task.title.toLowerCase();
      case 'status':
        return task.status;
      case 'assignee':
        return name(task).toLowerCase();
      case 'priority':
        return task.priority;
      case 'deps':
        return task.dependencies.length;
      case 'updated':
        return task.updated_at;
    }
  };

  const sorted = [...tasks].sort((a, b) => {
    const [x, y] = [value(a, sort.key), value(b, sort.key)];
    const order = x < y ? -1 : x > y ? 1 : 0;
    return sort.asc ? order : -order;
  });

  const header = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="list-sort"
        onClick={() => {
          setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));
        }}
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        headline={filtered ? 'Nothing here for this filter' : 'No tasks in this project yet'}
        {...(filtered ? { body: 'Widen the range or switch the filter.' } : {})}
      />
    );
  }

  return (
    <table className="list">
      <thead>
        <tr>
          {header('key', 'Key')}
          {header('title', 'Title')}
          {header('status', 'Status')}
          {header('assignee', 'Assignee')}
          {header('priority', 'Priority')}
          {header('deps', 'Deps')}
          {header('updated', 'Updated')}
        </tr>
      </thead>
      <tbody>
        {sorted.map((task) => {
          const blocked = blockedState(task, byId);
          return (
            <tr key={task.id}>
              <td className="list-key">{task.key}</td>
              <td>
                {task.title}
                {task.ready && <span className="marker marker-ready">ready</span>}
                {blocked === true && <span className="marker marker-blocked">blocked</span>}
              </td>
              <td>{task.status === 'cancelled' ? 'Cancelled' : COLUMN_LABELS[task.status]}</td>
              <td>
                {name(task) === '' ? (
                  <span className="card-unassigned">unassigned</span>
                ) : (
                  name(task)
                )}
              </td>
              <td className={`list-priority list-priority-${task.priority}`}>{task.priority}</td>
              <td>{task.dependencies.length}</td>
              <td className="list-updated">
                <time dateTime={new Date(task.updated_at).toISOString()}>
                  {new Date(task.updated_at).toLocaleDateString()}
                </time>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
