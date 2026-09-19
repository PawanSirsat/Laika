import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Board column endpoints (LAI-266). Transport only — the rules and their tests
 * live in `test/services/board-columns.test.ts`. What is asserted here is what
 * only the route layer can get wrong: status codes, the strict body, and the
 * fact that every mutation answers with the whole board.
 */

let h: AuthHarness;
let cookie: string;

const PASSWORD = 'correct-horse-battery-staple';

interface ColumnBody {
  id: string;
  name: string;
  position: number;
  hidden: boolean;
  statuses: string[];
  primary_status: string | null;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return req(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function columns(): Promise<ColumnBody[]> {
  const res = await req('/api/v1/projects/laika/board-columns');
  expect(res.status).toBe(200);
  return ((await res.json()) as { columns: ColumnBody[] }).columns;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function byName(name: string): Promise<ColumnBody> {
  const found = (await columns()).find((c) => c.name === name);
  if (found === undefined) throw new Error(`no column called ${name}`);
  return found;
}

beforeEach(async () => {
  h = authHarness();

  const setup = await h.app.request('/api/v1/setup', {
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
  expect(setup.status).toBe(201);
  cookie = cookieFrom(setup);
});

afterEach(() => {
  h.close();
});

describe('reading', () => {
  it('serves the board a first-boot project was given', async () => {
    // `setup.ts` is the creation site most easily forgotten — the migration
    // backfill cannot reach a project created after it ran, so first boot has
    // to seed its own board. This is the test that notices if it stops.
    const visible = (await columns()).filter((c) => !c.hidden);

    expect(visible.map((c) => c.name)).toEqual(['To do', 'In progress', 'Review', 'Done']);
    expect(visible[0]?.primary_status).toBe('todo');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await h.app.request('/api/v1/projects/laika/board-columns');
    expect(res.status).toBe(401);
  });

  it('404s an unknown project', async () => {
    expect((await req('/api/v1/projects/nope/board-columns')).status).toBe(404);
  });
});

describe('writing', () => {
  it('creates with 201 and returns the whole board', async () => {
    const res = await send('POST', '/api/v1/projects/laika/board-columns', { name: 'QA' });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { columns: ColumnBody[] };
    // The whole board, not the one column: a client that re-derived the order
    // from a single-object response would be free to disagree with the server
    // about it.
    expect(body.columns.map((c) => c.name)).toContain('QA');
    expect(body.columns.length).toBe(6);
  });

  it('renames', async () => {
    const review = await byName('Review');
    const res = await send('PATCH', `/api/v1/projects/laika/board-columns/${review.id}`, {
      name: 'QA',
    });

    expect(res.status).toBe(200);
    expect((await columns()).map((c) => c.name)).toContain('QA');
  });

  it('replaces a column’s statuses with PUT', async () => {
    const review = await byName('Review');
    const res = await send(
      'PUT',
      `/api/v1/projects/laika/board-columns/${review.id}/statuses`,
      { statuses: ['review', 'done'] },
    );

    expect(res.status).toBe(200);
    expect((await byName('Review')).statuses).toEqual(['review', 'done']);
    expect((await byName('Done')).statuses).toEqual([]);
    // An empty lane reports no drop target rather than inventing one.
    expect((await byName('Done')).primary_status).toBeNull();
  });

  it('deletes, and says which statuses moved', async () => {
    const review = await byName('Review');
    const target = await byName('In progress');

    const res = await send('DELETE', `/api/v1/projects/laika/board-columns/${review.id}`, {
      reassign_to_column_id: target.id,
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { reassigned: string[] }).toMatchObject({
      reassigned: ['review'],
    });
  });

  it('reorders', async () => {
    const before = (await columns()).map((c) => c.id);
    const res = await send('POST', '/api/v1/projects/laika/board-columns/reorder', {
      column_ids: [...before].reverse(),
    });

    expect(res.status).toBe(200);
    expect((await columns()).map((c) => c.id)).toEqual([...before].reverse());
  });
});

describe('the body is strict (§6.3)', () => {
  it('refuses an unknown field rather than ignoring it', async () => {
    // Strictness is what turns a silently-dropped field into a 422. A client
    // sending `colour` should be told, not humoured.
    const res = await send('POST', '/api/v1/projects/laika/board-columns', {
      name: 'QA',
      colour: 'red',
    });

    expect(res.status).toBe(422);
  });

  it('refuses a status outside the enum', async () => {
    const review = await byName('Review');
    const res = await send(
      'PUT',
      `/api/v1/projects/laika/board-columns/${review.id}/statuses`,
      { statuses: ['shipped'] },
    );

    expect(res.status).toBe(422);
  });

  it('refuses a delete with no destination', async () => {
    const review = await byName('Review');
    const res = await send('DELETE', `/api/v1/projects/laika/board-columns/${review.id}`, {});

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('unprocessable');
  });

  it('refuses a patch that changes nothing', async () => {
    const review = await byName('Review');
    const res = await send('PATCH', `/api/v1/projects/laika/board-columns/${review.id}`, {});

    expect(res.status).toBe(422);
  });

  it('refuses a reorder that is not the whole board', async () => {
    const ids = (await columns()).map((c) => c.id);
    const res = await send('POST', '/api/v1/projects/laika/board-columns/reorder', {
      column_ids: ids.slice(1),
    });

    expect(res.status).toBe(422);
    expect((await columns()).map((c) => c.id)).toEqual(ids);
  });

  it('409s a duplicate name', async () => {
    const res = await send('POST', '/api/v1/projects/laika/board-columns', { name: 'Review' });

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('conflict');
  });
});
