import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addDependency,
  dependencyEdges,
  DependencyError,
  dependsOnTransitively,
  directDependencies,
} from '../../src/db/dependencies.ts';
import { newId } from '../../src/db/ids.ts';
import { createTaskWithNumber } from '../../src/db/numbering.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let s: Seed;

function makeTask(title: string): string {
  const id = newId();
  createTaskWithNumber(t.sqlite, t.db, {
    projectId: s.projectId,
    id,
    title,
    createdBy: s.userId,
    createdVia: 'api',
  });
  return id;
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

describe('task_dependencies (SPEC §4.6)', () => {
  it('records a straightforward dependency', () => {
    const a = makeTask('a');
    const b = makeTask('b');

    addDependency(t.sqlite, t.db, a, b);

    expect(directDependencies(t.db, a)).toEqual([b]);
  });

  it('rejects self-reference', () => {
    const a = makeTask('a');

    expect(() => {
      addDependency(t.sqlite, t.db, a, a);
    }).toThrow(DependencyError);

    try {
      addDependency(t.sqlite, t.db, a, a);
    } catch (err) {
      expect((err as DependencyError).reason).toBe('self');
    }
  });

  it('rejects a direct two-task cycle', () => {
    const a = makeTask('a');
    const b = makeTask('b');

    addDependency(t.sqlite, t.db, a, b);

    try {
      addDependency(t.sqlite, t.db, b, a);
      throw new Error('should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyError);
      expect((err as DependencyError).reason).toBe('cycle');
    }
  });

  it('rejects a long cycle, not just the obvious one', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].map(makeTask);

    // a → b → c → d → e
    for (let i = 0; i < ids.length - 1; i++) {
      addDependency(t.sqlite, t.db, ids[i]!, ids[i + 1]!);
    }

    // e → a would close the loop.
    try {
      addDependency(t.sqlite, t.db, ids[4]!, ids[0]!);
      throw new Error('should have been rejected');
    } catch (err) {
      expect((err as DependencyError).reason).toBe('cycle');
    }
  });

  it('allows a diamond, which is not a cycle', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(makeTask);

    // a depends on b and c; both depend on d.
    addDependency(t.sqlite, t.db, a!, b!);
    addDependency(t.sqlite, t.db, a!, c!);
    addDependency(t.sqlite, t.db, b!, d!);

    expect(() => {
      addDependency(t.sqlite, t.db, c!, d!);
    }).not.toThrow();
  });

  it('rejects a duplicate pair', () => {
    const a = makeTask('a');
    const b = makeTask('b');

    addDependency(t.sqlite, t.db, a, b);

    try {
      addDependency(t.sqlite, t.db, a, b);
      throw new Error('should have been rejected');
    } catch (err) {
      expect((err as DependencyError).reason).toBe('duplicate');
    }
  });

  it('leaves no partial row behind when it refuses', () => {
    const a = makeTask('a');
    const b = makeTask('b');

    addDependency(t.sqlite, t.db, a, b);
    try {
      addDependency(t.sqlite, t.db, b, a);
    } catch {
      // expected
    }

    expect(directDependencies(t.db, b)).toEqual([]);
  });

  it('computes transitive reachability', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(makeTask);

    addDependency(t.sqlite, t.db, a!, b!);
    addDependency(t.sqlite, t.db, b!, c!);

    expect(dependsOnTransitively(t.db, a!, c!)).toBe(true);
    expect(dependsOnTransitively(t.db, c!, a!)).toBe(false);
  });
});

describe('discovered_from is provenance, not a dependency (SPEC §4.6)', () => {
  it('does not block: a discovered task can be worked while its parent is open', () => {
    const parent = makeTask('parent');
    const childId = newId();

    createTaskWithNumber(t.sqlite, t.db, {
      projectId: s.projectId,
      id: childId,
      title: 'discovered while doing parent',
      createdBy: s.userId,
      createdVia: 'mcp',
      discoveredFrom: parent,
    });

    // No dependency edge was created, so nothing blocks the child.
    expect(directDependencies(t.db, childId)).toEqual([]);
    expect(dependsOnTransitively(t.db, childId, parent)).toBe(false);
  });
});

/**
 * LAI-091. `task_dependencies` is read backwards to answer "what am I holding
 * up", through the §4.13 index whose only purpose is that lookup and which
 * nothing performed until now.
 */
