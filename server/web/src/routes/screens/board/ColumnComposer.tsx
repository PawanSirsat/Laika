import { Spinner } from '../../../components/Spinner.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { createTask, PRIORITIES } from '../../../api/tasks.ts';
import type { ProjectStatus } from '../../../api/statuses.ts';
import './column-composer.css';

export interface ColumnComposerProps {
  readonly slug: string;
  /** The column it opened in: the task is created in this status (LAI-739). */
  readonly status: ProjectStatus;
  readonly onCreated: () => void;
  readonly onClose: () => void;
}

/**
 * Create a card **in the column you clicked** (LAI-290).
 *
 * ## The bug this fixes
 *
 * `KanbanView`'s `onAdd` took **no arguments**, and every lane's `+` opened one
 * banner above the whole board which posted no `status` — so creating from
 * *Done* produced a task in `backlog`. The endpoint has accepted `status` all
 * along (`CreateBody` in `http/routes/tasks.ts`); nothing ever sent it.
 *
 * ## Why it stays small
 *
 * `NewTaskForm`'s docblock argued a create form should ask for little:
 *
 * > A create form that asks for everything is a form people avoid.
 *
 * That survives. This asks for a title and, optionally, a priority — the column
 * supplies the status, which is the whole point. Assignee, description and tags
 * are still decisions better made in the panel with the task in front of you.
 *
 * ## Staying open
 *
 * Enter creates and **keeps the box open**, cleared, because adding cards is
 * something people do in runs. Escape closes it. A failed create keeps the text
 * — the one outcome a composer must never have is losing what somebody typed.
 */
export function ColumnComposer({ slug, status, onCreated, onClose }: ColumnComposerProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('p2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;

    setBusy(true);
    setError(undefined);

    try {
      await createTask(slug, { title: trimmed, priority, status_id: status.id });
      setTitle('');
      onCreated();
      field.current?.focus();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      <textarea
        ref={field}
        className="composer-title"
        rows={2}
        value={title}
        maxLength={300}
        disabled={busy}
        placeholder="What needs to be done?"
        aria-label={`New task in ${status.name}`}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          // Enter submits; Shift+Enter is a newline, as in every composer.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      {error !== undefined && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}

      <div className="composer-foot">
        <label className={`composer-prio composer-prio-${priority}`}>
          <span className="visually-hidden">Priority</span>
          <Dropdown
            variant="bare"
            noun="priorities"
            value={priority}
            disabled={busy}
            onChange={(value) => {
              setPriority(value);
            }}
            options={PRIORITIES.map((p) => ({ value: p, label: p.toUpperCase() }))}
          />
        </label>

        {/* Where it will land, said rather than implied — the whole defect this
            component exists to fix was a card landing somewhere else. */}
        <span className="composer-target">{status.name}</span>

        <button
          type="button"
          className="composer-submit"
          disabled={busy || title.trim() === ''}
          onClick={() => {
            void submit();
          }}
        >
          {busy && <Spinner size="sm" />}
          <span aria-hidden="true">↵</span>
          <span className="visually-hidden">Create</span>
        </button>
      </div>
    </div>
  );
}
