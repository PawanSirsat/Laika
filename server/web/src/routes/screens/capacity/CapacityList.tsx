import { ScrollCue } from '../../../components/ScrollCue.tsx';
import { asAgentClient } from '../../../api/agent-clients.ts';
import type { CapacityEntry } from '../../../api/presence.ts';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { initials } from '../../../theme/initials.ts';
import { count, HOVER, LOAD_RULE, ROLE_LABEL, SpaceChip } from './CapacityCard.tsx';
import {
  barSegments,
  LOAD_LABEL,
  loadIn,
  runningAgents,
  statusText,
  workloadIn,
} from './capacity-derive.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

export interface CapacityListProps {
  readonly people: readonly CapacityEntry[];
  readonly now: number;
  readonly theme: Theme;
  /** The chosen space, or `null` for every space. */
  readonly space: string | null;
  /**
   * The heaviest committed count on the page, so every row's bar is drawn to
   * the same scale and the rows compare — what *Team load* did (LAI-767).
   */
  readonly scale: number;
}

/**
 * The same people as the cards, one row each (LAI-991, the owner's design).
 * **Every column is drawn for every row**, zeros included, so a reader scans
 * down a column and the figure is always there. The bars share one scale, so
 * the table is also the team-load chart: the longest bar is the heaviest
 * person, and an imbalance is one glance down the Workload column.
 *
 * The activity column exists only when the server sent a split — owners and
 * admins — so a member's table has no empty column (LAI-996).
 */
