import type { MyDayAgent } from '../../../api/time.ts';
import { CardLink } from './CardLink.tsx';
import { agentMinutes } from './my-day-derive.ts';

export interface AgentStripProps {
  readonly agent: MyDayAgent;
  readonly onNavigate: (to: string) => void;
}

/**
 * Claude Code's own time that day (D-088 item 8, LAI-787): **agent minutes,
 * never hours, and never added to the person's day.** The agent working is
 * not the person working, and an hour figure beside theirs would read as one.
 * Keyboard minutes are the person's own time inside Claude Code, shown as
 * evidence beside it. Per card the way tokens are tied to cards, each card a
 * link to it (LAI-810) — by key, as this view does not say its space.
 */
export function AgentStrip({ agent, onNavigate }: AgentStripProps) {
  const nothing =
    agent.minutes === 0 && agent.keyboard_minutes === 0 && agent.unattributed_minutes === 0;
  return (
    <section className="myday-card myday-agent" aria-labelledby="myday-agent-title">
      <header className="myday-card-head">
        <h2 className="myday-card-title" id="myday-agent-title">
          Agent minutes
        </h2>
        <span className="myday-card-caption">minutes, never hours · not added to your day</span>
      </header>
      {nothing ? (
        <p className="myday-quiet">
          None reported for this day. Agent minutes come from Claude Code’s own telemetry, when it
          is pointed at this board (Connect).
        </p>
      ) : (
        <>
          <p className="myday-agent-figures">
            <span className="myday-agent-total" data-agent-minutes>
              {agentMinutes(agent.minutes)}
            </span>{' '}
            agent working ·{' '}
            <span data-keyboard-minutes>{agentMinutes(agent.keyboard_minutes)}</span> at your
            keyboard in Claude Code
          </p>
          {(agent.by_task.length > 0 || agent.unattributed_minutes > 0) && (
            <ul className="myday-agent-tasks">
              {agent.by_task.map((row) => (
                <li key={row.task.id}>
                  <span className="myday-agent-task">
                    <CardLink task={row.task} slug={undefined} onNavigate={onNavigate} />
                  </span>
                  <span className="myday-agent-min">{agentMinutes(row.minutes)}</span>
                </li>
              ))}
              {agent.unattributed_minutes > 0 && (
                <li>
                  <span className="myday-agent-task">Not tied to a card</span>
                  <span className="myday-agent-min">
                    {agentMinutes(agent.unattributed_minutes)}
                  </span>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
