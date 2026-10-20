import type { MyDay } from '../../../api/time.ts';
import { agentDuration, duration } from './format.ts';
import type { Span } from './timeline-derive.ts';

export interface StatsStripProps {
  readonly view: Pick<MyDay, 'drafts' | 'entries' | 'agent' | 'state'>;
  readonly gaps: readonly Span[];
  /** Pick the first gap, for Add time. */
  readonly onGap: (gap: Span) => void;
}

const blocks = (n: number): string => `${String(n)} drafted ${n === 1 ? 'block' : 'blocks'}`;

/**
 * The day in four figures (LAI-831, the owner's design): what is confirmed —
 * the only time anybody else can see — what is still to settle and only the
 * reader sees, the gaps between blocks nobody accounted for, and the agent's
 * minutes, **beside the day and never in it** (D-088 item 8).
 *
 * A day nothing reached the board on, or one still to come, has no figure —
 * `—`, never `0 min`: no signal is not zero hours.
 */
export function StatsStrip({ view, gaps, onGap }: StatsStripProps) {
  const confirmed = view.entries.reduce((n, e) => n + e.minutes, 0);
  const drafted = view.drafts.reduce((n, d) => n + d.minutes, 0);
  const gapMinutes = gaps.reduce((n, g) => n + g.end - g.start, 0);
  const first = gaps[0];
  const quiet = view.state === 'no_signal' || view.state === 'future';
  const figure = (minutes: number): string => (quiet ? '—' : duration(minutes));
  return (
    <dl className="myday-stats">
      <div className="myday-stat" data-stat="confirmed">
        <dt className="myday-stat-label">Confirmed</dt>
        <dd className="myday-stat-figure">{figure(confirmed)}</dd>
        <dd className="myday-stat-sub">others can see this</dd>
      </div>
      <div className={`myday-stat ${drafted > 0 ? 'myday-stat-drafted' : ''}`} data-stat="settle">
        <dt className="myday-stat-label">To settle</dt>
        <dd className="myday-stat-figure">{figure(drafted)}</dd>
        <dd className="myday-stat-sub">
          {view.drafts.length > 0 ? `${blocks(view.drafts.length)} · only you` : 'nothing drafted'}
        </dd>
      </div>
      <div className={`myday-stat ${gapMinutes > 0 ? 'myday-stat-gaps' : ''}`} data-stat="gaps">
        <dt className="myday-stat-label">Gaps</dt>
        <dd className="myday-stat-figure">{figure(gapMinutes)}</dd>
        <dd className="myday-stat-sub">
          {first === undefined ? (
            'none between your blocks'
          ) : (
            <button
              type="button"
              className="myday-linkish"
              onClick={() => {
                onGap(first);
              }}
            >
              {String(gaps.length)} unaccounted · click to fill
            </button>
          )}
        </dd>
      </div>
      <div className="myday-stat myday-stat-agent" data-stat="agent">
        <dt className="myday-stat-label">Agent</dt>
        <dd className="myday-stat-figure">{agentDuration(view.agent.minutes)}</dd>
        <dd className="myday-stat-sub">beside the day, not in it</dd>
      </div>
    </dl>
  );
}
