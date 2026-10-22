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
 */
export function CapacityList({ people, now, theme, space, scale }: CapacityListProps) {
  return (
    <div className="cap-list-wrap">
      <table className="cap-list">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Load</th>
            <th scope="col">Workload</th>
            <th scope="col" className="cap-list-num" title={HOVER.in_progress}>
              In progress
            </th>
            <th scope="col" className="cap-list-num" title={HOVER.todo}>
              To do
            </th>
            <th scope="col" className="cap-list-num" title={HOVER.in_review}>
              Review
            </th>
            <th scope="col" className="cap-list-num" title={HOVER.running}>
              Agents
            </th>
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
                      <span className={`cap-status cap-status-${ring}`} title={statusTitle}>
                        {status.text}
                      </span>
                    </span>
                  </span>
                </td>
                <td>
                  <span className="cap-badges cap-badges-row">
                    <span className={`cap-load cap-load-${load}`} title={LOAD_RULE}>
                      <span className="visually-hidden">Load: </span>
                      {LOAD_LABEL[load]}
                    </span>
                    {work.overdue > 0 && (
                      <span className="cap-overdue" title={HOVER.overdue}>
                        {count(work.overdue)} overdue
                      </span>
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
                <td
                  className={work.in_progress === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}
                  title={HOVER.in_progress}
                >
                  {count(work.in_progress)}
                </td>
                <td
                  className={work.todo === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}
                  title={HOVER.todo}
                >
                  {count(work.todo)}
                </td>
                <td
                  className={work.in_review === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}
                  title={HOVER.in_review}
                >
                  {count(work.in_review)}
                </td>
                <td
                  className={running === 0 ? 'cap-list-num cap-list-zero' : 'cap-list-num'}
                  title={HOVER.running}
                >
                  <span className="cap-list-running">
                    <span
                      className={running === 0 ? 'cap-run-dot' : 'cap-run-dot cap-run-dot-on'}
                      aria-hidden="true"
                    />
                    {count(running)}
                  </span>
                </td>
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
    </div>
  );
}
