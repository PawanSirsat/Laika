/**
 * Print better-auth's **resolved** posture for whatever `NODE_ENV` this process
 * was started with (LAI-096).
 *
 * A child process, because `@better-auth/core` captures `NODE_ENV` into a
 * module-level constant at import time:
 *
 * ```js
 * const nodeENV = env.NODE_ENV ?? '';
 * const isProduction = nodeENV === 'production';
 * ```
 *
 * So a test cannot change it in-process — reassigning `process.env.NODE_ENV`
 * after the import does nothing, and a test that tried would pass while
 * measuring the environment vitest set. The only honest way to know what
 * `production` and `development` actually resolve to is to go and be them.
 */

import { createAuth } from '../../src/auth/auth.ts';
import { freshDb } from './db.ts';

const t = freshDb();

const auth = createAuth({
  db: t.db,
  sqlite: t.sqlite,
  secret: 'a-probe-secret-that-is-long-enough-to-pass',
  baseUrl: 'http://localhost:3000',
  secureCookies: false,
});

const context = await auth.$context;

process.stdout.write(
  `${JSON.stringify({
    nodeEnv: process.env.NODE_ENV ?? null,
    skipOriginCheck: context.skipOriginCheck,
    skipCSRFCheck: context.skipCSRFCheck,
    rateLimitEnabled: context.rateLimit.enabled,
    trustsForeignOrigin: context.isTrustedOrigin('https://evil.example'),
    trustsLoopback: context.isTrustedOrigin('http://127.0.0.1:3000'),
  })}\n`,
);

t.close();
