import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createLogger, type Logger } from './log.ts';
import { FALLBACK_DOCUMENT, PUBLIC_DIR } from './paths.ts';
import { type AppEnv } from './http/context.ts';
import { createErrorHandler } from './http/error-handler.ts';
import { ApiError } from './errors.ts';
import { anonymousAuth, authMiddleware } from './http/middleware/auth.ts';
import { errorBoundary } from './http/middleware/error-boundary.ts';
import { requestLogger } from './http/middleware/logger.ts';
import { rateLimitMiddleware } from './http/middleware/rate-limit.ts';
import { idempotencyMiddleware } from './http/middleware/idempotency.ts';
import { RateLimiter } from './http/rate-limit.ts';
import { requestId } from './http/middleware/request-id.ts';
import { createSecurityHeaders } from './http/middleware/security-headers.ts';
import { buildContentSecurityPolicy, extractStyleHashes } from './http/security-headers.ts';
import { healthRoutes } from './http/routes/health.ts';
import { meRoutes, meWatchRoutes } from './http/routes/me.ts';
import { setupRoutes } from './http/routes/setup.ts';
import { projectRoutes } from './http/routes/projects.ts';
import { projectSprintRoutes, sprintRoutes } from './http/routes/sprints.ts';
import { projectTaskRoutes, taskRoutes } from './http/routes/tasks.ts';
import { orgRoutes } from './http/routes/orgs.ts';
import { githubWebhookRoutes } from './http/routes/webhooks.ts';
import { userRoutes } from './http/routes/users.ts';
import { inviteRoutes } from './http/routes/invites.ts';
import { activityRoutes, projectActivityRoutes } from './http/routes/activity.ts';
import { commentRoutes, taskCommentRoutes } from './http/routes/comments.ts';
import { eventRoutes } from './http/routes/events.ts';
import { tokenRoutes, userTokenRoutes } from './http/routes/tokens.ts';
import { mcpRoutes } from './http/routes/mcp.ts';
import { unlistedRoutes } from './http/routes/unlisted.ts';
import { heartbeatRoutes } from './http/routes/heartbeats.ts';
import { capacityRoutes, presenceRoutes } from './http/routes/presence.ts';
import { setupGate } from './http/middleware/setup-gate.ts';
import { stoppingGate } from './http/middleware/stopping.ts';
import { setupRequired } from './services/setup.ts';
import { AUTH_BASE_PATH, type Auth } from './auth/auth.ts';
import { SignInThrottle } from './auth/sign-in-throttle.ts';
import { type Db } from './db/client.ts';
import { users } from './db/schema.ts';
import { ActivityFeed } from './services/activity-feed.ts';
import { createSpaHandler, createStaticHandler, isReservedPath } from './http/static.ts';
import { allowedMethodsFor } from './http/allowed-methods.ts';
import { translateAuthResponse } from './http/auth-errors.ts';

/**
 * Hash the fallback document's inline `<style>` block at startup so the policy
 * cannot drift from the file (LAI-205).
 *
 * A missing document is not fatal here — the SPA handler already fails loudly
 * for that — so the policy is built with no hash rather than refusing to boot
 * over a header.
 */
function contentSecurityPolicyFor(fallbackDocument: string): string {
  let html = '';
  try {
    html = readFileSync(fallbackDocument, 'utf8');
  } catch {
    html = '';
  }

  return buildContentSecurityPolicy(extractStyleHashes(html));
}

/** 1 MiB. Generous for JSON, small enough that a bad client cannot exhaust us. */
const BODY_LIMIT_BYTES = 1024 * 1024;

export const API_BASE = '/api/v1';

