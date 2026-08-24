import { type Hono } from 'hono';
import { createApp, type CreateAppOptions } from '../../src/app.ts';
import { createAuth, type Auth } from '../../src/auth/auth.ts';
import { hashInviteToken } from '../../src/auth/invites.ts';
import { type Db } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { invites, orgs, users } from '../../src/db/schema.ts';
import { type AppEnv } from '../../src/http/context.ts';
import { captureLog, type CapturedLog } from './app.ts';
import { freshDb, type TestDb } from './db.ts';

export const TEST_ORIGIN = 'http://localhost:3000';
export const TEST_SECRET = 'test-secret-that-is-long-enough-to-pass-validation';

export interface AuthHarness {
  app: Hono<AppEnv>;
  auth: Auth;
  db: Db;
  t: TestDb;
  log: CapturedLog;
  close(): void;
}

export interface AuthHarnessOptions extends Partial<CreateAppOptions> {
  /**
   * better-auth's clock. The sign-up hooks read it twice — once to validate the
   * invite, once to spend it — so a stepping clock is how a test reaches the
   * window between them without a real race (LAI-071).
   */
  now?: () => number;
}

/**
 * A real app with a real database and real better-auth — no doubles.
 *
 * `overrides` reaches `createApp` untouched, for the pieces a test needs to hold
 * still: the rate limiter's clock, or the SSE feed's polling (LAI-048).
 */
export function authHarness(overrides: AuthHarnessOptions = {}): AuthHarness {
  const { now, ...appOverrides } = overrides;
  const t = freshDb();
  const log = captureLog();

  const auth = createAuth({
    db: t.db,
    sqlite: t.sqlite,
    secret: TEST_SECRET,
    baseUrl: TEST_ORIGIN,
    secureCookies: false,
    ...(now === undefined ? {} : { now }),
  });

  const app = createApp({
    version: '0.0.0-test',
    logger: log.logger,
    auth,
    db: t.db,
    sqlite: t.sqlite,
    publicUrl: TEST_ORIGIN,
    ...appOverrides,
  });

  return {
    app,
    auth,
    db: t.db,
    t,
    log,
    close: () => {
      t.close();
    },
  };
}

/** better-auth checks the request origin; these headers make a request trusted. */
export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, ...extra };
}

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
  inviteToken?: string;
}

export async function signUp(app: Hono<AppEnv>, input: SignUpInput): Promise<Response> {
  return app.request('/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      name: input.name ?? 'Test User',
      ...(input.inviteToken === undefined ? {} : { inviteToken: input.inviteToken }),
    }),
  });
}

export async function signIn(
  app: Hono<AppEnv>,
  email: string,
  password: string,
): Promise<Response> {
  return app.request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
}

/** Pull the session cookie out of a response so later requests can present it. */
export function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

export function setCookieHeaders(res: Response): string[] {
  return res.headers.getSetCookie?.() ?? [];
}

/** Seed the single org row, which is what turns invite-only on. */
export function seedOrg(db: Db, inviteOnly: boolean): { orgId: string; ownerId: string } {
  const ownerId = newId();
  const orgId = newId();
  const now = Date.now();

  db.insert(users)
    .values({
      id: ownerId,
      email: 'existing-owner@example.test',
      name: 'Existing Owner',
      orgRole: 'owner',
      avatarColor: '#111111',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();

  db.insert(orgs)
    .values({
      id: orgId,
      name: 'Laika',
      ownerUserId: ownerId,
      inviteOnly: inviteOnly ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { orgId, ownerId };
}

export interface SeedInviteOptions {
  orgId: string;
  createdBy: string;
  email?: string | null;
  expiresAt?: number;
  orgRole?: 'owner' | 'admin' | 'member' | 'viewer';
}

/** Returns the plaintext token; only its hash is stored (§4.11). */
export function seedInvite(db: Db, options: SeedInviteOptions): string {
  const token = `inv_${newId()}`;
  const now = Date.now();

  db.insert(invites)
    .values({
      id: newId(),
      orgId: options.orgId,
      email: options.email === undefined ? null : options.email,
      orgRole: options.orgRole ?? 'member',
      tokenHash: hashInviteToken(token),
      createdBy: options.createdBy,
      expiresAt: options.expiresAt ?? now + 7 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })
    .run();

  return token;
}
