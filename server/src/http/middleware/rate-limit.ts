import { createMiddleware } from 'hono/factory';
import { LIMITS, type LimitPolicy, type RateLimiter } from '../rate-limit.ts';
import { type AppEnv } from '../context.ts';
import { ApiError } from '../../errors.ts';
import { isReservedPath } from '../static.ts';

/**
 * SPEC §6.3's limits, applied per actor. Sits after `auth` in the §11.2 chain
 * because it keys on the resolved actor.
 *
 * ## What is deliberately not limited (LAI-030)
 *
 * **The liveness probe.** `GET /api/v1/health` is exempt. The container's
 * `HEALTHCHECK` calls it every 30s and marks the container unhealthy after three
 * failures, so rate-limiting it means a burst of anonymous traffic exhausts the
 * shared bucket, the probe gets a `429`, and the orchestrator **restarts a server
 * that was working**. Load becomes an outage, and the restart makes it worse.
 * A liveness probe that can be rate-limited is not a liveness probe.
 *
 * **Static assets and the SPA document.** §6.3 is the REST API's contract; a
 * single page load pulls a dozen files, so counting them against an API budget
 * measures the wrong thing. Serving a file from disk is also not the cost this
 * limiter exists to protect.
 *
 * ## A token is limited as itself, not as its owner (LAI-138)
 *
 * §6.3 gives a token 120/min and a cookie session 600/min. Keyed by user, a
 * token would spend the session budget — five times what the spec allows — and
 * two tokens held by one person would contend with each other and with that
 * person's browser. So the bucket is the **token id**, and a session's bucket is
 * the **user id**; they are different keys and neither drains the other.
 *
 * ## Anonymous requests share one bucket
 *
 * Everything unauthenticated that *is* limited shares a single bucket. The
 * alternative is per-IP, and behind a reverse proxy — the documented deployment
 * (§11.7) — every request carries the proxy's address unless `X-Forwarded-For` is
 * trusted. Trusting that header without knowing which hop set it lets any client
 * invent its own identity and defeat the limiter completely, which is strictly
 * worse than one shared bucket. Per-IP needs a trusted-proxy configuration first;
 * until Laika has one, and until an expensive unauthenticated endpoint exists to
 * protect, sharing is the honest default.
 *
 * **A shared anonymous bucket can always be drained**, by whoever sends enough.
 * Device pairing (LAI-1050) has buckets of its own for that reason, sized so
 * that draining them takes sustained traffic; keys per address still wait for
 * the trusted-proxy setting above.
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!isLimited(c.req.path)) {
      await next();
      return;
    }

    const actor = c.get('actor');
    const { key, policy } = classify(
      c.req.path,
      actor === null || actor === undefined
        ? null
        : { userId: actor.userId, tokenId: actor.token?.id ?? null },
      c.req.method,
    );
    const decision = limiter.take(key, policy);

    // The bucket's size: per minute for §6.3's budgets, and 30 for the
    // report budget, which is per hour — `0.5` would tell a client nothing.
    c.header('X-RateLimit-Limit', String(policy.burst ?? policy.perMinute));
    c.header('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiError('rate_limited', 'Too many requests', {
        retry_after_seconds: decision.retryAfterSeconds,
      });
    }

    await next();
  });
}

/** The liveness probe (§11.7, `docker/Dockerfile`'s HEALTHCHECK). */
export const HEALTH_PATH = '/api/v1/health';

/**
 * Whether this path is subject to §6.3's limits at all.
 *
 * Reserved prefixes — `/api`, `/mcp`, `/webhooks` — are the API surface. Anything
 * else is a static asset or the SPA document.
 */
export function isLimited(path: string): boolean {
  if (path === HEALTH_PATH) return false;
  return isReservedPath(path);
}

/**
 * Who a request is being counted as.
 *
 * A record rather than two positional `string | null`s: the two are adjacent,
 * mean opposite things, and transposing them would silently key every token by
 * its owner — which is the exact defect LAI-138 exists to remove, reintroduced
 * by a call site instead of by the classifier.
 */
export interface RequestCredential {
  userId: string;
  /** The token the request arrived on, or `null` for a cookie session. */
  tokenId: string | null;
}

/** A collector's report, D-079's ingest (§6.3, LAI-751). */
export const LOCAL_ACTIVITY_PATH = '/api/v1/me/local-activity';

/** The OpenTelemetry receiver (LAI-773). */
export const OTLP_PREFIX = '/api/v1/otlp/';

/** A device's side of pairing (LAI-1050): claim, and `/:id/complete`. */
export const PAIRING_PREFIX = '/api/v1/device-pairing/';
export const PAIRING_CLAIM_PATH = '/api/v1/device-pairing/claim';
/** `/:id/complete` with a ULID id, as `newId` makes them. */
export const PAIRING_COMPLETE_PATH =
  /^\/api\/v1\/device-pairing\/([0-9A-HJKMNP-TV-Z]{26})\/complete$/;

/** A device redeeming a tool setup (LAI-1056): `/tool-setup/:id/redeem`, ULID ids. */
export const TOOL_REDEEM_PATH = /^\/api\/v1\/tool-setup\/([0-9A-HJKMNP-TV-Z]{26})\/redeem$/;
export const TOOL_SETUP_PREFIX = '/api/v1/tool-setup/';
/** An agent's CLI reporting itself (LAI-1056), on the heartbeat class. */
export const CLIENT_REPORT_PATH = '/api/v1/agents/me/client-report';

