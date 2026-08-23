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
  /** Signs session cookies and derives the AES key of §12. Required. */
  readonly serverSecret: string;
  readonly publicUrl: string;
  /** `Secure` cookies need HTTPS; localhost is the documented exception (§6.1). */
  readonly secureCookies: boolean;
  /**
   * Where the built SPA is served from. Defaults to `server/public` (§11.4).
   *
   * Overridable so a test can point the server at a directory it controls
   * instead of depending on whether the developer running it happens to have
   * built the SPA — see LAI-204.
   */
  readonly publicDir: string | undefined;
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

const DEV_SECRET = 'laika-development-secret-not-for-production-use';

/**
 * `SERVER_SECRET` (SPEC §11.7, §12).
 *
 * Required in production and refused if short — it signs session cookies and
 * derives the key that encrypts the org's API keys, so a guessable value is a
 * full compromise rather than a weak default. Outside production a fixed
 * development value is used so `pnpm dev` and the tests start without ceremony.
 */
function resolveServerSecret(source: NodeJS.ProcessEnv, nodeEnv: Env['nodeEnv']): string {
  const secret = source.SERVER_SECRET;

  if (secret !== undefined && secret !== '') {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new EnvError(
        'SERVER_SECRET',
        '<redacted>',
        `at least ${String(MIN_SECRET_LENGTH)} characters`,
      );
    }
    return secret;
  }

  if (nodeEnv === 'production') {
    throw new EnvError(
      'SERVER_SECRET',
      '<unset>',
      'a value in production — refusing to start insecurely',
    );
  }

  return DEV_SECRET;
}

const MIN_SECRET_LENGTH = 32;

const DEFAULT_PUBLIC_URL = 'http://localhost:3000';

function isLocalUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === 'https:' ? false : hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = parseNodeEnv(source.NODE_ENV);
  const publicUrl =
    source.PUBLIC_URL === undefined || source.PUBLIC_URL === ''
      ? DEFAULT_PUBLIC_URL
      : source.PUBLIC_URL;

  return {
    port: parsePort(source.PORT),
    host: source.HOST === undefined || source.HOST === '' ? DEFAULT_HOST : source.HOST,
    nodeEnv,
    dbPath: resolveDbPath(source, nodeEnv),
    serverSecret: resolveServerSecret(source, nodeEnv),
    publicUrl,
    secureCookies: !isLocalUrl(publicUrl),
    publicDir:
      source.LAIKA_PUBLIC_DIR === undefined || source.LAIKA_PUBLIC_DIR === ''
        ? undefined
        : resolve(source.LAIKA_PUBLIC_DIR),
  };
}
