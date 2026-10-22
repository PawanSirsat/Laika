import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AiProvider } from '../db/enums.ts';

/**
 * Re-exported so `routes/orgs.ts` can validate a provider without importing
 * `db/` (CONVENTIONS §2, LAI-119). The same line, for the same reason, as
 * `TASK_STATUSES` on `services/tasks.ts`.
 */
export { AI_PROVIDERS } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { orgs } from '../db/schema.ts';
import { encryptSecret } from '../secrets.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { extraOwners } from './users.ts';

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

/**
 * The GitHub webhook block (§10.1, LAI-753) — for a caller who may configure
 * webhooks, on a web session (§3.1). **Never the secret**: it is shown once,
 * by the call that made it, and nothing decrypts it to build a view.
 */
export interface OrgGithubWebhookView {
  configured: boolean;
  /**
   * What to paste into GitHub's *Payload URL*: `LAIKA_PUBLIC_URL` and
   * `/webhooks/github`. Null when the server has no public URL configured, and
   * the screen then builds it from the address it was opened at.
   */
  payload_url: string | null;
}

/** The path §10 mounts the GitHub webhook at — outside `/api/v1`. */
export const GITHUB_WEBHOOK_PATH = '/webhooks/github';

export interface OrgView {
  id: string;
  name: string;
  /**
   * Whether presence tracking is on for the org (§4.2, LAI-207).
   *
   * **Readable by everyone, writable by Admin and above**, and the read side is
   * not an oversight. §11.4.2 says Capacity shows a **disabled** state when this
   * is `0` — distinct from an empty one — so anyone who can open Capacity has to
   * be able to tell the two apart, and Capacity is not an admin screen.
   *
   * It also leaks nothing. This is a statement about the org's privacy posture
   * towards the people it would otherwise track, and **they are precisely who
   * has the strongest claim to know it** (D-005). Hiding it from a Member would
   * mean the promise is made about them and visible only to somebody else.
   */
  presence_enabled: boolean;
  /**
   * The organisation's Developer insights (§4.2, LAI-751): whether every
   * connected machine's local activity counts are collected. Since D-102
   * (amended) it decides alone — no person's own switch is read. Default off.
   *
   * **Readable by everyone, for presence's reason.** It is a statement about
   * what the org collects about the people in it, and they have the
   * strongest claim to know it; the Connect screen shows it to the developer
   * whose machine it collects from.
   */
  developer_insights: boolean;
  created_at: number;
  updated_at: number;
  /** Present only for a caller who passes `org.settings.edit`. Absent, not null. */
  ai?: OrgAiView;
  /** Present only for a caller who passes `webhook.configure`. Absent, not null. */
  github_webhook?: OrgGithubWebhookView;
  /**
   * Active owners besides the one `orgs.owner_user_id` names — normally empty
   * (D-104 item 2, LAI-982). Organisations from before D-104 may have more
   * than one, and they are **reported here, not demoted silently**. Present
   * only for a caller who passes `org.transfer_ownership`: the owner, signed
   * in, who is the one able to act on it. Absent, not null.
   */
  extra_owners?: { id: string; name: string; email: string }[];
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
export function getOrg(db: Db, actor: ResolvedActor, publicUrl = ''): OrgView {
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
    presence_enabled: row.presenceEnabled === 1,
    developer_insights: row.developerInsights === 1,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };

  // Field-level, and the only gate on it. A Viewer gets the org and no `ai` key
  // at all — see the module comment for why absent rather than null.
  const withAi: OrgView = can(actor, 'org.settings.edit')
    ? {
        ...view,
        ai: {
          configured: row.aiProvider !== null,
          provider: row.aiProvider,
          key_last4: keyLast4(row.aiKeyLast4),
        },
      }
    : view;

  // Its own grade: §3.1's *Configure webhooks*, session only (LAI-753).
  const withWebhook: OrgView = can(actor, 'webhook.configure')
    ? { ...withAi, github_webhook: githubWebhookView(row.githubWebhookSecretEnc, publicUrl) }
    : withAi;

  // The owner's, signed in (LAI-982): who else holds the role today.
  if (!can(actor, 'org.transfer_ownership')) return withWebhook;
  return { ...withWebhook, extra_owners: extraOwners(db) };
}

function githubWebhookView(enc: string | null, publicUrl: string): OrgGithubWebhookView {
  const base = publicUrl.replace(/\/+$/, '');
  return {
    configured: enc !== null && enc !== '',
    payload_url: base === '' ? null : `${base}${GITHUB_WEBHOOK_PATH}`,
  };
}

