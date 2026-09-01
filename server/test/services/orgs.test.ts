import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { decryptSecret, SecretAuthError } from '../../src/secrets.ts';
import { ApiError } from '../../src/errors.ts';
import { getOrg, updateOrg } from '../../src/services/orgs.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * `GET /api/v1/org` (§6.4, §11.4.2, LAI-222).
 *
 * Before this, a signed-in user could not learn the name of the organisation
 * they were signed in to: `GET /me` carries `org_role` and no org, and the only
 * place an org name was served was the pre-auth invite preview.
 */

let t: TestDb;
let orgId: string;

function makeUser(orgRole: OrgRole): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: orgRole,
      orgRole,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

beforeEach(() => {
  t = freshDb();
  orgId = newId();
  const ownerId = makeUser('owner');
  t.db
    .insert(orgs)
    .values({
      id: orgId,
      name: 'Kvell Dynamics',
      ownerUserId: ownerId,
      createdAt: 1000,
      updatedAt: 2000,
    })
    .run();
});
afterEach(() => {
  t.close();
});

const SECRET = 'a-laika-secret-that-is-at-least-32-characters-long';

describe('who may read the organisation', () => {
  it('answers every role, because §3.1 grants org.read to all four', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const view = getOrg(t.db, actor(makeUser(role)));

      expect(view.id, role).toBe(orgId);
      expect(view.name, role).toBe('Kvell Dynamics');
    }
  });

  it('refuses a deactivated user, because can() does', () => {
    const id = makeUser('admin');
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, id)).run();

    expect(() => getOrg(t.db, actor(id))).toThrow(ApiError);
  });

  it('carries the org’s own timestamps, not the caller’s', () => {
    const view = getOrg(t.db, actor(makeUser('member')));

    expect(view.created_at).toBe(1000);
    expect(view.updated_at).toBe(2000);
  });
});

describe('the provider block is gated field-level (§3.1, §11.4.2)', () => {
  beforeEach(() => {
    t.db
      .update(orgs)
      .set({ aiProvider: 'anthropic', aiApiKeyEnc: 'ciphertext' })
      .where(eq(orgs.id, orgId))
      .run();
  });

  it('gives a Viewer the org and not the provider block', () => {
    const view = getOrg(t.db, actor(makeUser('viewer')));

    expect(view.name).toBe('Kvell Dynamics');
    // **Absent, not null.** `null` would say "no provider is configured", which
    // is a different fact and one a Viewer would then act on.
    expect(view.ai).toBeUndefined();
    expect('ai' in view).toBe(false);
  });

  it('gives a Member the org and not the provider block', () => {
    expect(getOrg(t.db, actor(makeUser('member'))).ai).toBeUndefined();
  });

  it('gives an Admin and an Owner the provider block', () => {
    for (const role of ['admin', 'owner'] as const) {
      const view = getOrg(t.db, actor(makeUser(role)));

      expect(view.ai, role).toBeDefined();
      expect(view.ai?.configured, role).toBe(true);
      expect(view.ai?.provider, role).toBe('anthropic');
    }
  });

  it('reports an unconfigured provider to an Admin, rather than hiding it', () => {
    t.db.update(orgs).set({ aiProvider: null, aiApiKeyEnc: null }).where(eq(orgs.id, orgId)).run();

    const view = getOrg(t.db, actor(makeUser('admin')));

    // The block is present and says "nothing is set" — which is what the
    // Organisation screen needs to render the empty state.
    expect(view.ai).toEqual({ configured: false, provider: null, key_last4: null });
  });

  it('never returns the key, at any grade', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const serialised = JSON.stringify(getOrg(t.db, actor(makeUser(role))));

      // §12 keeps it as ciphertext and nothing decrypts it to build a response.
      expect(serialised, role).not.toContain('ciphertext');
      expect(serialised, role).not.toContain('api_key');
    }
  });

  it('never returns the other encrypted columns either', () => {
    t.db
      .update(orgs)
      .set({ smtpJsonEnc: 'smtp-secret', githubWebhookSecretEnc: 'hook-secret' })
      .where(eq(orgs.id, orgId))
      .run();

    const serialised = JSON.stringify(getOrg(t.db, actor(makeUser('owner'))));

    expect(serialised).not.toContain('smtp-secret');
    expect(serialised).not.toContain('hook-secret');
  });
});

