import type { ReactNode } from 'react';
import type { MyDayAgent, TaskRef } from '../../../api/time.ts';
import { CardLink } from './CardLink.tsx';
import { agentMinutes } from './my-day-derive.ts';
import { spaceOfKey, type Space } from './task-link.ts';

export interface AgentStripProps {
  readonly agent: MyDayAgent;
  /** The spaces the reader can read: `undefined` while reading, `null` if that failed. */
  readonly spaces: readonly Space[] | null | undefined;
  readonly onNavigate: (to: string) => void;
}

/**
 * Claude Code's own time that day (D-088 item 8, LAI-787): **agent minutes,
 * never hours, and never added to the person's day.** The agent working is
 * not the person working, and an hour figure beside theirs would read as one.
 * Keyboard minutes are the person's own time inside Claude Code, shown as
 * evidence beside it. Per card the way tokens are tied to cards.
 *
 * **A card is a link only when the reader can read it** (LAI-810 review
 * round 1) — the drafts' rule. This view names cards from the reader's own
 * sessions and does not say whether they can read them, so the card's key is
 * looked up among the spaces they can (`spaceOfKey`), which also says where it
 * opens. One they cannot read is its key and *not a card you can see*, as a
 * draft says; while the spaces are still being read, or could not be, plain
 * words and no link.
 */
export function AgentStrip({ agent, spaces, onNavigate }: AgentStripProps) {
  const card = (task: TaskRef): ReactNode => {
    if (spaces === undefined || spaces === null) return `${task.key} ${task.title}`;
    const space = spaceOfKey(task.key, spaces);
    if (space === undefined) return `${task.key} (not a card you can see)`;
    return <CardLink task={task} slug={space.slug} onNavigate={onNavigate} />;
  };
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
                  <span className="myday-agent-task">{card(row.task)}</span>
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
