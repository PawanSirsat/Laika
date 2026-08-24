import { describe, expect, it } from 'vitest';
import { type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { ApiError } from '../../src/errors.ts';
import { getCurrentUser } from '../../src/services/me.ts';

/**
 * The service is testable without a request, a port or a database — which is the
 * property CONVENTIONS §2 is buying. The same function the REST route calls is
 * the one an MCP tool will call in M3, so these assertions cover both.
 */
function actor(overrides: Partial<ResolvedActor> = {}): ResolvedActor {
  return {
    userId: 'u1',
    email: 'ada@example.test',
    name: 'Ada',
    orgRole: 'member',
    isActive: true,
    projectRole: null,
    memberships: [],
    token: null,
    ...overrides,
  };
}

describe('getCurrentUser', () => {
  it('returns the profile in the wire shape', () => {
    expect(getCurrentUser(actor())).toEqual({
      id: 'u1',
      email: 'ada@example.test',
      name: 'Ada',
      org_role: 'member',
      is_active: true,
      memberships: [],
    });
  });

  it('maps memberships to snake_case', () => {
    const profile = getCurrentUser(actor({ memberships: [{ projectId: 'p1', role: 'lead' }] }));

    expect(profile.memberships).toEqual([{ project_id: 'p1', role: 'lead' }]);
  });

  it('throws unauthorized when nobody is signed in', () => {
    try {
      getCurrentUser(null);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('unauthorized');
      expect((err as ApiError).status).toBe(401);
    }
  });

  it('throws forbidden for a deactivated account', () => {
    // Deactivation has to bite on an existing session, or it only takes effect
    // whenever the user next happens to sign out.
    try {
      getCurrentUser(actor({ isActive: false }));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('forbidden');
      expect((err as ApiError).status).toBe(403);
    }
  });

  it('carries no HTTP concepts in its signature or its failures', () => {
    // A service that returned a Response, or a status code, could not be reused
    // by an MCP tool (SPEC §7).
    const profile = getCurrentUser(actor());

    expect(profile).not.toHaveProperty('status');
    expect(profile).not.toHaveProperty('headers');
  });
});
