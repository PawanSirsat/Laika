import type { AgentClient } from '../../../api/agent-clients.ts';
import type { OwnLocalActivity } from '../../../api/local-activity.ts';
import { compactTokens, exactTokens } from '../../../api/usage.ts';
import { agentLabel } from '../profile/activity-derive.ts';
import './connect.css';

/** `Thu 15 Oct` — a held day, as a date; `Mon 13 Oct 2025` when not this year (LAI-751). */
export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const label = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const thisYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return thisYear ? label : `${label} ${String(date.getUTCFullYear())}`;
}

/**
 * What the board holds of a person's shared local activity, one row a day —
 * **one table for the person and for whoever reads it for them** (D-102 rule
 * 1, LAI-959), so an owner sees exactly what the person sees on Connect.
 */
export function HeldDays({ held }: { readonly held: OwnLocalActivity }) {
  return (
    <table className="share-table">
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Prompts</th>
          <th scope="col">Sessions</th>
          <th scope="col">Not pushed</th>
          <th scope="col">Pushed</th>
          <th scope="col">Tokens</th>
        </tr>
      </thead>
      <tbody>
        {held.days.map((day) => {
          const prompts = (Object.entries(day.prompts_by_agent) as [AgentClient, number][])
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) => `${agentLabel(kind)} ${String(n)}`)
            .join(', ');
          return (
            <tr key={day.day}>
              <th scope="row">{dayLabel(day.day)}</th>
              <td>{prompts === '' ? '0' : prompts}</td>
              <td>{day.sessions}</td>
              <td>{day.commits_local}</td>
              <td>{day.pushed_commits}</td>
              <td
                title={`${exactTokens(day.tokens)} tokens, ${exactTokens(day.cache_read)} cache reads`}
              >
                {compactTokens(day.tokens)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
