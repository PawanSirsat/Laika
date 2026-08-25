import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * Invites (SPEC §6.4, §4.11 — API by LAI-071, screen by LAI-077).
 *
 * Two of these three calls are **pre-auth**: the whole point of an invite is
 * that the holder has no account yet. `previewInvite` and `acceptInvite` carry
 * the token as their only credential, and `acceptInvite` returns with a session
 * cookie already set — the invitee is signed in when it resolves.
 */

/** Mirrors `ORG_ROLES` in `server/src/db/enums.ts`, which a CHECK constraint enforces. */
export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Mirrors `PROJECT_ROLES` in the same file. */
export const PROJECT_ROLES = ['lead', 'member', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * What `GET /invites/:token` answers for a token that is still good.
 *
 * Note what is **not** here: any indication of *why* a bad token is bad. The
 * service answers one `404` — "invalid, expired, or already used" — for all
 * three, deliberately, so that posting guesses cannot confirm a token exists.
 * A client therefore cannot render "expired" as distinct from "unknown", and
 * must not pretend to. See `INVITE_REFUSED_REASON`.
 */
export interface InvitePreview {
  readonly org_name: string;
  readonly inviter_name: string;
  readonly org_role: OrgRole;
  readonly project_id: string | null;
  readonly project_name: string | null;
  readonly project_role: ProjectRole | null;
  /** `null` for a link invite — one bound to no address (§4.11). */
  readonly email: string | null;
  readonly expires_at: number;
}

/**
 * The server's own wording for a refused token, quoted rather than reworded.
 *
 * It names all three possibilities in one breath because the server will not
 * say which, and a screen that guessed one would be asserting something it
 * cannot know.
 */
export const INVITE_REFUSED_REASON = 'invalid, expired, or already used';

export interface AcceptInviteInput {
  readonly token: string;
  readonly name: string;
  readonly password: string;
  /**
   * Only for a link invite, which is bound to no address.
   *
   * For an email invite the server takes the address from the invite itself,
   * and refuses a mismatch rather than quietly creating the account under a
   * different one.
   */
  readonly email?: string;
}

export interface AcceptedInvite {
  readonly user_id: string;
  readonly email: string;
  readonly org_role: OrgRole;
  readonly project_id: string | null;
}

/** Pre-auth. A `404` means refused, and says no more than that. */
export function previewInvite(token: string, signal?: AbortSignal): Promise<InvitePreview> {
  return request<InvitePreview>(
    `/invites/${encodeURIComponent(token)}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Pre-auth. Creates the account, spends the invite and signs the invitee in.
 *
 * A refused token is `403` here rather than the preview's `404`: accepting is an
 * action the token has to authorise, and the sign-up path answers the same way
 * for the same token.
 */
export function acceptInvite(input: AcceptInviteInput): Promise<AcceptedInvite> {
  return request<AcceptedInvite>('/invites/accept', {
    method: 'POST',
    body: {
      token: input.token,
      name: input.name,
      password: input.password,
      // Omitted entirely rather than sent as undefined: the body is a strict
      // schema, and an email alongside an email-bound invite is refused.
      ...(input.email === undefined ? {} : { email: input.email }),
    },
  });
}

/**
 * One pending invite, as `GET /invites` lists them.
 *
 * Note there is **no token here**. The token is shown once, at creation, and is
 * stored hashed — so a list can say who was invited and to what, and cannot
 * re-issue the link. Anyone who lost theirs needs a new invite.
 */
export interface PendingInvite {
  readonly id: string;
  /** `null` for a link invite — one bound to no address (§4.11). */
  readonly email: string | null;
  readonly org_role: OrgRole;
  readonly project_id: string | null;
  readonly project_role: ProjectRole | null;
  readonly created_by: string;
  readonly created_at: number;
  readonly expires_at: number;
  /** SMTP is unconfigured (LAI-206), so this is `false` for everything today. */
  readonly email_sent: boolean;
}

export interface CreateInviteInput {
  /** `null` for a link invite, which anyone holding the URL may spend. */
  readonly email: string | null;
  readonly org_role: OrgRole;
}

export interface CreatedInvite {
  readonly invite: PendingInvite;
  /** Shown **once**. Never listed again — the server keeps only a hash. */
  readonly token: string;
  readonly accept_url: string;
}

/** Pending invites for the org. `admin+` — the server decides, not the screen. */
export function listInvites(signal?: AbortSignal): Promise<Page<PendingInvite>> {
  return request<Page<PendingInvite>>('/invites', signal === undefined ? {} : { signal });
}

export function createInvite(input: CreateInviteInput): Promise<CreatedInvite> {
  return request<CreatedInvite>('/invites', {
    method: 'POST',
    // `email: null` is sent explicitly rather than omitted: the schema spells
    // "no address" and "absent" the same way on purpose, and a client that
    // means a link invite should say so.
    body: { email: input.email, org_role: input.org_role },
  });
}

export function revokeInvite(id: string): Promise<void> {
  return request<void>(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Who may manage invites and see the org's people (SPEC §3.1).
 *
 * *"Invite users / change org roles"* is Owner and Admin. A Member or Viewer
 * gets no controls at all rather than controls that answer `403` — the server
 * refuses either way, and a button that always fails is worse than no button.
 */
export function canManageOrg(orgRole: string): boolean {
  return orgRole === 'owner' || orgRole === 'admin';
}
