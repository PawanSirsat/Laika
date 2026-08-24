import { useState } from 'react';
import type { Sprint } from '../../../api/sprints.ts';
import type { SprintTask } from './sprint-derive.ts';

export interface AssignTasksPanelProps {
  readonly sprint: Sprint;
  readonly available: readonly SprintTask[];
  readonly busy: boolean;
  readonly onAssign: (taskIds: readonly string[]) => Promise<boolean>;
  readonly onClose: () => void;
}

/**
 * Move tasks into a sprint (LAI-083).
 *
 * **All or nothing, and the panel says so.** `POST /sprints/:id/tasks` rejects
 * the whole request if any id is unknown or belongs to another project, inside
 * one transaction — so on failure *nothing* was applied. That is the useful
 * half of the guarantee and the half a user cannot see, so it is written next to
 * the button rather than left for them to infer from a list that did not change.
 *
 * Only unassigned tasks are offered. Moving a task **between** sprints is
 * removing it from one and adding it to the other, which the card's Remove
 * control already does — offering it here would need a second confirmation about
 * which sprint loses it, for a case that is one extra click as it stands.
 */
export function AssignTasksPanel({
  sprint,
  available,
  busy,
  onAssign,
  onClose,
}: AssignTasksPanelProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <section className="sprint-assign" aria-label={`Add tasks to ${sprint.name}`}>
      <header className="sprint-assign-head">
        <h3 className="sprint-assign-title">Add tasks to {sprint.name}</h3>
        <button type="button" className="sprint-button" onClick={onClose} disabled={busy}>
          Close
        </button>
      </header>

      {available.length === 0 ? (
        <p className="sprint-assign-empty">
          Every task in this project is already in a sprint. Remove one from its sprint to move it.
        </p>
      ) : (
        <>
          <ul className="sprint-assign-list">
            {available.map((task) => (
              <li key={task.id} className="sprint-assign-item">
                <label className="sprint-assign-label">
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={() => {
                      toggle(task.id);
                    }}
                    disabled={busy}
                  />
                  <span className="sprint-task-key">{task.key}</span>
                  <span className="sprint-task-title">{task.title}</span>
                  <span className={`sprint-task-status sprint-task-${task.status}`}>
                    {task.status}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="sprint-hint">
            Tasks are added together. If one cannot be added, none of them are.
          </p>

          <div className="sprint-form-actions">
            <button
              type="button"
              className="sprint-button sprint-button-primary"
              disabled={busy || selected.size === 0}
              onClick={() => {
                void onAssign([...selected]).then((ok) => {
                  if (ok) {
                    setSelected(new Set());
                    onClose();
                  }
                });
              }}
            >
              {busy
                ? 'Adding…'
                : `Add ${String(selected.size)} task${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
