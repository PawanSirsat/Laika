import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * Setting a new password from an admin-issued reset link (§6.4, D-104 item 4,
 * LAI-983; the page is LAI-988).
 *
 * **The token travels in the body**, as the server asks, so no access log line
 * holds a working link. Nothing here keeps it: no log, no storage — the page
 * reads it from its own address and posts it once.
 */

/** What `POST /password-resets/consume` answers. */
export interface PasswordResetView {
  readonly user_id: string;
  /** Every session of theirs that was ended, signed in anywhere. */
  readonly sessions_ended: number;
}

export function consumeResetLink(token: string, newPassword: string): Promise<PasswordResetView> {
  return request<PasswordResetView>('/password-resets/consume', {
    method: 'POST',
    body: { token, new_password: newPassword },
  });
}

/** Why a link was refused, as the page explains it. */
export type ResetRefusal = 'unknown' | 'used' | 'revoked' | 'expired' | 'inactive' | 'throttled';

/**
 * The refusal's kind, read from the envelope's `reason` (`404 unknown`, `409
 * used | revoked | expired`, `403 inactive`, `429`), or `undefined` for a
 * failure that is not about the link.
 */
export function resetRefusal(cause: unknown): ResetRefusal | undefined {
  if (!(cause instanceof ApiError)) return undefined;
  if (cause.code === 'rate_limited') return 'throttled';
  const reason = (cause.details as { reason?: unknown } | null | undefined)?.reason;
  if (cause.code === 'not_found') return 'unknown';
  if (cause.code === 'forbidden' && reason === 'inactive') return 'inactive';
  if (
    cause.code === 'conflict' &&
    (reason === 'used' || reason === 'revoked' || reason === 'expired')
  )
    return reason;
  return undefined;
}

/** What each refusal says: what happened, and what to do now. */
export const RESET_REFUSAL_COPY: Readonly<
  Record<ResetRefusal, { readonly title: string; readonly body: string }>
> = {
  unknown: {
    title: 'This reset link is not valid',
    body: 'It may have been copied incompletely. Ask whoever sent it for a new one.',
  },
  used: {
    title: 'This reset link has already been used',
    body: 'Each link sets a password once. If that was not you, ask an admin for a new link.',
  },
  revoked: {
    title: 'A newer reset link replaced this one',
    body: 'Only the newest link works. Use the latest one you were sent.',
  },
  expired: {
    title: 'This reset link has expired',
    body: 'Reset links are short-lived. Ask an admin for a new one.',
  },
  inactive: {
    title: 'This account has been deactivated',
    body: 'A deactivated account cannot set a password. Ask an admin to reactivate it first.',
  },
  throttled: {
    title: 'Too many attempts',
    body: 'Wait a minute, then try again.',
  },
};
