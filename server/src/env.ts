/**
 * Environment parsing, done once at boot so a bad value fails immediately with a
 * readable message instead of surfacing as a confusing runtime error later.
 *
 * SPEC §11.7 lists more variables than this (`SERVER_SECRET`, `PUBLIC_URL`,
 * `DISABLE_INVITE_ONLY`). They are deliberately absent: nothing reads them yet,
 * and a variable parsed here but unused is a variable whose validation nobody has
 * tested. They arrive with the tasks that need them (LAI-005 and later).
 */

import { accessSync, constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface Env {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly dbPath: string;
}

const DEFAULT_PORT = 3000;

/** Binding 0.0.0.0 is what makes the container reachable from outside it. */
const DEFAULT_HOST = '0.0.0.0';

export class EnvError extends Error {
  constructor(variable: string, value: string, expected: string) {
    super(`Invalid ${variable}: ${JSON.stringify(value)}. Expected ${expected}.`);
    this.name = 'EnvError';
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;

  // Number() accepts '' , '0x10' and ' 12 '; none of those are a port anyone
  // meant to type, so match the shape first and convert second.
  if (!/^\d+$/.test(raw)) throw new EnvError('PORT', raw, 'an integer between 1 and 65535');

  const port = Number(raw);
  if (port < 1 || port > 65535) throw new EnvError('PORT', raw, 'an integer between 1 and 65535');

  return port;
}

function parseNodeEnv(raw: string | undefined): Env['nodeEnv'] {
  if (raw === undefined || raw === '') return 'production';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new EnvError('NODE_ENV', raw, "one of 'development', 'test', 'production'");
}

const DEFAULT_DATA_DIR = '/data';
const DB_FILENAME = 'laika.db';

/** `/data` is writable in the container and almost never on a developer's Mac. */
function isWritableDir(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the SQLite file (SPEC §11.7, LAI-003).
 *
 * Precedence, most specific first:
 *  1. `LAIKA_DB_PATH` — an explicit path wins outright. This is what
 *     `docker-compose.yml` sets (LAI-008).
 *  2. `DATA_DIR` — §11.7's variable; the database sits alongside `backups/` and
 *     `secret` in the same volume.
 *  3. `/data/laika.db` — the documented default.
 *  4. `./data/laika.db` — **only outside production**, and only when `/data` is
 *     not writable. Without this a developer's first `pnpm dev` fails on a
 *     permission error at a path they never chose. In production the fallback is
 *     refused: silently writing the database into a container's working
 *     directory is how data ends up outside the volume that gets backed up.
 */
function resolveDbPath(source: NodeJS.ProcessEnv, nodeEnv: Env['nodeEnv']): string {
  const explicit = source.LAIKA_DB_PATH;
  if (explicit !== undefined && explicit !== '') {
    return isAbsolute(explicit) ? explicit : resolve(explicit);
  }

  const dataDir = source.DATA_DIR;
  if (dataDir !== undefined && dataDir !== '') {
    return join(resolve(dataDir), DB_FILENAME);
  }

  if (nodeEnv !== 'production' && !isWritableDir(DEFAULT_DATA_DIR)) {
    return resolve('./data', DB_FILENAME);
  }

  return join(DEFAULT_DATA_DIR, DB_FILENAME);
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = parseNodeEnv(source.NODE_ENV);

  return {
    port: parsePort(source.PORT),
    host: source.HOST === undefined || source.HOST === '' ? DEFAULT_HOST : source.HOST,
    nodeEnv,
    dbPath: resolveDbPath(source, nodeEnv),
  };
}
