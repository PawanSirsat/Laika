import type Database from 'better-sqlite3';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { hashToken, newTokenSecret, tokenDisplayPrefix } from '../auth/tokens.ts';
import { activityActor, type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { requireOrgId } from '../db/orgs.ts';
import { type TokenScope } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { projects, tokens, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, forcedTokenScope } from '../policy/can.ts';
import { canSeeProject } from './projects.ts';

/**
 * Personal access tokens — mint, list, revoke (SPEC §4.9, §6.4, LAI-402).
 *
 * A token is how an agent proves it is acting **as a person**. Everything M3
 * does rests on this, and nothing in the codebase used the `tokens` table or the
 * five `can()` actions until now.
 *
 * ## This module mints; it does not authenticate
 *
 * Presenting a token on a request is LAI-403, deliberately separate. Minting is
 * a session-authenticated CRUD surface; authenticating is middleware on every
 * request. `auth/tokens.ts` holds the two functions both halves need.
 *
 * ## The secret exists in exactly one place, once
 *
 * `createToken` returns it and nothing else ever can: only `token_hash` and the
 * eight-character display `prefix` are written. There is no recovery path, no
 * second read, and no log line — §4.9 says *"shown exactly once, at creation"*
 * and that is a property of the storage, not a promise made by the UI.
 */

/**
 * Re-exported so the route can validate `scope` without importing `db/`, which
 * CONVENTIONS §2 forbids and `no-restricted-imports` enforces.
 *
 * The same line, for the same reason, as `ORG_ROLES` on `services/invites.ts`:
 * the alternative is a second copy of a closed vocabulary in the route file,
 * and nothing checks a copy against the original. LAI-119 is converging the
 * two places that still do that.
 */
export { TOKEN_SCOPES } from '../db/enums.ts';

/** One token as it goes over the wire. Never the secret, never the hash. */
export interface TokenView {
  id: string;
  name: string;
  /** `lai_` plus four characters — enough to tell your own tokens apart (§4.9). */
  prefix: string;
  scope: TokenScope;
  /** `null` = every project the user can reach. Otherwise a whitelist (§4.9). */
  project_ids: string[] | null;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export interface CreatedToken {
  token: TokenView;
  /**
   * The plaintext, returned once and never recoverable.
   *
   * This field is the **only** carrier. If it is ever added to `TokenView`, or
   * logged, or written to a column, §4.9's guarantee is gone — and gone
   * retroactively, because the rows are already there.
   */
  secret: string;
}

type TokenRow = typeof tokens.$inferSelect;

/**
 * Row → view.
 *
 * `tokenHash` is dropped here by construction rather than by remembering to omit
 * it: the object is built field by field, so a column added to the table does
 * not appear on the wire until someone writes the line that puts it there.
 */
function toView(row: TokenRow): TokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    project_ids: parseProjectIds(row.projectIdsJson),
    last_used_at: row.lastUsedAt,
    expires_at: row.expiresAt,
    revoked_at: row.revokedAt,
    created_at: row.createdAt,
  };
}

function parseProjectIds(raw: string | null): string[] | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : null;
  } catch {
    // A row we cannot parse is reported as unscoped rather than throwing: the
    // list endpoint should not 500 because one row is malformed. `can()` reads
    // the same column through its own path and errs closed there, which is the
    // side that matters.
    return null;
  }
}

export interface CreateTokenInput {
  name: string;
  scope: TokenScope;
  /** `null` or absent = all of the user's projects. */
  projectIds?: readonly string[] | null | undefined;
  expiresAt?: number | null | undefined;
  now?: number;
}

/**
 * Mint one.
 *
 * The scope is **forced**, not validated: §3.1 grants an org viewer "Generate
 * own tokens (`read_only` forced)", so a viewer asking for `full` gets a
 * `read_only` token rather than a `400`. Refusing would be a worse reading of
 * that cell — it says the scope is forced, not that the request is illegal —
 * and `forcedTokenScope` is the same function `can()` uses, so the two cannot
 * disagree about what a viewer's token is worth.
 */
export function createToken(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  input: CreateTokenInput,
): CreatedToken {
  assertCan(actor, 'token.create_own');

  const now = input.now ?? Date.now();
  const name = input.name.trim();
  if (name === '') {
    throw new ApiError('unprocessable', 'A token needs a name', { name: input.name });
  }

  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && expiresAt <= now) {
    throw new ApiError('unprocessable', 'expires_at must be in the future', {
      expires_at: expiresAt,
      now,
    });
  }

  const projectIds = assertReadableProjects(db, actor, input.projectIds ?? null);
  const scope = forcedTokenScope(actor.orgRole, input.scope);

  const secret = newTokenSecret();
  const row: TokenRow = {
    id: newId(),
    userId: actor.userId,
    name,
    prefix: tokenDisplayPrefix(secret),
    tokenHash: hashToken(secret),
    scope,
    projectIdsJson: projectIds === null ? null : JSON.stringify(projectIds),
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  };

  immediateTransaction(sqlite, () => {
    db.insert(tokens).values(row).run();

    appendActivity(db, {
      orgId: requireOrgId(db),
      // Org-scoped: a token is not a project's business, and §3.1 puts reading
      // these rows behind the audit-log cell (`visibleTo` in services/events).
      projectId: null,
      ...activityActor(actor),
      type: 'token.created',
      payload: { token_id: row.id, name: row.name, scope: row.scope, prefix: row.prefix },
      now,
    });
  });

  return { token: toView(row), secret };
}

