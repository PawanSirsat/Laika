import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type Database from 'better-sqlite3';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import * as schema from '../db/schema.ts';
import { consumeInvite, removeOrphanedInvitee } from '../services/invites.ts';
import { avatarColorFor } from './avatar.ts';
import { findUsableInvite, inviteMatchesEmail, isInviteOnly } from './invites.ts';
import { scrubTelemetryEnv } from './telemetry.ts';
import { trustedOriginsFor } from './trusted-origins.ts';

export const AUTH_BASE_PATH = '/api/v1/auth';

/** The `inviteToken` better-auth drops before validation but the hooks can read. */
function inviteTokenFrom(body: unknown): string {
  const value = (body as { inviteToken?: unknown } | null | undefined)?.inviteToken;
  return typeof value === 'string' ? value : '';
}

export interface CreateAuthOptions {
  db: Db;
  /**
   * The same connection, for the `BEGIN IMMEDIATE` that makes spending an invite
   * single-use (see `consumeInvite`). Drizzle's `transaction()` cannot choose the
   * mode, so the raw handle is the only way to take the write lock up front.
   */
  sqlite: Database.Database;
  /** Secret for signing session cookies. Required — there is no dev default. */
  secret: string;
  /** Public origin, used for cookie and redirect correctness. */
  baseUrl: string;
  /**
   * `Secure` cookies require HTTPS. Off on localhost so `pnpm dev` can hold a
   * session at all; on everywhere else (SPEC §6.1).
   */
  secureCookies: boolean;
  now?: () => number;
}

/**
 * better-auth, wired to the same SQLite database as everything else (§11.3).
 *
 * Its `user` model is remapped onto our `users` table rather than given a table
 * of its own: one identity is one row, and a second user table would need
 * syncing that nobody would remember to do. Sessions, accounts and verifications
 * are better-auth's own (§4.1).
 */