describe('dependencyEdges — both directions, one query', () => {
  /** a ← b ← c: c depends on b, b depends on a. */
  function chain(): [string, string, string] {
    const a = makeTask('a');
    const b = makeTask('b');
    const c = makeTask('c');
    addDependency(t.sqlite, t.db, b, a);
    addDependency(t.sqlite, t.db, c, b);
    return [a, b, c];
  }

  it('reports what blocks a task and what it blocks, as separate lists', () => {
    const [a, b, c] = chain();
    const edges = dependencyEdges(t.db, [a, b, c]);

    expect(edges.blockedBy.get(a)).toEqual([]);
    expect(edges.blocks.get(a)).toEqual([b]);

    // The middle of the chain has one of each — the case a merged list would
    // render as "two dependencies" and be wrong about both.
    expect(edges.blockedBy.get(b)).toEqual([a]);
    expect(edges.blocks.get(b)).toEqual([c]);

    expect(edges.blockedBy.get(c)).toEqual([b]);
    expect(edges.blocks.get(c)).toEqual([]);
  });

  it('agrees with directDependencies on the forward direction', () => {
    // The existing reader stays the definition of "blocked by"; this must not
    // quietly disagree with it.
    const [a, b] = chain();
    expect(dependencyEdges(t.db, [b]).blockedBy.get(b)).toEqual(directDependencies(t.db, b));
    expect(dependencyEdges(t.db, [a]).blockedBy.get(a)).toEqual(directDependencies(t.db, a));
  });

  it('gives every requested id an entry, so empty never looks like missing', () => {
    const lonely = makeTask('lonely');
    const edges = dependencyEdges(t.db, [lonely]);

    expect(edges.blockedBy.get(lonely)).toEqual([]);
    expect(edges.blocks.get(lonely)).toEqual([]);
  });

  it('counts an edge with both ends on the page once per direction', () => {
    // The case that made UNION ALL the right shape: with a single OR this edge
    // returns one row that the caller would have to classify twice.
    const [a, b] = chain();
    const edges = dependencyEdges(t.db, [a, b]);

    expect(edges.blocks.get(a)).toEqual([b]);
    expect(edges.blockedBy.get(b)).toEqual([a]);
  });

  it('asks for nothing when given nothing', () => {
    const edges = dependencyEdges(t.db, []);
    expect(edges.blockedBy.size).toBe(0);
    expect(edges.blocks.size).toBe(0);
  });

  it('ignores tasks outside the requested page', () => {
    const [, b] = chain();
    // `a` and `c` exist and are related to `b`, but were not asked about.
    expect([...dependencyEdges(t.db, [b]).blockedBy.keys()]).toEqual([b]);
    expect([...dependencyEdges(t.db, [b]).blocks.keys()]).toEqual([b]);
  });

  it('sorts each list, so a rendered view is stable between reads', () => {
    const target = makeTask('target');
    for (const title of ['x', 'y', 'z']) {
      addDependency(t.sqlite, t.db, target, makeTask(title));
    }

    const first = dependencyEdges(t.db, [target]).blockedBy.get(target) ?? [];
    expect(first).toEqual([...first].sort());
    expect(dependencyEdges(t.db, [target]).blockedBy.get(target)).toEqual(first);
  });

  it('reads the reverse direction through §4.13’s index (AC3)', () => {
    // The plan is taken from the query `dependencyEdges` **actually issues**,
    // captured off the driver — not from SQL retyped here. A hand-written copy
    // passes happily while the real query scans: I checked, by breaking the
    // production query and watching this test stay green.
    const [, b] = chain();

    const prepared: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);
    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      prepared.push(source);
      return real(source);
    };

    try {
      dependencyEdges(t.db, [b]);
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }

    const query = prepared.find((sql) => sql.includes('task_dependencies'));
    expect(query, 'dependencyEdges issued no query against task_dependencies').toBeDefined();

    // The captured SQL is parameterised; EXPLAIN still needs the right arity, so
    // the placeholders are counted rather than assumed. Their values do not
    // affect the plan — only how many there are.
    const sqlText = query ?? '';
    const bindings = Array.from({ length: (sqlText.match(/\?/g) ?? []).length }, () => 'x');

    const plan = t.sqlite.prepare(`EXPLAIN QUERY PLAN ${sqlText}`).all(...bindings) as {
      detail: string;
    }[];
    const detail = plan.map((row) => row.detail).join('\n');

    expect(detail).toContain('task_dependencies_depends_on_idx');
    // And the forward half still uses the pair index rather than scanning.
    expect(detail).toContain('task_dependencies_pair_unique');
    expect(detail).not.toContain('SCAN task_dependencies');
  });
});
