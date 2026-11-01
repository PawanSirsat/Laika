import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { ApiError } from '../../src/errors.ts';
import { getAgentProjectAccess } from '../../src/services/agent-project-access.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/agent-project-access.ts` (LAI-1052) without HTTP: the session
 * rule and the intersection. The route's behaviour, the 404s and the viewer
 * cap are `test/http/routes/agent-project-access.test.ts`'s.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function register(scope: 'full' | 'read_only' | null) {
  return registerAgent(t.sqlite, t.db, owner, {
    displayName: 'Claude',
    harness: 'claude-code',
    grants: scope === null ? [] : [{ projectId: s.projectId, scope }],
  }).agent;
}

function refused(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected an ApiError, and nothing was thrown');
}

describe('getAgentProjectAccess', () => {
  it('an org owner is an implicit lead: membership full, the grant its own fact', () => {
    const agent = register('read_only');
    const view = getAgentProjectAccess(t.db, owner, agent.id, 'laika');
    expect(view.member).toEqual({ role: 'lead', can_read: true, can_write: true });
    expect(view.grant).toEqual({ scope: 'read_only' });
    expect(view.effective).toBe('read_only');
    expect(view.can_grant).toEqual({ max: 'full', reason: null });
  });

  it('no grant is no access, whatever the owner may do', () => {
    const agent = register(null);
    const view = getAgentProjectAccess(t.db, owner, agent.id, 'laika');
    expect(view.grant).toEqual({ scope: null });
    expect(view.effective).toBe('none');
  });

  it('refuses any token, session_required', () => {
    const agent = register('full');
    const withToken = {
      ...owner,
      token: { id: 'tok', scope: 'full' as const, projectIds: null },
    } as unknown as ResolvedActor;
    const err = refused(() => getAgentProjectAccess(t.db, withToken, agent.id, 'laika'));
    expect(err.code).toBe('forbidden');
    expect((err.details as { reason: string }).reason).toBe('session_required');
  });

  it('an unknown agent is the agent 404', () => {
    const err = refused(() => getAgentProjectAccess(t.db, owner, 'nope', 'laika'));
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('No agent with that id');
  });
});
