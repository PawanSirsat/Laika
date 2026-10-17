import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { projectMemberships, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  normaliseOutsideId,
  outsideIdPrefixes,
  readableByOutsideId,
} from '../../src/services/outside-ids.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask, resolveTaskRef } from '../../src/services/tasks.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Outside ids (LAI-780, the owner's option 1): a card may carry the id it has
 * somewhere else — a repo's `LAI-123`, a Jira or GitHub key — in
 * `external_ref`, and everything that takes a task key takes that id too.
 *
 * Two rules carry the risk. **Only in projects the caller may read**: an id
 * on a card nobody showed them resolves to nothing, exactly as a key that
 * names no task does, so the answer does not confirm the card exists. And
 * **never a guess**: an id two readable cards carry is refused, with the keys
 * it matched, rather than settled by whichever row sorts first.
 */

const NOW = Date.UTC(2026, 9, 18, 9);

let t: TestDb;
let owner: string;
let bea: string;
let projectId: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function makeMember(name: string): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId: id, role: 'member', createdAt: NOW })
    .run();
  return id;
}

/** A task in `slug`, carrying `ref` as its outside id — written as the column holds it. */
function card(slug: string, title: string, ref: string | null): { id: string; key: string } {
  const task = createTask(t.sqlite, t.db, actor(owner), slug, { title, now: NOW });
  t.db.update(tasks).set({ externalRef: ref }).where(eq(tasks.id, task.id)).run();
  return { id: task.id, key: task.key };
}

function refusal(fn: () => unknown): { code: string; details: Record<string, unknown> } | string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return { code: err.code, details: (err.details ?? {}) as Record<string, unknown> };
    }
    throw err;
  }
  return 'no error';
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  projectId = s.projectId;
  bea = makeMember('Bea');
  // A private project Bea is not in.
  createProject(t.sqlite, t.db, actor(owner), {
    name: 'Hidden',
    slug: 'hidden',
    prefix: 'HID',
    visibility: 'private',
    now: NOW,
  });
});

afterEach(() => {
  t.close();
});

describe('the shape of an outside id', () => {
  it('takes a prefix of 1–16 letters, digits and _ starting with a letter, a dash, and 1–9 digits — upper-cased', () => {
    expect(normaliseOutsideId('LAI-780')).toBe('LAI-780');
    expect(normaliseOutsideId('  lai-780 ')).toBe('LAI-780');
    expect(normaliseOutsideId('data_eng-12')).toBe('DATA_ENG-12');
    expect(normaliseOutsideId('A-0')).toBe('A-0');
    expect(normaliseOutsideId('ABCDEFGHIJKLMNOP-123456789')).toBe('ABCDEFGHIJKLMNOP-123456789');
  });

  it('refuses anything else 422 on external_ref — a pull request, a URL, too long, no number', () => {
    for (const bad of [
      'kvell/laika#221',
      'https://github.com/kvell/laika/pull/221',
      'ABCDEFGHIJKLMNOPQ-1',
      'LAI-1234567890',
      'LAI-',
      '-12',
      '1LAI-2',
      'LAI 780',
      'LAI-7-8',
      '',
    ]) {
      expect(
        refusal(() => normaliseOutsideId(bad)),
        bad,
      ).toEqual({
        code: 'unprocessable',
        details: expect.objectContaining({ field: 'external_ref' }) as unknown,
      });
    }
  });
});

