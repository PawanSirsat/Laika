import { useCallback, useState } from 'react';
import './page-notices.css';

/**
 * Two in-place notices for Developer access V3 (LAI-1197), so a page never
 * trades what it shows for an error, and never does something consequential
 * without saying so on screen.
 *
 * - {@link StaleNotice}: a re-read failed **after** something was shown. What
 *   is shown stays; this says it may be out of date, why, and offers Retry.
 *   The first load still shows the full error state — there is nothing to keep.
 * - {@link ResultNote}: what a write just did — a device disconnected, a
 *   credential revoked — in words a sighted reader sees. Screen readers hear
 *   it through the page's live region, which is mounted empty with the page
 *   and so is heard reliably; this note carries no live role of its own, so
 *   nothing is announced twice.
 */

export function errorMessage(cause: unknown): string | undefined {
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
        onClick={() => {
          if (!retrying) onRetry();
        }}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

export interface ResultNoteProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

export function ResultNote({ message, onDismiss }: ResultNoteProps) {
  return (
    <div className="dx-note dx-result" data-tone="accent" data-result="">
      <p className="dx-result-text">{message}</p>
      <button
        type="button"
        className="dx-btn dx-btn-sm dx-btn-ghost"
        aria-label={`Dismiss: ${message}`}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * The page's last result: `show` puts a message on screen and hands it to
 * `announce` for screen readers; `clear` takes it away.
 */
export function useResult(announce: (message: string) => void) {
  const [result, setResult] = useState<string | undefined>(undefined);
  const show = useCallback(
    (message: string): void => {
      announce(message);
      setResult(message);
    },
    [announce],
  );
  const clear = useCallback((): void => {
    setResult(undefined);
  }, []);
  return [result, show, clear] as const;
}