export interface CreateAppOptions {
  version: string;
  /**
   * Whether shutdown has begun (§11.2, LAI-214). A request on a **reused
   * keep-alive connection** can still reach a closing server, and answering
   * `200 ready` to a stream that will never deliver a frame is worse than
   * refusing.
   */
  isStopping?: () => boolean;
  /**
   * Per-account sign-in throttling (§6.1, LAI-219). Injectable so a test can
   * supply one with a clock it controls — the rule is "after n failures, wait" ,
   * and proving it against `Date.now()` would mean sleeping for the delay.
   */
  signInThrottle?: SignInThrottle;
  logger?: Logger;
  /**
   * Auth and the database. Optional so the HTTP-level tests of LAI-002 can build
   * an app without standing up a database — those routes do not touch either.
   */
  auth?: Auth;
  /**
   * `LAIKA_SECRET`. Optional so the LAI-002 HTTP tests can build an app without
   * one; a route that needs it and does not get it fails at the boundary rather
   * than encrypting under an empty key.
   */
  serverSecret?: string;
  db?: Db;
  /** Needed for the setup transaction's `BEGIN IMMEDIATE` (LAI-009). */
  sqlite?: Database.Database;
  /** Injectable so tests can drive the clock and assert exhaustion. */
  rateLimiter?: RateLimiter;
  /**
   * The SSE fan-out (LAI-048). Passed in from `index.ts` because the shutdown
   * handler needs the same instance to close open streams; built here when a
   * test does not care.
   */
  activityFeed?: ActivityFeed;
  /**
   * `LAIKA_PUBLIC_URL` (§11.7) — the origin invite links are built from. Absent
   * yields relative links; see `acceptUrlFor`.
   */
  publicUrl?: string;
  /** Overridable so tests can point at a directory whose contents they control. */
  publicDir?: string;
  fallbackDocument?: string;
}

/**
 * Builds the Hono app without binding a port.
 *
 * Kept separate from `index.ts` on purpose: Hono's test client needs the app as
 * a value, and a factory that also called `serve()` would make every HTTP test
 * open a real socket (SPEC §13.3).
 */
/**
 * The `email` from a sign-in body, or null.
 *
 * Deliberately total: a body that is not JSON, or carries no email, is
 * better-auth's problem to reject — this only decides whether there is an
 * account to count failures against, and "no" is a safe answer because it means
 * the request is passed through untouched.
 */
/**
 * Is the account that just authenticated still active?
 *
 * Read from the row rather than from better-auth's session payload: `is_active`
 * changes, and a session minted before a deactivation must not keep carrying the
 * old value around — the same reason `loadActor` reads the database.
 */
function signedInUserIsActive(db: Db, email: string): boolean {
  const row = db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();

  // No row means better-auth authenticated somebody this query cannot find,
  // which should not happen — and "let them in" is the wrong way to be wrong.
  //
  // **Not independently tested, and it cannot be**: reaching here requires
  // better-auth to have just verified a password against a row, so the row is
  // there. Removing the guard changes no observable behaviour. It is defence in
  // depth rather than a checked property, and saying so beats a comment that
  // implies coverage nothing provides (LAI-427).
  return row?.isActive === 1;
}