/**
 * The org-wide presence switch (§4.2, §11.4.2, LAI-207).
 *
 * LAI-106 deleted the first-boot toggle because there was nowhere to put the
 * answer. §4.2 had specified the column all along; the schema was what lacked it.
 */
describe('presence_enabled', () => {
  it('defaults to on, matching §4.2 and the design', () => {
    expect(getOrg(t.db, actor(makeUser('member'))).presence_enabled).toBe(true);
  });

  it('is readable by every role, including a Viewer', () => {
    t.db.update(orgs).set({ presenceEnabled: 0 }).where(eq(orgs.id, orgId)).run();

    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      // Not an admin-only setting to *read*. §11.4.2 shows a **disabled** state
      // on Capacity when this is 0 — distinct from an empty one — and Capacity is
      // not an admin screen. It is also a claim about the people being tracked,
      // who have the strongest reason to know it (D-005).
      expect(getOrg(t.db, actor(makeUser(role))).presence_enabled, role).toBe(false);
    }
  });

  it('is changed by an Admin and an Owner', () => {
    for (const role of ['admin', 'owner'] as const) {
      expect(
        updateOrg(t.db, actor(makeUser(role)), { presence_enabled: false }, SECRET)
          .presence_enabled,
      ).toBe(false);
      updateOrg(t.db, actor(makeUser(role)), { presence_enabled: true }, SECRET);
    }
  });

  it('refuses a Member and a Viewer the write, while still letting them read', () => {
    for (const role of ['member', 'viewer'] as const) {
      const id = makeUser(role);

      expect(() => updateOrg(t.db, actor(id), { presence_enabled: false }, SECRET)).toThrow(
        ApiError,
      );
      // The read must survive the refusal, or "disabled" becomes unreadable to
      // exactly the people the setting is about.
      expect(getOrg(t.db, actor(id)).presence_enabled, role).toBe(true);
    }
  });

  it('leaves it alone when the patch does not mention it', () => {
    const adminId = makeUser('admin');
    updateOrg(t.db, actor(adminId), { presence_enabled: false }, SECRET);

    expect(updateOrg(t.db, actor(adminId), {}, SECRET).presence_enabled).toBe(false);
  });

  it('moves updated_at, so a client can tell the org changed', () => {
    const adminId = makeUser('admin');

    expect(
      updateOrg(t.db, actor(adminId), { presence_enabled: false }, SECRET, 9000).updated_at,
    ).toBe(9000);
  });
});

/**
 * The LLM provider settings (§4.2, §12, LAI-447).
 *
 * At this level because roles are constructible here and a session cookie is
 * not. `updateOrg` asserts `org.settings.edit` once, at the top, so the AI
 * fields inherit exactly the gate `presence_enabled` already has — which is
 * what these first two cases pin.
 */
