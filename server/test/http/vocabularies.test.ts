import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CREATED_VIA,
  ORG_ROLES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  SPRINT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TOKEN_SCOPES,
} from '../../src/db/enums.ts';
import { SERVER_ROOT } from '../../src/paths.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * What a route **accepts** against what `db/enums.ts` **declares** (LAI-119).
 *
 * ## Why the constant is not the thing to check
 *
 * `db/enums.ts` exists so a closed vocabulary is declared once — its own comment
 * says *"declaring them once is what stops the three from drifting apart"*: the
 * TypeScript union, the SQL `CHECK`, and the runtime list. Two route files made a
 * fourth copy, because CONVENTIONS §2 forbids `http/routes/` importing `db/` and
 * the tuples are values, so `allowTypeImports` does not help.
 *
 * **Nothing checked the copies.** Measured before fixing it: re-typing
 * `CreateBody`'s status list with `cancelled` quietly dropped left **all 1730
 * tests passing**. A route that 422s a status the database stores happily is
 * invisible from every other angle.
 *
 * The `db/enums.ts` ↔ SQL `CHECK` leg is already covered — adding a member to a
 * vocabulary alone turns `schema-migration-drift.test.ts`'s *"matches every named
 * CHECK"* red. This file covers the leg that was not: **the route's own accepted
 * set**.
 *
 * ## It asks the route rather than reading its imports
 *
 * A test that imported the same constant the route imports would pass by
 * construction. So each case sends a deliberately invalid value and **reads the
 * accepted set out of the refusal**, which is the one place the route states what
 * it will take. Both drift directions fail: a missing member and an extra one.
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

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

interface IssueBody {
  error: { message: string; details: { issues?: { path: string; message: string }[] } };
}

/**
 * The set a Zod `enum` names in its refusal — `expected one of "a"|"b"`.
 *
 * Throws rather than returning empty if the shape changes: an extractor that
 * silently finds nothing would make every assertion below compare `[]` to `[]`.
 */
async function acceptedByBody(res: Response, field: string): Promise<string[]> {
  const body = (await res.json()) as IssueBody;
  const issue = body.error.details.issues?.find((i) => i.path === field);
  if (issue === undefined) {
    throw new Error(`no validation issue for "${field}" in ${JSON.stringify(body)}`);
  }
  const quoted = [...issue.message.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
  if (quoted.length === 0) throw new Error(`no options listed in: ${issue.message}`);
  return quoted.sort();
}

/** The set `parseEnum` names for a query parameter — `must be one of a, b, c`. */
async function acceptedByQuery(res: Response): Promise<string[]> {
  const body = (await res.json()) as IssueBody;
  const match = /must be one of (.+)$/.exec(body.error.message);
  if (match === null) throw new Error(`no options listed in: ${body.error.message}`);
  return (match[1] ?? '').split(', ').sort();
}

describe('POST /projects/:slug/tasks accepts exactly what db/enums.ts declares', () => {
  async function create(field: string, value: string): Promise<Response> {
    return req('/api/v1/projects/laika/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: `probing ${field}`, [field]: value }),
    });
  }

  it('takes every task status, and says so when refusing another', async () => {
    expect(await acceptedByBody(await create('status', 'nonsense'), 'status')).toEqual(
      [...TASK_STATUSES].sort(),
    );
  });

  it('actually creates a task in each of them', async () => {
    // The refusal message is what the validator *says*; this is what it does.
    // A schema whose message and behaviour disagree fails one or the other.
    for (const status of TASK_STATUSES) {
      const res = await create('status', status);
      expect(res.status, `${status}: ${await res.clone().text()}`).toBe(201);
    }
  });

  it('takes every priority', async () => {
    expect(await acceptedByBody(await create('priority', 'p9'), 'priority')).toEqual(
      [...TASK_PRIORITIES].sort(),
    );
    for (const priority of TASK_PRIORITIES) {
      expect((await create('priority', priority)).status, priority).toBe(201);
    }
  });

  it('takes every created_via — the inline literal LAI-119 names', async () => {
    expect(await acceptedByBody(await create('created_via', 'telepathy'), 'created_via')).toEqual(
      [...CREATED_VIA].sort(),
    );
  });
});

