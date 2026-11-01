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
  /** Only an `https://` public URL gets `Secure` cookies (LAI-811); see `isHttpsUrl`. */
  readonly secureCookies: boolean;
  /**
   * Where the built SPA is served from. Defaults to `server/public` (§11.4).
   *
   * Overridable so a test can point the server at a directory it controls
   * instead of depending on whether the developer running it happens to have
   * built the SPA — see LAI-204.
   */
  readonly publicDir: string | undefined;
  /**
   * The claim timings of §9.1 (proposal §4.2, LAI-541), in milliseconds —
   * each its own `LAIKA_CLAIM_*_SECONDS` variable, defaulting to the
   * proposal's 30 s / 90 s / 5 min / 30 s.
   */
  readonly claims: {
    heartbeatMs: number;
    suspectMs: number;
    expireMs: number;
    scanMs: number;
  };
  /**
   * The checkpoint windows (§9.1.1, D-115 item 9, LAI-1015), in milliseconds:
   * `LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS` and
   * `LAIKA_CHECKPOINT_RETENTION_DAYS`, defaulting to 10 min and 90 days.
   */
  readonly checkpoints: {
    pendingNoticeMs: number;
    retentionMs: number;
  };
  /**
   * `LAIKA_BUILD_COMMIT` (LAI-1043): the git commit the image was built from,
   * injected by the Docker build. `null` when unset — a checkout run with
   * `pnpm dev`, or an image built by hand without the build arg.
   */
  readonly buildCommit: string | null;
  /** `LAIKA_DEVELOPER_ACCESS` (LAI-1043): which Developer access the web shows. */
  readonly developerAccess: DeveloperAccessMode;
  /**
   * `LAIKA_CLI_SOURCE_URL` (LAI-1043): the git repository a developer's `laika`
   * checkout is cloned from, served by `GET /developer/compatibility`.
   */
  readonly cliSourceUrl: string;
}

/**
 * `classic` is today's five tabs, `preview` adds the V3 tabs beside them, `v3`
 * makes them the default (the LAI-1042 plan, §I). Rollback is setting it back
 * and restarting: nothing it gates is stored.
 */
export const DEVELOPER_ACCESS_MODES = ['classic', 'preview', 'v3'] as const;
export type DeveloperAccessMode = (typeof DEVELOPER_ACCESS_MODES)[number];

/** Where the CLI comes from when `LAIKA_CLI_SOURCE_URL` is unset: this repository. */
export const DEFAULT_CLI_SOURCE_URL = 'https://github.com/PawanSirsat/Laika.git';

/** §9.1's defaults, in seconds (LAI-541). */
const CLAIM_DEFAULT_SECONDS = { heartbeat: 30, suspect: 90, expire: 300, scan: 30 } as const;

function parseWhole(
  variable: string,
  raw: string | undefined,
  fallback: number,
  unit: string,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  // The shape first, as `PORT` does: `Number()` would take `1e3` and ` 30 `.
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    throw new EnvError(variable, raw, `a whole number of ${unit} between 1 and ${String(max)}`);
  }
  return Number(raw);
}

function parseSeconds(variable: string, raw: string | undefined, fallback: number): number {
  return parseWhole(variable, raw, fallback, 'seconds', 86_400);
}

/** §9.1.1's 10 minutes and D-115 item 9's 90 days (LAI-1015). */
const CHECKPOINT_DEFAULTS = { pendingNoticeSeconds: 600, retentionDays: 90 } as const;

/**
 * `LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS` and
 * `LAIKA_CHECKPOINT_RETENTION_DAYS` (§11.7). Takes the raw values rather than
 * the source: `readEnv` reads them before the claim timings are judged, so a
 * bad claim value still leaves these read — what `env-contract.test.ts`
 * measures.
 */
function parseCheckpointWindows(raw: {
  pendingNotice: string | undefined;
  retention: string | undefined;
}): Env['checkpoints'] {
  const pendingNotice = parseSeconds(
    'LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS',
    raw.pendingNotice,
    CHECKPOINT_DEFAULTS.pendingNoticeSeconds,
  );
  const retention = parseWhole(
    'LAIKA_CHECKPOINT_RETENTION_DAYS',
    raw.retention,
    CHECKPOINT_DEFAULTS.retentionDays,
    'days',
    3650,
  );
  return { pendingNoticeMs: pendingNotice * 1000, retentionMs: retention * 86_400_000 };
}

/**
 * `LAIKA_CLAIM_*_SECONDS` (§11.7). One cross-check: a claim that lapses before
 * its next heartbeat is due would expire while its session is perfectly well,
 * so the expiry must be longer than the heartbeat.
 *
 * All four are read before any is judged, so a bad first one still leaves the
 * others read — what `env-contract.test.ts` measures.
 */
