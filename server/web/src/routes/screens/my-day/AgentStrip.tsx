import type { ReactNode } from 'react';
import type { MyDayAgent, TaskRef } from '../../../api/time.ts';
import { CardLink } from './CardLink.tsx';
import { agentDuration } from './format.ts';
import { spaceOfKey, type Space } from './task-link.ts';

export interface AgentStripProps {
  readonly agent: MyDayAgent;
  /** The spaces the reader can read: `undefined` while reading, `null` if that failed. */
  readonly spaces: readonly Space[] | null | undefined;
  readonly onNavigate: (to: string) => void;
}

const pct = (share: number): string => `${String(Math.round(share * 1000) / 10)}%`;

/**
 * Claude Code's own time that day (D-088 item 8, LAI-787): **agent minutes,
 * never hours, and never added to the person's day.** The agent working is
 * not the person working. Since LAI-831 one bar a card, as the owner's design
 * draws it — each a share of the busiest card, grey for time on none — and
 * keyboard minutes, the person's own time inside Claude Code, beneath. The
 * v3 design (LAI-888) names the builder on each row; the server has no
 * agent name per card, so the row is the card and its minutes.
 *
 * **A card is a link only when the reader can read it** (LAI-810 review
 * round 1): its key is looked up among the spaces they can (`spaceOfKey`),
 * which also says where it opens. One they cannot read is its key and *not a
 * card you can see*; while the spaces are still being read, plain words.
 */
export function AgentStrip({ agent, spaces, onNavigate }: AgentStripProps) {
  const card = (task: TaskRef): ReactNode => {
    if (spaces === undefined || spaces === null) return `${task.key} ${task.title}`;
    const space = spaceOfKey(task.key, spaces);
    if (space === undefined) return `${task.key} (not a card you can see)`;
    return <CardLink task={task} slug={space.slug} onNavigate={onNavigate} />;
  };
  const rows = [
    ...agent.by_task.map((row) => ({
      key: row.task.id,
      label: card(row.task),
      minutes: row.minutes,
      tied: true,
    })),
    ...(agent.unattributed_minutes > 0
      ? [
          {
            key: 'none',
            label: 'Not tied to a card' as ReactNode,
            minutes: agent.unattributed_minutes,
            tied: false,
          },
        ]
      : []),
  ];
  const most = Math.max(1, ...rows.map((r) => r.minutes));
  const nothing =
    agent.minutes === 0 && agent.keyboard_minutes === 0 && agent.unattributed_minutes === 0;

  return (
    <section className="myday-card myday-agent" aria-labelledby="myday-agent-title">
      <header className="myday-card-head">
        <h2 className="myday-card-title" id="myday-agent-title">
          Agent time
        </h2>
        <span className="myday-card-head-gap" />
        <span className="myday-card-figure" data-agent-minutes>
          {agentDuration(agent.minutes)}
        </span>
      </header>
      <p className="myday-quiet myday-pad">
        Claude Code builders you dispatched: minutes, never hours. Shown beside your day, never
        added to it.
      </p>
      {nothing ? (
        <p className="myday-quiet myday-pad" data-agent-hint>
          None reported for this day. Agent minutes come from Claude Code’s own telemetry: run{' '}
          <code>laika activity on</code> on each laptop.
        </p>
      ) : (
        <ul className="myday-agent-tasks">
          {rows.map((row) => (
            <li key={row.key} className="myday-agent-row">
              <span className="myday-agent-line">
                <span className="myday-agent-task">{row.label}</span>
                <span className="myday-agent-min">{agentDuration(row.minutes)}</span>
              </span>
              <span className="myday-agent-meter" aria-hidden="true">
                <span
                  className={row.tied ? 'myday-agent-fill' : 'myday-agent-fill myday-agent-untied'}
                  style={{ width: pct(row.minutes / most) }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="myday-agent-keyboard">
        <span>At your keyboard in Claude Code</span>
        <span className="myday-agent-min" data-keyboard-minutes>
          {agentDuration(agent.keyboard_minutes)}
        </span>
      </p>
    </section>
  );
}