export function CapacityList({ people, now, theme, space, scale }: CapacityListProps) {
  const withActivity = people.some((p) => p.activity_14d_split !== undefined);
  return (
    <ScrollCue className="cap-list-wrap" label="People and their load">
      <table className="cap-list">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Load</th>
            <th scope="col">Workload</th>
            <Tooltip content={HOVER.in_progress}>
              <th scope="col" className="cap-list-num">
                In progress
              </th>
            </Tooltip>
            <Tooltip content={HOVER.todo}>
              <th scope="col" className="cap-list-num">
                To do
              </th>
            </Tooltip>
            <Tooltip content={HOVER.in_review}>
              <th scope="col" className="cap-list-num">
                Review
              </th>
            </Tooltip>
            <Tooltip content={HOVER.running}>
              <th scope="col" className="cap-list-num">
                Agents
              </th>
            </Tooltip>
            {withActivity && (
              <th scope="col" className="cap-list-act">
                <Tooltip content={HOVER.by_self}>
                  <span>Hand</span>
                </Tooltip>
                {' · '}
                <Tooltip content={HOVER.by_agents}>
                  <span>Agents</span>
                </Tooltip>
                {' · '}
                <Tooltip content={HOVER.bookkeeping}>
                  <span>Bookkeeping</span>
                </Tooltip>
              </th>
            )}
            <th scope="col">Spaces</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const ink = avatarColor(person.user_id, theme);
            const status = statusText(person, now);
            const ring = person.status ?? 'off';
            const work = workloadIn(person, space);
            const load = loadIn(person, space);
            const parts = barSegments(work, scale);
            const running = runningAgents(person).filter(
              (a) => asAgentClient(a.client) !== null,
            ).length;
            const split = person.activity_14d_split;
            const statusTitle =
              status.title ??
              (person.status === null
                ? HOVER.presence_off
                : person.status === 'never'
                  ? HOVER.never
                  : '');
            return (
              <tr key={person.user_id} className="cap-row" data-status={person.status ?? 'off'}>
                <td className="cap-list-person">
                  <span className={`cap-avatar-wrap cap-ring-${ring}`} aria-hidden="true">
                    <span
                      className="cap-avatar cap-avatar-sm"
                      style={{ background: ink.background, color: ink.foreground }}
                    >
                      {initials(person.name)}
                    </span>
                    {person.status !== null && (
                      <span className={`cap-dot cap-dot-${person.status}`} />
                    )}
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
                      <span className="cap-role">
                        {ROLE_LABEL[person.org_role]}
                        {person.profile_kind !== undefined && (
                          <span className="cap-kind">
                            {' · '}
                            {person.profile_kind === 'manager' ? 'Manager' : 'Builder'}
                          </span>
                        )}
                      </span>
                      <span className="cap-meta-sep" aria-hidden="true">
                        {' · '}
                      </span>
                      <Tooltip content={statusTitle}>
                        <span className={`cap-status cap-status-${ring}`}>{status.text}</span>
                      </Tooltip>
                    </span>
                  </span>
                </td>
                <td>
                  <span className="cap-badges cap-badges-row">
                    <Tooltip content={LOAD_RULE}>
                      <span className={`cap-load cap-load-${load}`}>
                        <span className="visually-hidden">Load: </span>
                        {LOAD_LABEL[load]}
                      </span>
                    </Tooltip>
                    {work.overdue > 0 && (
                      <Tooltip content={HOVER.overdue}>
                        <span className="cap-overdue">{count(work.overdue)} overdue</span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="cap-list-bar">
                  <span
                    className="cap-bar"
                    role="img"
                    aria-label={
                      work.committed === 0
                        ? 'Nothing committed'
                        : `${String(work.committed)} committed: ${parts.map((s) => `${String(s.n)} ${s.label.toLowerCase()}`).join(', ')}`
                    }
                  >
                    {parts.map((s) => (
                      <span
                        key={s.key}
                        className={`cap-bar-part cap-part-${s.key}`}
                        style={{ width: `${String(s.pct)}%` }}
                      />
                    ))}
                  </span>
                </td>
                <Tooltip content={HOVER.in_progress}>
                  <td
                    className={
                      work.in_progress === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'
                    }
                  >
                    {count(work.in_progress)}
                  </td>
                </Tooltip>
                <Tooltip content={HOVER.todo}>
                  <td className={work.todo === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}>
                    {count(work.todo)}
                  </td>
                </Tooltip>
                <Tooltip content={HOVER.in_review}>
                  <td
                    className={work.in_review === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}
                  >
                    {count(work.in_review)}
                  </td>
                </Tooltip>
                <Tooltip content={HOVER.running}>
                  <td className={running === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}>
                    <span className="cap-list-running">
                      <span
                        className={running === 0 ? 'cap-run-dot' : 'cap-run-dot cap-run-dot-on'}
                        aria-hidden="true"
                      />
                      {count(running)}
                    </span>
                  </td>
                </Tooltip>
                {withActivity && (
                  <td className="cap-list-act">
                    {split === undefined ? (
                      <span className="cap-quiet">—</span>
                    ) : (
                      <span className="cap-list-split">
                        <Tooltip content={`${count(split.by_self)} by hand. ${HOVER.by_self}`}>
                          <span className={split.by_self === 0 ? 'cap-list-zero' : undefined}>
                            {count(split.by_self)}
                          </span>
                        </Tooltip>
                        <Tooltip
                          content={`${count(split.by_agents)} by agents. ${HOVER.by_agents}`}
                        >
                          <span className={split.by_agents === 0 ? 'cap-list-zero' : undefined}>
                            {count(split.by_agents)}
                          </span>
                        </Tooltip>
                        <Tooltip
                          content={`${count(split.bookkeeping)} bookkeeping. ${HOVER.bookkeeping}`}
                        >
                          <span className={split.bookkeeping === 0 ? 'cap-list-zero' : undefined}>
                            {count(split.bookkeeping)}
                          </span>
                        </Tooltip>
                      </span>
                    )}
                  </td>
                )}
                <td className="cap-list-spaces">
                  <span className="cap-list-spaces-in">
                    <span className="cap-list-spaces-n">{count(person.spaces.length)}</span>
                    {person.spaces.length === 0 ? (
                      <span className="cap-quiet">No spaces</span>
                    ) : (
                      <ul className="cap-spaces">
                        {person.spaces.map((s) => (
                          <SpaceChip
                            key={s.project_id}
                            space={s}
                            on={s.project_id === space}
                            theme={theme}
                          />
                        ))}
                      </ul>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollCue>
  );
}
