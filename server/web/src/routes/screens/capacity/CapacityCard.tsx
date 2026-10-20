import { useId } from 'react';
import { agentClientName, asAgentClient } from '../../../api/agent-clients.ts';
import type { CapacityEntry, PresenceEntry } from '../../../api/presence.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { initials } from '../../../theme/initials.ts';
import { barSegments, LOAD_LABEL, oldestAge, statusText, workloadIn } from './capacity-derive.ts';
import type { CapacityTaskLink } from './CapacityScreen.tsx';

const ROLE_LABEL: Readonly<Record<CapacityEntry['org_role'], string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** What the load badge's tooltip says — the server's fixed rule, in words. */
export const LOAD_RULE =
  'Heavy: more than 5 in progress, anything overdue, or more than 15 open. Light: up to 2 in progress and up to 5 open. Normal: the rest. Across every space you can see.';

export interface CapacityCardProps {
  readonly person: CapacityEntry;
  readonly now: number;
  readonly theme: Theme;
  /** The chosen space, or `null` for every space. */
  readonly space: string | null;
  /** Their live presence entry, for the task a session is matched to. */
  readonly presence: PresenceEntry | undefined;
  /** Resolved tasks by id: the matched one, and theirs once *Show tasks* is open. */
  readonly resolved: ReadonlyMap<string, TaskSummary>;
  /** Project slug by id, to open a task in its own space (LAI-755). */
  readonly slugs: ReadonlyMap<string, string> | null | undefined;
  readonly expanded: boolean;
  readonly onToggleTasks: () => void;
  readonly onOpenTask: (task: CapacityTaskLink) => void;
}

/**
 * One person (LAI-767): who they are and whether they are here, their agents,
 * what is on their plate and how heavy it is, and — for an owner or admin —
 * their last fortnight on the board.
 *
 * **Status is never colour alone**: the ring and dot are decoration
 * (`aria-hidden`) beside a line of words that says the same thing.
 */
