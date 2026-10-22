import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPayload } from '../../../src/db/activity.ts';
import { activity, orgs, users } from '../../../src/db/schema.ts';
import { ALL_ACTIONS } from '../../../src/policy/actions.ts';
import { CAPABILITY_DESCRIPTIONS } from '../../../src/policy/grants.ts';
import { type OrgPermissionsView } from '../../../src/services/org-permissions.ts';
import { type PermissionsView } from '../../../src/services/permissions.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /api/v1/permissions` (SPEC §6.4, LAI-885).
 *
 * The service owns the matrix and is asserted in `services/permissions.test.ts`.
 * What is left here is that the route is **mounted**, answers `401` signed
 * out, and is reachable by a session and by a token — a `read_only` one
 * included, because `org.read` is a read.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

beforeEach(async () => {
  h = authHarness();
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
});
afterEach(() => {
  h.close();
});

async function mint(scope: 'full' | 'read_only'): Promise<string> {
  const res = await h.app.request('/api/v1/tokens', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({ name: 'Agent', scope }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
}

describe('GET /api/v1/permissions', () => {
  it('serves the catalogue and the caller to a session', async () => {
    const res = await h.app.request('/api/v1/permissions', {
      headers: jsonHeaders({ Cookie: cookie }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PermissionsView;
    const humanActions = ALL_ACTIONS.filter((a) => !a.startsWith('system.'));
    expect(body.permissions.map((p) => p.action).sort()).toEqual([...humanActions].sort());
    expect(body.org_roles).toEqual(['owner', 'admin', 'member', 'viewer']);
    expect(body.project_roles).toEqual(['lead', 'member', 'viewer']);
    expect(body.me.org_role).toBe('owner');
    expect(body.me.credential).toBe('session');
    expect(body.me.actions).toContain('webhook.configure');
    // The setup owner is lead of the first project, by membership or implicitly.
    expect(body.me.implicit_project_role).toBe('lead');

    // D-102 rule 5 (LAI-958): roles are the owner's; an admin invites as
    // member or viewer.
    expect(body.permissions.find((p) => p.action === 'user.set_role')).toMatchObject({
      scope: 'org',
      label: 'Change org roles',
      condition: null,
      roles: { owner: 'yes', admin: 'no', member: 'no', viewer: 'no' },
    });
    expect(body.permissions.find((p) => p.action === 'user.invite')).toMatchObject({
      label: 'Invite users',
      condition: 'As Member or Viewer only',
      roles: { owner: 'yes', admin: 'conditional', member: 'no', viewer: 'no' },
    });

    // Every action has a §3 row now (LAI-953), so nothing comes back label-less;
    // presence and capacity were the last two.
    expect(body.permissions.filter((p) => p.label === null).map((p) => p.action)).toEqual([]);
    for (const action of ['presence.read', 'capacity.read']) {
      expect(body.permissions.find((p) => p.action === action)?.label, action).toBe(
        'Presence and capacity',
      );
    }
  });

  it('is reachable on a read-only token, and narrows me to it', async () => {
    const secret = await mint('read_only');
    const res = await h.app.request('/api/v1/permissions', {
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PermissionsView;
    expect(body.me.credential).toBe('token');
    expect(body.me.actions).toContain('org.read');
    expect(body.me.actions).not.toContain('org.delete');
    expect(body.me.actions).not.toContain('webhook.configure');
  });

  it('is reachable on a full token, which still holds no session-only action', async () => {
    const secret = await mint('full');
    const res = await h.app.request('/api/v1/permissions', {
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PermissionsView;
    expect(body.me.actions).toContain('org.delete');
    expect(body.me.actions).not.toContain('webhook.configure');
  });

  it('401s when signed out', async () => {
    const res = await h.app.request('/api/v1/permissions', { headers: jsonHeaders() });

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });
});

/**
 * `GET` and `PUT /api/v1/org/permissions` (SPEC §6.4, D-102 rule 6,
 * LAI-958), and that `GET /api/v1/permissions` follows what was saved — on
 * the next request, through the actor `loadActor` builds.
 */
describe('/api/v1/org/permissions', () => {
  const ALL_OFF = {
    see_people_analytics: false,
    see_org_activity: false,
    open_all_projects: false,
    invite_people: false,
    deactivate_people: false,
    create_archive_projects: false,
    manage_any_tokens: false,
    change_org_settings: false,
  };
  const ALL_ON = Object.fromEntries(Object.keys(ALL_OFF).map((k) => [k, true]));
  const DEFAULTS = { admin: ALL_ON, member: ALL_OFF, viewer: ALL_OFF };

  async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<string> {
    const orgId = h.db.select({ id: orgs.id }).from(orgs).get()!.id;
    const ownerId = h.db.select({ id: users.id }).from(users).get()!.id;
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
    const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
    expect(res.status, await res.clone().text()).toBe(200);
    return cookieFrom(res);
  }

  function put(grants: unknown, headers: Record<string, string>): Promise<Response> {
    return Promise.resolve(
      h.app.request('/api/v1/org/permissions', {
        method: 'PUT',
        headers: jsonHeaders(headers),
        body: JSON.stringify({ grants }),
      }),
    );
  }

  async function errorOf(res: Response): Promise<{ code: string; details: unknown }> {
    return ((await res.json()) as { error: { code: string; details: unknown } }).error;
  }

  function roleChanges() {
    return h.db.select().from(activity).where(eq(activity.type, 'member.role_changed')).all();
  }

  it('answers the defaults to anyone signed in, and 401 to nobody', async () => {
    const member = await join('m@example.test', 'member');
    const res = await h.app.request('/api/v1/org/permissions', {
      headers: jsonHeaders({ Cookie: member }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as OrgPermissionsView;
    expect(body.roles).toEqual(['admin', 'member', 'viewer']);
    expect(body.grants).toEqual(DEFAULTS);
    expect(body.capabilities.map((c) => c.id)).toEqual(Object.keys(ALL_OFF));
    expect(body.capabilities.find((c) => c.id === 'see_org_activity')).toEqual({
      id: 'see_org_activity',
      label: "See the organisation's activity history",
      description: CAPABILITY_DESCRIPTIONS.see_org_activity,
      actions: ['audit_log.export'],
    });
    // Every capability carries the server's one-line description (LAI-985).
    for (const capability of body.capabilities) {
      expect(capability.description, capability.id).toBe(CAPABILITY_DESCRIPTIONS[capability.id]);
    }
    expect(body.capabilities.find((c) => c.id === 'deactivate_people')).toMatchObject({
      label: 'Deactivate people and reset access',
      actions: ['user.deactivate', 'user.sign_out'],
    });
    expect(body.owner_locked.map((o) => o.action)).toEqual([
      'org.delete',
      'org.transfer_ownership',
      'user.set_role',
      'org.permissions.manage',
    ]);
    expect(body.updated_at).toBeNull();

    const anon = await h.app.request('/api/v1/org/permissions', { headers: jsonHeaders() });
    expect(anon.status).toBe(401);
  });

  it('lets the owner grant a member analytics, and the member then holds it', async () => {
    const member = await join('m@example.test', 'member');
    const ownerId = h.db.select({ id: users.id }).from(users).get()!.id;
    const memberId = h.db.select().from(users).where(eq(users.email, 'm@example.test')).get()!.id;

    // Refused before the grant — the profile read is the effect, not the matrix.
    const before = await h.app.request(`/api/v1/users/${ownerId}/profile`, {
      headers: jsonHeaders({ Cookie: member }),
    });
    expect(before.status).toBe(403);

    const grants = { ...DEFAULTS, member: { ...ALL_OFF, see_people_analytics: true } };
    const res = await put(grants, { Cookie: cookie });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = (await res.json()) as OrgPermissionsView;
    expect(saved.grants).toEqual(grants);
    expect(saved.updated_at).not.toBeNull();
    expect(saved.updated_by).toBe(ownerId);

    // One audit row, org-scoped, the matrix before and after.
    const rows = roleChanges();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.projectId).toBeNull();
    expect(readPayload(rows[0]!)).toMatchObject({
      scope: 'org_permissions',
      from: { member: [] },
      to: { member: ['see_people_analytics'] },
    });

    const after = await h.app.request(`/api/v1/users/${ownerId}/profile`, {
      headers: jsonHeaders({ Cookie: member }),
    });
    expect(after.status, await after.clone().text()).toBe(200);

    // LAI-885's catalogue follows: the member column and the member's own actions.
    const catalogue = (await (
      await h.app.request('/api/v1/permissions', { headers: jsonHeaders({ Cookie: member }) })
    ).json()) as PermissionsView;
    expect(catalogue.permissions.find((p) => p.action === 'profile.read')?.roles).toEqual({
      owner: 'yes',
      admin: 'yes',
      member: 'yes',
      viewer: 'no',
    });
    expect(catalogue.me.actions).toContain('profile.read');
    expect(catalogue.me.actions).not.toContain('audit_log.export');
    expect(memberId).not.toBe(ownerId);
  });

  it('takes a capability from admin, and the admin loses it at once', async () => {
    const admin = await join('a@example.test', 'admin');
    const history = () =>
      h.app.request('/api/v1/activity/history', { headers: jsonHeaders({ Cookie: admin }) });
    expect((await history()).status).toBe(200);

    const res = await put(
      { ...DEFAULTS, admin: { ...ALL_ON, see_org_activity: false } },
      {
        Cookie: cookie,
      },
    );
    expect(res.status, await res.clone().text()).toBe(200);

    const refused = await history();
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toMatchObject({
      code: 'forbidden',
      details: { action: 'audit_log.export' },
    });
  });

  it('refuses an admin, and the owner on a token', async () => {
    const admin = await join('a@example.test', 'admin');
    const byAdmin = await put(DEFAULTS, { Cookie: admin });
    expect(byAdmin.status).toBe(403);
    expect(await errorOf(byAdmin)).toMatchObject({
      code: 'forbidden',
      details: { action: 'org.permissions.manage' },
    });

    const secret = await mint('full');
    const byToken = await put(DEFAULTS, { Authorization: `Bearer ${secret}` });
    expect(byToken.status).toBe(403);
    expect(await errorOf(byToken)).toMatchObject({
      code: 'forbidden',
      details: { action: 'org.permissions.manage', reason: 'session_required' },
    });
    expect(roleChanges()).toHaveLength(0);
  });

  it('refuses an owner-locked action by name, 422', async () => {
    for (const action of ['user.set_role', 'org.delete', 'org.permissions.manage']) {
      const res = await put(
        { ...DEFAULTS, admin: { ...ALL_ON, [action]: true } },
        {
          Cookie: cookie,
        },
      );
      expect(res.status, action).toBe(422);
      expect(await errorOf(res)).toMatchObject({
        code: 'unprocessable',
        details: { field: `grants.admin.${action}`, reason: 'owner_locked' },
      });
    }
    expect(roleChanges()).toHaveLength(0);
  });

  it('refuses a partial or unknown matrix, 422, and the owner column', async () => {
    const cases: [unknown, string][] = [
      [{ ...DEFAULTS, owner: ALL_OFF }, 'grants.owner'],
      [{ admin: ALL_ON, member: ALL_OFF }, 'grants.viewer'],
      [{ ...DEFAULTS, member: { see_org_activity: true } }, 'grants.member'],
      [
        { ...DEFAULTS, member: { ...ALL_OFF, see_everything: true } },
        'grants.member.see_everything',
      ],
      [{ ...DEFAULTS, lead: ALL_OFF }, 'grants.lead'],
    ];
    for (const [grants, field] of cases) {
      const res = await put(grants, { Cookie: cookie });
      expect(res.status, field).toBe(422);
      expect(await errorOf(res), field).toMatchObject({
        code: 'unprocessable',
        details: { field },
      });
    }

    const notBoolean = await put(
      { ...DEFAULTS, member: { ...ALL_OFF, invite_people: 'yes' } },
      {
        Cookie: cookie,
      },
    );
    expect(notBoolean.status).toBe(422);
    expect(roleChanges()).toHaveLength(0);
  });

  it('refuses the retired manage_people by name as not a capability (LAI-985)', async () => {
    const res = await put(
      { ...DEFAULTS, member: { ...ALL_OFF, manage_people: true } },
      { Cookie: cookie },
    );
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({
      code: 'unprocessable',
      details: { field: 'grants.member.manage_people' },
    });
  });

  it('spaces and tokens follow the grant: withdrawn from admin, the admin is refused 403 (LAI-985)', async () => {
    const admin = await join('a@example.test', 'admin');
    const ownerId = h.db.select({ id: users.id }).from(users).get()!.id;
    const create = (who: string, slug: string) =>
      h.app.request('/api/v1/projects', {
        method: 'POST',
        headers: jsonHeaders({ Cookie: who }),
        body: JSON.stringify({ name: slug, slug, prefix: slug.toUpperCase().slice(0, 3) }),
      });
    const tokensOf = (who: string) =>
      h.app.request(`/api/v1/users/${ownerId}/tokens`, { headers: jsonHeaders({ Cookie: who }) });

    expect((await create(admin, 'alpha')).status).toBe(201);
    expect((await tokensOf(admin)).status).toBe(200);

    const withdrawn = {
      ...DEFAULTS,
      admin: { ...ALL_ON, create_archive_projects: false, manage_any_tokens: false },
    };
    expect((await put(withdrawn, { Cookie: cookie })).status).toBe(200);

    const refusedCreate = await create(admin, 'beta');
    expect(refusedCreate.status).toBe(403);
    expect(await errorOf(refusedCreate)).toMatchObject({
      code: 'forbidden',
      details: { action: 'project.create' },
    });
    const refusedTokens = await tokensOf(admin);
    expect(refusedTokens.status).toBe(403);
    expect(await errorOf(refusedTokens)).toMatchObject({
      code: 'forbidden',
      details: { action: 'token.list_any' },
    });
  });

  it('a member granted Invite people invites, and is still refused deactivating (LAI-985)', async () => {
    const member = await join('m@example.test', 'member');
    await join('v@example.test', 'viewer');
    const viewerId = h.db.select().from(users).where(eq(users.email, 'v@example.test')).get()!.id;

    expect(
      (await put({ ...DEFAULTS, member: { ...ALL_OFF, invite_people: true } }, { Cookie: cookie }))
        .status,
    ).toBe(200);

    const invited = await h.app.request('/api/v1/invites', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: member }),
      body: JSON.stringify({ org_role: 'viewer' }),
    });
    expect(invited.status, await invited.clone().text()).toBe(201);

    const deactivate = await h.app.request(`/api/v1/users/${viewerId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ Cookie: member }),
      body: JSON.stringify({ is_active: false }),
    });
    expect(deactivate.status).toBe(403);
    expect(await errorOf(deactivate)).toMatchObject({
      code: 'forbidden',
      details: { action: 'user.deactivate' },
    });
  });

  it('writes nothing for a matrix that changes nothing', async () => {
    const res = await put(DEFAULTS, { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(roleChanges()).toHaveLength(0);
    expect(((await res.json()) as OrgPermissionsView).updated_at).toBeNull();
  });
});
