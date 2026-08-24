import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
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
import { meRoutes } from './http/routes/me.ts';
import { setupRoutes } from './http/routes/setup.ts';
import { projectRoutes } from './http/routes/projects.ts';
import { projectSprintRoutes, sprintRoutes } from './http/routes/sprints.ts';
import { projectTaskRoutes, taskRoutes } from './http/routes/tasks.ts';
import { activityRoutes, projectActivityRoutes } from './http/routes/activity.ts';
import { commentRoutes, taskCommentRoutes } from './http/routes/comments.ts';
import { eventRoutes } from './http/routes/events.ts';
import { setupGate } from './http/middleware/setup-gate.ts';
import { setupRequired } from './services/setup.ts';
import { AUTH_BASE_PATH, type Auth } from './auth/auth.ts';
import { type Db } from './db/client.ts';
import { ActivityFeed } from './services/activity-feed.ts';
import { createSpaHandler, createStaticHandler, isReservedPath } from './http/static.ts';
import { allowedMethodsFor } from './http/allowed-methods.ts';

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
  logger?: Logger;
  /**
   * Auth and the database. Optional so the HTTP-level tests of LAI-002 can build
   * an app without standing up a database — those routes do not touch either.
   */
  auth?: Auth;
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
    app.route(`${API_BASE}/projects`, projectRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/tasks`, taskCommentRoutes({ db }));
    app.route(`${API_BASE}/tasks`, taskRoutes({ db, sqlite: options.sqlite }));
    app.route(`${API_BASE}/comments`, commentRoutes({ db }));
    app.route(`${API_BASE}/sprints`, sprintRoutes({ db, sqlite: options.sqlite }));
  }

  // better-auth owns everything under /api/v1/auth (§6.4). Mounted with `on`
  // rather than `route` so every method and sub-path reaches its handler.
  if (options.auth !== undefined) {
    const configuredAuth = options.auth;
    app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => configuredAuth.handler(c.req.raw));
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