function readClaimTimings(source: NodeJS.ProcessEnv): Env['claims'] {
  const raw = {
    heartbeat: source.LAIKA_CLAIM_HEARTBEAT_SECONDS,
    suspect: source.LAIKA_CLAIM_SUSPECT_SECONDS,
    expire: source.LAIKA_CLAIM_EXPIRE_SECONDS,
    scan: source.LAIKA_CLAIM_SCAN_SECONDS,
  };
  const heartbeat = parseSeconds(
    'LAIKA_CLAIM_HEARTBEAT_SECONDS',
    raw.heartbeat,
    CLAIM_DEFAULT_SECONDS.heartbeat,
  );
  const suspect = parseSeconds(
    'LAIKA_CLAIM_SUSPECT_SECONDS',
    raw.suspect,
    CLAIM_DEFAULT_SECONDS.suspect,
  );
  const expire = parseSeconds(
    'LAIKA_CLAIM_EXPIRE_SECONDS',
    raw.expire,
    CLAIM_DEFAULT_SECONDS.expire,
  );
  const scan = parseSeconds('LAIKA_CLAIM_SCAN_SECONDS', raw.scan, CLAIM_DEFAULT_SECONDS.scan);
  if (expire <= heartbeat) {
    throw new EnvError(
      'LAIKA_CLAIM_EXPIRE_SECONDS',
      String(expire),
      `more seconds than LAIKA_CLAIM_HEARTBEAT_SECONDS (${String(heartbeat)})`,
    );
  }
  return {
    heartbeatMs: heartbeat * 1000,
    suspectMs: suspect * 1000,
    expireMs: expire * 1000,
    scanMs: scan * 1000,
  };
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

/**
 * Whether the public URL is `https://`, which is when the session cookie is
 * marked `Secure` (LAI-811).
 *
 * The host does not enter into it. This used to answer "anything but
 * localhost", which made `secureCookies` true for `http://<IP>`. Browsers
 * accept a `Secure` cookie from `http://localhost`, which they treat as
 * trustworthy, but not from `http://<IP>` or any other plain-http host, so
 * nobody could have signed in on production had better-auth been reading the
 * flag. It was not; see `auth.ts`.
 */
function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * `LAIKA_BUILD_COMMIT`: unset or empty is `null`; otherwise a 7–40 character
 * lowercase hex commit id, or the server refuses to start. A wrong value here is
 * a broken build step, and a board that reports a commit it was not built from
 * would send every developer's `laika update` to the wrong place.
 */
function parseBuildCommit(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (!/^[0-9a-f]{7,40}$/.test(raw)) {
    throw new EnvError('LAIKA_BUILD_COMMIT', raw, 'a git commit id: 7 to 40 lowercase hex digits');
  }
  return raw;
}

function parseDeveloperAccess(raw: string | undefined): DeveloperAccessMode {
  if (raw === undefined || raw === '') return 'classic';
  const mode = DEVELOPER_ACCESS_MODES.find((m) => m === raw);
  if (mode === undefined) {
    throw new EnvError(
      'LAIKA_DEVELOPER_ACCESS',
      raw,
      `one of ${DEVELOPER_ACCESS_MODES.map((m) => `'${m}'`).join(', ')}`,
    );
  }
  return mode;
}

/**
 * `LAIKA_CLI_SOURCE_URL`: an `https://` URL with **no credentials in it**. It is
 * served to anyone who asks, so a URL carrying a user or a token would publish
 * that secret; refusing it at boot keeps it out of every response. The value is
 * redacted from the error for the same reason.
 */
function parseCliSourceUrl(raw: string | undefined): string {
  if (raw === undefined || raw === '') return DEFAULT_CLI_SOURCE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvError('LAIKA_CLI_SOURCE_URL', '<redacted>', 'an https:// git repository URL');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new EnvError(
      'LAIKA_CLI_SOURCE_URL',
      '<redacted>',
      'an https:// git repository URL with no user or password in it',
    );
  }
  return raw;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = parseNodeEnv(source.NODE_ENV);
  const port = parsePort(source.PORT);
  const publicUrl = resolvePublicUrl(source, nodeEnv, port);
  const checkpointRaw = {
    pendingNotice: source.LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS,
    retention: source.LAIKA_CHECKPOINT_RETENTION_DAYS,
  };
  // Read before the claim timings are judged, as the checkpoint windows are, so
  // a bad claim value still leaves these read (`env-contract.test.ts`).
  const buildRaw = {
    commit: source.LAIKA_BUILD_COMMIT,
    developerAccess: source.LAIKA_DEVELOPER_ACCESS,
    cliSourceUrl: source.LAIKA_CLI_SOURCE_URL,
  };

  return {
    port,
    host: source.HOST === undefined || source.HOST === '' ? DEFAULT_HOST : source.HOST,
    nodeEnv,
    dbPath: resolveDbPath(source, nodeEnv),
    serverSecret: resolveServerSecret(source),
    publicUrl,
    secureCookies: isHttpsUrl(publicUrl),
    publicDir:
      source.LAIKA_PUBLIC_DIR === undefined || source.LAIKA_PUBLIC_DIR === ''
        ? undefined
        : resolve(source.LAIKA_PUBLIC_DIR),
    claims: readClaimTimings(source),
    checkpoints: parseCheckpointWindows(checkpointRaw),
    buildCommit: parseBuildCommit(buildRaw.commit),
    developerAccess: parseDeveloperAccess(buildRaw.developerAccess),
    cliSourceUrl: parseCliSourceUrl(buildRaw.cliSourceUrl),
  };
}
