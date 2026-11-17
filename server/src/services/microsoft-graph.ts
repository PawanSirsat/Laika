import { type MicrosoftSso } from '../auth/sso.ts';

/**
 * Microsoft Graph, as the Entra app itself (LAI-1239, LAI-1311): the one
 * client the directory sync and the meetings sync share.
 *
 * **One of the few places data leaves the instance** (§13.4), so it follows
 * `services/clan-client.ts`: no SDK, an injectable `fetch` so **no test calls
 * Microsoft**, a timeout on every request cleared in `finally`, and Graph's
 * own response text never echoed — a failure is a code, never a token, a
 * secret or Graph's body.
 *
 * - **App permissions only**: the app's own token (client credentials,
 *   `.default` scope). No signed-in person is needed, which is what lets the
 *   syncs run on a schedule; what the token may read is whatever a tenant
 *   admin granted the app, and a `403` names the grant that is missing.
 * - **Paging follows `@odata.nextLink` only on Graph's own origin**, and is
 *   bounded, so a response cannot send the token anywhere else or loop.
 * - **One retry, bounded**: a `429` or `503` is asked once more after the
 *   `Retry-After` it names (a second when it names none), unless it asks for
 *   more than {@link GRAPH_RETRY_AFTER_MAX_MS}. The next scheduled run is the
 *   next attempt; waiting minutes inside one buys nothing.
 */

export const LOGIN = 'https://login.microsoftonline.com';
export const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Long enough for a page of a thousand rows, short enough that a hung Graph frees the sync. */
export const GRAPH_TIMEOUT_MS = 20_000;

/** The longest `Retry-After` the one retry waits for. */
export const GRAPH_RETRY_AFTER_MAX_MS = 30_000;

/** The wait when a `429` or `503` names none. */
const DEFAULT_RETRY_MS = 1_000;

/** A bound, so a Graph that keeps answering a nextLink cannot loop for ever. */
const MAX_PAGES = 500;

export interface GraphDeps {
  /** Injected by the tests, which never call Microsoft. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** How the one retry waits — injected by the tests, which never wait. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}

/** A failure said by its code alone — never a token, a secret or Graph's body. */
export class GraphError extends Error {
  constructor(
    readonly code: string,
    label = 'microsoft graph',
  ) {
    super(`${label}: ${code}`);
    this.name = 'GraphError';
  }
}

interface Answer {
  readonly status: number;
  readonly response: Response;
}

/** `Retry-After` in milliseconds: its seconds, or a second when it names none. */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  return header !== null && header.trim() !== '' && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1_000
    : DEFAULT_RETRY_MS;
}

/**
 * One request with a timeout, and once more after a short `429`/`503`.
 *
 * The body is read by the caller, but inside this request's timeout: the
 * timer is cleared only once `read` has consumed it, so a Graph that sends
 * headers and then stalls frees the sync too.
 */
async function send<T>(
  url: string,
  init: RequestInit,
  deps: GraphDeps,
  unreachable: string,
  read: (answer: Answer) => Promise<T>,
): Promise<T> {
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? GRAPH_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  // `token_unreachable` → `token_timeout`, `token_throttled`; the same for `graph_`.
  const stem = unreachable.replace(/_unreachable$/, '');
  const lost = (err: unknown): GraphError =>
    new GraphError(
      err instanceof Error && err.name === 'AbortError' ? `${stem}_timeout` : unreachable,
    );

  const once = async (): Promise<{ retry: string | null } | { value: T }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, { ...init, signal: controller.signal });
      } catch (err) {
        throw lost(err);
      }
      if (response.status === 429 || response.status === 503) {
        return { retry: response.headers.get('retry-after') };
      }
      try {
        return { value: await read({ status: response.status, response }) };
      } catch (err) {
        if (err instanceof GraphError) throw err;
        throw lost(err);
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await once();
  if ('value' in first) return first.value;
  const wait = retryAfterMs(first.retry);
  const throttled = `${stem}_throttled`;
  if (wait > GRAPH_RETRY_AFTER_MAX_MS) throw new GraphError(throttled);
  await sleep(wait);
  const second = await once();
  if ('value' in second) return second.value;
  throw new GraphError(throttled);
}

