import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

let h: AuthHarness;
let cookie: string;

const PASSWORD = 'correct-horse-battery-staple';

interface Row {
  id: string;
  seq: number;
  type: string;
  project_id: string | null;
  task_id: string | null;
  actor_kind: string;
  payload: unknown;
  created_at: number;
}

interface FeedPage {
  data: Row[];
  next_cursor: string | null;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function feed(path: string): Promise<FeedPage> {
  const res = await req(path);
  expect(res.status, path).toBe(200);
  return (await res.json()) as FeedPage;
}

async function newTask(title: string): Promise<string> {
  const res = await req('/api/v1/projects/laika/tasks', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
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

describe('both feeds are reachable and shaped as §6.3 says (AC1, AC2)', () => {
  it('returns the page envelope, newest first', async () => {
    await newTask('One');
    await newTask('Two');

    // The oldest row differs by feed, and the difference is the point: `org.created`
    // has no project (§4.8, D-022), so it belongs to the org feed and not to a
    // project's.
    const oldest = {
      '/api/v1/projects/laika/activity': 'project.created',
      '/api/v1/activity': 'org.created',
    } as const;

    for (const [path, first] of Object.entries(oldest)) {
      const page = await feed(path);

      expect(Object.keys(page).sort()).toEqual(['data', 'next_cursor']);
      expect(page.data.length).toBeGreaterThanOrEqual(3);

      const times = page.data.map((row) => row.created_at);
      expect([...times]).toEqual([...times].sort((a, b) => b - a));

      // Deterministic only because ties break on `seq`: setup writes `org.created`
      // and `project.created` in one transaction, in the same millisecond.
      expect(page.data[page.data.length - 1]?.type, path).toBe(first);
      expect(page.data[0]?.type, path).toBe('task.created');
    }

    // And stated directly, because it is the kind of thing a later change breaks
    // quietly: the project feed carries no org-scoped row.
    const project = await feed('/api/v1/projects/laika/activity');
    expect(project.data.every((row) => row.project_id !== null)).toBe(true);
  });

  it('badges every row with actor_kind, and keeps seq (AC5)', async () => {
    await newTask('One');
    const page = await feed('/api/v1/activity');

    expect(page.data.every((row) => row.actor_kind === 'user')).toBe(true);
    expect(page.data.every((row) => typeof row.seq === 'number')).toBe(true);
    // Descending, and seq is the stream's monotonic id, so it descends too.
    const seqs = page.data.map((row) => row.seq);
    expect([...seqs]).toEqual([...seqs].sort((a, b) => b - a));
  });

  it('401s an anonymous caller on both', async () => {
    expect((await h.app.request('/api/v1/projects/laika/activity')).status).toBe(401);
    expect((await h.app.request('/api/v1/activity')).status).toBe(401);
  });

  it('404s an unknown project', async () => {
    expect((await req('/api/v1/projects/nope/activity')).status).toBe(404);
  });
});

describe('read-only, and it says so (AC6)', () => {
  it('answers 405 with an Allow header on every writing method', async () => {
    for (const path of ['/api/v1/projects/laika/activity', '/api/v1/activity']) {
      for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
        const res = await req(path, { method, body: JSON.stringify({}) });

        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers.get('Allow')).toBe('GET');
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'method_not_allowed',
        );
      }
    }
  });
});

describe('filters and paging (AC3)', () => {
  it('narrows to one task with ?task_id=', async () => {
    const taskId = await newTask('One');
    await newTask('Two');
    await req(`/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body_md: 'A note' }),
    });

    const page = await feed(`/api/v1/activity?task_id=${taskId}`);

    expect(page.data.length).toBeGreaterThanOrEqual(2);
    expect(page.data.every((row) => row.task_id === taskId)).toBe(true);
    expect(page.data.map((row) => row.type)).toContain('comment.added');
  });

  it('takes ?since= as unix-ms and rejects nonsense', async () => {
    await newTask('One');
    const all = await feed('/api/v1/activity');
    const newest = all.data[0]!;

    const since = await feed(`/api/v1/activity?since=${String(newest.created_at)}`);
    expect(since.data.map((row) => row.id)).toContain(newest.id);
    expect(since.data.length).toBeLessThan(all.data.length);

    const bad = await req('/api/v1/activity?since=yesterday');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('pages through the whole feed without repeating or losing a row', async () => {
    for (let i = 0; i < 7; i++) await newTask(`T${String(i)}`);

    const whole = await feed('/api/v1/activity?limit=200');
    const walked: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 20; page++) {
      const url: string =
        cursor === null ? '/api/v1/activity?limit=3' : `/api/v1/activity?limit=3&cursor=${cursor}`;
      const got = await feed(url);
      walked.push(...got.data.map((row) => row.id));
      cursor = got.next_cursor;
      if (cursor === null) break;
    }

    expect(walked).toEqual(whole.data.map((row) => row.id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('rejects a malformed cursor rather than starting over', async () => {
    const res = await req('/api/v1/activity?cursor=not-a-cursor');
    expect(res.status).toBe(400);
  });
});

describe('the org feed does not leak a project (AC2)', () => {
  it('shows a member of one project nothing from the other', async () => {
    // A second project the owner can see and a second user who cannot.
    const created = await req('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Other', slug: 'other', prefix: 'OTH' }),
    });
    expect(created.status).toBe(201);

    const otherProject = (await created.json()) as { id: string };
    await req('/api/v1/projects/other/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Secret' }),
    });
    await newTask('Public');

    // The owner sees both projects.
    const asOwner = await feed('/api/v1/activity');
    expect(asOwner.data.some((row) => row.project_id === otherProject.id)).toBe(true);

    // A fresh member of neither project sees nothing project-scoped at all.
    const signUp = await h.app.request('/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'zoe@example.test', password: PASSWORD, name: 'Zoe' }),
    });

    if (signUp.status === 200 || signUp.status === 201) {
      const theirCookie = cookieFrom(signUp);
      const res = await h.app.request('/api/v1/activity', {
        headers: jsonHeaders({ Cookie: theirCookie }),
      });
      expect(res.status).toBe(200);

      const theirs = (await res.json()) as FeedPage;
      expect(theirs.data.every((row) => row.project_id === null)).toBe(true);
      // And an ordinary member is not an auditor, so the org-scoped rows are out
      // too — which leaves nothing.
      expect(theirs.data).toEqual([]);
    }
  });
});
