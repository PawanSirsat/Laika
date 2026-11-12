import { ApiError, NetworkError } from '../api/errors.ts';
import { clockTime, timeLabel } from '../api/time-label.ts';

/**
 * The words for a failed read (LAI-1207): what happened, why, and whether
 * asking again could help. Pure, so every branch is a unit test rather than a
 * screenshot.
 *
 * `ErrorPanel` and `StaleBanner` draw these; `ApiErrorPanel` picks them from
 * an error. A screen never writes its own "Something went wrong".
 */

export interface ErrorCopy {
  /** What happened, in the reader's terms: "Couldn’t load members". */
  readonly title: string;
  /** Why, and what that means for them. The server's own words when they are safe to show. */
  readonly why: string;
  /** Whether a Retry button could help. A rejected payload fails the same way twice. */
  readonly retryable: boolean;
  /** SPEC §13.2's `request_id`, for quoting in a report. */
  readonly requestId?: string | undefined;
  /** Which glyph: the instance did not answer, or it answered no. */
  readonly kind: 'offline' | 'server';
}

/** Longer than this and the server's message is a stack trace or a dump, not a sentence. */
const MAX_SAFE_MESSAGE = 240;

/**
 * Whether the server's own message can be shown as the *why* (LAI-1207).
 *
 * The §6.3 envelope's `message` is written for people — "A column with that
 * name already exists" — so it is the best explanation available. It is not
 * shown when it is empty, when it is long or multi-line (a trace, an HTML
 * error page a proxy put in the body), or when the code is `internal`: a 500's
 * message describes the server's insides, and the reader can do nothing with
 * it but quote the request id, which is shown separately.
 */
export function safeServerMessage(error: ApiError): string | undefined {
  const message = error.message.trim();
  if (error.code === 'internal') return undefined;
  if (message === '' || message.length > MAX_SAFE_MESSAGE) return undefined;
  if (/[\n<>]/.test(message)) return undefined;
  // `toApiError`'s stand-in when the body carried no message: true, and no help.
  if (/^Request failed with status \d+\.$/.test(message)) return undefined;
  return message;
}

/**
 * The copy for `error`, which failed while trying to `verb` the `resource`.
 *
 * `resource` reads after the verb: "members", "this space’s tokens".
 * `forbidden` is not handled here — it is not an error but a permission, and
 * `ApiErrorPanel` routes it to `PermissionDenied` before asking.
 */
export function errorCopy(error: unknown, resource: string, verb = 'load'): ErrorCopy {
  const title = `Couldn’t ${verb} ${resource}`;

  if (error instanceof NetworkError) {
    return {
      title,
      why: 'Laika didn’t answer — the connection may have dropped. Anything already on screen still works.',
      retryable: true,
      kind: 'offline',
    };
  }

  if (error instanceof ApiError) {
    const said = safeServerMessage(error);
    const fallback =
      error.code === 'internal'
        ? 'Laika hit a problem on its side. Trying again usually clears it.'
        : error.code === 'rate_limited'
          ? 'Too many requests in a short time. Wait a moment, then try again.'
          : error.code === 'not_found'
            ? 'It may have been moved or deleted.'
            : error.code === 'unauthorized'
              ? 'Your session may have ended. Sign in again, then try again.'
              : 'The request was refused.';
    return {
      title,
      why: said ?? fallback,
      retryable: error.retryable,
      requestId: error.requestId,
      kind: 'server',
    };
  }

  return {
    title,
    why: 'Something unexpected went wrong. Trying again may help.',
    retryable: true,
    kind: 'server',
  };
}

export interface StaleCopy {
  /** "Couldn’t refresh members". */
  readonly title: string;
  /** "Showing what was read 4 min ago (2:05 PM)." */
  readonly age: string;
  /** The failure's own words, when there are safe ones. */
  readonly why?: string | undefined;
}

/**
 * The copy for a failed **re**-read over data still on screen (LAI-1207).
 *
 * Says how old the data is in the relative form the app uses everywhere
 * (`timeLabel`, D-065) with the clock time beside it, so "4 min ago" can be
 * checked against the clock without hovering. `now` is passed in, never read
 * here, for the reason `timeLabel` gives.
 */
export function staleCopy(
  what: string,
  readAt: number | null,
  error: unknown,
  now: number,
): StaleCopy {
  const age =
    readAt === null
      ? 'Showing what was last read.'
      : `Showing what was read ${timeLabel(readAt, now).text} (${clockTime(readAt)}).`;
  const why =
    error instanceof NetworkError
      ? 'Laika didn’t answer.'
      : error instanceof ApiError
        ? safeServerMessage(error)
        : undefined;
  return { title: `Couldn’t refresh ${what}`, age, why };
}
