import { NetworkError, toApiError } from './errors.ts';
import { isSetupRequired } from './session-state.ts';

/**
 * The typed `fetch` wrapper every call goes through (LAI-007 AC1).
 *
 * One place that knows how to talk to this API, so no screen ever writes a raw
 * `fetch` and no screen invents its own error handling.
 *
 * `credentials: 'include'` is what makes the session cookie travel. The cookie
 * is `httpOnly` (server `auth.ts`), so the SPA cannot read it — which is the
 * point: there is no token in `localStorage` for a script injection to steal.
 */

export const API_BASE = '/api/v1';

/** Same-origin by construction: the server serves this SPA (SPEC §11.4). */
const REQUEST_ID_HEADER = 'X-Request-Id';

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Called on every `401`.
 *
 * A module-level hook rather than a parameter on every call: a 401 can come back
 * from any request, and the response — clear the session, go to sign-in — is the
 * same everywhere. The session hook registers it once.
 */
let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  onUnauthorized = handler;
}

/**
 * The same shape for the setup gate (LAI-087).
 *
 * `setup-gate.ts` answers `409` on **every** endpoint but setup when the
 * instance has no organisation, so any call can be the one that discovers it —
 * not just `/me`. A tab open since before the instance was reset never re-probes
 * `/me`, so without this the news only ever arrives at whichever screen happened
 * to fetch, which then renders its own local error and the shell carries on
 * believing there is a session.
 */
let onSetupRequired: (() => void) | undefined;

export function setSetupRequiredHandler(handler: (() => void) | undefined): void {
  onSetupRequired = handler;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  // Built conditionally rather than with `undefined` values: the repo sets
  // `exactOptionalPropertyTypes`, and `RequestInit` does not accept an explicit
  // `undefined` for `body`, `headers` or `signal`.
  const init: RequestInit = {
    method,
    credentials: 'include',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    // An aborted request is the caller's own doing — a screen unmounting, a
    // stale search — and must not be reported as the instance being down.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new NetworkError(cause);
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;

  if (response.status === 204) return undefined as T;

  // Parse before branching on `ok`: the error envelope is JSON too, and a
  // non-JSON body on either path is itself the anomaly worth reporting.
  let payload: unknown;
  const text = await response.text();
  try {
    payload = text === '' ? undefined : JSON.parse(text);
  } catch {
    if (response.ok) throw new NetworkError(new Error('Expected JSON from the API.'));
    throw toApiError(response.status, {}, requestId);
  }

  if (response.ok) return payload as T;

  const error = toApiError(response.status, payload, requestId);

  // Fire before throwing so the session clears even if the caller swallows it.
  if (error.code === 'unauthorized') onUnauthorized?.();
  if (isSetupRequired(error)) onSetupRequired?.();

  throw error;
}
