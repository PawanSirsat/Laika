import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type Database from 'better-sqlite3';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import * as schema from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { consumeInvite, ownerInviteRefused, removeOrphanedInvitee } from '../services/invites.ts';
import { findUsableInvite, inviteMatchesEmail, isInviteOnly } from './invites.ts';
import { inviteForEmail, userIsActive, type MicrosoftSso } from './sso.ts';
import { scrubTelemetryEnv } from './telemetry.ts';
import { trustedOriginsFor } from './trusted-origins.ts';

export const AUTH_BASE_PATH = '/api/v1/auth';

/**
 * How long a remembered session lasts **idle**, in seconds (LAI-811, SPEC §13.1).
 *
 * Idle, not absolute: a request on a session older than `SESSION_UPDATE_AGE`
 * pushes its expiry back out to this, and `resolve-actor.ts` hands the renewed
 * cookie to the browser. Someone who uses Laika at least once a month never
 * signs in again on that device.
 */
export const SESSION_EXPIRES_IN = 30 * 24 * 60 * 60;

/** How old a session must be before a request renews it, in seconds. */
export const SESSION_UPDATE_AGE = 24 * 60 * 60;

/** The `inviteToken` better-auth drops before validation but the hooks can read. */
function inviteTokenFrom(body: unknown): string {
  const value = (body as { inviteToken?: unknown } | null | undefined)?.inviteToken;
  return typeof value === 'string' ? value : '';
}

/** `ownerInviteRefused`, in the shape a better-auth endpoint answers with (LAI-982). */
function useTransferError(): APIError {
  return new APIError('UNPROCESSABLE_ENTITY', {
    code: 'use_transfer',
    message: ownerInviteRefused().message,
  });
}

function isUseTransfer(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.details as { reason?: unknown } | null)?.reason === 'use_transfer'
  );
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
   * Whether the session cookie is `Secure`. A browser refuses a `Secure` cookie
   * from a plain-http origin other than localhost, and nobody can stay signed
   * in. `env.ts` sets it only for an `https://` public URL (LAI-811, SPEC
   * §13.1).
   */
  secureCookies: boolean;
  /**
   * Microsoft SSO (LAI-1238). Set, Microsoft is the only way in: the password
   * endpoints refuse `sso_only`, and a new account needs an invite addressed to
   * the email Microsoft asserts. `null` or absent keeps email and password.
   */
  sso?: MicrosoftSso | null;
  now?: () => number;
}

/** The password endpoints, refused when Microsoft SSO is on (LAI-1238). */
export const PASSWORD_AUTH_PATHS = [
  '/sign-in/email',
  '/sign-up/email',
  '/request-password-reset',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/set-password',
] as const;

/** What a password endpoint answers on an SSO-only instance. */
export const SSO_ONLY_MESSAGE =
  'This Laika signs in with Microsoft only. Use "Sign in with Microsoft".';

function ssoOnlyError(): APIError {
  return new APIError('FORBIDDEN', { code: 'sso_only', message: SSO_ONLY_MESSAGE });
}

