import { type Context, type ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type Logger } from '../log.ts';
import { type AppEnv } from './context.ts';
import { ApiError, type ErrorBody, type ErrorCode, ERROR_STATUS, isApiError } from '../errors.ts';

/**
 * Map an HTTP status raised inside Hono onto the SPEC §6.3 code vocabulary.
 *
 * Since D-021 the vocabulary covers every status the framework actually raises
 * here — `413` from `bodyLimit` and `405` from a method mismatch each have their
 * own code rather than being folded into `bad_request`, because a client branches
 * on `code` and the remedies differ.
 *
 * The 4xx fallback still matters: collapsing an unmapped client error to
 * `internal` would report the caller's mistake as a server fault.
 */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 405:
      return 'method_not_allowed';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 400 && status < 500 ? 'bad_request' : 'internal';
  }
}

/** Used when a framework exception carries no message of its own. */
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  bad_request: 'Bad request',
  unauthorized: 'Not authenticated',
  forbidden: 'You do not have permission to perform this action',
  not_found: 'Not found',
  method_not_allowed: 'That method is not allowed on this path',
  conflict: 'Conflict',
  payload_too_large: 'Request body is too large',
  unprocessable: 'Request could not be processed',
  rate_limited: 'Too many requests',
  internal: 'Internal server error',
};

function respond(c: Context<AppEnv>, body: ErrorBody, status: number): Response {
  return c.json(body, status as never);
}

/**
 * The last link in the SPEC §11.2 chain.
 *
 * Two rules it exists to enforce:
 *  - an unhandled error never leaks its message, stack or cause to the client;
 *  - the `request_id` that *does* go to the client on a 5xx is the same one in
 *    the log line, so a user quoting it is quoting something findable (§13.2).
 */
export function createErrorHandler(log: Logger): ErrorHandler<AppEnv> {
  return (err, c) => {
    const requestId = c.get('requestId');

    if (isApiError(err)) {
      // Expected and deliberate — a handler said so. Not an error-level event.
      log.warn('http.error', {
        request_id: requestId,
        code: err.code,
        status: err.status,
        message: err.message,
      });
      return respond(c, err.toBody(), err.status);
    }

    if (err instanceof HTTPException) {
      const code = codeForStatus(err.status);
      // Hono's own exceptions sometimes carry no message — `bodyLimit` throws a
      // bare 413 — and `"message": ""` tells a client nothing.
      const message = err.message === '' ? DEFAULT_MESSAGE[code] : err.message;
      log.warn('http.error', {
        request_id: requestId,
        code,
        status: err.status,
        message,
      });
      return respond(c, new ApiError(code, message).toBody(), err.status);
    }

    // Anything else is a bug. The detail goes to the log and nowhere else.
    log.error('http.unhandled', {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    const body: ErrorBody = {
      error: {
        code: 'internal',
        message: 'Internal server error',
        // The only thing a client gets on a 5xx: the id to quote (§13.2).
        details: { request_id: requestId },
      },
    };

    return respond(c, body, ERROR_STATUS.internal);
  };
}
