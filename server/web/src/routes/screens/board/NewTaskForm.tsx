import { useEffect, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { createTask, PRIORITIES, type TaskPriority } from '../../../api/tasks.ts';

export interface NewTaskFormProps {
  readonly slug: string;
  /** Called once the server has created it, so the board can reload. */
  readonly onCreated: () => void;
  readonly onCancel: () => void;
}

/**
 * Create a task (LAI-065).
 *
 * **The first way to make a task from the UI.** `POST /projects/:slug/tasks` has
 * existed since LAI-011 and nothing in the browser could reach it — a board you
 * can only read is a board someone else has to fill in.
 *
 * Title and priority only. The endpoint also accepts a description, an assignee,
 * a status and `discovered_from`, and every one of those is a decision better
 * made in the task detail panel with the task in front of you. A create form
 * that asks for everything is a form people avoid.
 */
export function NewTaskForm({ slug, onCreated, onCancel }: NewTaskFormProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('p2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus lands in the field, not on the dialog: the next thing anyone does
  // here is type a title.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const trimmed = title.trim();

  return (
    <form
      className="new-task"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === '' || busy) return;

        setBusy(true);
        setError(null);
        createTask(slug, { title: trimmed, priority })
          .then(() => {
            setTitle('');
            onCreated();
            onCancel();
          })
          .catch((cause: unknown) => {
            // Stays open with the title still in it. Closing on failure would
            // throw away what they typed and leave only an error to read.
            setError(cause);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {error !== null && <ApiErrorState error={error} resource="this task" verb="create" />}

      <label className="new-task-title">
        <span className="visually-hidden">Task title</span>
        <input
          ref={titleRef}
          type="text"
          className="input"
          placeholder="What needs doing?"
          value={title}
          maxLength={300}
          disabled={busy}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>

      <label className="new-task-priority">
        <span className="visually-hidden">Priority</span>
        <select
          value={priority}
          disabled={busy}
          onChange={(event) => {
            setPriority(event.target.value as TaskPriority);
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      {/* Disabled on an empty title rather than submitting and letting the
          server answer 422 for something the form already knows. */}
      <Button type="submit" busy={busy} busyLabel="Creating…" disabled={trimmed === ''}>
        Create
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
