import { AssignControl } from '../board/AssignControl.tsx';
import { BOARD_COLUMNS, COLUMN_LABELS, type BoardColumn } from '../../../api/board-derive.ts';
import { updateTask, PRIORITIES, type Member, type Task } from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import type { DemoAgentBuild, DemoClaimLock } from '../../../demo/agent-runtime.ts';
import './task-panel.css';

export interface TaskMetaProps {
  readonly task: Task;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  readonly spaceName: string;
  readonly meId: string | undefined;
  readonly mayAssign: boolean;
  readonly mayEdit: boolean;
  readonly moving: boolean;
  /** Real: who is watching. The section above the buttons in the design. */
  readonly watchers: readonly string[] | undefined;
  readonly claimLock: DemoClaimLock | undefined;
  readonly agentBuild: DemoAgentBuild | undefined;
  readonly onMove: (taskId: string, to: BoardColumn) => void;
  readonly onAssigned: () => void;
  readonly onTaskEdited: () => void;
  readonly statusRef: React.RefObject<HTMLSelectElement | null>;
}

/** `4m`, `6d` — the design's short form beside a field. */
function since(at: number | null, now: number): string | undefined {
  if (at === null) return undefined;
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/**
 * The drawer's right-hand meta column (LAI-285).
 *
 * **This is the shape LAI-284 missed.** The reference is two columns — the task
 * as a document on the left, and a 280px rail of *fields* on the right:
 * assignee, status, priority, space, created via, watchers, then the two
 * actions. I built every one of those as a stacked section in a single column,
 * so the panel had the right contents and the wrong layout, and reading a task
 * meant scrolling past its own metadata to reach the description.
 *
 * Each row is a **label, a value, and a quiet second line** — `claimed 4m ago`
 * under the status, the branch under the space. The second line is what makes
 * this a rail worth having rather than a form: it answers *when* and *by what*
 * without another click.
 */
export function TaskMeta({
  task,
  members,
  theme,
  spaceName,
  meId,
  mayAssign,
  mayEdit,
  moving,
  watchers,
  claimLock,
  agentBuild,
  onMove,
  onAssigned,
  onTaskEdited,
  statusRef,
}: TaskMetaProps) {
  const now = Date.now();
  const assignee = task.assignee_id === null ? undefined : members.get(task.assignee_id);
  const ink = task.assignee_id === null ? undefined : avatarColor(task.assignee_id, theme);

  const named = (watchers ?? [])
    .map((id) => members.get(id)?.name)
    .filter((n): n is string => n !== undefined);
  const viewers = (watchers ?? [])
    .map((id) => members.get(id))
    .filter((m) => m?.role === 'viewer')
    .map((m) => m?.name)
    .filter((n): n is string => n !== undefined);

  return (
    <aside className="panel-meta" aria-label="Task details">
      <div className="meta-row">
        <p className="meta-label">Assignee</p>
        <div className="meta-value meta-person">
          <span
            className={assignee === undefined ? 'meta-avatar meta-avatar-empty' : 'meta-avatar'}
            aria-hidden="true"
            {...(ink === undefined
              ? {}
              : { style: { background: ink.background, color: ink.foreground } })}
          >
            {assignee === undefined ? '—' : initials(assignee.name)}
            {/* The bot mark the design puts on an agent-held avatar. */}
            {claimLock !== undefined && <span className="meta-avatar-bot" aria-hidden="true" />}
          </span>
          <AssignControl
            task={task}
            members={members}
            meId={meId}
            mayAssign={mayAssign}
            onChanged={onAssigned}
          />
        </div>
        {/*
          **The claim's deadline is invented and the line says so.** The claim
          itself is real — `POST /tasks/:id/claim` is a compare-and-swap — but it
          has no TTL, so an hour here comes from `demo/agent-runtime.ts` and
          cannot reach a production build.
        */}
        {claimLock !== undefined && (
          <p className="meta-sub meta-sub-claim">
            agent has the claim lock until {claimLock.label}
            <span className="meta-placeholder">placeholder</span>
          </p>
        )}
      </div>

      <div className="meta-row">
        <p className="meta-label">Status</p>
        <div className="meta-value">
          <label className="meta-select">
            <span className="visually-hidden">Status</span>
            <select
              ref={statusRef}
              value={task.status}
              disabled={moving || !mayEdit}
              onChange={(event) => {
                const to = event.target.value as BoardColumn;
                if (to !== task.status) onMove(task.id, to);
              }}
            >
              {BOARD_COLUMNS.map((c) => (
                <option key={c} value={c}>
                  {COLUMN_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* `started_at` is when it was claimed — the design's second line. */}
        {since(task.started_at, now) !== undefined && (
          <p className="meta-sub">claimed {since(task.started_at, now)}</p>
        )}
      </div>

      <div className="meta-row">
        <p className="meta-label">Priority</p>
        <div className="meta-value">
          <label className={`meta-select meta-prio meta-prio-${task.priority}`}>
            <span className="visually-hidden">Priority</span>
            <select
              value={task.priority}
              disabled={!mayEdit}
              onChange={(event) => {
                void updateTask(task.id, {
                  priority: event.target.value as (typeof PRIORITIES)[number],
                }).then(onTaskEdited);
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="meta-row">
        <p className="meta-label">Space</p>
        <p className="meta-value meta-plain">{spaceName}</p>
        {/*
          **No branch line, and that is a gap rather than a choice.**
          The design writes `branch lai-142-claim-lock` here. `tasks.branch` is
          a real column — the plugin writes it — but `TaskView` does not expose
          it, so the browser has no way to read it. Inventing one would put a
          branch name in front of somebody that nothing verified. Filed as
          LAI-286 for CORE.
        */}
      </div>

      <div className="meta-row">
        <p className="meta-label">Created via</p>
        <p className="meta-value meta-plain">
          {task.created_by_client === null ? task.created_via : `Agent · ${task.created_by_client}`}
          {agentBuild !== undefined && ` ${agentBuild.version}`}
        </p>
        {agentBuild !== undefined && (
          <p className="meta-sub meta-mono">
            scope {agentBuild.scope}
            <span className="meta-placeholder">placeholder</span>
          </p>
        )}
      </div>

      <div className="meta-row">
        <p className="meta-label">Watchers</p>
        {watchers === undefined ? (
          <p className="meta-value meta-plain meta-quiet">Could not read who is watching.</p>
        ) : watchers.length === 0 ? (
          <p className="meta-value meta-plain meta-quiet">Nobody yet.</p>
        ) : (
          <>
            <p className="meta-value meta-plain">
              {/* Named where we can; a watcher this page cannot name is still
                  counted, because the count is the server's. */}
              {named.join(', ')}
              {named.length < watchers.length && `${named.length > 0 ? ', ' : ''}and others`}
            </p>
            <p className="meta-sub">
              {watchers.length} {watchers.length === 1 ? 'person' : 'people'}
              {viewers.length > 0 &&
                ` · ${viewers.join(', ')} ${viewers.length === 1 ? 'is a Viewer' : 'are Viewers'}`}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