describe('a task found by its outside id (resolveTaskRef with the caller)', () => {
  it('finds the card that carries it, in any case', () => {
    const lai = card('laika', 'LAI-780 · This repo ties no tokens', 'LAI-780');
    expect(resolveTaskRef(t.db, 'LAI-780', actor(bea))).toBe(lai.id);
    expect(resolveTaskRef(t.db, 'lai-780', actor(bea))).toBe(lai.id);
  });

  it('a board key always wins: an outside id that is also a key names the board’s task', () => {
    const first = card('laika', 'The board’s LAI-1', null);
    // Another card claims `LAI-1` as its outside id; the key still names the first.
    card('laika', 'Imported', 'LAI-1');
    expect(first.key).toBe('LAI-1');
    expect(resolveTaskRef(t.db, 'LAI-1', actor(bea))).toBe(first.id);
  });

  it('resolves to nothing in a project the caller cannot read — the ref comes back as given', () => {
    const hidden = card('hidden', 'Secret work', 'JIRA-9');
    expect(resolveTaskRef(t.db, 'JIRA-9', actor(bea))).toBe('JIRA-9');
    // Positive control: the owner can read it, and finds it.
    expect(resolveTaskRef(t.db, 'JIRA-9', actor(owner))).toBe(hidden.id);
  });

  it('refuses an id two readable cards carry, 422 ambiguous, naming both keys — never a guess', () => {
    const a = card('laika', 'One', 'ONR-12');
    const b = card('hidden', 'Two', 'ONR-12');
    expect(refusal(() => resolveTaskRef(t.db, 'onr-12', actor(owner)))).toEqual({
      code: 'unprocessable',
      details: { reason: 'ambiguous', external_ref: 'ONR-12', tasks: [a.key, b.key].sort() },
    });
    // Bea reads only one of them, so for her it is not ambiguous.
    expect(resolveTaskRef(t.db, 'ONR-12', actor(bea))).toBe(a.id);
  });

  it('without a caller, an outside id is not looked up — the ref comes back as given', () => {
    card('laika', 'Carried', 'GH-4');
    expect(resolveTaskRef(t.db, 'GH-4')).toBe('GH-4');
  });

  it('readableByOutsideId lists only readable matches, and nothing for a ref of another shape', () => {
    const a = card('laika', 'Seen', 'LAI-5');
    card('hidden', 'Unseen', 'LAI-5');
    card('laika', 'A pull request', 'kvell/laika#5');
    expect(readableByOutsideId(t.db, actor(bea), 'lai-5')).toEqual([
      { taskId: a.id, projectId, key: a.key },
    ]);
    expect(readableByOutsideId(t.db, actor(bea), 'kvell/laika#5')).toEqual([]);
  });
});

describe('the prefixes of outside ids a caller may read', () => {
  it('names each prefix once, sorted, from readable projects only, and never a pull request’s', () => {
    card('laika', 'Repo task', 'LAI-780');
    card('laika', 'Another repo task', 'LAI-781');
    card('laika', 'A Jira key', 'data_eng-3');
    card('laika', 'A pull request', 'kvell-dynamics/laika#221');
    card('laika', 'Nothing', null);
    card('hidden', 'Hidden', 'SECRET-1');

    expect(outsideIdPrefixes(t.db, actor(bea))).toEqual(['DATA_ENG', 'LAI']);
    expect(outsideIdPrefixes(t.db, actor(owner))).toEqual(['DATA_ENG', 'LAI', 'SECRET']);
  });
});

describe('both reads go through tasks_external_ref_idx (§4.13)', () => {
  /** The statements `fn` prepares — the real ones, as drizzle wrote them. */
  function statements(fn: () => unknown): string[] {
    const seen: string[] = [];
    const original = t.sqlite.prepare.bind(t.sqlite);
    t.sqlite.prepare = (source: string) => {
      seen.push(source);
      return original(source);
    };
    try {
      fn();
    } finally {
      t.sqlite.prepare = original;
    }
    return seen.filter((s) => s.includes('external_ref'));
  }

  function plan(statement: string): string[] {
    const params = (statement.match(/\?/g) ?? []).map(() => 'x');
    return (
      t.sqlite.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(...params) as { detail: string }[]
    ).map((r) => r.detail);
  }

  it('a lookup by outside id searches the index; it never scans tasks', () => {
    card('laika', 'Carried', 'LAI-780');
    const [lookup, ...rest] = statements(() => readableByOutsideId(t.db, actor(bea), 'LAI-780'));
    // Positive control: the statement under test was the one recorded.
    expect(rest).toEqual([]);
    expect(lookup).toMatch(/"external_ref" = \?/);
    const steps = plan(lookup ?? '');
    expect(
      steps.some((s) => /^SEARCH tasks USING (COVERING )?INDEX tasks_external_ref_idx/.test(s)),
    ).toBe(true);
    expect(
      steps.filter((s) =>
        /^SCAN tasks\b(?! USING (COVERING )?INDEX tasks_external_ref_idx)/.test(s),
      ),
    ).toEqual([]);
  });

  it('the prefix list reads the partial index alone — only the cards that carry one', () => {
    card('laika', 'Carried', 'LAI-780');
    const [list, ...rest] = statements(() => outsideIdPrefixes(t.db, actor(bea)));
    expect(rest).toEqual([]);
    expect(isPrefixRead(list)).toBe(true);
    const steps = plan(list ?? '');
    expect(steps.some((s) => s.includes('USING COVERING INDEX tasks_external_ref_idx'))).toBe(true);
    expect(steps.filter((s) => /^SCAN tasks$/.test(s))).toEqual([]);
  });

  // Drizzle writes the operator in lower case.
  const isPrefixRead = (statement: string | undefined) =>
    statement?.includes('"external_ref" is not null') ?? false;
});
