/**
 * Process entry point: read the environment, build the app, bind the port, and
 * wire signal handling. Everything interesting lives in `app.ts` — this file is
 * the part that cannot be exercised by Hono's test client, so it is kept as thin
 * as it can be (SPEC §11.1).
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { readEnv } from './env.ts';
import { createLogger } from './log.ts';
import { createShutdownHandler } from './shutdown.ts';
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

  const app = createApp({ version, logger: log });

  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
    log.info('server.listening', {
      port: info.port,
      host: env.host,
      version,
      node_env: env.nodeEnv,
      pid: process.pid,
    });
  });

  const shutdown = createShutdownHandler({
    server,
    log,
    // Checkpoints the WAL and releases the file lock, so the next boot does not
    // start by recovering a journal.
    onClosed: () => {
      sqlite.close();
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
