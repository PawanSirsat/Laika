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

/** What better-auth answers to `POST /sign-in/social`: where to send the browser. */
interface SocialRedirect {
  readonly url?: string;
  readonly redirect?: boolean;
}

/**
 * **Sign in with Microsoft** (LAI-1238): ask better-auth for Microsoft's
 * authorise URL and send the browser there. Microsoft comes back to
 * `/api/v1/auth/callback/microsoft`, which sets the session and redirects to
 * `returnTo` — or to `errorTo?error=<code>` when it could not sign anyone in
 * (no invite for that address, a deactivated account, a cancelled consent).
 *
 * Both are **paths on this instance**, never full URLs: better-auth refuses a
 * callback outside the trusted origins, and a path cannot be one.
 */
export async function signInWithMicrosoft(returnTo: string, errorTo: string): Promise<void> {
  // Untyped at the call, as `signIn` is: better-auth's routes are not Hono's,
  // and `endpoint-coverage.test.ts` scans only typed calls, so it skips both.
  const answer: SocialRedirect = await request(`${AUTH_BASE}/sign-in/social`, {
    method: 'POST',
    body: { provider: 'microsoft', callbackURL: returnTo, errorCallbackURL: errorTo },
  });
  if (typeof answer.url !== 'string' || answer.url === '') {
    throw new SignInError('Microsoft sign-in did not start. Try again.', undefined, 0);
  }
  window.location.assign(answer.url);
}

/**
 * The words for an `?error=` Microsoft sign-in came back with (LAI-1238).
 *
 * The codes are better-auth's and the server's; anything unknown still says
 * that sign-in did not finish, with the code, rather than nothing — a silent
 * return to the sign-in page reads as the button being broken.
 */
export function microsoftErrorWords(code: string): string {
  switch (code) {
    case 'invite_required':
    case 'unable_to_create_user':
    case 'signup_disabled':
      return 'That Microsoft account has no invite to this Laika. Ask an admin to invite the address you signed in with.';
    case 'invite_invalid':
      return 'Your invite could not be used — it may have expired or been used already. Ask an admin for a new one.';
    case 'use_transfer':
      return 'That invite would make a second owner. Ownership changes only by transfer — ask the owner.';
    case 'forbidden':
    case 'account_deactivated':
      return 'This account has been deactivated. Ask an admin if you think that is a mistake.';
    case 'access_denied':
    case 'consent_required':
      return 'Microsoft sign-in was cancelled.';
    // LAI-1317: a person holds one Microsoft identity, and the token must be
    // this organisation's directory's, for this Laika, and a member's.
    case 'account_already_linked':
      return 'Your Laika account is linked to a different Microsoft account. If yours was re-created, ask an admin to unlink the old one.';
    case 'wrong_tenant':
      return 'That Microsoft account is not in this organisation’s directory. Sign in with your work account.';
    case 'guest_account':
      return 'Guest accounts cannot sign in here. Sign in with your own account in this organisation’s directory.';
    case 'wrong_issuer':
    case 'wrong_audience':
    case 'id_token_unreadable':
      return `Microsoft’s answer was not for this Laika (${code}). Ask an admin to check the app registration.`;
    default:
      return `Microsoft sign-in did not finish (${code}). Try again, or ask an admin.`;
  }
}