export function createAuth(options: CreateAuthOptions) {
  // Before anything in better-auth initialises — see the module comment.
  scrubTelemetryEnv();

  const now = options.now ?? (() => Date.now());

  return betterAuth({
    appName: 'Laika',
    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: AUTH_BASE_PATH,

    // SPEC §13.4. Belt and braces: the env vars are already scrubbed above,
    // because this option alone is OR'd with them and cannot win.
    telemetry: { enabled: false },

    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),

    user: {
      modelName: 'users',
      additionalFields: {
        // Ours, not better-auth's. `input: false` keeps them off the public
        // signup payload — otherwise anyone could POST themselves `owner`.
        orgRole: { type: 'string', required: false, defaultValue: 'member', input: false },
        avatarColor: { type: 'string', required: false, defaultValue: '#6b7280', input: false },
        isActive: { type: 'number', required: false, defaultValue: 1, input: false },
      },
    },
    session: { modelName: 'sessions' },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications' },

    emailAndPassword: {
      enabled: true,
      // Argon2id is better-auth's default hash (§13.1). Not overridden.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    advanced: {
      database: { generateId: () => newId() },
      cookies: {
        sessionToken: {
          attributes: {
            httpOnly: true,
            sameSite: 'lax',
            secure: options.secureCookies,
            path: '/',
          },
        },
      },
      // `SameSite=Lax` plus better-auth's own origin check is the CSRF story for
      // cookie-authenticated mutations (§6.1, §13.1).
      disableCSRFCheck: false,
      /**
       * Set explicitly because better-auth's **default depends on the
       * environment** (LAI-090):
       *
       * ```js
       * skipOriginCheck: options.advanced?.disableOriginCheck !== undefined
       *   ? options.advanced.disableOriginCheck
       *   : isTest() ? true : false
       * ```
       *
       * Under `NODE_ENV=test` — which vitest sets — the origin check is **off**.
       * So the suite ran with a weaker security posture than production, and no
       * test at any level could have caught the origin rejection that locked the
       * owner out: every request was accepted regardless of `Origin`.
       *
       * A check that cannot fail in the test environment is a check nobody can
       * regression-test. Pinning it to `false` makes the posture identical
       * everywhere, which is the only way `test/auth/origin.test.ts` means
       * anything.
       */
      disableOriginCheck: false,
    },

    // Loopback spellings are one host (LAI-090). `localhost`, `127.0.0.1` and
    // `::1` name the same machine, and treating them as different origins locked
    // the owner out of their own instance with a message about their password.
    // See `trusted-origins.ts` for what this deliberately does *not* widen.
    trustedOrigins: trustedOriginsFor(options.baseUrl),

    hooks: {
      /**
       * Invite-only signup (D-004, SPEC §4.2), enforced at the endpoint rather
       * than in a database hook.
       *
       * It has to be here: better-auth validates the sign-up body against its
       * own schema and **drops unknown fields** before any database hook runs, so
       * `inviteToken` is gone by then. That stripping is a feature — it is what
       * stops a caller smuggling `orgRole: 'owner'` into signup — but it means
       * the invite check must read the raw body, which only an endpoint
       * middleware sees.
       */
      before: createAuthMiddleware((ctx) => {
        if (ctx.path !== '/sign-up/email') return Promise.resolve();
        if (!isInviteOnly(options.db)) return Promise.resolve();

        const body = (ctx.body ?? {}) as { email?: unknown; inviteToken?: unknown };
        const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
        const token = typeof body.inviteToken === 'string' ? body.inviteToken : '';

        if (token === '') {
          throw new APIError('FORBIDDEN', {
            code: 'invite_required',
            message: 'This Laika is invite-only. A valid invite is required to sign up.',
          });
        }

        const invite = findUsableInvite(options.db, token, now());
        if (invite === null || !inviteMatchesEmail(invite, email)) {
          throw new APIError('FORBIDDEN', {
            code: 'invite_invalid',
            message: 'That invite is invalid, expired, or already used.',
          });
        }

        return Promise.resolve();
      }),

      /**
       * Spend the invite and apply the role it was issued for (LAI-071).
       *
       * This is wired here rather than in `POST /api/v1/invites/accept` because
       * `/sign-up/email` is a **public** endpoint that already accepts an
       * `inviteToken`. An accept route that did the spending on its own would
       * leave anyone who posted straight to better-auth signed up on the default
       * `member` role with their token still unspent — a single-use invite that
       * is not single-use, which is the entire risk. Both paths run this hook, so
       * there is no second way in that skips it.
       *
       * The user exists by the time this runs; better-auth creates it before the
       * `after` stage. A token that cannot be spent therefore has to take the
       * account with it, or a lost race leaves an orphan holding the email
       * address and the invite could never be retried.
       *
       * A token supplied to an instance that is **not** invite-only is still
       * spent, not ignored: the `before` gate skips validation there, and
       * silently discarding a field the caller believed in is how somebody ends
       * up on the wrong role wondering why.
       */
      after: createAuthMiddleware((ctx) => {
        if (ctx.path !== '/sign-up/email') return Promise.resolve();

        const token = inviteTokenFrom(ctx.body);
        if (token === '') return Promise.resolve();

        const userId = ctx.context.newSession?.user.id;
        // No session means no account was created — nothing to promote, and
        // nothing to clean up.
        if (userId === undefined) return Promise.resolve();

        try {
          consumeInvite(options.sqlite, options.db, { token, userId, now: now() });
        } catch (err) {
          removeOrphanedInvitee(options.db, userId);

          throw new APIError('FORBIDDEN', {
            code: 'invite_invalid',
            message: err instanceof Error ? err.message : 'That invite could not be used.',
          });
        }

        return Promise.resolve();
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            const email = user.email.toLowerCase();

            return Promise.resolve({
              data: {
                ...user,
                // Lowercased on write so uniqueness is case-insensitive (§4.1).
                email,
                // Seeded from the email rather than the id: better-auth has not
                // assigned an id yet when this runs, and the email is unique
                // anyway, so the colour is just as stable.
                avatarColor: avatarColorFor(email),
              },
            });
          },
        },
      },
    },
  });
}

/**
 * The configured better-auth instance. Inferred rather than annotated:
 * `ReturnType<typeof betterAuth>` widens the options generic and loses the
 * narrower context type the routes need.
 */
export type Auth = ReturnType<typeof createAuth>;