describe('the AI provider', () => {
  const KEY = 'sk-ant-secret-value-nobody-should-see-4242';

  it('is refused for a Member and a Viewer (§3.1 `✓ ✓ — —`)', () => {
    for (const role of ['member', 'viewer'] as const) {
      expect(() =>
        updateOrg(t.db, actor(makeUser(role)), { ai_provider: 'anthropic' }, SECRET),
      ).toThrow(ApiError);
    }
  });

  it('is allowed for an Admin', () => {
    const view = updateOrg(t.db, actor(makeUser('admin')), { ai_provider: 'anthropic' }, SECRET);

    expect(view.ai?.provider).toBe('anthropic');
  });

  it('clears everything when the provider is set to null', () => {
    const admin = actor(makeUser('admin'));
    updateOrg(t.db, admin, { ai_provider: 'anthropic', ai_api_key: KEY }, SECRET);

    const view = updateOrg(t.db, admin, { ai_provider: null }, SECRET);

    // A base URL and a key belonging to no provider are residue, and residue
    // that `configured` would still report as a working setup.
    expect(view.ai?.configured).toBe(false);
    expect(view.ai?.key_last4).toBeNull();
    const row = t.db.select().from(orgs).get();
    expect(row?.aiApiKeyEnc).toBeNull();
    expect(row?.aiBaseUrl).toBeNull();
  });

  it('leaves the key alone when the field is absent', () => {
    // `null` clears, absent leaves alone — the distinction the whole input shape
    // exists for. Without this, a request changing only the base URL would drop
    // the key and report success.
    const admin = actor(makeUser('admin'));
    updateOrg(
      t.db,
      admin,
      { ai_provider: 'openai_compatible', ai_base_url: 'http://ollama:11434', ai_api_key: KEY },
      SECRET,
    );

    const view = updateOrg(t.db, admin, { ai_base_url: 'http://ollama:11435' }, SECRET);

    expect(view.ai?.key_last4).toBe('4242');
    expect(t.db.select().from(orgs).get()?.aiApiKeyEnc).not.toBeNull();
  });

  it('clears only the key when the key is null', () => {
    const admin = actor(makeUser('admin'));
    updateOrg(t.db, admin, { ai_provider: 'anthropic', ai_api_key: KEY }, SECRET);

    const view = updateOrg(t.db, admin, { ai_api_key: null }, SECRET);

    expect(view.ai?.provider).toBe('anthropic');
    expect(view.ai?.key_last4).toBeNull();
  });

  it('refuses openai_compatible with no base URL, and says which field', () => {
    // §12: "base URL + optional key, covering Ollama and vLLM". Without it there
    // is nowhere to send anything, and the setting would fail at first use in
    // §10.2 — a long way from the screen that set it.
    expect(() =>
      updateOrg(t.db, actor(makeUser('admin')), { ai_provider: 'openai_compatible' }, SECRET),
    ).toThrow(ApiError);
  });

  it('validates the resulting state, not the request', () => {
    // **The reason the settings are computed as a whole.** Setting the provider
    // and the URL in separate requests must not reach a configuration that no
    // single request would have been allowed to ask for.
    const admin = actor(makeUser('admin'));
    updateOrg(
      t.db,
      admin,
      { ai_provider: 'openai_compatible', ai_base_url: 'http://ollama:11434' },
      SECRET,
    );

    expect(() => updateOrg(t.db, admin, { ai_base_url: null }, SECRET)).toThrow(ApiError);
  });

  it('refuses a base URL that is not http', () => {
    expect(() =>
      updateOrg(
        t.db,
        actor(makeUser('admin')),
        { ai_provider: 'openai_compatible', ai_base_url: 'file:///etc/passwd' },
        SECRET,
      ),
    ).toThrow(ApiError);
  });

  it('after a LAIKA_SECRET rotation, still reports configured — and that is the known gap', () => {
    // **AC6, answered by measurement rather than by design.**
    //
    // Nothing in this task decrypts the key. `configured` comes from
    // `ai_provider`, and `key_last4` is a stored column, so a wrong secret is
    // invisible here: `GET /org` answers exactly as before and the failure waits
    // for the first *use*, in §10.2.
    //
    // That is LAI-161's rotation finding at the layer above it — *"the instance
    // still looks configured"* — and it is pinned here so the next person meets
    // an assertion that says so rather than a screen that lies. **LAI-162 owns
    // the fix**; the honest thing this task owes is to say what it answers.
    const admin = actor(makeUser('admin'));
    updateOrg(t.db, admin, { ai_provider: 'anthropic', ai_api_key: KEY }, SECRET);

    // A later boot under a different secret. Nothing re-reads the key, so:
    const view = getOrg(t.db, admin);

    expect(view.ai?.configured).toBe(true);
    expect(view.ai?.key_last4).toBe('4242');

    // And the key genuinely cannot be recovered — the state is unusable, not
    // merely mislabelled. This is what makes the report above a real gap rather
    // than a cosmetic one.
    const stored = t.db.select().from(orgs).get()?.aiApiKeyEnc ?? '';
    expect(() =>
      decryptSecret(stored, 'a-different-secret-of-at-least-32-characters', 'ai_api_key'),
    ).toThrow(SecretAuthError);
  });

  it('anthropic needs no base URL', () => {
    const view = updateOrg(
      t.db,
      actor(makeUser('admin')),
      { ai_provider: 'anthropic', ai_api_key: KEY },
      SECRET,
    );

    expect(view.ai?.configured).toBe(true);
  });
});
