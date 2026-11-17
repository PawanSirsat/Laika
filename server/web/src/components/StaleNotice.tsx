import { clockTime } from '../api/time-label.ts';
import './states.css';

export interface StaleNoticeProps {
  /** When what is on screen was read (unix ms), or `null` if that is unknown. */
  readonly readAt: number | null;
  /** Ask again. */
  readonly onRetry: () => void;
}

/**
 * The last refresh failed; what is on screen is the read before it (LAI-1128).
 *
 * The rows stay — a failed re-read is not news about the rows, and swapping a
 * page of real work for an error page loses the thing the reader was using.
 * But the page must not look current when it is not, so this says so, says
 * how old it is, and offers to try again. The Inbox's hand-offs tab says the
 * same thing in the same words.
 */
export function StaleNotice({ readAt, onRetry }: StaleNoticeProps) {
  return (
    <p className="state-stale" role="status" data-stale>
      <span>
        Could not refresh — showing what was read at{' '}
        {readAt === null ? 'the last read' : clockTime(readAt)}.
      </span>
      <button type="button" className="state-stale-retry" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