describe('the task list filters accept exactly the same sets', () => {
  // A second entry point into the same vocabulary, and it validates separately —
  // `parseEnum` on the query rather than Zod on the body. A copy could drift in
  // one and not the other, so both are asked.
  it('filters by every status', async () => {
    expect(
      await acceptedByQuery(await req('/api/v1/projects/laika/tasks?status=nonsense')),
    ).toEqual([...TASK_STATUSES].sort());
    for (const status of TASK_STATUSES) {
      expect((await req(`/api/v1/projects/laika/tasks?status=${status}`)).status, status).toBe(200);
    }
  });

  it('filters by every priority', async () => {
    expect(await acceptedByQuery(await req('/api/v1/projects/laika/tasks?priority=p9'))).toEqual(
      [...TASK_PRIORITIES].sort(),
    );
  });
});

describe('sprints accept exactly the declared sprint statuses', () => {
  it('takes every one of them', async () => {
    const res = await req('/api/v1/projects/laika/sprints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'S1',
        starts_on: '2026-01-01',
        ends_on: '2026-01-14',
        status: 'nonsense',
      }),
    });

    expect(await acceptedByBody(res, 'status')).toEqual([...SPRINT_STATUSES].sort());
  });
});

describe('the vocabularies already reached through a service stay that way', () => {
  // These converged first (LAI-071) and are the precedent LAI-119 followed. They
  // are checked here so the file covers one idiom rather than two halves of one.
  it('invites accept exactly the org roles', async () => {
    const res = await req('/api/v1/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.test', org_role: 'emperor' }),
    });

    expect(await acceptedByBody(res, 'org_role')).toEqual([...ORG_ROLES].sort());
  });

  it('tokens accept exactly the token scopes', async () => {
    const res = await req('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'ci', scope: 'unlimited' }),
    });

    expect(await acceptedByBody(res, 'scope')).toEqual([...TOKEN_SCOPES].sort());
  });
});

describe('no route or tool re-declares a vocabulary', () => {
  /**
   * The structural half, and the one that keeps the convergence.
   *
   * The tests above catch a copy **once it has drifted**. This catches the copy
   * itself, which is cheaper to fix and is what AC1's "one idiom" means: a route
   * or an MCP tool reaches for `db/enums.ts` through `services/`, and never
   * retypes the list.
   */
  const VOCABULARIES: [string, readonly string[]][] = [
    ['TASK_STATUSES', TASK_STATUSES],
    ['TASK_PRIORITIES', TASK_PRIORITIES],
    ['SPRINT_STATUSES', SPRINT_STATUSES],
    ['CREATED_VIA', CREATED_VIA],
    ['ORG_ROLES', ORG_ROLES],
    ['PROJECT_ROLES', PROJECT_ROLES],
    ['PROJECT_VISIBILITIES', PROJECT_VISIBILITIES],
    ['TOKEN_SCOPES', TOKEN_SCOPES],
  ];

  function sourceFiles(): { path: string; text: string }[] {
    const found: { path: string; text: string }[] = [];

    for (const dir of ['http/routes', 'mcp']) {
      const full = join(SERVER_ROOT, 'src', dir);
      for (const name of readdirSync(full)) {
        if (!name.endsWith('.ts')) continue;
        found.push({ path: `src/${dir}/${name}`, text: readFileSync(join(full, name), 'utf8') });
      }
    }
    return found;
  }

  it('reads the files it claims to check', () => {
    // Two directories, both non-empty. A path change that finds nothing would
    // make the assertion below pass over an empty list.
    const files = sourceFiles();

    expect(files.filter((f) => f.path.startsWith('src/http/routes/')).length).toBeGreaterThan(5);
    expect(files.filter((f) => f.path.startsWith('src/mcp/')).length).toBeGreaterThan(1);
  });

  it('has no file retyping a closed vocabulary', () => {
    const copies: string[] = [];

    for (const { path, text } of sourceFiles()) {
      // Vocabularies overlap — `member` and `viewer` are in both `ORG_ROLES`
      // and `PROJECT_ROLES` — so the one with the most literals present is
      // named, rather than whichever happened to be listed first.
      const matches = VOCABULARIES.map(
        ([vocabulary, members]) =>
          [vocabulary, members.filter((m) => text.includes(`'${m}'`))] as const,
      )
        .filter(([, literals]) => literals.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);

      // Two or more members of one vocabulary as string literals is a retyped
      // list. One on its own is an ordinary use — `'mcp'` as a `created_via`
      // value, say — and is not what this is about.
      const best = matches[0];
      if (best !== undefined) {
        copies.push(`${path} spells out ${best[1].join(', ')} — reach for ${best[0]}`);
      }
    }

    expect(copies).toEqual([]);
  });
});
