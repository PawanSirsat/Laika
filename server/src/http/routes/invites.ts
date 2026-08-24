import { Hono } from 'hono';
import { type Auth } from '../../auth/auth.ts';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  type AcceptableInvite,
  createInvite,
  ORG_ROLES,
  PROJECT_ROLES,
  type InvitePreview,
  type InviteView,
  listInvites,
  previewInvite,
  resolveInviteForAccept,
  revokeInvite,
} from '../../services/invites.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/invites` (SPEC §6.4).
 *
 * Transport only — every rule about who may invite whom, how long a token
 * lasts, and what spending one does lives in `services/invites.ts`.
 *
 * Two of these five are **pre-auth on purpose**: `GET /invites/:token` is
 * labelled "unauthenticated preview" in §6.4, and `POST /invites/accept` is how
 * somebody with no account gets one — putting it behind a session would make it
 * unreachable by the only people who need it. Neither takes an actor, so neither
 * calls `can()`; the token is the credential and the service checks it first.
 *
 * The path for the preview carries the token, which §6.4 chose, so the request
 * logger redacts it (`redactPath`) — hashing a credential at rest and then
 * printing it in the access log would defeat the hashing.
 */

const CreateInviteBody = strictObject({
  // Null and absent both mean a link invite (§4.11): a token anybody holding it
  // may spend. They are spelled differently so a client that means "no address"
  // can say so rather than omitting a key and hoping.
  email: z.string().trim().email().max(320).nullish(),
  org_role: z.enum(ORG_ROLES),
  project_id: z.string().min(1).max(64).nullish(),
  project_role: z.enum(PROJECT_ROLES).nullish(),
});

const AcceptInviteBody = strictObject({
  token: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(512),
  // Required only for a link invite, which is bound to no address. For an
  // email invite the invite is the authority and a mismatch is refused rather
  // than quietly overridden.
  email: z.string().trim().email().max(320).optional(),
});

export interface CreatedInviteBody {
  invite: InviteView;
  /** Returned once, never recoverable — only the hash is stored (§4.11). */
  token: string;
  /** Where to send the invitee. Laika mails nobody; the inviter passes it on. */
  accept_url: string;
}

export interface AcceptedInviteBody {
  user_id: string;
  email: string;
  org_role: InviteView['org_role'];
  project_id: string | null;
}

export interface InviteRouteOptions {
  db: Db;
  auth: Auth;
  /**
   * `LAIKA_PUBLIC_URL` (§11.7) — the origin an invite link must point at. Empty
   * when unset, which yields a relative `accept_url`: still correct for a UI
   * building a link from its own origin, and honest about not knowing the
   * public address rather than inventing `localhost` and handing out a URL the
   * invitee cannot open.
   */
  publicUrl?: string | undefined;
}

/** `<public-url>/invite?token=…` — the screen at `/invite` in the SPA. */
export function acceptUrlFor(publicUrl: string | undefined, token: string): string {
  const base = (publicUrl ?? '').replace(/\/+$/, '');
  return `${base}/invite?token=${encodeURIComponent(token)}`;
}

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `?include_used=true|false`, absent meaning pending invites only. */
function parseIncludeUsed(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  throw ApiError.badRequest('include_used must be true or false', { include_used: raw });
}

export function inviteRoutes(options: InviteRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, auth } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());

    const rows = listInvites(db, actor, {
      limit,
      cursor,
      includeUsed: parseIncludeUsed(c.req.query('include_used')),
    });

    const page: Page<InviteView> = buildPage(rows, limit, (row) => ({
      sortKey: row.created_at,
      id: row.id,
    }));

    return c.json(page);
  });

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateInviteBody, await c.req.json().catch(() => null));

    const created = createInvite(db, actor, {
      email: body.email,
      orgRole: body.org_role,
      projectId: body.project_id,
      projectRole: body.project_role,
    });

    return c.json<CreatedInviteBody>(
      {
        invite: created.invite,
        token: created.token,
        accept_url: acceptUrlFor(options.publicUrl, created.token),
      },
      201,
    );
  });

  /**
   * Registered before `/:token`, which is not currently load-bearing and is kept
   * anyway.
   *
   * Hono resolves a same-method collision in registration order: a `/:param`
   * declared first shadows a literal declared after it. These two differ in
   * method — `POST /accept` against `GET /:token` — so nothing collides today.
   * The ordering costs nothing and means adding `GET /invites/accept` later
   * cannot silently turn the one request that must work into a token lookup.
   */
  app.post('/accept', async (c) => {
    const body = parseBody(AcceptInviteBody, await c.req.json().catch(() => null));

    // Read the invite first so the email can come from it, and so a bad token is
    // refused before an account is created for nobody. `resolveInviteForAccept`
    // rather than `previewInvite`: accepting is an action the token authorises,
    // so a token that does not is `403` — the same answer the public sign-up
    // path gives for the same token.
    const invite = resolveInviteForAccept(db, body.token);
    const email = resolveAcceptEmail(invite, body.email);

    // better-auth creates the account, hashes the password its way (§13.1) and
    // returns a session — the invitee is signed in when this responds, which is
    // the point of accepting. The `inviteToken` field is what the sign-up hooks
    // read: the `before` hook validates it, the `after` hook spends it and
    // applies the role, inside one transaction (see `consumeInvite`).
    // Held in a variable, not written inline: `inviteToken` is not one of
    // better-auth's declared sign-up fields — unknown keys are stripped before
    // validation, which is exactly what stops a caller smuggling
    // `orgRole: 'owner'` into signup (auth.ts). The hooks read the raw body
    // before that stripping, which is why the field arrives at all. TypeScript's
    // excess-property check applies to object literals only, so this passes the
    // extra key through without a cast asserting something untrue.
    const signUpBody = {
      email,
      password: body.password,
      name: body.name,
      inviteToken: body.token,
    };

    const signUp = await auth.api.signUpEmail({ body: signUpBody, returnHeaders: true });

    for (const [name, value] of signUp.headers.entries()) {
      if (name.toLowerCase() === 'set-cookie') c.header('Set-Cookie', value, { append: true });
    }

    return c.json<AcceptedInviteBody>(
      {
        user_id: signUp.response.user.id,
        email,
        org_role: invite.orgRole,
        project_id: invite.projectId,
      },
      201,
    );
  });

  app.get('/:token', (c) => {
    return c.json<InvitePreview>(previewInvite(db, c.req.param('token')));
  });

  app.delete('/:id', (c) => {
    const actor = requireActor(c);
    revokeInvite(db, actor, c.req.param('id'));

    return c.body(null, 204);
  });

  return app;
}

/**
 * Which address the new account is created under.
 *
 * An email invite is bound to one address and the invite wins: a supplied
 * mismatch is refused rather than silently overridden, because a caller who
 * typed an address and got an account under a different one has been lied to.
 * A link invite is bound to none, so the caller must supply one.
 */
export function resolveAcceptEmail(
  invite: Pick<AcceptableInvite, 'email'>,
  supplied: string | undefined,
): string {
  if (invite.email !== null) {
    if (supplied !== undefined && supplied.toLowerCase() !== invite.email) {
      throw new ApiError('unprocessable', 'That invite was issued for a different email address', {
        field: 'email',
      });
    }
    return invite.email;
  }

  if (supplied === undefined) {
    throw new ApiError(
      'unprocessable',
      'This invite is not bound to an address; email is required',
      {
        field: 'email',
      },
    );
  }

  return supplied.toLowerCase();
}
