import { failure, failureForStatus, type Failure } from './failures.ts';

/**
 * The three calls `init` makes, and nothing else.
 *
 * Each returns either a value or a {@link Failure} — never a thrown status code
 * — so the caller cannot accidentally print a stack trace at somebody who typed
 * a URL wrong. Every branch that can go wrong has a message attached at the
 * point where what went wrong is still known.
 */

export interface Session {
  readonly cookie: string;
}

export interface MintedToken {
  readonly name: string;
  readonly prefix: string;
  readonly secret: string;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Failure };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const bad = <T>(error: Failure): Result<T> => ({ ok: false, error });

/** Trim a trailing slash so `${url}/api/v1` never doubles it. */
export function normaliseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Is there a Laika at this address?
 *
 * Distinguishes **three** outcomes that a single try/catch would flatten into
 * one: nothing answered, something answered but is not Laika, and it is there.
 * The middle one is real — a proxy or another app on the same port — and telling
 * someone to check whether their instance is running when the answer is "that is
 * a different service" sends them somewhere that cannot help.
 */
export async function checkReachable(url: string): Promise<Result<true>> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/health`);
  } catch (cause) {
    return bad(failure('unreachable', cause instanceof Error ? cause.message : undefined));
  }

  if (!response.ok) return bad(failure('not_laika'));

  try {
    const body: unknown = await response.json();
    // Laika's health payload is an object. Anything else is another service.
    if (typeof body !== 'object' || body === null) return bad(failure('not_laika'));
  } catch {
    return bad(failure('not_laika'));
  }

  return ok(true);
}

/** Sign in with email and password, keeping only the session cookie. */
export async function signIn(
  url: string,
  email: string,
  password: string,
): Promise<Result<Session>> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ email, password }),
    });
  } catch (cause) {
    return bad(failure('unreachable', cause instanceof Error ? cause.message : undefined));
  }

  if (!response.ok) return bad(failureForStatus(response.status));

  const cookie = response.headers.getSetCookie().join('; ');
  if (cookie === '') {
    return bad(failure('mint_failed', 'the sign-in succeeded but returned no session'));
  }
  return ok({ cookie });
}

/**
 * Mint a token. **The secret exists in this response and nowhere else** (§4.9).
 *
 * `init` writes it straight to the settings file and prints it once. Anything
 * that keeps it elsewhere — a log line, a temp file, a retry buffer — has broken
 * the guarantee rather than worked around an inconvenience.
 */
export async function mintToken(
  url: string,
  session: Session,
  name: string,
): Promise<Result<MintedToken>> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ name, scope: 'full' }),
    });
  } catch (cause) {
    return bad(failure('unreachable', cause instanceof Error ? cause.message : undefined));
  }

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: unknown } };
      if (typeof body.error?.message === 'string') detail = body.error.message;
    } catch {
      // The status is enough; a body we cannot read adds nothing.
    }
    return bad(failureForStatus(response.status, detail));
  }

  const body = (await response.json()) as {
    token?: { name?: string; prefix?: string };
    secret?: unknown;
  };
  if (typeof body.secret !== 'string' || body.secret === '') {
    return bad(failure('mint_failed', 'the board created a token but returned no secret'));
  }

  return ok({
    name: body.token?.name ?? name,
    prefix: body.token?.prefix ?? '',
    secret: body.secret,
  });
}
