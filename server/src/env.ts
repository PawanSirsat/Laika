/**
 * Environment parsing, done once at boot so a bad value fails immediately with a
 * readable message instead of surfacing as a confusing runtime error later.
 *
 * SPEC §11.7 is the deployment contract (D-018): everything the server reads is
 * in that table, and everything in that table is read. The one exception today is
 * `LAIKA_DISABLE_INVITE_ONLY`, which is documented and read by nothing — see
 * LAI-105.
 *
 * **Naming (D-018):** Laika-specific variables carry the `LAIKA_` prefix; `PORT`,
 * `HOST` and `NODE_ENV` do not, because they are universal conventions and
 * prefixing them would surprise. The prefix is collision safety — `DATA_DIR` and
 * `SERVER_SECRET` are generic enough to already mean something else in a shared
 * compose file or systemd unit.
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
 *  2. `LAIKA_DATA_DIR` — §11.7's variable; the database sits alongside `backups/` and
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

  const dataDir = source.LAIKA_DATA_DIR;
  if (dataDir !== undefined && dataDir !== '') {
    return join(resolve(dataDir), DB_FILENAME);
  }

  if (nodeEnv !== 'production' && !isWritableDir(DEFAULT_DATA_DIR)) {
    return resolve('./data', DB_FILENAME);
  }

  return join(DEFAULT_DATA_DIR, DB_FILENAME);
}

/**
 * `LAIKA_SECRET` (SPEC §11.7, §12, D-018).
 *
 * **Required in every environment. No default, no auto-generation, no
 * development fallback.** It signs session cookies and derives the key that
 * encrypts the org's API keys.
 *
 * D-018 chose "required" over "auto-generate" because the failure is asymmetric.
 * A required secret fails once, at install, with a message naming the fix. An
 * auto-generated one succeeds until `$LAIKA_DATA_DIR` is lost or restored onto a
 * new host — at which point every session is invalid and every `*_enc` column is
 * permanently undecryptable, **with nothing saying that is what happened**. The
 * operator's own backup is what betrays them. One loud failure now is cheaper
 * than a silent one at restore time.
 *
 * The value is redacted from the error: a startup message naming a secret ends up
 * in logs, terminals and screenshots.
 */
function resolveServerSecret(source: NodeJS.ProcessEnv): string {
  const secret = source.LAIKA_SECRET;

  if (secret === undefined || secret === '') {
    throw new EnvError(
      'LAIKA_SECRET',
      '<unset>',
      `a value of at least ${String(MIN_SECRET_LENGTH)} characters — refusing to start without one`,
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new EnvError(
      'LAIKA_SECRET',
      '<redacted>',
      `at least ${String(MIN_SECRET_LENGTH)} characters`,
    );
  }

  return secret;
}

const MIN_SECRET_LENGTH = 32;

/**
 * `LAIKA_PUBLIC_URL` (SPEC §11.7).
 *
 * Required in production, defaulting to `http://localhost:$PORT` elsewhere. The
 * default is deliberately not available in production: it goes into invite links
 * and webhook URLs, so one escaping into a deployment sends people links to their
 * own laptop — which fails in a way that looks like a mail problem rather than a
 * configuration one.
 */
function resolvePublicUrl(
  source: NodeJS.ProcessEnv,
  nodeEnv: Env['nodeEnv'],
  port: number,
): string {
  const url = source.LAIKA_PUBLIC_URL;

  if (url !== undefined && url !== '') return url;

  if (nodeEnv === 'production') {
    throw new EnvError(
      'LAIKA_PUBLIC_URL',
      '<unset>',
      'a value in production — invite links and webhook URLs are built from it',
    );
  }

  return `http://localhost:${String(port)}`;
}

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
  const port = parsePort(source.PORT);
  const publicUrl = resolvePublicUrl(source, nodeEnv, port);

  return {
    port,
    host: source.HOST === undefined || source.HOST === '' ? DEFAULT_HOST : source.HOST,
    nodeEnv,
    dbPath: resolveDbPath(source, nodeEnv),
    serverSecret: resolveServerSecret(source),
    publicUrl,
    secureCookies: !isLocalUrl(publicUrl),
    publicDir:
      source.LAIKA_PUBLIC_DIR === undefined || source.LAIKA_PUBLIC_DIR === ''
        ? undefined
        : resolve(source.LAIKA_PUBLIC_DIR),
  };
}