/** A collector's drafted blocks (LAI-787). */
export const TIME_DRAFTS_PATH = '/api/v1/me/time-drafts';

/** The Time report (LAI-1135), JSON and CSV alike. */
export const TIME_REPORT_PATH = '/api/v1/time/report';

/** The Time logging grid (D-148, LAI-1175). */
export const TIME_DAYS_PATH = '/api/v1/time/days';

/** The calls to the HR system a person makes (D-149, LAI-1181): connect, and sync now. */
export const HR_CALL_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/org/hr/connect',
  '/api/v1/org/hr/sync',
]);

export function classify(
  path: string,
  credential: RequestCredential | null,
  method = 'GET',
): { key: string; policy: LimitPolicy } {
  // A token is its own identity; a cookie session is its user's. Anonymous
  // callers share one, for the reason in the module comment.
  const who = credential === null ? 'anonymous' : (credential.tokenId ?? credential.userId);

  // Reports have their own hourly budget, per token and per user for a
  // session — and nothing else on that path does: the preview and the delete
  // are a person on the web app, on the session budget.
  if (path === LOCAL_ACTIVITY_PATH && method === 'PUT') {
    return {
      key: `local-activity:${credential?.tokenId != null ? 'token' : 'user'}:${who}`,
      policy: LIMITS.localActivity,
    };
  }

  // A collector's time drafts (LAI-787): a report like the snapshot, on the
  // same policy and its own bucket, so drafting never spends the snapshot's
  // budget. An agent's proposal (`POST`) is an ordinary write.
  if (path === TIME_DRAFTS_PATH && method === 'PUT') {
    return {
      key: `time-drafts:${credential?.tokenId != null ? 'token' : 'user'}:${who}`,
      policy: LIMITS.localActivity,
    };
  }

  // The Time report (LAI-1135): its own bucket per person, so a run of
  // filter clicks never spends the session's budget, nor the session's its.
  if (path === TIME_REPORT_PATH && method === 'GET') {
    return { key: `time-report:${who}`, policy: LIMITS.timeReport };
  }

  // The Time logging grid (LAI-1175): the report's budget on a bucket of its
  // own, so stepping through months never starves the report, nor it the grid.
  if (path === TIME_DAYS_PATH && method === 'GET') {
    return { key: `time-days:${who}`, policy: LIMITS.timeReport };
  }

  // The HR system (LAI-1181): every one of these calls Clan, so they share a
  // small bucket per person, and never spend the session's.
  if (HR_CALL_PATHS.has(path) && method === 'POST') {
    return { key: `hr:${who}`, policy: LIMITS.hr };
  }

  // OpenTelemetry has its own budget (LAI-773), per token as reports are.
  if (path.startsWith(OTLP_PREFIX)) {
    return {
      key: `otlp:${credential?.tokenId != null ? 'token' : 'user'}:${who}`,
      policy: LIMITS.otlp,
    };
  }

  // A device pairing (LAI-1050): anonymous, and on buckets of its own. Claims
  // share one; completing is per request, because the CLI polls it.
  if (path === PAIRING_CLAIM_PATH) {
    return { key: 'pairing:claim', policy: LIMITS.pairing };
  }
  // A key per request only for a path shaped like one (LAI-1050 review, B2):
  // the id is the caller's input, and a key made from any string they send is
  // a map entry made for them. Everything else shares one.
  if (path.startsWith(PAIRING_PREFIX)) {
    const id = PAIRING_COMPLETE_PATH.exec(path)?.[1];
    return {
      key: id === undefined ? 'pairing:complete:other' : `pairing:complete:${id}`,
      policy: LIMITS.pairingComplete,
    };
  }

  // Redeeming a tool setup (LAI-1056): no actor, so a bucket per exchange,
  // and only for a ULID-shaped id — anything else that ends in `/redeem`
  // shares one. A flood on one exchange spends that exchange's budget and
  // nobody else's; the owner's `GET` / `DELETE` stay on their session's.
  if (path.startsWith(TOOL_SETUP_PREFIX) && path.endsWith('/redeem')) {
    const id = TOOL_REDEEM_PATH.exec(path)?.[1];
    return {
      key: id === undefined ? 'tool-redeem:other' : `tool-redeem:${id}`,
      policy: LIMITS.toolRedeem,
    };
  }

  // A CLI's report of itself is heartbeat-sized (plan LAI-1042 §E.8).
  if (path === CLIENT_REPORT_PATH) {
    return { key: `client-report:${who}`, policy: LIMITS.heartbeat };
  }

  // Heartbeats are frequent, cheap and get their own budget (§6.3, §9.1) so a
  // busy agent cannot spend its whole session allowance on presence pings.
  if (path.startsWith('/api/v1/heartbeats')) {
    return { key: `heartbeat:${who}`, policy: LIMITS.heartbeat };
  }

  // §6.3's tighter budget, keyed on the token rather than on its owner. The
  // prefixes keep the two namespaces apart, so `token:X` and `session:X` are
  // different buckets whatever the ids happen to be.
  if (credential?.tokenId != null) {
    return { key: `token:${credential.tokenId}`, policy: LIMITS.token };
  }

  return { key: `session:${who}`, policy: LIMITS.session };
}
