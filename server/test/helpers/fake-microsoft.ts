import { type Hono } from 'hono';
import { type MicrosoftSso } from '../../src/auth/sso.ts';
import { type AppEnv } from '../../src/http/context.ts';
import { cookieFrom, jsonHeaders } from './auth.ts';

/**
 * A fake Microsoft Entra ID tenant (LAI-1317), served through a replaced
 * global `fetch` — **no test calls Microsoft**.
 *
 * It answers the two endpoints Laika reaches:
 *
 *  - the tenant's token endpoint, for a sign-in's `authorization_code` (with
 *    an id token naming whoever `signInAs` set) and for the directory sync's
 *    `client_credentials`;
 *  - Graph's `/users`, for the directory sync, one page.
 *
 * better-auth decodes the id token from the token endpoint's TLS answer and
 * does not verify a signature on it (the code flow), so the fake signs
 * nothing. Anything else the code asks for is refused `599`, so a call nobody
 * expected fails loudly instead of reaching the network.
 *
 * Each sign-in is issued fresh tokens, recorded in `issued`, so a test can
 * look for them in the database.
 */

export const MS_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
export const MS_SSO: MicrosoftSso = {
  provider: 'microsoft',
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 'fixture-client-secret-never-real',
  tenantId: MS_TENANT,
  directorySync: false,
};

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface MicrosoftPerson {
  readonly email: string;
  readonly name: string;
  /** The directory object id — better-auth's `accountId` for Microsoft. */
  readonly oid: string;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface FakeMicrosoft {
  readonly fetchImpl: typeof fetch;
  /** Every URL asked for, in order. */
  readonly calls: string[];
  /** The tokens each sign-in was issued, in order. */
  readonly issued: IssuedTokens[];
  /** Graph's `/users` page for the directory sync. */
  users: Record<string, unknown>[];
  signInAs(person: MicrosoftPerson): void;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A form body as `fetch` was handed it: better-fetch passes the params, Laika a string. */
function formOf(body: RequestInit['body']): URLSearchParams {
  if (body instanceof URLSearchParams) return body;
  return new URLSearchParams(typeof body === 'string' ? body : '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function fakeMicrosoft(sso: MicrosoftSso = MS_SSO): FakeMicrosoft {
  const calls: string[] = [];
  const issued: IssuedTokens[] = [];
  let person: MicrosoftPerson | null = null;

  const fake: FakeMicrosoft = {
    calls,
    issued,
    users: [],
    signInAs(next) {
      person = next;
    },
    fetchImpl: (input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(answer(input instanceof Request ? input.url : String(input), init)),
  };

  function answer(url: string, init: RequestInit | undefined): Response {
    calls.push(url);

    if (url === `${LOGIN}/${sso.tenantId}/oauth2/v2.0/token`) {
      const body = formOf(init?.body);
      if (body.get('grant_type') === 'client_credentials') {
        return json({
          token_type: 'Bearer',
          access_token: 'fixture-app-token',
          expires_in: 3599,
        });
      }
      if (body.get('grant_type') !== 'authorization_code' || person === null) {
        return json({ error: 'invalid_grant' }, 400);
      }
      const n = issued.length + 1;
      const tokens = {
        accessToken: `fixture-ms-access-${String(n)}-${person.oid}`,
        refreshToken: `fixture-ms-refresh-${String(n)}-${person.oid}`,
      };
      issued.push(tokens);
      const now = Math.floor(Date.now() / 1000);
      const idToken = [
        base64url({ alg: 'RS256', typ: 'JWT', kid: 'fixture' }),
        base64url({
          iss: `${LOGIN}/${sso.tenantId}/v2.0`,
          aud: sso.clientId,
          tid: sso.tenantId,
          oid: person.oid,
          sub: `sub-${person.oid}`,
          email: person.email,
          preferred_username: person.email,
          name: person.name,
          iat: now,
          nbf: now,
          exp: now + 3600,
        }),
        'fixture-signature',
      ].join('.');
      return json({
        token_type: 'Bearer',
        scope: 'openid profile email User.Read',
        expires_in: 3600,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        id_token: idToken,
      });
    }

    if (url.startsWith(`${GRAPH}/users?`)) {
      return json({ value: fake.users });
    }

    return new Response('not part of the fake Microsoft', { status: 599 });
  }
  return fake;
}

export interface MicrosoftSignIn {
  /** The callback's answer: a redirect, to the app or to better-auth's error page. */
  readonly response: Response;
  /** Where it redirected. */
  readonly location: string;
  /** The session cookie, when one was set; `''` otherwise. */
  readonly cookie: string;
}

/**
 * A whole Microsoft sign-in, as the browser makes it: ask better-auth for the
 * authorization URL, take its `state` and cookie, and come back to the
 * callback with a code, which better-auth exchanges at the fake's token
 * endpoint. The fake's global `fetch` must be in place.
 */
export async function signInWithMicrosoft(
  app: Hono<AppEnv>,
  fake: FakeMicrosoft,
  person: MicrosoftPerson,
): Promise<MicrosoftSignIn> {
  fake.signInAs(person);
  const start = await app.request('/api/v1/auth/sign-in/social', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ provider: 'microsoft', callbackURL: '/' }),
  });
  if (start.status !== 200) {
    throw new Error(`sign-in/social answered ${String(start.status)}: ${await start.text()}`);
  }
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  if (state === null) throw new Error(`no state in ${url}`);

  const response = await app.request(
    `/api/v1/auth/callback/microsoft?code=fixture-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: cookieFrom(start) } },
  );
  const cookie = cookieFrom(response)
    .split('; ')
    .filter((c) => c.includes('session_token='))
    .join('; ');
  return { response, location: response.headers.get('location') ?? '', cookie };
}
