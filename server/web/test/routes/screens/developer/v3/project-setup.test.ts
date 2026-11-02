/**
 * Project setup's decisions, without a browser (LAI-1052, plan §G, §H).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { ProjectAccess } from '../../../../../src/api/project-access.ts';
import type { ProjectSetup } from '../../../../../src/api/project-setups.ts';
import {
  connectedTools,
  currentChoice,
  grantOptions,
  projectCheckCommand,
  recordFinding,
  recordSource,
  recordState,
  setupEvidence,
  withOneGrant,
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

const setup = (over: Partial<ProjectSetup> & { id: string }): ProjectSetup => ({
  agent_id: 'a1',
  device_label: 'Belka',
  project_id: 'p1',
  project_slug: 'onroute',
  repo_label: 'onroute-app',
  instructions_path: 'CLAUDE.md',
  block_found: true,
  template_revision: 2,
  project_match: true,
  prefix_match: true,
  source: 'local_check',
  checked_at: Date.UTC(2026, 9, 20, 12, 0),
  ...over,
});

void describe('what the records say (LAI-1066)', () => {
  void test('no record says not recorded, never missing or up to date', () => {
    assert.deepEqual(setupEvidence([], 'a1'), { checks: [], self: null, overall: 'not-recorded' });
  });

  void test('Update available only from a record: an older revision or a mismatch', () => {
    assert.equal(recordState(setup({ id: 's1' })), 'current');
    assert.equal(recordState(setup({ id: 's1', template_revision: 1 })), 'update-available');
    assert.equal(recordState(setup({ id: 's1', project_match: false })), 'update-available');
    assert.equal(recordState(setup({ id: 's1', prefix_match: false })), 'update-available');
    // What a record could not check is never read as a mismatch.
    assert.equal(
      recordState(setup({ id: 's1', project_match: null, prefix_match: null })),
      'current',
    );
    assert.equal(
      recordState(setup({ id: 's1', block_found: false, template_revision: null })),
      'missing',
    );
  });

  void test('a newer template than this page knows is still current', () => {
    assert.equal(recordState(setup({ id: 's1', template_revision: 9 })), 'current');
  });

  void test('splits local checks from the reader’s word, for this tool only', () => {
    const self = setup({
      id: 's2',
      source: 'self_reported_browser',
      repo_label: null,
      project_match: null,
      prefix_match: null,
    });
    const other = setup({ id: 's3', agent_id: 'a2', template_revision: 1 });
    const evidence = setupEvidence([setup({ id: 's1' }), self, other], 'a1');
    assert.deepEqual(
      evidence.checks.map((r) => r.id),
      ['s1'],
    );
    assert.equal(evidence.self?.id, 's2');
    // Another tool's older record does not raise this tool's update.
    assert.equal(evidence.overall, 'current');
  });

  void test('any record behind makes the step say Update available', () => {
    const evidence = setupEvidence(
      [setup({ id: 's1' }), setup({ id: 's2', repo_label: 'other', prefix_match: false })],
      'a1',
    );
    assert.equal(evidence.overall, 'update-available');
  });

  void test('only checks that found nothing is No block found', () => {
    const none = setup({ id: 's1', block_found: false, template_revision: null });
    assert.equal(setupEvidence([none], 'a1').overall, 'missing');
    const self = setup({ id: 's2', source: 'self_reported_browser' });
    assert.equal(setupEvidence([none, self], 'a1').overall, 'current');
  });

  void test('a local check says it was checked, where and when; the reader’s word says not verified', () => {
    const now = Date.UTC(2026, 9, 21);
    assert.match(
      recordSource(setup({ id: 's1' }), now),
      /^Checked by laika project check on Belka at \d+ Oct, \d+:\d\d [AP]M$/,
    );
    const self = recordSource(setup({ id: 's2', source: 'self_reported_browser' }), now);
    assert.match(self, /^Recorded by you at .+ — not verified$/);
    assert.doesNotMatch(self, /Checked/);
  });

  void test('presence off: no time at all', () => {
    const now = Date.UTC(2026, 9, 21);
    assert.equal(
      recordSource(setup({ id: 's1', checked_at: null }), now),
      'Checked by laika project check on Belka',
    );
    assert.equal(
      recordSource(setup({ id: 's2', source: 'self_reported_browser', checked_at: null }), now),
      'Recorded by you — not verified',
    );
  });

  void test('the finding names the revision and any mismatch, never context_revision', () => {
    assert.equal(
      recordFinding(setup({ id: 's1', template_revision: 1, project_match: false })),
      'onroute-app: as of the last check, instructions template revision 1 in CLAUDE.md — it names another project',
    );
    assert.equal(
      recordFinding(setup({ id: 's2', block_found: false, template_revision: null })),
      'onroute-app: as of the last check, no Laika block in CLAUDE.md',
    );
    assert.doesNotMatch(recordFinding(setup({ id: 's3' })), /context/i);
    // The reader's own word is not a check, so it does not say one ran.
    assert.equal(
      recordFinding(setup({ id: 's4', source: 'self_reported_browser', repo_label: null })),
      'instructions template revision 2 in CLAUDE.md',
    );
  });

  void test('the command to run names the project', () => {
    assert.equal(projectCheckCommand('onroute'), 'laika project check --project onroute');
  });
});
