/**
 * The client half of SPEC §6.3's error envelope.
 *
 * The server has a **closed** vocabulary of ten codes, and clients branch on
 * `code` rather than on status or message text. Mirroring the list here means a
 * `switch` over it is exhaustive under `strict`, so adding a code server-side
 * surfaces as a type error rather than as a branch nobody wrote.
 */

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'method_not_allowed',
  'conflict',
  'payload_too_large',
  'unprocessable',
  'rate_limited',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * A failed API call.
 *
 * Carries the code, the status, whatever `details` the server sent, and the
 * `request_id` when there is one — SPEC §13.2 returns it on 5xx precisely so a
 * user can quote it, and it is the only thread between "it broke for me" and a
 * line in the server log.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details: unknown = null,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }

  /** Retrying this exact call could plausibly work. */
  get retryable(): boolean {
    return this.code === 'internal' || this.code === 'rate_limited';
  }
}

/**
 * The network itself failed — no response, so no envelope and no code.
 *
 * Distinct from `ApiError` because the remedy differs: an offline browser or an
 * unreachable instance is not the same as a request the server rejected, and
 * rendering "internal server error" for a dropped connection is a lie.
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The instance could not be reached.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** Parse a JSON body into an `ApiError`, falling back when it is not one. */
export function toApiError(status: number, body: unknown, requestId?: string): ApiError {
  const envelope = body as { error?: { code?: unknown; message?: unknown; details?: unknown } };
  const error = envelope.error;

  const code = isErrorCode(error?.code) ? error.code : 'internal';
  const message =
    typeof error?.message === 'string' && error.message !== ''
      ? error.message
      : `Request failed with status ${String(status)}.`;

  return new ApiError(code, message, status, error?.details ?? null, requestId);
}
