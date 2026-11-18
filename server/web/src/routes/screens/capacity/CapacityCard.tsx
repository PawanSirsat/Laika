import { useId, useState } from 'react';
import { agentClientName, asAgentClient } from '../../../api/agent-clients.ts';
import type {
  ActivitySplit,
  CapacityEntry,
  CapacitySpace,
  LoadLevel,
} from '../../../api/presence.ts';
import { Chip } from '../../../components/chip/Chip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { timeLabel } from '../../../api/time-label.ts';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { PersonFacts } from '../../../components/person-facts/PersonFacts.tsx';
import { Avatar } from '../../../components/avatar/Avatar.tsx';
import { ProjectMark } from '../../../components/ProjectMark.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import type { Theme } from '../../../theme/theme.ts';
import {
  barSegments,
  LOAD_LABEL,
  loadIn,
  oldestAge,
  runningAgents,
  statusText,
  workloadIn,
} from './capacity-derive.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

export const ROLE_LABEL: Readonly<Record<CapacityEntry['org_role'], string>> = {
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

/**
 * What each figure on a card counts, on hover (LAI-991). **One rule, one
 * sentence, the same words on the card and in the list**, so hover says the
 * same kind of thing wherever a number is.
 */
export const HOVER = {
  overdue:
    'Open tasks of theirs past their due date. Shown apart: overdue does not make anyone Heavy.',
  in_progress: 'Open tasks assigned to them that are in progress now.',
  todo: 'Committed and not started: to do. Counts as load.',
  backlog: 'The pipeline: assigned to them but not yet committed. Not load.',
  in_review: 'Their work in review. It waits on a reviewer, not on them, so it is not their load.',
  due_soon: 'Open tasks of theirs due within the next 7 days.',
  running: 'Agents with a live session on their token right now.',
  by_self: 'Board actions they made themselves in the browser, signed in.',
  by_agents:
    'Board actions made with one of their personal access tokens: anything Claude Code, Omnigent, the CLI or another tool did as them over MCP or the API.',
  bookkeeping:
    'Sprint moves and card reorders, by them or their agents. Tidying, not work: counted in neither figure before it.',
  never: 'No sign-in, board action or agent signal has ever been recorded for them.',
  presence_off: 'Presence is off for this organisation, so nobody’s status or last seen is kept.',
} as const;

/** Thousands separated: "2,547" reads at a glance, "2547" does not. */
export const count = (n: number): string => n.toLocaleString('en-US');

/** What a space chip says on hover: committed is the figure, the rest is here. */
export function spaceTitle(s: CapacitySpace): string {
  return `${count(s.committed)} committed in ${s.name} (in progress and to do) · ${count(s.backlog)} in backlog, ${count(s.in_review)} waiting on reviewers`;
}

export interface CapacityCardProps {
  readonly person: CapacityEntry;
  readonly now: number;
  readonly theme: Theme;
  /** The chosen space, or `null` for every space. */
  readonly space: string | null;
}

/**
 * One person (LAI-767; compacted by LAI-991): who they are and whether they
 * are here, what is on their plate and how heavy it is, their agents, their
 * fortnight on the board as three figures (owners and admins), and their
 * spaces.
 *
 * **No task is read or listed** (LAI-992, the owner). LAI-767 drew *Show
 * tasks* and *Claude Code · working on LAI-9*, each a `GET /tasks/:id`; the
 * workload counts already say how many are in progress, and the owner did
 * not want the reads or the footer. **Nor the sparkline** (LAI-992): the
 * fortnight is three figures, *by hand · by agents · bookkeeping* (LAI-818,
 * back by LAI-996), and the bar chart is the profile's.
 *
 * **Every card draws every block, in the same order, whoever the person is.**
 * A block with nothing to say draws a `0`, *No agents running* or *No spaces*
 * rather than disappearing, so the cards in a row are the same shape and a
 * reader's eye finds the same figure in the same place on each (LAI-991, the
 * owner's design).
 *
 * **Status is never colour alone**: the ring and dot are decoration
 * (`aria-hidden`) beside a line of words that says the same thing.
 */
export function CapacityCard({ person, now, theme, space }: CapacityCardProps) {
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const status = statusText(person, now);
  const ring = person.status ?? 'off';
  const work = workloadIn(person, space);
  // The chosen space's badge, beside the chosen space's counts (D-092).
  const load = loadIn(person, space);
  const segments = barSegments(work, work.committed);
  const age = oldestAge(person.oldest_in_progress_ms);
  const agents = person.agents.filter((a) => asAgentClient(a.client) !== null);
  const live = runningAgents(person).filter((a) => asAgentClient(a.client) !== null);
  const running = live.length;
  const statusTitle =
    status.title ??
    (person.status === null ? HOVER.presence_off : person.status === 'never' ? HOVER.never : '');

  return (
    <li className="cap-card" data-status={person.status ?? 'off'} data-load={load}>
      <div className="cap-card-head">
        <span className={`cap-avatar-wrap cap-ring-${ring}`} aria-hidden="true">
          <Avatar
            name={person.name}
            userId={person.user_id}
            theme={theme}
            size={36}
            label={null}
            className="cap-avatar"
          />
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
          <span className="cap-meta">
            <Tooltip content={statusTitle}>
              <span className={`cap-status cap-status-${ring}`}>{status.text}</span>
            </Tooltip>
            <span className="cap-meta-sep" aria-hidden="true">
              {' · '}
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
          </span>
          <PersonFacts userId={person.user_id} className="cap-facts" />
        </span>
        <LoadBadges load={load} overdue={work.overdue} />
      </div>

      {/* What matters at a glance (LAI-1222): one bar of committed work, its
          two figures, and how long the oldest has been going. */}
      <div className="cap-block cap-load-block">
        <div className="cap-load-line">
          <ul className="cap-counts">
            {(
              [
                ['in progress', work.in_progress, HOVER.in_progress],
                ['to do', work.todo, HOVER.todo],
              ] as const
            ).map(([label, n, title]) => (
              <Tooltip key={label} content={title}>
                <li className={n === 0 ? 'cap-count cap-count-zero' : 'cap-count'}>
                  <span className="cap-count-n">{count(n)}</span> {label}
                </li>
              </Tooltip>
            ))}
          </ul>
          <span className="cap-oldest">
            {age === undefined ? 'nothing in progress' : `oldest in progress ${age}`}
          </span>
        </div>
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
        <div className="cap-keys">
          <Tooltip content={HOVER.running}>
            <span className={running === 0 ? 'cap-key cap-key-zero' : 'cap-key cap-key-on'}>
              {live.length > 0 && (
                <span className="cap-key-marks" aria-hidden="true">
                  {live.map((agent) => (
                    <AgentMark key={agent.client} client={agent.client} size="sm" />
                  ))}
                </span>
              )}
              <span className="cap-count-n">{count(running)}</span>{' '}
              {running === 1 ? 'agent running' : 'agents running'}
            </span>
          </Tooltip>
          <Tooltip content={HOVER.in_review}>
            <span className={work.in_review === 0 ? 'cap-key cap-key-zero' : 'cap-key'}>
              <span className="cap-count-n">{count(work.in_review)}</span> in review
            </span>
          </Tooltip>
          <button
            type="button"
            className="cap-details-toggle"
            aria-expanded={details}
            aria-controls={detailsId}
            aria-label={`${details ? 'Hide' : 'Show'} details for ${person.name}`}
            onClick={() => {
              setDetails((was) => !was);
            }}
          >
            Details
            <Icon name="chevron-down" size="tiny" />
          </button>
        </div>
      </div>

      {/* The rest, one press away (LAI-1222): the pipeline, every agent, the
          fortnight's activity and the spaces. */}
      <div className="cap-details" id={detailsId} hidden={!details}>
        {details && (
          <>
            <div className="cap-block">
              <span className="cap-label">Pipeline</span>
              {/* Apart from the load: review waits on the reviewer (D-092 item 2). */}
              <ul className="cap-waits">
                <Tooltip content={HOVER.in_review}>
                  <li className={work.in_review === 0 ? 'cap-count cap-count-zero' : 'cap-count'}>
                    <span className="cap-count-n">{count(work.in_review)}</span> waiting on
                    reviewers
                  </li>
                </Tooltip>
                <Tooltip content={HOVER.due_soon}>
                  <li className={work.due_soon === 0 ? 'cap-count cap-count-zero' : 'cap-count'}>
                    <span className="cap-count-n">{count(work.due_soon)}</span> due in 7 days
                  </li>
                </Tooltip>
                <Tooltip content={HOVER.backlog}>
                  <li className={work.backlog === 0 ? 'cap-count cap-count-zero' : 'cap-count'}>
                    <span className="cap-count-n">{count(work.backlog)}</span> backlog
                  </li>
                </Tooltip>
              </ul>
            </div>

            <div className="cap-block cap-agents-block">
              <span className="cap-label">
                Agents
                <Tooltip content={HOVER.running}>
                  <span
                    className={
                      running === 0 ? 'cap-label-note' : 'cap-label-note cap-label-note-on'
                    }
                  >
                    {count(running)} running
                  </span>
                </Tooltip>
              </span>
              {agents.length === 0 ? (
                person.status === null ? (
                  <Tooltip content={HOVER.presence_off}>
                    <span className="cap-quiet">Presence is off</span>
                  </Tooltip>
                ) : (
                  <span className="cap-quiet">No agents running</span>
                )
              ) : (
                <ul className="cap-agents">
                  {agents.map((agent) => (
                    <Tooltip
                      key={agent.client}
                      content={
                        agent.last_at === null
                          ? agent.running
                            ? 'Running now'
                            : 'Not running'
                          : `${agent.running ? 'Running now · last signal' : 'Last used'} ${timeLabel(agent.last_at, now).text}`
                      }
                    >
                      <li className={agent.running ? 'cap-agent cap-agent-running' : 'cap-agent'}>
                        <span className="cap-agent-mark">
                          <AgentMark client={agent.client} size="sm" />
                          {agent.running && <span className="cap-agent-dot" aria-hidden="true" />}
                        </span>
                        {agentClientName(agent.client)}
                        {agent.running && <span className="visually-hidden"> (running now)</span>}
                      </li>
                    </Tooltip>
                  ))}
                </ul>
              )}
            </div>

            {person.activity_14d_split !== undefined && (
              <ActivityFigures split={person.activity_14d_split} />
            )}

            <div className="cap-block cap-spaces-block">
              <span className="cap-label">
                Spaces
                <span className="cap-label-note">
                  {count(person.spaces.length)} {person.spaces.length === 1 ? 'space' : 'spaces'}
                </span>
              </span>
              {person.spaces.length === 0 ? (
                <span className="cap-quiet">No spaces</span>
              ) : (
                <ul className="cap-spaces">
                  {person.spaces.map((s) => (
                    <SpaceChip key={s.project_id} space={s} on={s.project_id === space} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/** The tone each load badge wears: colour only where it asks for attention. */
const LOAD_TONE: Readonly<Record<LoadLevel, 'neutral' | 'green' | 'blue' | 'orange'>> = {
  none: 'neutral',
  light: 'green',
  normal: 'blue',
  heavy: 'orange',
};

/**
 * The load badge and, apart from it, the overdue badge (D-092 item 3) — the
 * shared status Chip, one semantics on the cards and in the list (LAI-1222):
 * *No load*, *Light*, *Normal*, *Heavy*, and *N overdue* with the warning
 * mark, each with its rule on hover.
 */
export function LoadBadges({
  load,
  overdue,
}: {
  readonly load: LoadLevel;
  readonly overdue: number;
}) {
  return (
    <span className="cap-badges">
      <Chip
        variant="status"
        tone={LOAD_TONE[load]}
        className={`cap-load cap-load-${load}`}
        glyphLabel="Load"
        title={LOAD_RULE}
      >
        {LOAD_LABEL[load]}
      </Chip>
      {overdue > 0 && (
        <Chip
          variant="status"
          tone="danger"
          mark="alert"
          className="cap-overdue"
          title={HOVER.overdue}
        >
          {`${count(overdue)} overdue`}
        </Chip>
      )}
    </span>
  );
}

/**
 * A space the person has open work in: its mark (LAI-1311), its name and its
 * **committed** count. The pipeline and the review queue are on hover, and
 * read aloud (D-092).
 */
export function SpaceChip({ space, on }: { readonly space: CapacitySpace; readonly on: boolean }) {
  const aside = `${count(space.backlog)} in backlog, ${count(space.in_review)} waiting on reviewers`;
  return (
    <Tooltip content={spaceTitle(space)}>
      <li className={on ? 'cap-space cap-space-on' : 'cap-space'}>
        <ProjectMark project={space} size="xs" />
        {space.name}
        <span className="cap-space-n">{count(space.committed)}</span>
        <span className="visually-hidden"> committed, {aside}</span>
      </li>
    </Tooltip>
  );
}

/**
 * The fortnight's board actions by who did them (LAI-818), owners and admins
 * only — the server sends the split to nobody else: by hand, by their
 * agents, and bookkeeping — sprint moves and reorders — **shown apart and in
 * neither of the other two**. Three figures of one shape, each with its rule
 * on hover; the total is their sum. No bar chart (LAI-992, LAI-996).
 */
function ActivityFigures({ split }: { readonly split: ActivitySplit }) {
  const total = split.by_self + split.by_agents + split.bookkeeping;
  const parts = [
    ['self', 'by hand', split.by_self, HOVER.by_self],
    ['agents', 'by agents', split.by_agents, HOVER.by_agents],
    ['bookkeeping', 'bookkeeping', split.bookkeeping, HOVER.bookkeeping],
  ] as const;
  return (
    <div className="cap-block cap-activity-block">
      <span className="cap-label">
        Activity
        <span className="cap-label-note">14 days · {count(total)}</span>
      </span>
      {/* One stacked bar of the fortnight (LAI-1222), read aloud as the three
          figures it is drawn from; the legend below carries the numbers. */}
      <div
        className="cap-act"
        role="img"
        aria-label={
          total === 0
            ? 'No board actions in 14 days'
            : `${count(total)} board actions in 14 days: ${parts.map(([, label, n]) => `${count(n)} ${label}`).join(', ')}`
        }
      >
        {parts
          .filter(([, , n]) => n > 0)
          .map(([key, , n]) => (
            <span
              key={key}
              className={`cap-act-part cap-act-${key}`}
              style={{ width: `${String((n / Math.max(total, 1)) * 100)}%` }}
            />
          ))}
      </div>
      <ul className="cap-figs">
        {parts.map(([key, label, n, title]) => (
          <Tooltip key={label} content={title}>
            <li className={n === 0 ? 'cap-fig cap-fig-zero' : 'cap-fig'}>
              <span className={`cap-act-swatch cap-act-${key}`} aria-hidden="true" />
              <span className="cap-count-n">{count(n)}</span>
              <span className="cap-fig-label">{label}</span>
            </li>
          </Tooltip>
        ))}
      </ul>
    </div>
  );
}