function readEmail(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const email = (parsed as { email?: unknown }).email;
    return typeof email === 'string' && email.trim() !== '' ? email : null;
  } catch {
    return null;
  }
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const log = options.logger ?? createLogger();
  const db = options.db;

  const staticOptions = {
    publicDir: options.publicDir ?? PUBLIC_DIR,
    fallbackDocument: options.fallbackDocument ?? FALLBACK_DOCUMENT,
    // Re-read per request: setup stops being required the moment it succeeds,
    // and the app is built once at startup.
    setupRequired: db === undefined ? undefined : () => setupRequired(db),
  };

  const app = new Hono<AppEnv>();

  // SPEC §11.2 — fixed order:
  // requestId → logger → cors → bodyLimit → auth → rateLimit → route → errorHandler
  app.use('*', requestId);
  // Front half of errorHandler — see the module comment for why it is here and
  // not a stage of its own.
  app.use('*', errorBoundary);

  // Early: a server that has decided to stop should not resolve a credential,
  // touch the database, or take a rate-limit token on the way to refusing. After
  // `errorBoundary` so the refusal is still §6.3-shaped.
  if (options.isStopping !== undefined) app.use('*', stoppingGate(options.isStopping));
  app.use('*', requestLogger(log));
  app.use(
    '*',
    cors({
      // Deny-by-default. The SPA is same-origin in production and behind Vite's
      // proxy in development (LAI-007), so nothing legitimate needs a cross-origin
      // grant yet. Widening this is a decision, not a default.
      origin: () => null,
      credentials: true,
    }),
  );
  // Immediately after cors: response headers, so they apply to everything the
  // chain produces, including errors and the SPA document (SPEC §13.1).
  app.use('*', createSecurityHeaders(contentSecurityPolicyFor(staticOptions.fallbackDocument)));
  app.use('*', bodyLimit({ maxSize: BODY_LIMIT_BYTES }));
  // SPEC §11.2 position. Real when auth is configured, pass-through otherwise;
  // either way an anonymous request continues with `actor: null` rather than 401.
  app.use(
    '*',
    options.auth !== undefined && options.db !== undefined
      ? authMiddleware({ auth: options.auth, db: options.db })
      : anonymousAuth,
  );
  app.use('*', rateLimitMiddleware(options.rateLimiter ?? new RateLimiter()));

  // After rateLimit, before the routes: an un-set-up instance answers `conflict`
  // for every API path except setup and health (LAI-009 AC1).
  if (db !== undefined) {
    app.use('*', setupGate(db));
  }

  // After rateLimit: a replayed response should still cost a token, or a retry
  // loop on a stored 201 becomes a free unlimited request.
  if (options.db !== undefined) {
    app.use('*', idempotencyMiddleware(options.db));
  }

  // Routes before the static handler: whoever matches first wins, and the SPA
  // fallback must never shadow an API path.
  app.route(`${API_BASE}/health`, healthRoutes(options.version));
  app.route(`${API_BASE}/me`, meRoutes());

  if (db !== undefined) {
    app.route(`${API_BASE}/me`, meWatchRoutes({ db }));
    app.route(
      `${API_BASE}/events`,
      eventRoutes({ db, feed: options.activityFeed ?? new ActivityFeed({ db }) }),
    );
  }

  if (db !== undefined && options.auth !== undefined && options.sqlite !== undefined) {
    app.route(`${API_BASE}/setup`, setupRoutes({ db, sqlite: options.sqlite, auth: options.auth }));
    // Task routes mount on the same prefix; Hono merges the two routers.
    app.route(`${API_BASE}/projects`, projectTaskRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/projects`, projectSprintRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/projects`, projectActivityRoutes({ db }));
    app.route(`${API_BASE}/activity`, activityRoutes({ db }));
    // Before `userRoutes`, which registers `GET /` on the same prefix. They do
    // not collide today — `/:id/tokens` is a different path — but Hono resolves
    // a same-method match in registration order, so the more specific router
    // going first is what keeps that true if `/users/:id` is ever added.
    app.route(`${API_BASE}/users`, userTokenRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/users`, userRoutes({ db }));
    app.route(`${API_BASE}/org`, orgRoutes({ db, serverSecret: options.serverSecret ?? '' }));

    // **Outside `/api/v1`, and that is §10's first sentence** — *"Mounted at
    // `/webhooks/*`, outside `/api/v1`, no user session."* It still passes
    // through the middleware chain: `/webhooks/` is a reserved path, so §6.3's
    // limiter bounds it, and `authMiddleware` resolves nothing and leaves
    // `actor: null`, which is correct — the signature is the authentication.
    app.route('/webhooks', githubWebhookRoutes({ db, serverSecret: options.serverSecret ?? '' }));
    app.route(`${API_BASE}/tokens`, tokenRoutes({ db, sqlite: options.sqlite }));
    app.route(
      `${API_BASE}/invites`,
      inviteRoutes({ db, auth: options.auth, publicUrl: options.publicUrl }),
    );
    app.route(`${API_BASE}/projects`, projectRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/tasks`, taskCommentRoutes({ db }));
    app.route(`${API_BASE}/tasks`, taskRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/comments`, commentRoutes({ db }));
    app.route(`${API_BASE}/sprints`, sprintRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/unlisted`, unlistedRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/heartbeats`, heartbeatRoutes({ db }));
    app.route(`${API_BASE}/presence`, presenceRoutes({ db }));
    app.route(`${API_BASE}/capacity`, capacityRoutes({ db }));

    // §7's endpoint, on the same process and the same auth as the REST API.
    // Not under `${API_BASE}`: §6.4 places it at the root, and `static.ts`
    // already excludes `/mcp` from the SPA fallback while `rate-limit.ts`
    // already counts it as a reserved API prefix — the routing hole was
    // pre-cut for this.
    app.route('/mcp', mcpRoutes({ version: options.version, db, sqlite: options.sqlite }));
  }

  // better-auth owns everything under /api/v1/auth (§6.4). Mounted with `on`
  // rather than `route` so every method and sub-path reaches its handler.
  if (options.auth !== undefined) {
    const configuredAuth = options.auth;

    const signInThrottle = options.signInThrottle ?? new SignInThrottle();

    app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, async (c) => {
      // **Sign-in only.** Sign-out, session reads and the rest of better-auth's
      // surface are not guessing attempts and must not share a failure counter
      // with one (LAI-219).
      const isSignIn = c.req.method === 'POST' && c.req.path.endsWith('/sign-in/email');

      // The body is read once and re-attached: `c.req.raw` is a stream, and
      // better-auth needs it intact after this handler has looked.
      let email: string | null = null;
      let request = c.req.raw;

      if (isSignIn) {
        const body = await c.req.raw.clone().text();
        email = readEmail(body);

        if (email !== null) {
          const decision = signInThrottle.check(email);

          if (!decision.allowed) {
            // §6.3's envelope, and `Retry-After` so a legitimate user is told
            // how long rather than left guessing. Identical for a real account
            // and an unknown one — see `sign-in-throttle.ts`.
            throw new ApiError('rate_limited', 'Too many sign-in attempts', {
              retry_after_seconds: decision.retryAfterSeconds ?? 0,
            });
          }
        }

        request = new Request(c.req.raw.url, {
          method: c.req.raw.method,
          headers: c.req.raw.headers,
          body,
        });
      }

      const response = await configuredAuth.handler(request);

      // **A deactivated account may not sign in** (§4.1, LAI-442) — checked
      // *after* better-auth has verified the password, deliberately.
      //
      // Refusing before would answer "deactivated" to anyone who typed the
      // address, turning `403` into an account-existence oracle — the property
      // LAI-219 went to some trouble to keep. Refusing after means only somebody
      // who **already proved they hold the credential** learns the account is
      // switched off, which they are entitled to know and which tells an
      // attacker nothing they could not already confirm.
      //
      // The session better-auth just issued is discarded with the response, so
      // no cookie reaches the client.
      // `db` is optional on this app (the LAI-002 HTTP tests build one without
      // it); with no database there is no account to be deactivated.
      if (
        isSignIn &&
        response.ok &&
        email !== null &&
        db !== undefined &&
        !signedInUserIsActive(db, email)
      ) {
        throw new ApiError('forbidden', 'This account has been deactivated');
      }

      if (email !== null) {
        if (response.ok) {
          signInThrottle.recordSuccess(email);
        } else if (response.status === 401) {
          // **Only a rejected credential counts.** A `403` is the origin check
          // refusing before any password was looked at (§6.1), and counting it
          // would let an attacker throttle any account from a foreign origin
          // **without ever submitting a guess** — a cheaper denial of service
          // than the one the capped delay deliberately accepts. `400` and
          // better-auth's own `429` are the same: no credential was evaluated,
          // so no attempt was made against this account.
          //
          // This does not reopen the account-existence oracle: a wrong password
          // and an unknown address both answer `401`, which is asserted in
          // `test/http/sign-in-throttle.test.ts`.
          signInThrottle.recordFailure(email);
        }
      }

      // Successes pass through untouched — they carry better-auth's session
      // payload and `Set-Cookie`. Failures are re-emitted in the §6.3 envelope,
      // because this handler bypasses `createErrorHandler` and a second error
      // shape on one prefix is a second thing every client has to know
      // (LAI-090).
      return translateAuthResponse(response, {
        publicUrl: options.publicUrl ?? '',
        origin: c.req.header('Origin') ?? null,
      });
    });
  }

  app.use('*', createStaticHandler(staticOptions));

  const spa = createSpaHandler(staticOptions);

  app.notFound((c) => {
    // A reserved prefix that reached here is a genuinely unknown API route, and
    // it answers as JSON (SPEC §6.3) rather than as an HTML document.
    if (isReservedPath(c.req.path)) {
      // Hono answers a method mismatch with 404, so without this a client cannot
      // tell "wrong method" from "no such endpoint" (D-021).
      const allowed = allowedMethodsFor(app as unknown as Hono<never>, c.req.path);

      if (allowed.length > 0) {
        c.header('Allow', allowed.join(', '));
        throw new ApiError(
          'method_not_allowed',
          `${c.req.method} is not allowed on ${c.req.path}`,
          { allowed },
        );
      }

      throw ApiError.notFound(`No route for ${c.req.method} ${c.req.path}`);
    }
    return spa(c);
  });

  app.onError(createErrorHandler(log));

  return app;
}
