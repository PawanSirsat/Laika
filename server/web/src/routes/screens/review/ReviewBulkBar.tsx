import { Spinner } from '../../../components/Spinner.tsx';
import type { BulkRun } from '../list/list-bulk.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

export interface ReviewBulkBarProps {
  /** How many rows are ticked. */
  readonly count: number;
  readonly run: BulkRun | undefined;
  readonly onAccept: () => void;
  readonly onClear: () => void;
  readonly onDismissReport: () => void;
}

/**
 * The bar that appears once anything is ticked (D-146, LAI-1168): *N selected
 * · Accept N · ×*, a progress line while the run goes, and the report when
 * it ends. **Accept only.** A send-back needs a reason each, so it stays on
 * the row; a decision that needs no words is the one worth making twelve at
 * a time.
 *
 * Sticky to the foot of the page rather than floating over a card — the
 * queue is sections down a page, not one scrolling table — and it is drawn
 * only while something is selected or a report waits to be read.
 */
export function ReviewBulkBar({
  count,
  run,
  onAccept,
  onClear,
  onDismissReport,
}: ReviewBulkBarProps) {
  const busy = run?.phase === 'running';
  return (
    <div className="rev-bulk" role="region" aria-label="Selected tasks">
      {(count > 0 || busy) && (
        <div className="rev-bulk-row">
          <span className="rev-bulk-count">
            <b>{String(count)}</b> selected
          </span>
          <button
            type="button"
            className="bar-control bar-control-primary rev-bulk-accept"
            disabled={busy || count === 0}
            aria-busy={busy}
            onClick={onAccept}
          >
            {busy && <Spinner size="sm" />}
            Accept {String(count)}
          </button>
          <Tooltip content="Clear selection">
            <button
              type="button"
              className="rev-bulk-clear"
              aria-label="Clear selection"
              disabled={busy}
              onClick={onClear}
            >
              <Icon name="close" size="small" />
            </button>
          </Tooltip>
        </div>
      )}

      {run?.phase === 'running' && (
        <p className="rev-bulk-progress" role="status">
          Accepting {String(run.completed)} of {String(run.total)}…
        </p>
      )}

      {run?.phase === 'done' && (
        <div className="rev-bulk-report" role="status">
          <p className="rev-bulk-summary">
            {run.summary}
            <button type="button" className="rev-bulk-dismiss" onClick={onDismissReport}>
              Dismiss
            </button>
          </p>
          {run.refusals.length > 0 && (
            <ul className="rev-bulk-refusals">
              {run.refusals.map((r) => (
                <li key={r.key} className="rev-bulk-refusal">
                  <b>{r.key}</b> — {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
