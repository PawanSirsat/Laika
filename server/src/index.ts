/**
 * Process entry point: read the environment, build the app, bind the port, and
 * wire signal handling. Everything interesting lives in `app.ts` — this file is
 * the part that cannot be exercised by Hono's test client, so it is kept as thin
 * as it can be (SPEC §11.1).
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { openDb } from './db/client.ts';
import { dirname, join } from 'node:path';
import { runMigrations } from './db/migrate.ts';
import { startScheduler } from './jobs/scheduler.ts';
import { readEnv } from './env.ts';
import { createLogger } from './log.ts';
import { ActivityFeed } from './services/activity-feed.ts';
import { createRuntimeShutdown } from './shutdown.ts';
import { readVersion } from './version.ts';

function main(): void {
  const log = createLogger();
  const env = readEnv();
  const version = readVersion();

  // Migrations run at boot, forward-only (SPEC §11.3). Before the port is bound:
  // a server that accepts requests against an unmigrated database is worse than
  // one that takes an extra moment to start.
  const { db, sqlite } = openDb({ path: env.dbPath });
  runMigrations(db);
  log.info('db.ready', { path: env.dbPath });

  const auth = createAuth({
    db,
    sqlite,
    secret: env.serverSecret,
    baseUrl: env.publicUrl,
    secureCookies: env.secureCookies,
  });

  // Built here rather than inside `createApp` because the shutdown handler needs
  // the same instance to close the streams it is feeding.
  const activityFeed = new ActivityFeed({ db });

  // Flipped by the shutdown handler's `onStopping`, read by every API request.
  let stopping = false;

  const app = createApp({
    version,
    isStopping: () => stopping,
    logger: log,
    auth,
    db,
    sqlite,
    activityFeed,
    publicUrl: env.publicUrl,
    ...(env.publicDir === undefined ? {} : { publicDir: env.publicDir }),
  });

  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
    log.info('server.listening', {
      port: info.port,
      host: env.host,
      version,
      node_env: env.nodeEnv,
      pid: process.pid,
    });
  });

  // The wiring lives in `shutdown.ts` so it is reachable from a test (LAI-057).
  // It used to be four lines here, in a function nothing can call — and during
  // the LAI-048 review `onStopping` was replaced with a comment and every test
  // still passed.
  // §11.6's cron. After the port is bound — a job is not a reason to delay
  // serving — and handed to the shutdown path, which stops it with the streams.
  const scheduler = startScheduler({
    db,
    sqlite,
    log,
    backupDir: join(dirname(env.dbPath), 'backups'),
  });

  const shutdown = createRuntimeShutdown({
    server,
    log,
    activityFeed,
    sqlite,
    scheduler,
    markStopping: () => {
      stopping = true;
    },
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

try {
  main();
} catch (err) {
  // Boot failures are the one place a bare message to stderr beats structured
  // logging: whoever is reading this is looking at a container that will not
  // start, and they need the reason on the first line.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
