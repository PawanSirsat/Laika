import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { agents, orgs, projectRepoSetups, projects } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { listProjectSetups, recordProjectSetup } from '../../src/services/project-setups.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/project-setups.ts` (SPEC §4.82, LAI-1066). The HTTP half — the
 * agent's own token, the body each caller may send, and the `404`s — is
 * `test/http/routes/project-setups.test.ts`.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let slug: string;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
  slug = t.db.select().from(projects).where(eq(projects.id, s.projectId)).get()?.slug ?? '';
});

afterEach(() => {
  t.close();
});

function agent(status: 'active' | 'revoked' = 'active'): string {
  const id = newId();
  t.db
    .insert(agents)
    .values({
      id,
      orgId: s.orgId,
      ownerUserId: s.userId,
      displayName: 'Tool',
      harness: 'claude-code',
      deviceLabel: 'Belka',
      status,
      createdAt: NOW,
      ...(status === 'revoked' ? { revokedAt: NOW } : {}),
    })
    .run();
  return id;
}

const browser = (agentId: string | null, templateRevision = 2) =>
  ({
    source: 'self_reported_browser',
    agentId,
    projectSlug: slug,
    templateRevision,
    instructionsPath: 'CLAUDE.md',
  }) as const;

describe('the browser’s record', () => {
  it('keeps the owner’s word with the time, and checks nothing about the block', () => {
    const id = agent();
    const made = recordProjectSetup(t.db, owner, browser(id), NOW);
    expect(made).toMatchObject({
      agent_id: id,
      device_label: 'Belka',
      source: 'self_reported_browser',
      template_revision: 2,
      project_match: null,
      prefix_match: null,
      checked_at: NOW,
    });
    expect(t.db.select().from(projectRepoSetups).get()?.repoKey).toBe('');
  });

  it('replaces the owner’s record for the same tool rather than adding one', () => {
    const id = agent();
    const first = recordProjectSetup(t.db, owner, browser(id, 1), NOW);
    const second = recordProjectSetup(t.db, owner, browser(id, 2), NOW + 1);
    expect(second.id).toBe(first.id);
    // A record about no tool is a separate row from the tool's.
    recordProjectSetup(t.db, owner, browser(null), NOW + 2);
    expect(t.db.select().from(projectRepoSetups).all()).toHaveLength(2);
  });

  it('refuses a revoked tool: it reaches nothing, so nothing is recorded for it', () => {
    const id = agent('revoked');
    let thrown: unknown;
    try {
      recordProjectSetup(t.db, owner, browser(id), NOW);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('conflict');
    expect((thrown as ApiError).details).toMatchObject({ reason: 'agent_revoked' });
    expect(t.db.select().from(projectRepoSetups).all()).toEqual([]);
  });

  it('refuses a local check from a session: there is no agent to have read the file', () => {
    let thrown: unknown;
    try {
      recordProjectSetup(
        t.db,
        owner,
        {
          source: 'local_check',
          projectSlug: slug,
          repoKey: 'a'.repeat(64),
          repoLabel: 'x',
          instructionsPath: null,
          blockFound: true,
          templateRevision: 2,
          blockProject: null,
          blockPrefix: null,
        },
        NOW,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('forbidden');
    expect(t.db.select().from(projectRepoSetups).all()).toEqual([]);
  });
});

describe('presence off (§4.2)', () => {
  it('stores no time, and answers none for a row stored while it was on', () => {
    const id = agent();
    recordProjectSetup(t.db, owner, browser(id), NOW);
    t.db.update(orgs).set({ presenceEnabled: 0 }).run();

    expect(listProjectSetups(t.db, owner, slug, id)[0]?.checked_at).toBeNull();
    const again = recordProjectSetup(t.db, owner, browser(id), NOW + 5);
    expect(again.checked_at).toBeNull();
    expect(t.db.select().from(projectRepoSetups).get()?.checkedAt).toBeNull();
  });
});

describe('reading', () => {
  it('answers only the asked tool’s records when one is named', () => {
    const a = agent();
    recordProjectSetup(t.db, owner, browser(a), NOW);
    recordProjectSetup(t.db, owner, browser(null), NOW);
    expect(listProjectSetups(t.db, owner, slug, undefined)).toHaveLength(2);
    expect(listProjectSetups(t.db, owner, slug, a).map((r) => r.agent_id)).toEqual([a]);
  });
});
