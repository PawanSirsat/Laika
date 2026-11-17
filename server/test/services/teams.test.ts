import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  projectMemberships,
  projectTeamsChannels,
  teamsPosts,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { decryptSecret } from '../../src/secrets.ts';
import { createProject } from '../../src/services/projects.ts';
import {
  clearProjectTeamsChannel,
  getProjectTeams,
  getTeamsSettings,
  sendTeamsTestPost,
  setProjectTeamsChannel,
  setTeamsPosting,
} from '../../src/services/teams.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { fakeTeams, type FakeTeams, TEAMS_URL, TEAMS_URL_2 } from '../helpers/fake-teams.ts';

/**
 * Teams posting as an owner or admin configures it (§6.4, D-154, LAI-1314):
 * the switch, each space's channel, and the test post. The address goes in
 * and never comes out. Teams is a fake: **no test calls a real one**.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 10, 18, 9);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let fake: FakeTeams;

function person(name: string, orgRole: 'admin' | 'member'): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return loadActor(t.db, id)!;
}

function refusal(fn: () => unknown): { code: string; reason?: unknown } {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return { code: err.code, reason: (err.details as { reason?: unknown } | null)?.reason };
    }
    throw err;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW - 60_000);
  owner = loadActor(t.db, s.userId)!;
  fake = fakeTeams();
});
afterEach(() => {
  t.close();
});

describe('the switch', () => {
  it('is off until somebody turns it on, and says who did', () => {
    expect(getTeamsSettings(t.db, owner)).toMatchObject({
      posting_enabled: false,
      updated_at: null,
      updated_by: null,
      schedule: { standup_utc: ['05:30', '12:30'], digest_utc: '07:00' },
      channels: [],
    });

    const on = setTeamsPosting(t.db, owner, { posting_enabled: true }, NOW);
    expect(on).toMatchObject({
      posting_enabled: true,
      updated_at: NOW,
      updated_by: { id: s.userId, name: 'Owner' },
    });
    expect(setTeamsPosting(t.db, owner, { posting_enabled: false }, NOW + 1).posting_enabled).toBe(
      false,
    );
  });

  it('lists only the spaces the reader can open', () => {
    // A private space the admin is not in, and the seed space they are.
    createProject(t.sqlite, t.db, owner, {
      name: 'Secret',
      slug: 'secret',
      prefix: 'SEC',
      visibility: 'private',
      now: NOW,
    });
    setProjectTeamsChannel(t.db, owner, 'laika', { webhook_url: TEAMS_URL }, SECRET, NOW);
    setProjectTeamsChannel(t.db, owner, 'secret', { webhook_url: TEAMS_URL_2 }, SECRET, NOW);
    const adminId = person('Ada', 'admin').userId;
    t.db
      .insert(projectMemberships)
      .values({
        id: newId(),
        projectId: s.projectId,
        userId: adminId,
        role: 'member',
        createdAt: NOW,
      })
      .run();
    // *Change organisation settings* kept, *Open every project* withdrawn.
    const admin: ResolvedActor = {
      ...loadActor(t.db, adminId)!,
      orgGrants: { admin: ['change_org_settings'], member: [], viewer: [] },
    };

    expect(getTeamsSettings(t.db, owner).channels.map((c) => c.project_slug)).toEqual([
      'laika',
      'secret',
    ]);
    const seen = getTeamsSettings(t.db, admin);
    expect(seen.channels.map((c) => c.project_slug)).toEqual(['laika']);
    expect(JSON.stringify(seen)).not.toContain('Secret');
  });

  it('is an owner’s or an admin’s, and nobody else’s', () => {
    const admin = person('Ada', 'admin');
    const member = person('Bea', 'member');
    expect(setTeamsPosting(t.db, admin, { posting_enabled: true }, NOW).posting_enabled).toBe(true);
    expect(refusal(() => getTeamsSettings(t.db, member)).code).toBe('forbidden');
    expect(refusal(() => setTeamsPosting(t.db, member, { posting_enabled: false })).code).toBe(
      'forbidden',
    );
  });
});

describe('a space’s channel', () => {
  it('is stored encrypted, and shown only by its host and last four characters', () => {
    const view = setProjectTeamsChannel(
      t.db,
      owner,
      'laika',
      { webhook_url: TEAMS_URL },
      SECRET,
      NOW,
    );
    expect(view.channel).toMatchObject({
      project_slug: 'laika',
      host: 'default0fixture.00.environment.api.powerplatform.com',
      last4: TEAMS_URL.slice(-4),
      set_at: NOW,
      set_by: { id: s.userId, name: 'Owner' },
      last_post: null,
    });
    // A positive control, then the absence.
    expect(JSON.stringify(view)).toContain(TEAMS_URL.slice(-4));
    expect(JSON.stringify(view)).not.toContain('sig=');
    expect(JSON.stringify(getTeamsSettings(t.db, owner))).not.toContain('sig=');

    const row = t.db.select().from(projectTeamsChannels).get()!;
    expect(row.webhookUrlEnc).not.toContain('powerplatform');
    expect(decryptSecret(row.webhookUrlEnc, SECRET, 'teams_webhook_url')).toBe(TEAMS_URL);
  });

  it('is replaced by a new address, and cleared to nothing', () => {
    setProjectTeamsChannel(t.db, owner, 'laika', { webhook_url: TEAMS_URL }, SECRET, NOW);
    const replaced = setProjectTeamsChannel(
      t.db,
      owner,
      'laika',
      { webhook_url: TEAMS_URL_2 },
      SECRET,
      NOW + 1,
    );
    expect(replaced.channel?.host).toBe('prod-27.westeurope.logic.azure.com');
    expect(getTeamsSettings(t.db, owner).channels.map((c) => c.last4)).toEqual([
      TEAMS_URL_2.slice(-4),
    ]);

    clearProjectTeamsChannel(t.db, owner, 'laika');
    expect(getProjectTeams(t.db, owner, 'laika').channel).toBeNull();
    expect(t.db.select().from(projectTeamsChannels).all()).toEqual([]);
  });

  it('refuses an address that is not a Teams webhook, and stores nothing', () => {
    expect(
      refusal(() =>
        setProjectTeamsChannel(
          t.db,
          owner,
          'laika',
          { webhook_url: 'https://localhost/x' },
          SECRET,
        ),
      ),
    ).toEqual({ code: 'unprocessable', reason: 'webhook_url_invalid' });
    expect(t.db.select().from(projectTeamsChannels).all()).toEqual([]);
  });

  it('never encrypts under no key', () => {
    expect(
      refusal(() => setProjectTeamsChannel(t.db, owner, 'laika', { webhook_url: TEAMS_URL }, '')),
    ).toMatchObject({ code: 'internal' });
  });

  it('is a member’s to neither read nor set, and a missing space is a 404', () => {
    const member = person('Bea', 'member');
    expect(refusal(() => getProjectTeams(t.db, member, 'laika')).code).toBe('forbidden');
    expect(
      refusal(() =>
        setProjectTeamsChannel(t.db, member, 'laika', { webhook_url: TEAMS_URL }, SECRET),
      ).code,
    ).toBe('forbidden');
    expect(refusal(() => getProjectTeams(t.db, owner, 'nope')).code).toBe('not_found');
  });

  it('is set from a script by loading the owner as the actor — how KSage’s flows come over', () => {
    // CHIEF's import: no session, the owner's id, the same service.
    const asOwner = loadActor(t.db, s.userId)!;
    setProjectTeamsChannel(t.db, asOwner, 'laika', { webhook_url: TEAMS_URL }, SECRET, NOW);
    expect(getProjectTeams(t.db, owner, 'laika').channel?.last4).toBe(TEAMS_URL.slice(-4));
  });
});

describe('the test post', () => {
  it('goes while posting is off, says it worked, and is recorded', async () => {
    setProjectTeamsChannel(t.db, owner, 'laika', { webhook_url: TEAMS_URL }, SECRET, NOW);
    const post = await sendTeamsTestPost(t.db, owner, 'laika', SECRET, {
      fetchImpl: fake.fetchImpl,
      now: () => NOW,
      publicUrl: 'https://laika.example',
    });

    expect(post).toMatchObject({
      kind: 'test',
      title: 'Laika is connected to this channel — Laika (LAI)',
      outcome: 'sent',
      reason: null,
      http_status: 202,
    });
    expect(fake.requests.map((r) => r.url)).toEqual([TEAMS_URL]);
    expect(fake.texts()[0]).toContain('<a href="https://laika.example/board?project=laika">');
    expect(getProjectTeams(t.db, owner, 'laika')).toMatchObject({
      posting_enabled: false,
      recent: [{ id: post.id, kind: 'test', outcome: 'sent' }],
      channel: { last_post: { id: post.id } },
    });
  });

  it('says why when the flow refuses, without what the flow said', async () => {
    setProjectTeamsChannel(t.db, owner, 'laika', { webhook_url: TEAMS_URL }, SECRET, NOW);
    fake.answer = () => 401;
    const post = await sendTeamsTestPost(t.db, owner, 'laika', SECRET, {
      fetchImpl: fake.fetchImpl,
    });
    expect(post).toMatchObject({ outcome: 'failed', reason: 'refused', http_status: 401 });
    expect(JSON.stringify(post)).not.toContain('flow said');
  });

  it('is a conflict for a space with no channel, and calls nobody', async () => {
    await expect(
      sendTeamsTestPost(t.db, owner, 'laika', SECRET, { fetchImpl: fake.fetchImpl }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'teams_no_channel' } });
    expect(fake.requests).toEqual([]);
    expect(t.db.select().from(teamsPosts).all()).toEqual([]);
  });
});
