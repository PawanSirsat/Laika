import { useState } from 'react';
import { ALL_STATUSES, boardStatusLabel } from '../../../api/board-derive.ts';
import type { BoardColumn } from '../../../api/columns.ts';
import type { Sprint } from '../../../api/sprints.ts';
import { PRIORITIES, type Member, type TaskPriority, type TaskStatus } from '../../../api/tasks.ts';
import { anchorOf, ListMenu, type MenuAnchor, type MenuItem } from './ListMenu.tsx';
import type { BulkAction, BulkRun } from './list-bulk.ts';

export interface BulkBarProps {
  /** How many rows are selected, of `total` rows the filter left. */
  readonly count: number;
  readonly total: number;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly columns: readonly BoardColumn[];
  readonly members: ReadonlyMap<string, Member>;
  readonly sprints: readonly Sprint[];
  readonly sprintLabels: ReadonlyMap<string, { readonly label: string }>;
  /** Assigning to a sprint is member+ (§3.2) — absent otherwise, not disabled. */
  readonly maySetSprint: boolean;
  readonly run: BulkRun | undefined;
  readonly onAction: (action: BulkAction) => void;
  readonly onDismissReport: () => void;
}

type Open = 'status' | 'priority' | 'assignee' | 'sprint';

const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
  p1: 'P1 — highest',
  p2: 'P2',
  p3: 'P3 — lowest',
};

/**
 * The bar that appears once anything is selected (LAI-496; the owner's
 * second screenshot). *n selected · Select all N · Status · Priority ·
 * Assignee · Sprint · Cancel tasks · ×*, then a progress line while an action
 * runs and the report when it ends.
 *
 * **Every control is a menu over the same choices the drawer offers**, with
 * the same labels — the board's column names for statuses (LAI-490) — so
 * nothing here can disagree with the task panel about what a status is
 * called.
 *
 * **Cancel asks once, in place.** It is the one action that takes work off
 * the board, and it is offered where the screenshot puts *Delete*; a confirm
 * step inside the bar costs one click and no dialog.
 */
export function BulkBar({
  count,
  total,
  onSelectAll,
  onClear,
  columns,
  members,
  sprints,
  sprintLabels,
  maySetSprint,
  run,
  onAction,
  onDismissReport,
}: BulkBarProps) {
  const [open, setOpen] = useState<{ readonly which: Open; readonly at: MenuAnchor } | undefined>(
    undefined,
  );
  const [confirming, setConfirming] = useState(false);
  const busy = run?.phase === 'running';

  const menuOf = (which: Open): { label: string; items: readonly MenuItem[] } => {
    switch (which) {
      case 'status':
        return {
          label: 'Change status',
          items: ALL_STATUSES.map((s) => ({
            value: s,
            label: boardStatusLabel(s, columns),
            danger: s === 'cancelled',
          })),
        };
      case 'priority':
        return {
          label: 'Change priority',
          items: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
        };
      case 'assignee':
        return {
          label: 'Assign to',
          items: [
            { value: '', label: 'Unassigned' },
            ...[...members.values()].map((m) => ({ value: m.user_id, label: m.name })),
          ],
        };
      case 'sprint':
        return {
          label: 'Move to sprint',
          items: [
            { value: '', label: 'No sprint' },
            ...sprints.map((s) => ({
              value: s.id,
              label: `${sprintLabels.get(s.id)?.label ?? ''} · ${s.name}`,
            })),
          ],
        };
    }
  };

  const pick = (which: Open, value: string): void => {
    setOpen(undefined);
    switch (which) {
      case 'status':
        onAction({ kind: 'status', status: value as TaskStatus });
        return;
      case 'priority':
        onAction({ kind: 'priority', priority: value as TaskPriority });
        return;
      case 'assignee':
        onAction({ kind: 'assignee', assigneeId: value === '' ? null : value });
        return;
      case 'sprint':
        onAction({ kind: 'sprint', sprintId: value === '' ? null : value });
    }
  };

  const trigger = (which: Open, text: string, icon: React.ReactNode) => (
    <button
      type="button"
      className="list-bulk-action"
      disabled={busy}
      aria-haspopup="menu"
      aria-expanded={open?.which === which}
      onClick={(event) => {
        setConfirming(false);
        setOpen({ which, at: anchorOf(event.currentTarget) });
      }}
    >
      {icon}
      {text}
    </button>
  );

  return (
    <div className="list-bulk" role="region" aria-label="Selected tasks">
      <div className="list-bulk-row">
        <span className="list-bulk-count">
          <b>{String(count)}</b> selected
        </span>

        {count < total && (
          <button type="button" className="list-bulk-all" disabled={busy} onClick={onSelectAll}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12l5 5L20 7"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Select all {String(total)}
          </button>
        )}

        <span className="list-bulk-sep" aria-hidden="true" />

        {trigger(
          'status',
          'Status',
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect
              x="3"
              y="7"
              width="18"
              height="10"
              rx="3"
              stroke="currentColor"
              strokeWidth="2.2"
            />
          </svg>,
        )}
        {trigger(
          'priority',
          'Priority',
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 14l6-6 6 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>,
        )}
        {trigger(
          'assignee',
          'Assignee',
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2.2" />
            <path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5" stroke="currentColor" strokeWidth="2.2" />
          </svg>,
        )}
        {maySetSprint &&
          sprints.length > 0 &&
          trigger(
            'sprint',
            'Sprint',
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12h12M12 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" />
            </svg>,
          )}

        <span className="list-bulk-sep" aria-hidden="true" />

        {confirming ? (
          <span className="list-bulk-confirm" role="group" aria-label="Confirm cancelling">
            Cancel {String(count)} {count === 1 ? 'task' : 'tasks'}?
            <button
              type="button"
              className="list-bulk-action list-bulk-danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onAction({ kind: 'cancel' });
              }}
            >
              Yes, cancel {count === 1 ? 'it' : 'them'}
            </button>
            <button
              type="button"
              className="list-bulk-action"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="list-bulk-action list-bulk-danger"
            disabled={busy}
            onClick={() => {
              setOpen(undefined);
              setConfirming(true);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
            </svg>
            Cancel tasks
          </button>
        )}

        <span className="list-bulk-sep" aria-hidden="true" />

        <button
          type="button"
          className="list-bulk-clear"
          aria-label="Clear selection"
          title="Clear selection"
          disabled={busy}
          onClick={onClear}
        >
          ×
        </button>
      </div>

      {run?.phase === 'running' && (
        <p className="list-bulk-progress" role="status">
          Updating {String(run.completed)} of {String(run.total)}…
        </p>
      )}

      {run?.phase === 'done' && (
        <div className="list-bulk-report" role="status">
          <p className="list-bulk-summary">
            {run.summary}
            <button type="button" className="list-bulk-dismiss" onClick={onDismissReport}>
              Dismiss
            </button>
          </p>
          {run.refusals.length > 0 && (
            <ul className="list-bulk-refusals">
              {run.refusals.map((r) => (
                <li key={r.key} className="list-bulk-refusal">
                  <b>{r.key}</b> — {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open !== undefined && (
        <ListMenu
          {...menuOf(open.which)}
          anchor={open.at}
          above
          onPick={(value) => {
            pick(open.which, value);
          }}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
    </div>
  );
}
