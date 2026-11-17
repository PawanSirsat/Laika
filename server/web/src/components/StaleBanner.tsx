import { useEffect, useState } from 'react';
import { Spinner } from '../components/Spinner.tsx';
import { staleCopy } from './error-copy.ts';
import { startTicker } from '../api/time-label.ts';
import './forms/forms.css';
import './state-kit.css';

export interface StaleBannerProps {
  /** What failed to refresh, as a phrase after "Couldn’t refresh": "members". */
  readonly what: string;
  /** When what is on screen was read (unix ms), or `null` if that is unknown. */
  readonly readAt: number | null;
  /** Why the refresh failed. Its words are shown only when they are safe. */
  readonly error?: unknown;
  /** Ask again. */
  readonly onRetry: () => void;
  /** A retry is in flight. */
  readonly retrying?: boolean | undefined;
}

/**
 * The last refresh failed; what is on screen is the read before it
 * (LAI-1207).
 *
 * **The data stays.** A failed re-read is not news about the rows, and
 * swapping a page of real work for an error page loses the thing the reader
 * was using. But the page must not look current when it is not, so this says
 * so, says how old it is — and keeps saying it as it ages — and offers Retry.
 *
 * **One banner for the app.** LAI-1128 (`components/StaleNotice.tsx`:
 * `readAt`, `onRetry`) and LAI-1197 (developer `StaleNotice.tsx`: `what`,
 * `error`, `loadedAt`, `retrying`, `onRetry`) each wrote one; this takes the
 * union of their props under LAI-1128's names, so either adopts it by
 * renaming the import (`loadedAt` → `readAt`). It is `role="status"`, as
 * LAI-1128's is, rather than LAI-1197's `alert`: the reader can carry on with
 * what is on screen, so it should not interrupt them.
 */
export function StaleBanner({ what, readAt, error, onRetry, retrying = false }: StaleBannerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(
    () =>
      startTicker(() => {
        setNow(Date.now());
      }, 30_000),
    [],
  );
  const copy = staleCopy(what, readAt, error, now);

  return (
    <div className="stale-banner" role="status" data-stale="">
      <p className="stale-banner-text">
        <strong className="stale-banner-title">{copy.title}.</strong>{' '}
        <span className="stale-banner-age">{copy.age}</span>
        {copy.why !== undefined && <span className="stale-banner-why"> {copy.why}</span>}
      </p>
      {/* `aria-disabled`, not `disabled`: focus stays on the button while it asks. */}
      <button
        type="button"
        className="button button-secondary kit-btn kit-btn-sm"
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
