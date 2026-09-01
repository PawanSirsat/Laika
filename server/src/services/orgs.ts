import { eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AiProvider } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { orgs } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';

/**
 * The organisation itself (SPEC §4.2, §6.4, LAI-222).
 *
 * Laika is single-org (D-022), so "which organisation" has one answer and this
 * endpoint exists to tell the signed-in UI **what it is looking at**. Before
 * LAI-222 nothing served that: `GET /me` carries the caller's `org_role` but no
 * org id or name, and the only place an org name was returned at all was the
 * *pre-auth invite preview*, which needs an invite token. So a signed-in user
 * could not learn the name of the organisation they were signed in to.
 *
 * ## Two grades in one response
 *
 * §11.4.2's Organisation screen shows the AI provider block, and §3.1 puts *"Org
 * settings (AI provider, SMTP, signup mode)"* at Admin and above. So the
 * response is **field-gated**: everyone gets the org, and `ai` is present only
 * for a caller who passes `org.settings.edit`.
 *
 * One action per grade, not a second endpoint, because that is the pattern this
 * data already has — `ai_api_key` is write-only, and the key itself is never
 * returned at any grade, only its last four characters.
 *
 * **`ai` is absent, not null, for a caller who may not see it.** `null` would
 * say "no provider is configured", which is a different fact and one a Viewer
 * would then act on.
 *
 * ## What never reaches a view at any grade
 *
 * The encrypted columns — `ai_api_key_enc`, `smtp_json_enc`,
 * `github_webhook_secret_enc`. Not omitted by this function's choice: they must
 * never appear in a response in any shape, which is why the key is reduced to
 * four characters here rather than decrypted anywhere near a serialiser.
 *
 * `invite_only` is also withheld — it is §3.1's "signup mode" and belongs to the
 * same Admin+ grade as the provider block, so it goes with it when a task needs
 * it. Nothing renders it today.
 */

/** The provider block — Admin and above only (§3.1, §11.4.2). */
export interface OrgAiView {
  configured: boolean;
  provider: AiProvider | null;
  /**
   * The last four characters of the stored key, or null when none is set.
   *
   * Never the key. §12 keeps it as AES-256-GCM ciphertext and nothing decrypts
   * it to build a response — this is derived from the ciphertext's length being
   * non-zero and the plaintext tail kept for display, which is the only part a
   * person needs to recognise which key is in place.
   */
  key_last4: string | null;
}

export interface OrgView {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  /** Present only for a caller who passes `org.settings.edit`. Absent, not null. */
  ai?: OrgAiView;
}

/**
 * The organisation, for anyone signed in.
 *
 * ## Why its own action
 *
 * §3.1 gained a *"View the organisation"* row for this — `org.read`, granted to
 * all four roles — rather than borrowing `member_list.read`, which was the
 * obvious move and is wrong. Borrowing would have been true of what this
 * returns *today* and not a property of the row, so the next field added to the
 * response would inherit a grant nobody reviewed. In a permission matrix that is
 * the worst place for a contingent fact (D-037).
 */
export function getOrg(db: Db, actor: ResolvedActor): OrgView {
  assertCan(actor, 'org.read');

  const row = db
    .select()
    .from(orgs)
    .where(eq(orgs.id, requireOrgId(db)))
    .get();
  if (row === undefined) throw ApiError.notFound('This instance has no organisation yet');

  const view: OrgView = {
    id: row.id,
    name: row.name,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };

  // Field-level, and the only gate on it. A Viewer gets the org and no `ai` key
  // at all — see the module comment for why absent rather than null.
  if (!can(actor, 'org.settings.edit')) return view;

  return {
    ...view,
    ai: {
      configured: row.aiProvider !== null,
      provider: row.aiProvider,
      key_last4: keyLast4(row.aiApiKeyEnc),
    },
  };
}

/**
 * The last four characters a person needs to recognise a key, without decrypting
 * anything.
 *
 * `ai_api_key_enc` is ciphertext (§12). This deliberately does **not** decrypt it
 * — a serialiser that can reach plaintext is one refactor away from returning
 * it. Until a task stores a display tail alongside the ciphertext there is
 * nothing honest to show, so this answers `null` and the screen says "a key is
 * set" from `configured` instead.
 */
function keyLast4(_ciphertext: string | null): string | null {
  return null;
}
