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
 * Deliberately a banner rather than a blocking state: what is already loaded
 * stays readable and only live updates stop, so replacing the screen with an
 * error would throw away data the reader can still use.
 *
 * ## The copy is not the design's, on purpose (LAI-078)
 *
 * The prototype says *"The board keeps working offline for reading."* **There is
 * no service worker and no offline cache in this app** — checked, not assumed.
 * An open tab keeps rendering what it already fetched, which is the only
 * situation this banner is ever seen in, so the sentence is true where it
 * appears. But it also reads as a promise that you can close the tab, come back
 * offline tomorrow, and still read the board. That is false: the document
 * itself comes from the server.
 *
 * So it says what is actually true — what is on screen stays readable — rather
 * than a claim that is right only if you do not act on it. The task's own note
 * asked for exactly this: *"if the SPA cannot in fact read while offline, change
 * the copy to match reality rather than shipping the aspiration."*
 *
 * `role="status"` rather than `role="alert"`: losing live updates is worth
 * announcing, but not worth interrupting whatever the reader is doing.
 */
export function ConnectionBanner({ host, retryInSeconds, attempt }: ConnectionBannerProps) {
  // The first drop has an attempt but no measurable interval yet, so the two
  // are assembled independently rather than the attempt being lost with the
  // countdown it happened to arrive alongside.
  const parts = [
    retryInSeconds === undefined
      ? undefined
      : // "retrying in 0s" is a countdown that has finished; say what is
        // happening instead of printing a zero.
        retryInSeconds === 0
        ? 'retrying now'
        : `retrying in ${String(retryInSeconds)}s`,
    attempt === undefined || attempt === 0 ? undefined : `attempt ${String(attempt)}`,
  ].filter((part) => part !== undefined);
  const countdown = parts.length === 0 ? undefined : parts.join(' · ');

  return (
    <div className="banner" role="status" aria-live="polite">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <p className="banner-title">Can&rsquo;t reach {host}</p>
        <p className="banner-body">
          What is already on screen stays readable. Live updates resume when the stream reconnects.
        </p>
        {countdown !== undefined && <p className="banner-meta">{countdown}</p>}
      </div>
    </div>
  );
}
