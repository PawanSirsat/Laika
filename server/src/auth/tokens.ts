import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type Logger } from '../log.ts';
import { presenceEnabled } from '../db/orgs.ts';
import { agents, tokens } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import {
  AGENT_CLIENTS,
  agentClientSlug,
  cleanClientName,
  isWeakClientName,
} from './agent-clients.ts';

/**
 * Personal access token secrets (SPEC §4.9, §13.1).
 *
 * Split from `services/tokens.ts` for the same reason `auth/invites.ts` is split
 * from `services/invites.ts`: minting is a service concern, but **recognising**
 * a presented credential is an auth concern, and LAI-403's middleware needs
 * `hashToken` without pulling in the whole CRUD surface.
 *
 * §4.9 is unambiguous about the shape: `lai_<40 base62>`, and *"the secret is
 * never stored and is shown exactly once, at creation"*. Only the hash and the
 * display prefix reach the database.
 */

/** §4.9's literal format. */
export const TOKEN_PREFIX = 'lai_';
export const TOKEN_SECRET_LENGTH = 40;

/** `prefix` in §4.9 — "first 8 chars, shown in the UI so a token is identifiable". */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 8;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * The largest multiple of 62 that fits in a byte.
 *
 * 256 is not a multiple of 62, so `randomBytes(n) % 62` is **biased**: bytes
 * 0–247 cover the alphabet four times over, and 248–255 wrap onto the first
 * eight characters, making them ~3% likelier than the rest. That is a small
 * amount of entropy given away for nothing, on the one value in this codebase
 * whose whole job is being unguessable — so bytes at or above this are
 * discarded and redrawn rather than folded.
 */
const UNBIASED_CEILING = 248;

/**
 * 40 base62 characters — about 238 bits, all of it from the CSPRNG.
 *
 * Nothing derived from the user, the clock or the id contributes: those are
 * discoverable by whoever wants to forge one. Same reasoning as
 * `newInviteToken`, which says the M3 tokens should be minted the same way.
 */
export function newTokenSecret(random: (size: number) => Uint8Array = randomBytes): string {
  let secret = '';

  while (secret.length < TOKEN_SECRET_LENGTH) {
    // Drawn a block at a time rather than byte by byte: rejection means the
    // number of bytes needed is not known in advance, and one syscall per
    // character would be the expensive way to find that out.
    //
    // `random` is injectable for one reason: rejection is invisible to a
    // statistical test at any sample size a suite can afford, so the only way to
    // prove a biased byte is *discarded* rather than folded is to hand one over
    // and look. Production always uses `randomBytes`.
    for (const byte of random(TOKEN_SECRET_LENGTH)) {
      if (byte >= UNBIASED_CEILING) continue;

      secret += BASE62.charAt(byte % 62);
      if (secret.length === TOKEN_SECRET_LENGTH) break;
    }
  }

  return TOKEN_PREFIX + secret;
}

/** Tokens are stored hashed, never in plaintext (§4.9, §13.1). */
export function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * The identifiable stub kept on the row.
 *
 * Taken from the **whole** token, so it reads `lai_` plus four characters —
 * §4.9 says "first 8 chars" and this is that, literally. Four distinguishing
 * characters is ample for telling apart the handful of tokens one person holds,
 * which is what the field is for; it is not, and is not used as, a lookup key.
 */
export function tokenDisplayPrefix(secret: string): string {
  return secret.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH);
}

// ----------------------------------------------------- presenting one (LAI-403)

/**
 * How long a token may go without its `last_used_at` being rewritten.
 *
 * SPEC §7.2 requires a read tool not to mutate on every call, and a token is
 * read on **every** request — an unthrottled write would turn `GET /tasks` into
 * a write, take the write lock, and make an agent's read traffic contend with
 * the board's actual work.
 *
 * A minute is enough resolution for "when was this last used" on a screen that
 * shows a date, and it collapses a busy agent's thousand requests into one write.
 */
export const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Does the presented "token" look like a variable that was never expanded?
 *
 * Every agent client has its own syntax for reading the token from the
 * environment (`${LAIKA_TOKEN}`, `{env:LAIKA_TOKEN}`, `$LAIKA_TOKEN`,
 * `${{ secrets.X }}`), and several send the text unchanged when the variable is
 * unset. Saying so turns a mystery 401 into a fix. It reveals nothing about any
 * stored token: it is a fact about the text the caller sent.
 */
export function looksLikePlaceholder(presented: string): boolean {
  return (
    /^\$\{.*\}$/.test(presented) ||
    /^\{\{?\s*env[:.].*\}\}?$/i.test(presented) ||
    /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(presented) ||
    /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(presented) ||
    /^<.*>$/.test(presented) ||
    /^lai_(\.\.\.|…)$/.test(presented)
  );
}