export interface ListTokensOptions {
  limit: number;
  /** Keyset position, `(created_at, id)`, matching the ORDER BY below. */
  cursor: { sortKey: string | number; id: string } | null;
}

/** Your own tokens, newest first. */
export function listOwnTokens(
  db: Db,
  actor: ResolvedActor,
  options: ListTokensOptions,
): TokenView[] {
  assertCan(actor, 'token.read_own', { ownerId: actor.userId });
  return selectTokens(db, actor.userId, options);
}

/** Anyone's tokens — the admin+ half of §3.1's "List / revoke anyone's token". */
export function listTokensFor(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  options: ListTokensOptions,
): TokenView[] {
  assertCan(actor, 'token.list_any');
  requireUser(db, userId);
  return selectTokens(db, userId, options);
}

export function revokeOwnToken(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  tokenId: string,
  now: number = Date.now(),
): void {
  const row = requireToken(db, tokenId);
  assertCan(actor, 'token.revoke_own', { ownerId: row.userId });
  revoke(sqlite, db, actor, row, now);
}

export function revokeTokenFor(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  userId: string,
  tokenId: string,
  now: number = Date.now(),
): void {
  assertCan(actor, 'token.revoke_any');

  const row = requireToken(db, tokenId);
  // The token must belong to the user in the path. Without this, an admin could
  // revoke anybody's token through anybody's URL, and the audit row would name
  // the wrong owner.
  if (row.userId !== userId) {
    throw ApiError.notFound(`No token with id "${tokenId}" for that user`);
  }

  revoke(sqlite, db, actor, row, now);
}

// ------------------------------------------------------------------ helpers

/**
 * Newest first, one row over the limit so `buildPage` can tell there is more.
 *
 * Paginated like every other list in §6.3 even though one person's tokens are
 * inherently few: returning a `Page` whose `next_cursor` the service cannot
 * honour would be a contract that lies, and returning a bare array here alone
 * would make this the one endpoint a generic client has to special-case.
 */
function selectTokens(db: Db, userId: string, options: ListTokensOptions): TokenView[] {
  const conditions: SQL[] = [eq(tokens.userId, userId)];

  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(tokens.createdAt, key),
        and(eq(tokens.createdAt, key), lt(tokens.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select()
    .from(tokens)
    .where(and(...conditions))
    .orderBy(desc(tokens.createdAt), desc(tokens.id))
    .limit(options.limit + 1)
    .all()
    .map(toView);
}

function requireToken(db: Db, tokenId: string): TokenRow {
  const row = db.select().from(tokens).where(eq(tokens.id, tokenId)).get();
  if (row === undefined) throw ApiError.notFound(`No token with id "${tokenId}"`);
  return row;
}

function requireUser(db: Db, userId: string): void {
  const row = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (row === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
}

/**
 * Revoking twice is not an error and is not a second event.
 *
 * §6.4's `DELETE` is idempotent, so the second call answers `204` like the
 * first. It writes **no** activity row: nothing changed, and this codebase
 * already refuses a no-op status transition on exactly that ground — an event
 * claiming a change that did not happen is worse than a missing one.
 */
function revoke(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  row: TokenRow,
  now: number,
): void {
  if (row.revokedAt !== null) return;

  immediateTransaction(sqlite, () => {
    db.update(tokens).set({ revokedAt: now }).where(eq(tokens.id, row.id)).run();

    appendActivity(db, {
      orgId: requireOrgId(db),
      projectId: null,
      ...activityActor(actor),
      type: 'token.revoked',
      payload: { token_id: row.id, name: row.name, prefix: row.prefix, owner_id: row.userId },
      now,
    });
  });
}

/** Single-org deployment (§4.2), so there is exactly one row to find. */

/**
 * Every id in the whitelist must be a project this actor can actually read.
 *
 * Rejected with `422`, never silently dropped: a token quietly scoped to fewer
 * projects than the caller asked for is a token that stops working later, for
 * reasons nothing recorded.
 *
 * **Existence is checked as well as permission.** `canSeeProject` answers from
 * the actor's role, and an Owner has implicit lead everywhere — including on an
 * id that names no project at all, which would otherwise sail through.
 */
function assertReadableProjects(
  db: Db,
  actor: ResolvedActor,
  requested: readonly string[] | null,
): string[] | null {
  if (requested === null) return null;

  const unique = [...new Set(requested)];
  const refused = unique.filter((id) => {
    const exists = db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
    return exists === undefined || !canSeeProject(actor, id);
  });

  if (refused.length > 0) {
    throw new ApiError('unprocessable', 'Those projects are not yours to scope a token to', {
      project_ids: refused,
    });
  }

  return unique;
}
