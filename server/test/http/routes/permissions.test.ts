import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_ACTIONS } from '../../../src/policy/actions.ts';
import { type PermissionsView } from '../../../src/services/permissions.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

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

    const setRole = body.permissions.find((p) => p.action === 'user.set_role');
    expect(setRole).toMatchObject({
      scope: 'org',
      label: 'Invite users / change org roles',
      condition: 'Any role except Owner',
      roles: { owner: 'yes', admin: 'conditional', member: 'no', viewer: 'no' },
    });
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
