import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { agentSessionContextDeliveries, users } from '../../src/db/schema.ts';
import {
  contextNotice,
  contextRevisionStamp,
  deliveredRevision,
} from '../../src/services/context-revisions.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Delivery and the MCP stamp (§4.69, proposal §4.6, LAI-555). The paths an
 * agent reaches — recording through `get_project_context` and the stamp on
 * every answer — are exercised end to end in `test/mcp/context-revision.test.ts`;
 * these are the rules underneath, one at a time.
 */

let t: TestDb;
let s: ReturnType<typeof seed>;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});

afterEach(() => {
  t.close();
});

describe('contextNotice', () => {
  it('says nothing to a session that is current, or that nothing was delivered to', () => {
    expect(contextNotice(null)).toBeNull();
    expect(contextNotice({ project: 'p', revision: 3, delivered_revision: null })).toBeNull();
    expect(contextNotice({ project: 'p', revision: 3, delivered_revision: 3 })).toBeNull();
  });

  it('names the revisions and the call, within 300 characters, for a session behind', () => {
    const notice = contextNotice({
      project: 'p',
      revision: Number.MAX_SAFE_INTEGER,
      delivered_revision: Number.MAX_SAFE_INTEGER - 1,
    });
    expect(notice).toMatch(/^Project context changed: r\d+ → r\d+\. Call get_project_context/);
    expect(notice!.length).toBeLessThanOrEqual(300);
  });
});

describe('contextRevisionStamp', () => {
  it('is null for a call that names no project, or one that names nothing', () => {
    expect(contextRevisionStamp(t.db, actor(s.userId), {}, null)).toBeNull();
    expect(contextRevisionStamp(t.db, actor(s.userId), { project: 'nope' }, null)).toBeNull();
    expect(contextRevisionStamp(t.db, actor(s.userId), { task: 'NOPE-1' }, null)).toBeNull();
  });

  it('is null for a project the caller cannot read — it says no more than the tool would', () => {
    const outsider = newId();
    t.db
      .insert(users)
      .values({
        id: outsider,
        email: 'outsider@example.test',
        name: 'Outsider',
        orgRole: 'viewer',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    expect(contextRevisionStamp(t.db, actor(outsider), { project: 'laika' }, null)).toBeNull();
  });

  it('a session id that is not the caller’s own agent’s reads as nothing delivered', () => {
    // A person's own session (no agent token) cannot name an agent session.
    expect(
      contextRevisionStamp(t.db, actor(s.userId), { project: 'laika' }, 'someone-elses'),
    ).toEqual({ project: 'laika', revision: 0, delivered_revision: null });
  });
});

describe('deliveredRevision', () => {
  it('is null for a session and project with no delivery', () => {
    expect(deliveredRevision(t.db, 'no-session', s.projectId)).toBeNull();
    expect(t.db.select().from(agentSessionContextDeliveries).all()).toEqual([]);
  });
});
