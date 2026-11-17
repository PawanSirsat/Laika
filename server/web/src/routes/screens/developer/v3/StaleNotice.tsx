import { Spinner } from '../../../../components/Spinner.tsx';
import './page-notices.css';

/**
 * A re-read failed **after** something was shown (LAI-1197): what is shown
 * stays, and this says it may be out of date, why, and offers Retry — so a
 * page in Developer access V3 never trades what it shows for an error. The
 * first load still shows the full error state; there is nothing to keep.
 */
function errorMessage(cause: unknown): string | undefined {
  return cause instanceof Error && cause.message !== '' ? cause.message : undefined;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export interface StaleNoticeProps {
  /** What failed to refresh, as a phrase: "your devices". */
  readonly what: string;
  readonly error: unknown;
  /** When what is shown was read; omitted, the time is not said. */
  readonly loadedAt?: number | undefined;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}

export function StaleNotice({ what, error, loadedAt, retrying, onRetry }: StaleNoticeProps) {
  const why = errorMessage(error);
  return (
    <div className="dx-note dx-stale" data-tone="warn" data-stale="" role="alert">
      <div className="dx-stale-text">
        <strong className="dx-note-title">{`Couldn’t refresh ${what}`}</strong>
        <p className="dx-note-body">
          {loadedAt === undefined
            ? 'Showing what was last loaded.'
            : `Showing what was last loaded, at ${clock(loadedAt)}.`}
          {why === undefined ? '' : ` ${why}`}
        </p>
      </div>
      {/* `aria-disabled`, not `disabled`: focus stays on the button while it asks. */}
      <button
        type="button"
        className="dx-btn dx-btn-sm"
        aria-disabled={retrying || undefined}
        aria-busy={retrying || undefined}
        onClick={() => {
          if (!retrying) onRetry();
        }}
      >
        {retrying && <Spinner size="sm" />}
        Retry
      </button>
    </div>
  );
}