/** What a placeholder is told instead of "not valid". It never echoes the text. */
export const PLACEHOLDER_MESSAGE =
  'The Authorization header carries an unexpanded variable placeholder, not a token. Set the variable in the agent’s environment, or check how this client writes environment variables.';

/** Why a presented token was refused. Logged, never returned (§6.1). */
export type TokenRejection =
  | 'malformed'
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'inactive_user'
  // The token's registered agent is revoked (D-114, LAI-534).
  | 'agent_revoked';

/**
 * A refused token — `401`, with the reason **off the wire**.
 *
 * The reason is a field on the error, deliberately **not** in `details`:
 * `ApiError.toBody()` serialises `details` into the response, so putting it
 * there would tell an unauthenticated caller whether a token is unknown or
 * merely revoked — which distinguishes "this never existed" from "this existed",
 * free information about somebody else's token. Checked against `toBody()`
 * rather than assumed; the first draft of this had it in `details`.
 */
export class TokenAuthError extends ApiError {
  readonly reason: TokenRejection;

  constructor(reason: TokenRejection, message = 'That access token is not valid') {
    super('unauthorized', message);
    this.name = 'TokenAuthError';
    this.reason = reason;
  }
}

export interface TokenLookup {
  row: typeof tokens.$inferSelect;
}

/**
 * `Authorization: Bearer lai_…` → the row, or why not.
 *
 * **Looked up by hash**, never by scanning and comparing plaintext: the hash
 * column is uniquely indexed, so this is one indexed equality match whatever the
 * table size, and the plaintext never appears in a query.
 *
 * The final comparison is `timingSafeEqual` even though the lookup already
 * matched. That looks redundant and is not quite: it closes the gap between
 * "SQLite found a row for this hash" and "this hash is that row's hash", and it
 * costs one fixed-length compare on a path that already hit the disk.
 */