/** 32 random bytes as hex: GitHub accepts any string, and this one is unguessable. */
const WEBHOOK_SECRET_BYTES = 32;

/**
 * What setting or rotating the secret answers — the one time it is shown.
 * Spelled out rather than extending `OrgGithubWebhookView`, so the drift
 * check compares every field it serves (it reads a type's own fields).
 */
export interface GithubWebhookSecretView {
  configured: boolean;
  payload_url: string | null;
  /** The new secret, in plaintext. **Never served again** (§12). */
  secret: string;
}

/**
 * Set or rotate the GitHub webhook secret (§10.1, §3.1, LAI-753).
 *
 * **Laika makes the secret** rather than accepting one: a person pasting a
 * secret they invented is a person choosing a weak one, and a generated one
 * costs them nothing — they copy it into GitHub either way. It is answered
 * here once, in plaintext, and stored only as §12's ciphertext under its own
 * purpose; nothing decrypts it to build a response afterwards.
 *
 * **Rotating replaces it at once.** Every delivery signed with the old secret
 * is refused `401` from this moment, so the screen says to paste the new one
 * into GitHub straight away.
 *
 * **Session only** (§3.1): whoever holds this secret can sign deliveries that
 * confirm an agent's proof (D-083), so an agent's token must never be able to
 * mint one for itself.
 *
 * No `activity` row: §4.8 has no verb for it, as for `developer_insights`.
 */
export function rotateGithubWebhookSecret(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  now: number = Date.now(),
  publicUrl = '',
): GithubWebhookSecretView {
  assertCan(actor, 'webhook.configure');
  if (serverSecret === '') throw new ApiError('internal', 'This server cannot store secrets');

  const secret = randomBytes(WEBHOOK_SECRET_BYTES).toString('hex');
  const enc = encryptSecret(secret, serverSecret, 'github_webhook_secret');
  db.update(orgs)
    .set({ githubWebhookSecretEnc: enc, updatedAt: now })
    .where(eq(orgs.id, requireOrgId(db)))
    .run();

  return { ...githubWebhookView(enc, publicUrl), secret };
}

/**
 * Clear the GitHub webhook secret: every delivery is refused `401` until one
 * is set again (§10.1's *absent means refuse*).
 */
