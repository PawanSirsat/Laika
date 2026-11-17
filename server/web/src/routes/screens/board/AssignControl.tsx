import { Spinner } from '../../../components/Spinner.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { assigneeOptions } from './assignee-options.ts';
import { useId, useState } from 'react';
import { useAction } from '../../../components/toast/use-action.ts';
import { assignTask, claimTask, claimWinner } from '../../../api/tasks.ts';
import type { Member, TaskSummary } from '../../../api/tasks.ts';
import './assign.css';

export interface AssignControlProps {
  readonly task: TaskSummary;
  /** The **project's** members — not the org's. */
  readonly members: ReadonlyMap<string, Member>;
  /** The signed-in user's id, for the Claim path. */
  readonly meId: string | undefined;
  /** False for a Viewer: `task.assign_other` is member+ (§3.2). */
  readonly mayAssign: boolean;
  readonly onChanged: () => void;
}

function nameOf(id: string, members: ReadonlyMap<string, Member>): string {
  return members.get(id)?.name ?? id;
}

/**
 * Assign, unassign, or claim (LAI-097).
 *
 * The whole multi-user chain worked in the API and stopped here: the panel
 * rendered `unassigned` as plain text, so a team could be invited, added to a
 * project and given roles, and then nobody could be given a task.
 *
 * **The list is the project's members, not the org's.** `GET /users` is
 * org-wide and a task is project-scoped — offering someone outside the project
 * creates an assignee who cannot open their own work.
 *
 * **Claim is a separate button** because the server does a compare-and-swap on
 * that endpoint, and it is the common case. When it loses, the 409 carries the
 * winner's id, so this says who took it rather than "something went wrong".
 *
 * **Each change says so in a toast** (LAI-1310) — *LAI-42 assigned to Ada*,
 * with Undo, which assigns the previous person back: the server takes that
 * as readily as the change itself. A refusal is a persistent error toast with
 * the server's sentence (or the claim's winner) as its detail; the inline
 * `.assign-error` it replaces said the same thing in a smaller place.
 */
export function AssignControl({ task, members, meId, mayAssign, onChanged }: AssignControlProps) {
  const [busy, setBusy] = useState(false);
  const { run: act } = useAction();
  const nameId = useId();

  const assigned = task.assignee_id;
  const mine = assigned !== null && assigned === meId;
  const canClaim = assigned === null && meId !== undefined && mayAssign;

  /** Whoever it goes to, as the toast names them. */
  const who = (id: string | null): string => (id === null ? 'nobody' : nameOf(id, members));

  const assign = (next: string | null): void => {
    const before = assigned;
    setBusy(true);
    void act({
      do: () => assignTask(task.id, next),
      success: next === null ? `${task.key} unassigned` : `${task.key} assigned to ${who(next)}`,
      failure: next === null ? `Couldn’t unassign ${task.key}` : `Couldn’t assign ${task.key}`,
      undo: async () => {
        await assignTask(task.id, before);
        onChanged();
        return before === null
          ? `${task.key} unassigned again`
          : `${task.key} back with ${who(before)}`;
      },
    }).then((done) => {
      setBusy(false);
      if (done !== undefined) onChanged();
    });
  };

  const claim = (): void => {
    let lost = false;
    setBusy(true);
    void act({
      do: () =>
        claimTask(task.id).catch((cause: unknown) => {
          const winner = claimWinner(cause);
          if (winner === undefined) throw cause;
          // The point of the compare-and-swap: say who won, as the detail.
          lost = true;
          throw new Error(`Taken by ${nameOf(winner, members)} first.`);
        }),
      success: `${task.key} claimed`,
      failure: `Couldn’t claim ${task.key}`,
      undo: async () => {
        await assignTask(task.id, null);
        onChanged();
        return `${task.key} unassigned again`;
      },
    }).then((done) => {
      setBusy(false);
      // A lost race changed the task too: show who has it now.
      if (done !== undefined || lost) onChanged();
    });
  };

  if (!mayAssign) {
    // A Viewer sees who it belongs to and gets no control at all — not a
    // disabled one, which reads as "you could do this".
    return (
      <span className="panel-assignee">
        {assigned === null ? 'unassigned' : nameOf(assigned, members)}
      </span>
    );
  }

  return (
    <span className="assign">
      {/*
        The app's own dropdown (LAI-726), named by the label's words through
        `aria-labelledby`, so the name never rests on how a browser reads a
        label that also holds the control's value.
      */}
      <label className="assign-pick">
        <span className="visually-hidden" id={nameId}>
          Assignee
        </span>
        <Dropdown
          variant="bare"
          aria-labelledby={nameId}
          noun="people"
          value={assigned ?? ''}
          disabled={busy}
          options={assigneeOptions(members.values(), meId)}
          onChange={(next) => {
            assign(next === '' ? null : next);
          }}
        />
      </label>

      {canClaim && (
        <button
          type="button"
          className="assign-claim"
          disabled={busy}
          onClick={() => {
            claim();
          }}
        >
          {busy && <Spinner size="sm" />}
          Claim
        </button>
      )}

      {mine && <span className="assign-mine">yours</span>}
    </span>
  );
}
