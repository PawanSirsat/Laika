import { ApiError } from './errors.ts';
import type { MeProfile } from './me.ts';

/**
 * Who is signed in, as the whole app sees it.
 *
 * Five states, not a boolean plus a nullable user: "still checking" and "not
 * signed in" are different, and collapsing them is what makes an app flash its
 * sign-in screen at an already-authenticated user on every reload.
 */
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly user: MeProfile }
  | { readonly status: 'anonymous' }
  /**
   * The instance has no organisation — `setup-gate.ts` answers `409` for every
   * endpoint but setup. Distinct from `error` because there is a screen that
   * fixes it, and sending the reader there beats describing the problem.
   */
  | { readonly status: 'setup-required' }
  /**
   * The whole error, not a flattened message: `ApiErrorState` branches on the
   * code, and a `403` must not be rendered as a generic failure.
   */
  | { readonly status: 'error'; readonly error: unknown };

/**
 * How long the shell will sit on a skeleton before calling it a failure.
 *
 * A request that never settles — an instance that went away mid-flight, a proxy
 * holding the socket open — leaves `loading` true for ever, and **a skeleton
 * that never resolves is worse than an error**: it says "data is coming" when
 * the truth is "this will never load", so the reader waits instead of acting.
 * Long enough not to fire on a slow-but-working instance.
 */
export const SESSION_TIMEOUT_MS = 8000;

/** Does this failure mean the instance has never been set up? */
export function isSetupRequired(cause: unknown): boolean {
  if (!(cause instanceof ApiError) || cause.code !== 'conflict') return false;

  // The gate sends `{ setup_required: true, setup_path: '/setup' }`. Read the
  // flag rather than matching the message, which is prose and will be reworded.
  const details: unknown = cause.details;
  if (typeof details !== 'object' || details === null) return false;
  return (details as { readonly setup_required?: unknown }).setup_required === true;
}

/**
 * Map a failed `/me` onto a session state.
 *
 * Extracted from the hook so it can be tested for **every** status, not just the
 * two anyone remembers. The bug this closes was not a wrong branch — it was a
 * missing one: anything the hook did not recognise left the app on a skeleton,
 * and the owner opened a screen of grey bars that never resolved.
 *
 * The default is therefore deliberately total: **every** unrecognised failure
 * becomes `error`, which the shell renders. Nothing falls through to `loading`.
 */
export function sessionFromFailure(cause: unknown): SessionState {
  if (cause instanceof ApiError) {
    // 401 on the first probe is the normal signed-out case, not a failure.
    if (cause.code === 'unauthorized') return { status: 'anonymous' };
    if (isSetupRequired(cause)) return { status: 'setup-required' };
  }
  return { status: 'error', error: cause };
}
