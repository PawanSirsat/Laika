import type { MyDay } from '../../../api/time.ts';
import { hourLabel } from '../../../api/time-label.ts';
import { dayTimeline, hourTicks } from './day-timeline.ts';

export interface DayBarProps {
  readonly view: Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries'>;
  readonly now: number;
}

/**
 * The day as a bar (LAI-796, the owner's reference): confirmed blocks solid,
 * drafted ones dashed, a line at now on today. A picture of the lists below
 * it, which stay the record — so the bar is hidden from assistive tech and
 * the lists say everything it shows.
 */
export function DayBar({ view, now }: DayBarProps) {
  const line = dayTimeline(view, now);
  const span = (line.to - line.from) * 60;
  const at = (minutes: number): string => `${String(((minutes - line.from * 60) / span) * 100)}%`;
  const width = (minutes: number): string => `${String((minutes / span) * 100)}%`;

  return (
    <div className="dayline">
      <div className="dayline-track" aria-hidden="true">
        {line.blocks.map((block) => (
          <span
            key={`${block.kind}-${block.id}`}
            className={`dayline-block dayline-${block.kind}`}
            style={{ left: at(block.start), width: width(block.end - block.start) }}
            title={block.label}
          />
        ))}
        {line.now !== undefined && (
          <span className="dayline-now" style={{ left: at(line.now) }} data-now />
        )}
      </div>
      <div className="dayline-hours" aria-hidden="true">
        {hourTicks(line.from, line.to).map((hour) => (
          <span key={hour} style={{ left: at(hour * 60) }}>
            {hourLabel(hour)}
          </span>
        ))}
      </div>
      <p className="dayline-legend">
        <span className="dayline-key dayline-key-confirmed" aria-hidden="true" />
        Confirmed
        <span className="dayline-key dayline-key-drafted" aria-hidden="true" />
        Drafted
        {line.now !== undefined && (
          <>
            <span className="dayline-key dayline-key-now" aria-hidden="true" />
            Now
          </>
        )}
        {line.untimed > 0 && (
          <span className="dayline-untimed">
            {line.untimed === 1 ? '1 block has' : `${String(line.untimed)} blocks have`} no set time
            — listed below only
          </span>
        )}
      </p>
    </div>
  );
}
