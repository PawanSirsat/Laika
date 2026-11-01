/**
 * Project setup's decisions, without a browser (LAI-1052, plan §G, §H).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { ProjectAccess } from '../../../../../src/api/project-access.ts';
import {
  blockStatus,
  connectedTools,
  currentChoice,
  grantOptions,
  readSelfReport,
  withOneGrant,
  writeSelfReport,
} from '../../../../../src/routes/screens/developer/v3/project-setup.ts';

const agent = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  ...over,
});

const access = (over: Partial<ProjectAccess> = {}): ProjectAccess => ({
  agent_id: 'a1',
  project: { id: 'p1', slug: 'onroute', name: 'OnRoute', prefix: 'ONR', agents_allowed: true },
  member: { role: 'member', can_read: true, can_write: true },
  grant: { scope: null },
  effective: 'none',
  can_grant: { max: 'full', reason: null },
  ...over,
});

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

void describe('connectedTools', () => {
  void test('names each from the catalogue and its device, and leaves revoked ones out', () => {
    const tools = connectedTools(
      [
        agent({ id: 'b', harness: 'codex', device_label: 'Strelka' }),
        agent({ id: 'a' }),
        agent({ id: 'gone', status: 'revoked' }),
        agent({ id: 'x', harness: 'not-a-client', display_name: 'My script', device_label: null }),
      ],
      Date.now(),
    );
    assert.deepEqual(
      tools.map((t) => t.label),
      ['Claude Code · Belka', 'Codex · Strelka', 'My script · Unnamed device'],
    );
    assert.ok(
      tools.every((t) => t.status.length > 0),
      'every tool has a status word',
    );
  });
});

void describe('grantOptions', () => {
  void test('a member may choose any; No access is the default with no grant', () => {
    const value = access();
    assert.deepEqual(
      grantOptions(value).map((o) => [o.value, o.disabled === undefined]),
      [
        ['none', true],
        ['read_only', true],
        ['full', true],
      ],
    );
    assert.equal(currentChoice(value), 'none');
  });

  void test('a viewer sees Full disabled, with the reason', () => {
    const options = grantOptions(
      access({
        member: { role: 'viewer', can_read: true, can_write: false },
        can_grant: { max: 'read_only', reason: 'viewer_role' },
      }),
    );
    assert.equal(options.find((o) => o.value === 'read_only')?.disabled, undefined);
    assert.match(options.find((o) => o.value === 'full')?.disabled ?? '', /viewer/);
  });

  void test('a revoked tool may be given nothing but No access', () => {
    const options = grantOptions(access({ can_grant: { max: null, reason: 'agent_revoked' } }));
    assert.deepEqual(
      options.filter((o) => o.disabled === undefined).map((o) => o.value),
      ['none'],
    );
  });
});

void describe('withOneGrant', () => {
  const grants = [
    { project_id: 'p1', scope: 'read_only' as const },
    { project_id: 'p2', scope: 'full' as const },
  ];
  void test('changes one project and carries every other grant over', () => {
    assert.deepEqual(withOneGrant(grants, 'p1', 'full'), [
      { project_id: 'p2', scope: 'full' },
      { project_id: 'p1', scope: 'full' },
    ]);
  });
  void test('No access removes only that project', () => {
    assert.deepEqual(withOneGrant(grants, 'p2', 'none'), [
      { project_id: 'p1', scope: 'read_only' },
    ]);
  });
});

void describe('the reader’s record', () => {
  void test('none recorded says not recorded, never up to date', () => {
    assert.deepEqual(blockStatus(null), { kind: 'not-recorded' });
  });

  void test('an older revision recorded is an update; the current one is current', () => {
    assert.equal(blockStatus({ revision: 1, at: 1 }).kind, 'update-available');
    assert.equal(blockStatus({ revision: 2, at: 1 }).kind, 'current');
  });

  void test('kept per tool and project, and survives a storage that throws', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    writeSelfReport('a1', 'p1', { revision: 2, at: 5 }, storage);
    assert.deepEqual(readSelfReport('a1', 'p1', storage), { revision: 2, at: 5 });
    assert.equal(readSelfReport('a1', 'p2', storage), null);
    const broken = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    assert.equal(readSelfReport('a1', 'p1', broken), null);
    writeSelfReport('a1', 'p1', { revision: 2, at: 5 }, broken);
  });
});