/** The path of a better-auth call that came over HTTP; `undefined` for an internal one. */
function pathOf(ctx: unknown): string | undefined {
  const path = (ctx as { path?: unknown } | null | undefined)?.path;
  return typeof path === 'string' ? path : undefined;
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
  const sso = options.sso ?? null;

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
        isActive: { type: 'number', required: false, defaultValue: 1, input: false },
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
    },
    account: {
      modelName: 'accounts',
      /**
       * **Microsoft's access and refresh tokens are encrypted at rest**
       * (LAI-1317). Sign-in asks for `offline_access`, so the refresh token is
       * a long-lived credential to the person's Microsoft account; in clear it
       * would be one database copy away from everyone's mailbox scopes.
       * better-auth encrypts both with `LAIKA_SECRET` on every write and
       * decrypts on its own reads; a row written in clear before this still
       * reads, and the next sign-in rewrites it encrypted. Nothing else in
       * Laika reads these columns. A password account has no tokens, so this
       * changes nothing without SSO.
       */
      encryptOAuthTokens: true,
      /**
       * An existing person signing in with Microsoft for the first time is
       * **linked** to their account by email, not given a second one (LAI-1238).
       * Trusting Microsoft's email for that is safe only because the tenant is
       * one directory (`sso.ts` refuses `common`/`organizations`/`consumers`):
       * the address comes from a directory this organisation runs.
       *
       * **`requireLocalEmailVerified: false`** — better-auth otherwise refuses
       * to link unless the *local* account's email is marked verified
       * (`account_not_linked`), and Laika never verifies one: every account is
       * made by an invite or by first boot, so every existing person — the owner
       * first — would be locked out the first time they used Microsoft. What
       * that check guards against is someone registering a victim's address
       * ahead of them; on an SSO-only, invite-only instance nobody can register
       * at all, so the guard protects nothing here and costs everyone.
       */
      accountLinking:
        sso === null
          ? { enabled: false }
          : {
              enabled: true,
              trustedProviders: ['microsoft'],
              allowDifferentEmails: false,
              requireLocalEmailVerified: false,
            },
    },
    verification: { modelName: 'verifications' },

    emailAndPassword: {
      // Off when Microsoft SSO is on (LAI-1238); the `before` hook below also
      // answers those endpoints `sso_only` so a client is told why, in words.
      enabled: sso === null,
      // Argon2id is better-auth's default hash (§13.1). Not overridden.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    // Microsoft Entra ID, one tenant (LAI-1238). No profile photo: it is a
    // second call to Microsoft Graph for a picture Laika does not draw.
    socialProviders:
      sso === null
        ? {}
        : {
            microsoft: {
              clientId: sso.clientId,
              clientSecret: sso.clientSecret,
              tenantId: sso.tenantId,
              disableProfilePhoto: true,
              prompt: 'select_account',
            },
          },

    advanced: {
      database: { generateId: () => newId() },
      /**
       * **The one switch better-auth reads for `Secure`** (LAI-811).
       *
       * It decides both the attribute and the `__Secure-` name prefix, so the
       * two cannot disagree. There used to be a `cookies.sessionToken.attributes`
       * block here instead, and better-auth never read it: it looks cookies up
       * by `session_token`. The block only repeated better-auth's defaults
       * (`HttpOnly`, `SameSite=Lax`, `Path=/`) plus a `secure` that
       * `env.ts` got wrong for `http://<IP>`. The two faults cancelled out.
       * Re-keying the block alone would have put `env.ts`'s wrong `Secure` on
       * the plain-http cookie and signed everyone out; fixing `env.ts` alone
       * would have changed nothing, since the block was not read.
       *
       * **The cookie's name is unchanged by this**, in either scheme. Before,
       * better-auth derived the prefix from `baseURL`; `env.ts` now derives
       * this flag from the same URL's scheme. Over http the name is still
       * `better-auth.session_token`, which every session already issued
       * carries, so nobody is signed out by the deploy.
       */
      useSecureCookies: options.secureCookies,
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
        // SSO-only (LAI-1238): every password endpoint refuses, in words.
        if (sso !== null && (PASSWORD_AUTH_PATHS as readonly string[]).includes(ctx.path)) {
          throw ssoOnlyError();
        }
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

          if (isUseTransfer(err)) throw useTransferError();
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
          before: (user, ctx) => {
            const email = user.email.toLowerCase();

            /*
             * **SSO is a way to sign in, never a way to join** (D-004, LAI-1238).
             * A Microsoft sign-in that would create an account needs an invite
             * addressed to the email Microsoft asserts. Only a call that came
             * over HTTP is gated: first-boot setup creates the owner through
             * better-auth's internal adapter, with no request behind it.
             */
            if (sso !== null && pathOf(ctx) !== undefined) {
              const invite = inviteForEmail(options.db, email, now());
              if (invite === null) {
                throw new APIError('FORBIDDEN', {
                  code: 'invite_required',
                  message: `No invite is waiting for ${email}. Ask an admin to invite that address.`,
                });
              }
              // The backstop every path meets (LAI-982): no invite becomes `owner`.
              if (invite.orgRole === 'owner') throw useTransferError();
            }

            return Promise.resolve({
              data: {
                ...user,
                // Lowercased on write so uniqueness is case-insensitive (§4.1).
                email,
              },
            });
          },
          /*
           * Spend the invite the `before` gate found, and apply its role
           * (LAI-1238) — the same `consumeInvite` the password sign-up uses, so
           * the single-use transaction, the owner backstop and the audit rows
           * are one code path. A lost race takes the new account with it, as on
           * the password path, so the address is free to try again.
           */
          after: (user, ctx) => {
            if (sso === null || pathOf(ctx) === undefined) return Promise.resolve();
            const invite = inviteForEmail(options.db, user.email, now());
            try {
              if (invite === null)
                throw new ApiError('forbidden', 'That invite was used meanwhile');
              consumeInvite(options.sqlite, options.db, {
                tokenHash: invite.tokenHash,
                userId: user.id,
                now: now(),
              });
            } catch (err) {
              removeOrphanedInvitee(options.db, user.id);
              if (isUseTransfer(err)) throw useTransferError();
              throw new APIError('FORBIDDEN', {
                code: 'invite_invalid',
                message: err instanceof Error ? err.message : 'That invite could not be used.',
              });
            }
            return Promise.resolve();
          },
        },
      },
      session: {
        create: {
          /*
           * A deactivated account gets no session from Microsoft either (§4.1,
           * LAI-442). The password path checks this after the credential in
           * `app.ts`; a social sign-in never passes through that handler's
           * check, so it is refused here, where every session is born.
           */
          before: (session) => {
            if (sso !== null && !userIsActive(options.db, session.userId)) {
              throw new APIError('FORBIDDEN', {
                code: 'forbidden',
                message: 'This account has been deactivated',
              });
            }
            return Promise.resolve({ data: session });
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