export function clearGithubWebhookSecret(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
): void {
  assertCan(actor, 'webhook.configure');
  db.update(orgs)
    .set({ githubWebhookSecretEnc: null, updatedAt: now })
    .where(eq(orgs.id, requireOrgId(db)))
    .run();
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
function keyLast4(last4: string | null): string | null {
  return last4;
}

/**
 * Change org settings (§3.1's *"Org settings"* row, §6.4, LAI-207).
 *
 * **Admin and above, not Owner-only.** LAI-207's criteria say Owner-only; §3.1's
 * row is `✓ ✓ — —`, and D-011 makes the spec authoritative. Reported rather than
 * silently followed either way.
 *
 * `presence_enabled`, D-079's `developer_insights` (LAI-751) and the AI provider
 * (LAI-447). SMTP is the same §3.1 row and the same action, but carries
 * encryption (§12) and belongs with the task that builds its screen — a
 * setter that could write `ai_api_key_enc` without the key-derivation path is
 * a hole waiting for a caller. The GitHub webhook secret is *Configure
 * webhooks*, its own row, and has its own two calls above (LAI-753).
 */
/**
 * `null` clears, absent leaves alone (§6.4, LAI-447).
 *
 * The distinction this repo has now drawn four times, and it matters most here:
 * *"stop using a provider"* and *"I am editing something else"* are different
 * requests, and a shape that cannot tell them apart makes the first one
 * impossible to express.
 */
export interface UpdateOrgInput {
  /**
   * The organisation's name (D-104 item 7, LAI-984), 1–80 characters, trimmed
   * by the route. Writes no `activity` row: §4.8 has no verb for it.
   */
  name?: string | undefined;
  presence_enabled?: boolean | undefined;
  /** D-079's org switch (LAI-751). Writes no `activity` row: §4.8 has no verb for it. */
  developer_insights?: boolean | undefined;
  ai_provider?: AiProvider | null | undefined;
  ai_base_url?: string | null | undefined;
  /** Write-only. Never read back, at any grade (§12). */
  ai_api_key?: string | null | undefined;
}

/**
 * What the org's AI settings become, before anything is written.
 *
 * Computed as a whole rather than field by field so the invariant below is
 * checked against the **resulting** state. Applying three independent updates
 * and validating each one lets a caller reach a configuration that no single
 * request would have been allowed to ask for.
 */
interface AiSettings {
  provider: AiProvider | null;
  baseUrl: string | null;
  keyEnc: string | null;
  keyLast4: string | null;
}

/** The tail §12 lets the UI show. Short keys keep whatever they have. */
function lastFour(key: string): string {
  return key.slice(-4);
}

function nextAiSettings(
  current: AiSettings,
  input: UpdateOrgInput,
  serverSecret: string,
): AiSettings {
  // Clearing the provider clears the configuration. A base URL and a key
  // belonging to no provider are not settings, they are residue — and residue
  // that `configured` would still report as a working setup.
  if (input.ai_provider === null) {
    return { provider: null, baseUrl: null, keyEnc: null, keyLast4: null };
  }

  const next: AiSettings = {
    provider: input.ai_provider ?? current.provider,
    baseUrl: input.ai_base_url === undefined ? current.baseUrl : input.ai_base_url,
    keyEnc: current.keyEnc,
    keyLast4: current.keyLast4,
  };

  if (input.ai_api_key === null) {
    next.keyEnc = null;
    next.keyLast4 = null;
  } else if (input.ai_api_key !== undefined) {
    next.keyEnc = encryptSecret(input.ai_api_key, serverSecret, 'ai_api_key');
    // **The one moment the tail is known without decrypting anything.**
    next.keyLast4 = lastFour(input.ai_api_key);
  }

  assertUsable(next);
  return next;
}

/**
 * A configuration that cannot work is refused at the boundary.
 *
 * §12: `openai_compatible` is *"base URL + optional key, covering Ollama and
 * vLLM"*. Without the URL there is nowhere to send anything, so the setting
 * would sit there reporting `configured: true` and fail at the first use — in
 * §10.2, a long way from the screen that set it.
 */
function assertUsable(next: AiSettings): void {
  if (next.provider === 'openai_compatible' && (next.baseUrl === null || next.baseUrl === '')) {
    throw new ApiError('unprocessable', 'openai_compatible needs a base URL', {
      field: 'ai_base_url',
    });
  }

  if (next.baseUrl !== null && next.baseUrl !== '' && !isHttpUrl(next.baseUrl)) {
    throw new ApiError('unprocessable', 'ai_base_url must be an http or https URL', {
      field: 'ai_base_url',
    });
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function updateOrg(
  db: Db,
  actor: ResolvedActor,
  input: UpdateOrgInput,
  serverSecret: string,
  now: number = Date.now(),
  publicUrl = '',
): OrgView {
  assertCan(actor, 'org.settings.edit');
  // Asked before anything is written, so a token's request that also carries
  // another setting changes nothing at all (D-079, LAI-751 review).
  if (input.developer_insights !== undefined) assertCan(actor, 'org.developer_insights.set');

  const orgId = requireOrgId(db);

  // One transaction, so a request refused by the AI settings' check below
  // changes nothing — not even the name or presence given beside it.
  db.transaction(() => {
    if (input.name !== undefined) {
      db.update(orgs).set({ name: input.name, updatedAt: now }).where(eq(orgs.id, orgId)).run();
    }

    if (input.presence_enabled !== undefined) {
      db.update(orgs)
        .set({ presenceEnabled: input.presence_enabled ? 1 : 0, updatedAt: now })
        .where(eq(orgs.id, orgId))
        .run();
    }

    if (input.developer_insights !== undefined) {
      db.update(orgs)
        .set({ developerInsights: input.developer_insights ? 1 : 0, updatedAt: now })
        .where(eq(orgs.id, orgId))
        .run();
    }

    const touchesAi =
      input.ai_provider !== undefined ||
      input.ai_base_url !== undefined ||
      input.ai_api_key !== undefined;

    if (touchesAi) {
      const row = db
        .select({
          provider: orgs.aiProvider,
          baseUrl: orgs.aiBaseUrl,
          keyEnc: orgs.aiApiKeyEnc,
          keyLast4: orgs.aiKeyLast4,
        })
        .from(orgs)
        .where(eq(orgs.id, orgId))
        .get();

      const next = nextAiSettings(
        {
          provider: row?.provider ?? null,
          baseUrl: row?.baseUrl ?? null,
          keyEnc: row?.keyEnc ?? null,
          keyLast4: row?.keyLast4 ?? null,
        },
        input,
        serverSecret,
      );

      db.update(orgs)
        .set({
          aiProvider: next.provider,
          aiBaseUrl: next.baseUrl,
          aiApiKeyEnc: next.keyEnc,
          aiKeyLast4: next.keyLast4,
          updatedAt: now,
        })
        .where(eq(orgs.id, orgId))
        .run();
    }
  });

  return getOrg(db, actor, publicUrl);
}
