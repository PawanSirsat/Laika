import { createMiddleware } from 'hono/factory';
import { type Logger } from '../../log.ts';
import { type AppEnv } from '../context.ts';

/**
 * One structured line per request (SPEC §13.2).
 *
 * `actor_id`, `actor_kind` and `token_id` are emitted as `null` rather than
 * omitted — the field list is part of the log contract, and a consumer that has
 * to distinguish "absent" from "anonymous" has a worse job than one reading a
 * stable shape.
 *
 * The logger runs *before* auth in the §11.2 chain, so it reads the actor in its
 * `finally` block — by then the auth middleware downstream has set it. Reading it
 * up front would log every request as anonymous.
 *
 * `path` is redacted first — see `redactPath`. One §6.4 endpoint carries a
 * credential in its URL, and a log line is a file that outlives the request.
 */
export function requestLogger(log: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('log', log);

    const startedAt = performance.now();

    try {
      await next();
    } finally {
      const actor = c.get('actor');

      log.info('http.request', {
        request_id: c.get('requestId'),
        actor_id: actor?.userId ?? null,
        // Real since LAI-403: a request that arrived on a personal access token
        // is an `agent`, and the row names which token. Before that this said
        // `'user'` and the literal string `'token'` — the one place that would
        // otherwise lie about every agent request.
        actor_kind:
          actor === null || actor === undefined
            ? null
            : actor.token === null || actor.token === undefined
              ? 'user'
              : 'agent',
        token_id: actor?.token?.id ?? null,
        method: c.req.method,
        path: redactPath(c.req.path),
        status: c.res.status,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  });
}

/** The one §6.4 path whose parameter is a secret (LAI-071). */
const INVITE_PREFIX = '/api/v1/invites/';

/**
 * Replace a secret path segment with its parameter name.
 *
 * `GET /api/v1/invites/:token` takes the invite token in the URL, which §6.4
 * chose and this file does not get to change. Only the SHA-256 of that token is
 * stored (§4.11) precisely so a database dump does not hand out working invites
 * — and writing the plaintext into every access log line would undo that, in a
 * file that is routinely shipped somewhere else and kept far longer.
 *
 * Deliberately narrow. `/api/v1/invites` (the list) and `/api/v1/invites/accept`
 * are not secrets and stay readable, so a redaction that swallowed them would
 * cost real diagnostic information for nothing. Everything outside the prefix is
 * returned untouched.
 */
export function redactPath(path: string): string {
  if (!path.startsWith(INVITE_PREFIX)) return path;

  const rest = path.slice(INVITE_PREFIX.length);
  if (rest === '' || rest === 'accept' || rest.includes('/')) return path;

  return `${INVITE_PREFIX}:token`;
}
