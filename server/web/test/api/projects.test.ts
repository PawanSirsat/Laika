/**
 * `src/api/projects.ts` (LAI-058).
 *
 * The tombstone cases are the point. `GET /projects` returns
 * `{ id, deleted: true }` for archived rows rather than omitting them (SPEC
 * §6.3), and a list that treats one as a project renders a nameless card with an
 * undefined slug — which reads as an API bug and is not one.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyProjectRows,
  createProject,
  isProject,
  isTombstone,
  listProjects,
  slugify,
  suggestPrefix,
  type Project,
  type ProjectRow,
} from '../../src/api/projects.ts';

interface Call {
  url: string;
  init: RequestInit;
}

function stub(response: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

function body(call: Call | undefined): Record<string, unknown> {
  const raw = call?.init.body;
  assert.equal(typeof raw, 'string');
  return JSON.parse(raw as string) as Record<string, unknown>;
}

void describe('isTombstone', () => {
  void test('recognises a tombstone', () => {
    assert.equal(isTombstone({ id: 'p1', deleted: true }), true);
  });

  void test('a live project is not one', () => {
    const project = {
      id: 'p1',
      slug: 'laika-core',
      prefix: 'LC',
      name: 'Laika Core',
      description: null,
      visibility: 'private',
      context_md: '',
      archived_at: null,
      created_at: 0,
      updated_at: 0,
    } as const;
    assert.equal(isTombstone(project), false);
  });

  void test('an archived-but-live row is not a tombstone either', () => {
    // `archived_at` set is still a full row. Only the `deleted` marker means
    // "this is a removal notice", and conflating them would drop projects the
    // server actually sent.
    const archived = {
      id: 'p1',
      slug: 's',
      prefix: 'PP',
      name: 'Old',
      description: null,
      visibility: 'private',
      context_md: '',
      archived_at: 123,
      created_at: 0,
      updated_at: 0,
    } as const;
    assert.equal(isTombstone(archived), false);
  });

  void test('isProject narrows in a filter, where negating isTombstone does not', () => {
    const rows: ProjectRow[] = [
      { id: 'gone', deleted: true },
      {
        id: 'live',
        slug: 's',
        prefix: 'PP',
        name: 'Live',
        description: null,
        visibility: 'private',
        context_md: '',
        archived_at: null,
        created_at: 0,
        updated_at: 0,
      },
    ];

    const names = rows.filter(isProject).map((r) => r.name);
    assert.deepEqual(names, ['Live']);
  });
});

void describe('listProjects query', () => {
  void test('sends nothing by default', async () => {
    const calls = stub({ data: [], next_cursor: null });
    await listProjects();
    assert.equal(calls[0]?.url, '/api/v1/projects');
  });

  void test('passes cursor, limit and updated_since', async () => {
    const calls = stub({ data: [], next_cursor: null });
    await listProjects({ cursor: 'abc', limit: 50, updatedSince: 1700000000000 });

    const query = new URL(calls[0]?.url ?? '', 'http://x').searchParams;
    assert.equal(query.get('cursor'), 'abc');
    assert.equal(query.get('limit'), '50');
    assert.equal(query.get('updated_since'), '1700000000000');
  });
});

void describe('createProject body', () => {
  void test('sends the four required fields', async () => {
    const calls = stub({ id: 'p1' }, 201);
    await createProject({ name: 'Laika Core', slug: 'laika-core', prefix: 'LC' });

    assert.deepEqual(body(calls[0]), {
      name: 'Laika Core',
      slug: 'laika-core',
      prefix: 'LC',
    });
  });

  void test('omits an empty description rather than sending one', async () => {
    // The schema is strict and trims to a minimum, so an empty string is a 422
    // where an absent key is fine.
    const calls = stub({ id: 'p1' }, 201);
    await createProject({ name: 'N', slug: 's', prefix: 'PP', description: '' });
    assert.ok(!('description' in body(calls[0])));
  });

  void test('sends visibility only when chosen', async () => {
    const calls = stub({ id: 'p1' }, 201);
    await createProject({ name: 'N', slug: 's', prefix: 'PP', visibility: 'public' });
    assert.equal(body(calls[0]).visibility, 'public');
  });

  void test('never sends a key the schema does not know', async () => {
    const calls = stub({ id: 'p1' }, 201);
    await createProject({ name: 'N', slug: 's', prefix: 'PP', visibility: 'private' });

    const allowed = new Set(['name', 'slug', 'prefix', 'description', 'visibility']);
    assert.deepEqual(
      Object.keys(body(calls[0])).filter((k) => !allowed.has(k)),
      [],
    );
  });
});

void describe('slugify', () => {
  void test('matches the server rule: lowercase words joined by hyphens', () => {
    const rule = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const name of ['Laika Core', 'laika  web', 'A/B Testing!', 'Team   42']) {
      const slug = slugify(name);
      assert.ok(rule.test(slug), `${name} -> ${slug} must satisfy the server regex`);
    }
  });

  void test('collapses runs and trims edges', () => {
    assert.equal(slugify('  Laika --- Core  '), 'laika-core');
    assert.equal(slugify('!!!Edge!!!'), 'edge');
  });

  void test('gives an empty string when there is nothing to slug', () => {
    // Better than a fabricated default: the field stays empty and required
    // validation asks for it, rather than silently inventing a URL.
    assert.equal(slugify('!!!'), '');
  });
});

void describe('suggestPrefix', () => {
  void test('uses initials when there are several words', () => {
    assert.equal(suggestPrefix('Laika Core'), 'LC');
    assert.equal(suggestPrefix('kvelld dynamics platform'), 'KDP');
  });

  void test('falls back to the word itself when there is one', () => {
    assert.equal(suggestPrefix('Laika'), 'LAIKA');
  });

  void test('always satisfies the server regex when non-empty', () => {
    const rule = /^[A-Za-z][A-Za-z0-9]{1,7}$/;
    for (const name of ['Laika Core', 'Laika', 'a b c d e f g h i j', 'Web2 Platform']) {
      const prefix = suggestPrefix(name);
      if (prefix !== '') assert.ok(rule.test(prefix), `${name} -> ${prefix}`);
    }
  });

  void test('returns empty rather than something invalid', () => {
    // A one-letter name cannot make a legal 2-8 char prefix, and a digit cannot
    // start one. Empty lets the required check ask, instead of shipping a 422.
    assert.equal(suggestPrefix('A'), '');
    assert.equal(suggestPrefix('42'), '');
    assert.equal(suggestPrefix(''), '');
  });
});

void describe('applyProjectRows — the tombstone rule (AC2)', () => {
  const project = (id: string, name: string): Project => ({
    id,
    slug: name.toLowerCase().replace(/ /g, '-'),
    prefix: 'PP',
    name,
    description: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 0,
    updated_at: 0,
  });

  void test('a tombstone removes the project it names', () => {
    const first = applyProjectRows([], [project('a', 'Alpha'), project('b', 'Beta')], 'replace');
    assert.deepEqual(
      first.map((p) => p.id),
      ['a', 'b'],
    );

    const after = applyProjectRows(first, [{ id: 'a', deleted: true }], 'merge');
    assert.deepEqual(
      after.map((p) => p.id),
      ['b'],
    );
  });

  void test('a tombstone for something we never had is harmless', () => {
    const rows = applyProjectRows([project('a', 'Alpha')], [{ id: 'zz', deleted: true }], 'merge');
    assert.deepEqual(
      rows.map((p) => p.id),
      ['a'],
    );
  });

  void test('a tombstone is never rendered as a project', () => {
    // The failure this guards: a nameless card with an undefined slug, which
    // reads as an API bug and is not one.
    const rows = applyProjectRows([], [{ id: 'gone', deleted: true }], 'replace');
    assert.deepEqual(rows, []);
  });

  void test('a page mixing live rows and tombstones applies both', () => {
    const rows = applyProjectRows(
      [project('a', 'Alpha')],
      [project('b', 'Beta'), { id: 'a', deleted: true }],
      'merge',
    );
    assert.deepEqual(
      rows.map((p) => p.id),
      ['b'],
    );
  });

  void test('merge keeps earlier pages, replace does not', () => {
    const page1 = applyProjectRows([], [project('a', 'Alpha')], 'replace');
    assert.deepEqual(applyProjectRows(page1, [project('b', 'Beta')], 'merge').length, 2);
    assert.deepEqual(applyProjectRows(page1, [project('b', 'Beta')], 'replace').length, 1);
  });

  void test('a repeated row updates rather than duplicating', () => {
    const first = applyProjectRows([], [project('a', 'Alpha')], 'replace');
    const again = applyProjectRows(first, [project('a', 'Alpha Renamed')], 'merge');
    assert.equal(again.length, 1);
    assert.equal(again[0]?.name, 'Alpha Renamed');
  });

  void test('sorted by name, so the picker is scannable', () => {
    const rows = applyProjectRows(
      [],
      [project('c', 'Zeta'), project('a', 'Alpha'), project('b', 'Mid')],
      'replace',
    );
    assert.deepEqual(
      rows.map((p) => p.name),
      ['Alpha', 'Mid', 'Zeta'],
    );
  });
});
