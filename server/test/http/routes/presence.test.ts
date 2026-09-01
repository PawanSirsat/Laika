import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import { heartbeats, orgs, users } from '../../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * `GET /api/v1/presence` and `GET /api/v1/capacity` (§9.3, LAI-432).
 *
 * The service owns the rules. What is left here is that both are **mounted**,
 * that they answer `401` signed out, and that `enabled` survives serialisation —
 * which is the field a client renders §11.4.2's disabled state from.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

interface PresenceBody {
  enabled: boolean;
  present: { user_id: string; is_agent: boolean }[];
}

interface CapacityBody {
  enabled: boolean;
  people: { user_id: string; active_sessions: number; unlisted?: string[] }[];
}

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

async function get(path: string): Promise<Response> {
  return h.app.request(path, { headers: jsonHeaders({ Cookie: cookie }) });
}

describe('both endpoints are mounted', () => {
  it('serves presence', async () => {
    const res = await get('/api/v1/presence');

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as PresenceBody).enabled).toBe(true);
  });

  it('serves capacity', async () => {
    const res = await get('/api/v1/capacity');

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as CapacityBody).people.length).toBeGreaterThan(0);
  });

  it('401s both when signed out', async () => {
    for (const path of ['/api/v1/presence', '/api/v1/capacity']) {
      const res = await h.app.request(path, { headers: jsonHeaders() });
      expect(res.status, path).toBe(401);
    }
  });
});

describe('the disabled state reaches the wire', () => {
  it('serialises enabled:false rather than an empty list', async () => {
    const ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id;
    h.db
      .insert(heartbeats)
      .values({
        id: newId(),
        userId: ownerId ?? '',
        tokenId: null,
        repo: 'kvell/laika',
        branch: 'main',
        matchedTaskId: null,
        createdAt: Date.now(),
      })
      .run();

    h.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const body = (await (await get('/api/v1/presence')).json()) as PresenceBody;

    // §11.4.2 renders "disabled" and "nobody is working" differently, and once
    // LAI-150 stops storing rows for a disabled org an empty list is the only
    // thing left — so the flag has to travel, not be inferred.
    expect(body.enabled).toBe(false);
    expect(body.present).toEqual([]);
  });

  it('and capacity carries the same flag', async () => {
    h.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const body = (await (await get('/api/v1/capacity')).json()) as CapacityBody;

    expect(body.enabled).toBe(false);
  });
});

describe('a read_only token may read both', () => {
  it('because they are reads, and that is what such a token is for', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'watcher', scope: 'read_only' }),
    });
    expect(minted.status).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    for (const path of ['/api/v1/presence', '/api/v1/capacity']) {
      const res = await h.app.request(path, {
        headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
      });

      // Both are in `READ_ACTIONS`. A monitoring token that cannot read presence
      // is a monitoring token that cannot monitor.
      expect(res.status, path).toBe(200);
    }
  });
});
