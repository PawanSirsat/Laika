import { dateTime } from '../../../api/time-label.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { groupRuns, type TimelineRow, type TimelineSource } from './workroom-timeline.ts';

type ReadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ExecutionTimelineProps {
  readonly rows: readonly TimelineRow[];
  readonly activity: ReadState;
  readonly saves: ReadState;
  readonly rounds: ReadState;
  /** The space's `agents_allowed`; `false` says why there is nothing here. */
  readonly agentsAllowed: boolean | undefined;
  readonly onRetry: () => void;
}

const SOURCE_LABEL: Readonly<Record<TimelineSource, string>> = {
  activity: 'Activity',
  save: 'Save',
  round: 'Round',
  review: 'Review',
};

/**
 * The execution timeline (LAI-1199): claims, saves, rounds and reviews,
 * newest first, grouped into runs by claim. **Each read stands alone**: one
 * that failed is named, and the rows the others returned still show.
 */
export function ExecutionTimeline({
  rows,
  activity,
  saves,
  rounds,
  agentsAllowed,
  onRetry,
}: ExecutionTimelineProps) {
  const reads = [
    ['activity', activity],
    ['saves', saves],
    ['rounds', rounds],
  ] as const;
  const loading = reads.some(([, s]) => s === 'loading' || s === 'idle');
  const failed = reads.filter(([, s]) => s === 'error').map(([name]) => name);
  const now = Date.now();

  if (loading && rows.length === 0) {
    return (
      <div className="wr-skeleton" role="status" aria-busy="true" data-loading="timeline">
        <span className="visually-hidden">Loading the timeline</span>
        <div aria-hidden="true">
          <div className="skeleton skeleton-line wr-w-75" />
          <div className="skeleton skeleton-line wr-w-90" />
          <div className="skeleton skeleton-line wr-w-50" />
        </div>
      </div>
    );
  }

  return (
    <div className="wr-timeline" data-rows={rows.length}>
      {failed.length > 0 && (
        <div className="wr-inline-error" role="alert">
          <p>Could not read this task’s {failed.join(' and ')}. What did load is shown.</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="wr-empty">
          {agentsAllowed === false
            ? 'Agents are off for this space, and no one has worked this task through one.'
            : 'No agent has worked this yet.'}
        </p>
      ) : (
        <>
          {groupRuns(rows).map((group, i) => (
            <div
              key={`${String(group.generation)}:${String(i)}`}
              className="wr-run"
              data-generation={group.generation ?? 'none'}
            >
              {group.generation !== null && (
                <h3 className="wr-run-title">Claim {String(group.generation)}</h3>
              )}
              <ol className="wr-rows">
                {group.rows.map((row) => (
                  <li key={row.id} className="wr-row" data-source={row.source} data-tone={row.tone ?? 'none'}>
                    <span className="wr-row-badge">{SOURCE_LABEL[row.source]}</span>
                    <span className="wr-row-title">{row.title}</span>
                    {row.detail !== undefined && <span className="wr-row-detail">{row.detail}</span>}
                    <time className="wr-row-time" dateTime={new Date(row.at).toISOString()}>
                      {dateTime(row.at, now)}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <p className="wr-footnote">
            Claims are read from the task’s newest activity, so an older run may not be listed.
          </p>
        </>
      )}
    </div>
  );
}
