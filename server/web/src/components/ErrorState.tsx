import { StateIcon } from './StateIcon.tsx';
import './states.css';

export interface ErrorStateProps {
  /** What failed, in the reader's terms — not the exception message. */
  readonly headline: string;
  /** Whether retrying is worth it, and why. */
  readonly body: string;
  /**
   * `request_id` from the API. SPEC §13.2 returns it on 5xx precisely so a user
   * can quote it, and the server logs the same value — it is the only thread
   * between "it broke for me" and a line in the log.
   */
  readonly requestId?: string;
  /**
   * Omit when retrying cannot help. A retry button on a 403 or a 422 teaches
   * people to mash it, which is worse than no button.
   */
  readonly onRetry?: () => void;
}

export function ErrorState({ headline, body, requestId, onRetry }: ErrorStateProps) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon">
        <StateIcon name="error" />
      </div>
      <p className="state-headline">{headline}</p>
      <p className="state-body">{body}</p>

      {requestId !== undefined && (
        <p className="state-detail">
          <span className="visually-hidden">Request id, quote this when reporting: </span>
          request_id {requestId}
        </p>
      )}

      {onRetry !== undefined && (
        <div className="state-action">
          <button type="button" className="state-retry" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
