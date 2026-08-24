import { useState } from 'react';
import { assignTask, claimTask, claimWinner } from '../../../api/tasks.ts';
import type { Member, Task } from '../../../api/tasks.ts';
import './assign.css';

export interface AssignControlProps {
  readonly task: Task;
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
 */
export function AssignControl({ task, members, meId, mayAssign, onChanged }: AssignControlProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const assigned = task.assignee_id;
  const mine = assigned !== null && assigned === meId;
  const canClaim = assigned === null && meId !== undefined && mayAssign;

  const run = (work: Promise<unknown>): void => {
    setBusy(true);
    setError(undefined);
    work
      .then(() => {
        onChanged();
      })
      .catch((cause: unknown) => {
        const winner = claimWinner(cause);
        if (winner !== undefined) {
          // The point of the compare-and-swap: say who won.
          setError(`Taken by ${nameOf(winner, members)} first.`);
          onChanged();
          return;
        }
        setError(cause instanceof Error ? cause.message : 'That did not work.');
      })
      .finally(() => {
        setBusy(false);
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
      <label className="assign-pick">
        <span className="visually-hidden">Assignee</span>
        <select
          value={assigned ?? ''}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            run(assignTask(task.id, next === '' ? null : next));
          }}
        >
          <option value="">unassigned</option>
          {[...members.values()].map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name}
              {member.user_id === meId ? ' (you)' : ''}
            </option>
          ))}
        </select>
      </label>

      {canClaim && (
        <button
          type="button"
          className="assign-claim"
          disabled={busy}
          onClick={() => {
            run(claimTask(task.id));
          }}
        >
          Claim
        </button>
      )}

      {mine && <span className="assign-mine">yours</span>}

      {error !== undefined && (
        <span className="assign-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
