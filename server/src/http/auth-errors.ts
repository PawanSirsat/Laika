import { ApiError, type ErrorCode } from '../errors.ts';

/**
 * Translate better-auth's error bodies into the SPEC §6.3 envelope (LAI-090).
 *
 * ## Why this is needed at all
 *
 * `/api/v1/auth/*` is handed to better-auth's own handler, so its responses
 * never pass through `createErrorHandler` — they arrive at the client as
 * `{ "message": …, "code": … }` rather than `{ "error": { code, message,
 * details } }`. The client's parser looks for `error`, finds nothing, and falls
 * back to a generic failure.
 *
 * The visible consequence was that **every** auth failure reached the UI as
 * *"Email or password is wrong."* — including an origin rejection, which is how
 * the owner spent a session believing their password was wrong when the real
 * problem was that they had opened `127.0.0.1` instead of `localhost`.
 *
 * One envelope for the whole API is the point. A second error shape that only
 * one prefix speaks is a second thing every client has to know.
 */

/** better-auth's body: a message and its own machine-readable code. */
interface AuthErrorBody {
  message?: unknown;
  code?: unknown;
}

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
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 400 && status < 500 ? 'bad_request' : 'internal';
  }
}

export interface OriginContext {
  /** `LAIKA_PUBLIC_URL` — what the instance believes it is reachable at. */
  readonly publicUrl: string;
  /** The `Origin` header the request carried, if any. */
  readonly origin: string | null;
}

/**
 * The message for a rejected origin.
 *
 * Names **both** addresses. An operator who can see the mismatch fixes it in
 * seconds; one told only "invalid origin" has to guess which of the two the
 * server thinks is wrong. Echoing the caller's own `Origin` back to that same
 * caller adds no exposure — they sent it — and it is the half that makes the
 * sentence actionable.
 */
export function originMismatchMessage(context: OriginContext): string {
  const seen = context.origin ?? 'an unknown origin';

  return (
    `This instance is configured for ${context.publicUrl} and the request came from ${seen}. ` +
    `Open it at the configured address, or set LAIKA_PUBLIC_URL to the address you use.`
  );
}

/** better-auth's code for a request whose `Origin` is not trusted. */
const INVALID_ORIGIN = 'INVALID_ORIGIN';

/**
 * Map one better-auth failure onto an `ApiError`.
 *
 * better-auth's own `code` travels in `details.auth_code`; §6.3's vocabulary is
 * closed and a client still wants to tell causes apart without reading prose.
 *
 * `details.message` repeats the envelope's message on purpose. The web client's
 * `signIn` reads `details.message` — it was written against better-auth's raw
 * body, which is what `details` effectively was — so carrying it there is what
 * makes this fix reach the screen without editing a file this task does not own.
 * **LAI-125 removes the repetition** once the client reads `error.message`.
 */
export function toApiError(status: number, body: unknown, context: OriginContext): ApiError {
  const parsed = (body ?? {}) as AuthErrorBody;
  const authCode = typeof parsed.code === 'string' ? parsed.code : null;
  const raw = typeof parsed.message === 'string' && parsed.message !== '' ? parsed.message : null;

  const isOriginRejection = authCode === INVALID_ORIGIN;
  const code = codeForStatus(status);
  const message = isOriginRejection
    ? originMismatchMessage(context)
    : (raw ?? 'That request could not be completed.');

  return new ApiError(code, message, {
    message,
    ...(authCode === null ? {} : { auth_code: authCode }),
    ...(isOriginRejection
      ? {
          reason: 'origin_mismatch',
          configured_url: context.publicUrl,
          origin: context.origin,
        }
      : {}),
  });
}

/**
 * Re-emit a failed better-auth response in the §6.3 envelope.
 *
 * Successful responses pass through **untouched** — they carry better-auth's own
 * shape, its `Set-Cookie` headers and its session payload, none of which are
 * ours to rewrite.
 */
export async function translateAuthResponse(
  response: Response,
  context: OriginContext,
): Promise<Response> {
  if (response.ok) return response;

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    // A non-JSON failure is still a failure, and still must not reach the client
    // as a shape nothing can parse.
    body = {};
  }

  const error = toApiError(response.status, body, context);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(error.toBody()), { status: response.status, headers });
}
