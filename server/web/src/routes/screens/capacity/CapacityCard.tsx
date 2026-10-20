import { useId } from 'react';
import { agentClientName, asAgentClient } from '../../../api/agent-clients.ts';
import type { ActivitySplit, CapacityEntry, PresenceEntry } from '../../../api/presence.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { initials } from '../../../theme/initials.ts';
import {
  barSegments,
  LOAD_LABEL,
  loadIn,
  oldestAge,
  statusText,
  workloadIn,
} from './capacity-derive.ts';
import type { CapacityTaskLink } from './CapacityScreen.tsx';

const ROLE_LABEL: Readonly<Record<CapacityEntry['org_role'], string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/**
 * What the load badge's tooltip says — the server's fixed rule, in words
 * (SPEC §9.3, D-092).
 */
export const LOAD_RULE =
  'Load is committed work: in progress plus to do. Heavy: more than 5 in progress or more than 15 committed. Light: up to 2 in progress and up to 5 committed. Normal: the rest. Backlog, work waiting on reviewers and overdue are shown apart and are not load. In the chosen space, or across every space you can see.';

/** Thousands separated: "2,547" reads at a glance, "2547" does not. */
const count = (n: number): string => n.toLocaleString('en-US');

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
  // The chosen space's badge, beside the chosen space's counts (D-092).
  const load = loadIn(person, space);
  const segments = barSegments(work, work.committed);
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
        <span className="cap-badges">
          <span className={`cap-load cap-load-${load}`} title={LOAD_RULE}>
            <span className="visually-hidden">Load: </span>
            {LOAD_LABEL[load]}
          </span>
          {/* Its own badge, never a load trigger (D-092 item 3). */}
          {work.overdue > 0 && (
            <span
              className="cap-overdue"
              title="Open tasks of theirs past their due date. Shown apart: overdue does not make anyone Heavy."
            >
              {count(work.overdue)} overdue
            </span>
          )}
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
        {/* Committed work, then the pipeline: in progress · to do · backlog. */}
        <ul className="cap-counts">
          {(
            [
              ['in progress', work.in_progress],
              ['to do', work.todo],
              ['backlog', work.backlog],
            ] as const
          ).map(([label, n]) => (
            <li key={label} className={n === 0 ? 'cap-count cap-count-zero' : 'cap-count'}>
              <span className="cap-count-n">{count(n)}</span> {label}
            </li>
          ))}
        </ul>
        <div
          className="cap-bar"
          role="img"
          aria-label={
            work.committed === 0
              ? 'Nothing committed'
              : `${String(work.committed)} committed: ${segments.map((s) => `${String(s.n)} ${s.label.toLowerCase()}`).join(', ')}`
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
        {/* Apart from the load: review waits on the reviewer (D-092 item 2). */}
        <ul className="cap-waits">
          <li
            className={work.in_review === 0 ? 'cap-count cap-count-zero' : 'cap-count'}
            title="Their work in review. It waits on a reviewer, not on them, so it is not their load."
          >
            <span className="cap-count-n">{count(work.in_review)}</span> waiting on reviewers
          </li>
          <li className={work.due_soon === 0 ? 'cap-count cap-count-zero' : 'cap-count'}>
            <span className="cap-count-n">{count(work.due_soon)}</span> due in 7 days
          </li>
        </ul>
      </div>

      {person.spaces.length > 0 && (
        <div className="cap-block">
          <span className="cap-label">Spaces</span>
          <ul className="cap-spaces">
            {person.spaces.map((s) => {
              // Committed work is the figure; the pipeline and the review
              // queue are on hover, and read aloud (D-092).
              const aside = `${count(s.backlog)} in backlog, ${count(s.in_review)} waiting on reviewers`;
              return (
                <li
                  key={s.project_id}
                  className={s.project_id === space ? 'cap-space cap-space-on' : 'cap-space'}
                  title={`${count(s.committed)} committed in ${s.name} (in progress and to do) · ${aside}`}
                >
                  {s.name}
                  <span className="cap-space-n">{count(s.committed)}</span>
                  <span className="visually-hidden"> committed, {aside}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {person.activity_14d !== undefined && (
        <Sparkline days={person.activity_14d} split={person.activity_14d_split} />
      )}

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
 * admins only — the server sends the series to nobody else. Under it, who did
 * them (LAI-818): by hand, by their agents, and bookkeeping — sprint moves and
 * reorders — **shown apart and in neither of the other two**.
 */
function Sparkline({
  days,
  split,
}: {
  readonly days: readonly number[];
  readonly split: ActivitySplit | undefined;
}) {
  const top = Math.max(1, ...days);
  const total = days.reduce((sum, n) => sum + n, 0);
  return (
    <div className="cap-block cap-spark-block">
      <span className="cap-label">
        Board activity
        <span className="cap-label-note">14 days · {count(total)}</span>
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
      {split !== undefined && (
        <p className="cap-spark-split">
          <span>
            <span className="cap-count-n">{count(split.by_self)}</span> by hand
          </span>
          <span>
            <span className="cap-count-n">{count(split.by_agents)}</span> by agents
          </span>
          <span
            className="cap-spark-tidy"
            title="Sprint moves and card reorders, by them or their agents. Tidying, not work: counted in neither figure before it."
          >
            <span className="cap-count-n">{count(split.bookkeeping)}</span> bookkeeping
          </span>
        </p>
      )}
    </div>
  );
}