/** The app's own Graph token (client credentials, `.default` scope). */
export async function appToken(sso: MicrosoftSso, deps: GraphDeps = {}): Promise<string> {
  return send(
    `${LOGIN}/${encodeURIComponent(sso.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: sso.clientId,
        client_secret: sso.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    },
    deps,
    'token_unreachable',
    async ({ status, response }) => {
      if (status < 200 || status >= 300) throw new GraphError(`token_${String(status)}`);
      const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
      if (typeof body?.access_token !== 'string') throw new GraphError('token_malformed');
      return body.access_token;
    },
  );
}

export interface GraphRequest {
  /**
   * The code a `403` becomes: the application permission an admin must
   * grant, e.g. `graph_forbidden_grant_calendars_read`. The one failure an
   * operator can fix, so it is named rather than numbered.
   */
  readonly forbidden: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A Graph client holding one app token, for one run. */
export interface GraphClient {
  /** One JSON `GET`. `404` is `null` — "no such thing" is an answer, not a failure. */
  get(url: string, request: GraphRequest): Promise<unknown>;
  /** Every page of a collection, following `@odata.nextLink` on Graph's origin only. */
  list(url: string, request: GraphRequest): Promise<unknown[]>;
  /** One `GET` whose body is text (a transcript's VTT); `404` is `null`. */
  text(url: string, request: GraphRequest): Promise<string | null>;
}

/** `GRAPH` + a path, or a full URL that is already on Graph's origin. */
export function graphUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith(`${GRAPH}/`)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${GRAPH}${pathOrUrl}`;
  // Anything else is a URL off Graph's origin, and the token never goes there.
  throw new GraphError('graph_bad_url');
}

/** A client with the app's token, asked for once. */
export async function graphClient(sso: MicrosoftSso, deps: GraphDeps = {}): Promise<GraphClient> {
  const token = await appToken(sso, deps);
  const headersFor = (request: GraphRequest, accept: string) => ({
    Authorization: `Bearer ${token}`,
    Accept: accept,
    ...request.headers,
  });

  const failure = (status: number, request: GraphRequest): GraphError =>
    status === 403 ? new GraphError(request.forbidden) : new GraphError(`graph_${String(status)}`);

  const get = (url: string, request: GraphRequest): Promise<unknown> =>
    send(
      graphUrl(url),
      { headers: headersFor(request, 'application/json') },
      deps,
      'graph_unreachable',
      async ({ status, response }) => {
        if (status === 404) return null;
        if (status < 200 || status >= 300) throw failure(status, request);
        const body: unknown = await response.json().catch(() => undefined);
        if (body === undefined || body === null || typeof body !== 'object') {
          throw new GraphError('graph_malformed');
        }
        return body;
      },
    );

  return {
    get,
    async list(url, request) {
      let next: string | null = graphUrl(url);
      const out: unknown[] = [];
      for (let page = 0; next !== null && page < MAX_PAGES; page++) {
        const body = (await get(next, request)) as {
          value?: unknown;
          '@odata.nextLink'?: unknown;
        } | null;
        // A collection that is not there (a deleted mailbox) is empty.
        if (body === null) return out;
        if (!Array.isArray(body.value)) throw new GraphError('graph_malformed');
        out.push(...(body.value as unknown[]));
        const link = body['@odata.nextLink'];
        next = typeof link === 'string' && link.startsWith(`${GRAPH}/`) ? link : null;
      }
      return out;
    },
    text(url, request) {
      return send(
        graphUrl(url),
        { headers: headersFor(request, 'text/vtt, text/plain;q=0.9, */*;q=0.1') },
        deps,
        'graph_unreachable',
        async ({ status, response }) => {
          if (status === 404) return null;
          if (status < 200 || status >= 300) throw failure(status, request);
          return response.text();
        },
      );
    },
  };
}
