import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addDependency,
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
