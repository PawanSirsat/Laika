import { ApiError } from '../../../api/errors.ts';
import { weekdayOf } from './summary-derive.ts';
import './day-states.css';

/**
 * The day could not be read (`bd.error`): the weekday it was, what went
 * wrong in the server's words, Retry, and the request that failed in mono —
 * so the person can say what they saw.
 */
export function DayError({
  day,
  error,
  request,
  onRetry,
}: {
  readonly day: string;
  readonly error: unknown;
  /** `GET /api/v1/me/time?day=…` — what was asked. */
  readonly request: string;
  readonly onRetry: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'The request did not come back.';
  const status = error instanceof ApiError ? error.status : undefined;
  return (
    <section className="myday-card dstate-card dstate-centre" role="alert" data-day-error>
      <span className="dstate-mark dstate-mark-error" aria-hidden="true">
        !
      </span>
      <h2 className="dstate-title">Couldn’t load {weekdayOf(day)}</h2>
      <p className="dstate-body">
        {message} Your collector keeps drafting in the meantime, so nothing is lost.
      </p>
      <button
        type="button"
        className="myday-chip myday-chip-primary dstate-action"
        onClick={onRetry}
      >
        Retry
      </button>
      <span className="dstate-request" data-day-error-request>
        {request}
        {status === undefined ? '' : ` · ${String(status)}`}
      </span>
    </section>
  );
}
