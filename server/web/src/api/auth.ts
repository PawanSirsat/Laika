import { request } from './client.ts';

/**
 * Sign in and out through better-auth, which owns `/api/v1/auth/*`
 * (server `auth.ts`, SPEC §6.1).
 *
 * Its endpoints are **not** the §6.3 envelope — it has its own body shape — so
 * these translate at the boundary rather than letting a second error format
 * reach the UI. Everything above this file sees one error type.
 */

const AUTH_BASE = '/auth';

export interface Credentials {
  readonly email: string;
  readonly password: string;
  /** Long-lived session vs one that ends with the browser. */
  readonly rememberMe: boolean;
}

/** better-auth's own failure body. Nothing outside this file should know it. */
interface AuthFailure {
  readonly code?: string;
  readonly message?: string;
}

export class SignInError extends Error {
  /** better-auth's code, kept so a caller can distinguish causes if it needs to. */
  readonly code: string | undefined;
  /**
   * The HTTP status, because **not every failed sign-in is a wrong password**.
   *
   * `401` is a credential rejection. `429` is better-auth's rate limiter, which
   * fires after three rapid failures in production — and a caller that cannot
   * tell them apart shows *"Email or password is wrong"* to someone whose
   * password is right, who then retries, stays limited, and concludes they have
   * forgotten it (LAI-220). Carried here rather than re-derived from the
   * message, which is prose and will be reworded.
   */
  readonly status: number | undefined;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'SignInError';
    this.code = code;
    this.status = status;
  }
}

/** Wrong email or password, as opposed to any other reason sign-in failed. */
export function isCredentialRejection(cause: unknown): boolean {
  return cause instanceof SignInError && cause.status === 401;
}

export async function signIn(credentials: Credentials): Promise<void> {
  try {
    await request(`${AUTH_BASE}/sign-in/email`, {
      method: 'POST',
      body: {
        email: credentials.email,
        password: credentials.password,
        rememberMe: credentials.rememberMe,
      },
    });
  } catch (cause) {
    // better-auth answers 401 for wrong credentials. That is not a session
    // expiring, so it must not be reported as one — the message a user sees
    // here is "check your details", not "you were signed out".
    if (cause instanceof Error && 'status' in cause) {
      const failure = (cause as { details?: AuthFailure }).details ?? {};
      const status = (cause as { status?: unknown }).status;
      throw new SignInError(
        failure.message ?? 'Email or password is wrong.',
        failure.code,
        typeof status === 'number' ? status : undefined,
      );
    }
    throw cause;
  }
}

/**
 * End the session server-side.
 *
 * The empty object body is load-bearing, not decoration: better-auth answers
 * `415 Unsupported Media Type` to a POST with no `content-type`, and because the
 * caller clears local state in a `finally` the UI looked signed out while the
 * session was still valid on the server. A sign-out that only pretends is the
 * worst possible bug in this file — verified fixed by re-requesting `/me`.
 */
export function signOut(): Promise<void> {
  return request(`${AUTH_BASE}/sign-out`, { method: 'POST', body: {} });
}