export function CapacityCard({
  person,
  now,
  theme,
  space,
  presence,
  resolved,
  slugs,
  expanded,
  onToggleTasks,
  onOpenTask,
}: CapacityCardProps) {
  const tasksId = useId();
  const ink = avatarColor(person.user_id, theme);
  const status = statusText(person, now);
  const ring = person.status ?? 'off';
  const work = workloadIn(person, space);
  const segments = barSegments(work, work.open);
  const age = oldestAge(person.oldest_in_progress_ms);
  const agents = person.agents.filter((a) => asAgentClient(a.client) !== null);

  const open = (task: TaskSummary): void => {
    onOpenTask({ id: task.id, key: task.key, projectSlug: slugs?.get(task.project_id) });
  };

  const matchedId = presence?.matched_task_id ?? null;
  const matched = matchedId === null ? undefined : resolved.get(matchedId);
  const sessionClient = presence === undefined ? null : asAgentClient(presence.client);

  return (
    <li className="cap-card" data-status={person.status ?? 'off'}>
      <div className="cap-card-head">
        <span className={`cap-avatar-wrap cap-ring-${ring}`} aria-hidden="true">
          <span
            className="cap-avatar"
            style={{ background: ink.background, color: ink.foreground }}
          >
            {initials(person.name)}
          </span>
          {person.status !== null && <span className={`cap-dot cap-dot-${person.status}`} />}
        </span>
        <span className="cap-who">
          <span className="cap-name">
            <PersonLink
              userId={person.user_id}
              className="cap-name-link"
              label={`Open ${person.name}’s profile`}
            >
              {person.name}
            </PersonLink>
          </span>
          <span className="cap-role">
            {ROLE_LABEL[person.org_role]}
            {person.profile_kind !== undefined && (
              <span className="cap-kind">
                {' · '}
                {person.profile_kind === 'manager' ? 'Manager' : 'Builder'}
              </span>
            )}
          </span>
          <span className={`cap-status cap-status-${ring}`} title={status.title}>
            {status.text}
          </span>
        </span>
        <span className={`cap-load cap-load-${person.load}`} title={LOAD_RULE}>
          <span className="visually-hidden">Load: </span>
          {LOAD_LABEL[person.load]}
        </span>
      </div>

      <div className="cap-block">
        <span className="cap-label">Agents</span>
        {agents.length === 0 ? (
          <span className="cap-quiet">
            {person.status === null ? 'Presence is off' : 'No agent running'}
          </span>
        ) : (
          <ul className="cap-agents">
            {agents.map((agent) => (
              <li
                key={agent.client}
                className={agent.running ? 'cap-agent cap-agent-running' : 'cap-agent'}
                title={
                  agent.last_at === null
                    ? undefined
                    : `${agent.running ? 'Running now · last signal' : 'Last used'} ${timeLabel(agent.last_at, now).text}`
                }
              >
                <span className="cap-agent-mark">
                  <AgentMark client={agent.client} size="sm" />
                  {agent.running && <span className="cap-agent-dot" aria-hidden="true" />}
                </span>
                {agentClientName(agent.client)}
                {agent.running && <span className="visually-hidden"> (running now)</span>}
              </li>
            ))}
          </ul>
        )}
        {matched !== undefined && (
          <button
            type="button"
            className="cap-working"
            title={`${matched.key} · ${matched.title}${presence?.branch === undefined ? '' : ` — ${presence.branch}`}`}
            onClick={() => {
              open(matched);
            }}
          >
            {sessionClient === null
              ? 'Working on'
              : `${agentClientName(sessionClient)} · working on`}{' '}
            <span className="cap-key">{matched.key}</span>
          </button>
        )}
      </div>

      <div className="cap-block">
        <span className="cap-label">
          Workload
          {age !== undefined && <span className="cap-label-note">oldest in progress {age}</span>}
        </span>
        <ul className="cap-counts">
          {(
            [
              ['in progress', work.in_progress],
              ['in review', work.in_review],
              ['to do', work.todo],
              ['overdue', work.overdue],
              ['due in 7 days', work.due_soon],
            ] as const
          ).map(([label, n]) => (
            <li
              key={label}
              className={
                label === 'overdue' && n > 0
                  ? 'cap-count cap-count-overdue'
                  : n === 0
                    ? 'cap-count cap-count-zero'
                    : 'cap-count'
              }
            >
              <span className="cap-count-n">{n}</span> {label}
            </li>
          ))}
        </ul>
        <div
          className="cap-bar"
          role="img"
          aria-label={
            work.open === 0
              ? 'No open work'
              : `${String(work.open)} open: ${segments.map((s) => `${String(s.n)} ${s.label.toLowerCase()}`).join(', ')}`
          }
        >
          {segments.map((s) => (
            <span
              key={s.key}
              className={`cap-bar-part cap-part-${s.key}`}
              style={{ width: `${String(s.pct)}%` }}
            />
          ))}
        </div>
      </div>

      {person.spaces.length > 0 && (
        <div className="cap-block">
          <span className="cap-label">Spaces</span>
          <ul className="cap-spaces">
            {person.spaces.map((s) => (
              <li
                key={s.project_id}
                className={s.project_id === space ? 'cap-space cap-space-on' : 'cap-space'}
                title={`${String(s.open)} open in ${s.name}`}
              >
                {s.name}
                <span className="cap-space-n">{s.open}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {person.activity_14d !== undefined && <Sparkline days={person.activity_14d} />}

      {person.in_progress_tasks.length > 0 && (
        <div className="cap-tasks">
          <button
            type="button"
            className="cap-tasks-toggle"
            aria-expanded={expanded}
            aria-controls={tasksId}
            onClick={onToggleTasks}
          >
            {expanded ? 'Hide tasks' : 'Show tasks'}
            <span className="cap-tasks-n">{person.in_progress_tasks.length} in progress</span>
          </button>
          {expanded && (
            <ul className="cap-task-list" id={tasksId}>
              {person.in_progress_tasks.map((id) => {
                const task = resolved.get(id);
                return (
                  <li key={id}>
                    {task === undefined ? (
                      <span className="cap-task cap-task-loading">Loading…</span>
                    ) : (
                      <button
                        type="button"
                        className="cap-task"
                        title={`${task.key} · ${task.title} — ${task.status_name}`}
                        onClick={() => {
                          open(task);
                        }}
                      >
                        <span className="cap-key">{task.key}</span>
                        <span className="cap-task-title">{task.title}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Board actions per day over the last fortnight (D-079's rollup), owners and
 * admins only — the server sends the series to nobody else.
 */
function Sparkline({ days }: { readonly days: readonly number[] }) {
  const top = Math.max(1, ...days);
  const total = days.reduce((sum, n) => sum + n, 0);
  return (
    <div className="cap-block cap-spark-block">
      <span className="cap-label">
        Board activity
        <span className="cap-label-note">14 days · {total}</span>
      </span>
      <div
        className="cap-spark"
        role="img"
        aria-label={`${String(total)} board actions in the last 14 days`}
      >
        {days.map((n, i) => (
          <span
            // The series is positional: index i is a day, oldest first.
            key={i}
            className={n === 0 ? 'cap-spark-bar cap-spark-zero' : 'cap-spark-bar'}
            style={{ height: n === 0 ? undefined : `${String(Math.max(12, (n / top) * 100))}%` }}
          />
        ))}
      </div>
    </div>
  );
}
