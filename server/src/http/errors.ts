/**
 * The error envelope from SPEC §6.3 and the codes that map onto it.
 *
 * One definition, one mapper. Handlers throw `ApiError`; nothing builds an error
 * response by hand, so the shape cannot drift between endpoints.
 *
 * LAI-006 owns the rest of §6.3 (pagination, idempotency, rate limiting, zod
 * validation) and will import these codes rather than redefine them.
 */

export const ERROR_STATUS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type ErrorStatus = (typeof ERROR_STATUS)[ErrorCode];

/** SPEC §6.3: `{ "error": { "code", "message", "details" } }`. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /**
     * Always present, `null` when there is nothing to add. A key that sometimes
     * vanishes forces every client to feature-detect it; a stable shape does not.
     */
    details: unknown;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  static notFound(message = 'Not found', details: unknown = null): ApiError {
    return new ApiError('not_found', message, details);
  }

  static badRequest(message = 'Bad request', details: unknown = null): ApiError {
    return new ApiError('bad_request', message, details);
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details ?? null } };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