export function findTokenBySecret(
  db: Db,
  presented: string,
  now: number,
): { ok: true; row: typeof tokens.$inferSelect } | { ok: false; reason: TokenRejection } {
  if (
    !presented.startsWith(TOKEN_PREFIX) ||
    presented.length !== TOKEN_PREFIX.length + TOKEN_SECRET_LENGTH
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const presentedHash = hashToken(presented);
  const row = db.select().from(tokens).where(eq(tokens.tokenHash, presentedHash)).get();
  if (row === undefined) return { ok: false, reason: 'unknown' };

  const stored = Buffer.from(row.tokenHash, 'utf8');
  const offered = Buffer.from(presentedHash, 'utf8');
  // Length is checked first because `timingSafeEqual` throws on a mismatch. Both
  // are fixed-length hex, so this branch leaks nothing about the secret.
  if (stored.length !== offered.length || !timingSafeEqual(stored, offered)) {
    return { ok: false, reason: 'unknown' };
  }

  const rejected = lapsed(row, now);
  if (rejected !== null) return { ok: false, reason: rejected };

  return { ok: true, row };
}

/**
 * A token already presented once → its row again, or why it no longer holds.
 *
 * For a credential that outlives its request — an open event stream (LAI-539,
 * audit M10). The stream authenticated at connect and keeps the token's **id**,
 * never its secret, so this looks up by primary key and re-applies the same
 * revocation and expiry rules as `findTokenBySecret`, through the same
 * `lapsed`, so the two cannot disagree about what "still valid" means.
 */
export function findTokenById(
  db: Db,
  id: string,
  now: number,
): { ok: true; row: typeof tokens.$inferSelect } | { ok: false; reason: TokenRejection } {
  const row = db.select().from(tokens).where(eq(tokens.id, id)).get();
  if (row === undefined) return { ok: false, reason: 'unknown' };

  const rejected = lapsed(row, now);
  if (rejected !== null) return { ok: false, reason: rejected };

  return { ok: true, row };
}

/** Revoked, expired, or `null` while the row is still good at `now`. */
function lapsed(row: typeof tokens.$inferSelect, now: number): TokenRejection | null {
  if (row.revokedAt !== null) return 'revoked';
  if (row.expiresAt !== null && row.expiresAt <= now) return 'expired';
  return null;
}

/**
 * Has the read-only warning already been emitted for the current spell?
 *
 * Module scope on purpose. The AC is "logged, and **not once per request**" —
 * an unwritable database is hit by every authenticated call, and a line per
 * request buries the one that matters under thousands of copies.
 *
 * Reset by the next successful write, so a **recurrence** is reported again.
 * "Once per process" would announce the first outage and stay silent through
 * every later one, which is the version of this that looks the same and is
 * worse.
 */
let readOnlyReported = false;

/** Exposed so a test can assert the once-per-spell behaviour from a clean slate. */
export function resetReadOnlyWarning(): void {
  readOnlyReported = false;
}

/**
 * Stamp `last_used_at`, at most once per {@link LAST_USED_THROTTLE_MS}.
 *
 * Returns whether it wrote, so a test can assert the throttle rather than infer
 * it from a timestamp that happens not to have moved.
 *
 * ## A read-only database does not stop reads (LAI-156)
 *
 * This is the only write on the token read path, and `last_used_at` is
 * observability (§4.9) — nothing decides access on it. When the database cannot
 * be written, the stamp is skipped and the request continues.
 *
 * **This is the opposite of the call LAI-231 made for `ActivityFeed.poll()`, and
 * the difference is which signal is lost.** Swallowing there would hide the
 * *only* evidence that the feed had stopped delivering, and the feature would
 * fail silently. Here the primary operation — the read — is unaffected, and an
 * unwritable database is not a subtle condition: **every write request still
 * fails loudly at its own write.** One signal of many is muffled, and it is
 * muffled into a log line rather than into nothing.
 *
 * Before this, the failure mode was worse than either alternative: the throttle
 * above means a token used within the last minute writes nothing and served
 * fine, so a read-only instance **worked for sixty seconds after each token's
 * last use and then stopped.** A total outage that looks intermittent.
 *
 * **Only `SQLITE_READONLY`.** Classified by the error's `code`, not its message
 * and not "any failure here is fine" — LAI-437's lesson one file over. A
 * constraint violation or a corrupt page is a bug and still throws.
 */
export function touchTokenUsage(
  db: Db,
  row: typeof tokens.$inferSelect,
  now: number,
  log?: Logger,
): boolean {
  if (row.lastUsedAt !== null && now - row.lastUsedAt < LAST_USED_THROTTLE_MS) return false;

  try {
    db.update(tokens).set({ lastUsedAt: now }).where(eq(tokens.id, row.id)).run();
  } catch (err) {
    if (!isReadOnly(err)) throw err;

    if (!readOnlyReported) {
      readOnlyReported = true;
      log?.warn('token.last_used_unwritable', {
        message: err instanceof Error ? err.message : String(err),
        effect: 'reads continue; last_used_at is not being recorded',
      });
    }
    return false;
  }

  readOnlyReported = false;
  return true;
}

/** What {@link recordMcpUse} wrote, so a test can assert the throttle directly. */
export interface McpUseWrite {
  /** `last_mcp_at` was stamped. */
  mcp: boolean;
  /** `last_client` / `last_client_name` changed. */
  client: boolean;
}

/**
 * Record one authenticated `/mcp` request on its token (D-076).
 *
 * - `last_mcp_at` is stamped at most once per {@link LAST_USED_THROTTLE_MS},
 *   for the same reason `last_used_at` is: a busy agent's thousand calls are
 *   one write, not a thousand. §9.3's five-minute window is far wider than the
 *   throttle, so presence never misses a live agent because of it.
 * - **Not while the org has presence off** (§4.2). It is a presence signal, and
 *   LAI-150 stores no heartbeats while presence is off, so that turning it back
 *   on shows nothing from the time it was off. The org flag is read only when
 *   the throttle would otherwise write.
 * - `clientName` is `clientInfo.name` from an `initialize` request, and
 *   `undefined` on every other request. It is cleaned, turned into a slug, and
 *   written **only when it changed**.
 * - **A registered agent's token takes its harness from the agent** (D-120,
 *   LAI-1001): `agents.harness` is the slug, whatever the client said and
 *   whatever the token is called — an agent registered as `Polly` on
 *   `omnigent` is Omnigent, not `other`. The first-word rule below is for
 *   unregistered, legacy tokens only.
 *
 * Bookkeeping on the credential that was just presented, the same as
 * `touchTokenUsage`, which is why it lives here and asks `can()` nothing. It
 * decides nothing about access.
 *
 * A read-only database skips the write and lets the request through, as
 * `touchTokenUsage` does (LAI-156). That function logs the condition once per
 * spell; this one stays quiet rather than report it a second time.
 */
export function recordMcpUse(
  db: Db,
  tokenId: string,
  now: number,
  clientName: unknown,
): McpUseWrite {
  const row = db
    .select({
      name: tokens.name,
      lastMcpAt: tokens.lastMcpAt,
      lastClient: tokens.lastClient,
      lastClientName: tokens.lastClientName,
      agentHarness: agents.harness,
    })
    .from(tokens)
    .leftJoin(agents, eq(agents.id, tokens.agentId))
    .where(eq(tokens.id, tokenId))
    .get();
  if (row === undefined) return { mcp: false, client: false };
  const registered = AGENT_CLIENTS.find((slug) => slug === row.agentHarness);

  const set: Partial<typeof tokens.$inferInsert> = {};

  const mcp =
    (row.lastMcpAt === null || now - row.lastMcpAt >= LAST_USED_THROTTLE_MS) && presenceEnabled(db);
  if (mcp) set.lastMcpAt = now;

  let client = false;
  if (clientName !== undefined) {
    const name = cleanClientName(clientName);
    const slug = registered ?? agentClientSlug(name, row.name);
    // A weak name (`mcp`, `hermes-probe`) never replaces a client the token
    // already knows; it only fills a blank or an `other`. A registered
    // agent's slug is its harness, so only the name itself can be new.
    const known = row.lastClient !== null && row.lastClient !== 'other';
    const keep =
      isWeakClientName(name) &&
      known &&
      (registered === undefined || row.lastClient === registered);
    if (!keep && (name !== row.lastClientName || slug !== row.lastClient)) {
      set.lastClientName = name;
      set.lastClient = slug;
      client = true;
    }
  }

  if (!mcp && !client) return { mcp, client };

  try {
    db.update(tokens).set(set).where(eq(tokens.id, tokenId)).run();
  } catch (err) {
    if (!isReadOnly(err)) throw err;
    return { mcp: false, client: false };
  }

  return { mcp, client };
}

/**
 * Does this REST request count as presence (D-081)?
 *
 * **Only a write**: anything but `GET`, `HEAD` and `OPTIONS`. A script that
 * polls the board every minute with somebody's token would otherwise keep
 * them "online" for as long as it runs, and presence answers who is
 * *working*. An agent working the board writes: it claims, moves, comments
 * and finishes, and each of those keeps it present for §9.3's five minutes.
 *
 * **Only under `/api/`.** `/mcp` records itself (`recordMcpUse`), with the
 * client's name, and stamping it twice would say nothing new.
 */
export function restWriteCountsAsPresence(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  // **Telemetry is not somebody working** (LAI-773): an exporter posts every
  // minute for as long as a session is open, idle or not, so counting it
  // would keep a person "online" all day with nobody at the keyboard.
  if (path.startsWith('/api/v1/otlp/')) return false;
  return path.startsWith('/api/');
}

/**
 * Record one token-authenticated REST write on its token (D-081).
 *
 * The REST twin of {@link recordMcpUse}, under the same rules: stamped at most
 * once per {@link LAST_USED_THROTTLE_MS}, **not while the org has presence
 * off** (the org flag is read only when the throttle would otherwise write),
 * and a read-only database skips the write and lets the request through. It
 * names no client: the token's agent is `clientOf(last_client, name)`, as for
 * a heartbeat. A revoked or expired token never gets here — the resolver
 * refused it — and presence drops one that stops being usable afterwards.
 *
 * Returns whether it wrote, so a test can assert the throttle directly. The
 * caller ignores any failure: a lost stamp costs one presence update, and a
 * request refused for it would cost the write.
 */
export function recordRestWrite(db: Db, tokenId: string, now: number): boolean {
  const row = db
    .select({ lastRestWriteAt: tokens.lastRestWriteAt })
    .from(tokens)
    .where(eq(tokens.id, tokenId))
    .get();
  if (row === undefined) return false;

  if (row.lastRestWriteAt !== null && now - row.lastRestWriteAt < LAST_USED_THROTTLE_MS) {
    return false;
  }
  if (!presenceEnabled(db)) return false;

  try {
    db.update(tokens).set({ lastRestWriteAt: now }).where(eq(tokens.id, tokenId)).run();
  } catch (err) {
    if (!isReadOnly(err)) throw err;
    return false;
  }
  return true;
}

/** better-sqlite3 reports the reason in `code`; the message is prose. */
function isReadOnly(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_READONLY');
}

/** `project_ids_json` → the whitelist `can()` reads, or `null` for unscoped. */
export function tokenProjectIds(row: typeof tokens.$inferSelect): readonly string[] | null {
  if (row.projectIdsJson === null) return null;

  try {
    const parsed: unknown = JSON.parse(row.projectIdsJson);
    // A whitelist we cannot read is an **empty** whitelist, not an absent one.
    // `null` here would widen the token to every project — the one direction a
    // parse failure must never move.
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
