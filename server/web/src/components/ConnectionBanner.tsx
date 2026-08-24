import './states.css';

export interface ConnectionBannerProps {
  /**
   * The deployment the stream dropped from. A prop, never a constant: the
   * prototype shows `laika.kvelld.internal`, which `docs/design/README.md`
   * lists as a fixture that must not be hardcoded.
   */
  readonly host: string;
  /** Seconds until the next attempt. Omit when not counting down. */
  readonly retryInSeconds?: number;
  /** Which attempt the next one will be. */
  readonly attempt?: number;
}

/**
 * The SSE stream (SPEC §11.5, D-003) has dropped.
 *
 * Deliberately a banner rather than a blocking state: the copy below is the
 * design's own, and it is right — reads keep working from what is already
 * loaded, only live updates stop. Replacing the screen with an error would
 * throw away data the reader can still use.
 *
 * `role="status"` rather than `role="alert"`: losing live updates is worth
 * announcing, but not worth interrupting whatever the reader is doing.
 */
export function ConnectionBanner({ host, retryInSeconds, attempt }: ConnectionBannerProps) {
  const countdown =
    retryInSeconds === undefined
      ? undefined
      : `retrying in ${String(retryInSeconds)}s${attempt === undefined ? '' : ` · attempt ${String(attempt)}`}`;

  return (
    <div className="banner" role="status" aria-live="polite">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <p className="banner-title">Can&rsquo;t reach {host}</p>
        <p className="banner-body">
          The board keeps working offline for reading. Live updates resume when the SSE stream
          reconnects.
        </p>
        {countdown !== undefined && <p className="banner-meta">{countdown}</p>}
      </div>
    </div>
  );
}
