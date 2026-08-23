import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createLogger, type Logger } from './log.ts';
import { FALLBACK_DOCUMENT, PUBLIC_DIR } from './paths.ts';
import { type AppEnv } from './http/context.ts';
import { createErrorHandler } from './http/error-handler.ts';
import { ApiError } from './http/errors.ts';
import { anonymousAuth, authMiddleware } from './http/middleware/auth.ts';
import { errorBoundary } from './http/middleware/error-boundary.ts';
import { requestLogger } from './http/middleware/logger.ts';
import { rateLimit } from './http/middleware/rate-limit.ts';
import { requestId } from './http/middleware/request-id.ts';
import { healthRoutes } from './http/routes/health.ts';
import { meRoutes } from './http/routes/me.ts';
import { AUTH_BASE_PATH, type Auth } from './auth/auth.ts';
import { type Db } from './db/client.ts';
import { createSpaHandler, createStaticHandler, isReservedPath } from './http/static.ts';

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
  const staticOptions = {
    publicDir: options.publicDir ?? PUBLIC_DIR,
    fallbackDocument: options.fallbackDocument ?? FALLBACK_DOCUMENT,
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
  app.use('*', bodyLimit({ maxSize: BODY_LIMIT_BYTES }));
  // SPEC §11.2 position. Real when auth is configured, pass-through otherwise;
  // either way an anonymous request continues with `actor: null` rather than 401.
  app.use(
    '*',
    options.auth !== undefined && options.db !== undefined
      ? authMiddleware({ auth: options.auth, db: options.db })
      : anonymousAuth,
  );
  app.use('*', rateLimit);

  // Routes before the static handler: whoever matches first wins, and the SPA
  // fallback must never shadow an API path.
  app.route(`${API_BASE}/health`, healthRoutes(options.version));
  app.route(`${API_BASE}/me`, meRoutes());

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
      throw ApiError.notFound(`No route for ${c.req.method} ${c.req.path}`);
    }
    return spa(c);
  });

  app.onError(createErrorHandler(log));

  return app;
}
