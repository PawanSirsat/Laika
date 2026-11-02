/**
 * Project setup's decisions, without a browser (LAI-1052, plan §G, §H).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { ProjectAccess } from '../../../../../src/api/project-access.ts';
import type { ProjectSetup } from '../../../../../src/api/project-setups.ts';
import {
  cliMatchHint,
  connectedTools,
  currentChoice,
  doneSummary,
  GRANT_MEANINGS,
  grantOptions,
  hasRecord,
  levelChip,
  parseStep,
  projectCheckCommand,
  recordChip,
  recordFinding,
  recordSource,
  recordState,
  setupEvidence,
  setupRow,
  stepNumber,
  verificationWords,
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

  void test('a check that found no block leads over the reader’s word (LAI-1073)', () => {
    const none = setup({ id: 's1', block_found: false, template_revision: null });
    assert.equal(setupEvidence([none], 'a1').overall, 'missing');
    const self = setup({ id: 's2', source: 'self_reported_browser' });
    assert.equal(setupEvidence([none, self], 'a1').overall, 'missing');
    // A check that did find the current block, in another repository, wins.
    const found = setup({ id: 's3', repo_label: 'other' });
    assert.equal(setupEvidence([none, found, self], 'a1').overall, 'current');
    // The reader's word alone is current.
    assert.equal(setupEvidence([self], 'a1').overall, 'current');
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

void describe('the hint for a CLI older than the board (LAI-1084)', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';

  void test('names the board’s helper commit as laika version prints one: seven characters', () => {
    const hint = cliMatchHint({ url: 'https://github.com/PawanSirsat/Laika.git', commit: COMMIT });
    assert.equal(hint.commit, '0123456');
  });

  void test('a board that does not say its commit, or did not answer, names none', () => {
    const url = 'https://github.com/PawanSirsat/Laika.git';
    assert.equal(cliMatchHint({ url, commit: null }).commit, null);
    assert.equal(cliMatchHint(undefined).commit, null);
  });

  void test('the way forward works on a CLI with no laika update: the checkout itself', () => {
    const hint = cliMatchHint(undefined);
    assert.equal(hint.version, 'laika version');
    assert.equal(hint.pull, 'git -C <your Laika checkout> pull --ff-only');
    assert.equal(hint.update, 'laika update');
  });
});

void describe('the wizard’s address (LAI-1082)', () => {
  void test('a step is 1, 2, 3 or done; anything else opens at the start', () => {
    assert.deepEqual(['1', '2', '3', 'done', null, '', '4', 'Done', ' 2'].map(parseStep), [
      1,
      2,
      3,
      'done',
      1,
      1,
      1,
      1,
      1,
    ]);
    assert.deepEqual(
      [1, 2, 3, 'done'].map((s) => stepNumber(parseStep(String(s)))),
      [1, 2, 3, 4],
    );
  });
});

void describe('the authorization row (LAI-1082)', () => {
  void test('the chip names the level in words', () => {
    assert.deepEqual(levelChip('full'), { word: 'Full access', tone: 'ok' });
    assert.deepEqual(levelChip('read_only'), { word: 'Read only', tone: 'accent' });
    assert.deepEqual(levelChip('none'), { word: 'No access', tone: 'warn' });
  });

  void test('no tile’s second line says another option’s name, so each radio is found by its own', () => {
    const names = grantOptions(access()).map((o) => o.label.toLowerCase());
    for (const [value, line] of Object.entries(GRANT_MEANINGS)) {
      const own = grantOptions(access())
        .find((o) => o.value === value)
        ?.label.toLowerCase();
      for (const name of names.filter((n) => n !== own)) {
        assert.ok(!line.toLowerCase().includes(name), `${value}'s line names ${name}`);
      }
    }
  });
});

void describe('done and the setups list say no more than the records (LAI-1082)', () => {
  const now = Date.UTC(2026, 9, 21);
  const self = setup({
    id: 's2',
    source: 'self_reported_browser',
    repo_label: null,
    project_match: null,
    prefix_match: null,
  });

  void test('a record of either kind finishes the wizard; none does not', () => {
    assert.equal(hasRecord(setupEvidence([], 'a1')), false);
    assert.equal(hasRecord(setupEvidence([self], 'a1')), true);
    assert.equal(hasRecord(setupEvidence([setup({ id: 's1' })], 'a1')), true);
    // Another tool's record is not this tool's.
    assert.equal(hasRecord(setupEvidence([setup({ id: 's1', agent_id: 'a2' })], 'a1')), false);
  });

  void test('Verification says Checked only for a local check of the current block', () => {
    assert.match(
      verificationWords(setupEvidence([setup({ id: 's1' })], 'a1'), now),
      /^Checked on Belka at \d+ Oct, \d+:\d\d [AP]M$/,
    );
    assert.equal(
      verificationWords(setupEvidence([setup({ id: 's1', checked_at: null })], 'a1'), now),
      'Checked on Belka',
    );
    assert.equal(
      verificationWords(setupEvidence([self], 'a1'), now),
      'Recorded by you — not verified',
    );
    assert.equal(
      verificationWords(
        setupEvidence([setup({ id: 's1', template_revision: 1 }), self], 'a1'),
        now,
      ),
      'Update available',
    );
    assert.equal(
      verificationWords(
        setupEvidence([setup({ id: 's1', block_found: false, template_revision: null })], 'a1'),
        now,
      ),
      'No block found',
    );
    assert.equal(verificationWords(setupEvidence([], 'a1'), now), 'Not recorded');
  });

  const summary = (records: ProjectSetup[], effective: 'none' | 'read_only' | 'full') =>
    doneSummary({
      evidence: setupEvidence(records, 'a1'),
      effective,
      toolName: 'Claude Code',
      projectName: 'OnRoute',
      path: 'CLAUDE.md',
    });

  void test('the done note follows the grant in effect, and a missing block is not set up', () => {
    const full = summary([self], 'full');
    assert.equal(full.eyebrow, 'Repository set up');
    assert.match(full.body, /^With Full access, Claude Code can .+ in OnRoute, as you\./);
    assert.match(summary([self], 'read_only').body, /^With Read only, it reads .+ changes nothing/);
    const none = summary([self], 'none');
    assert.equal(none.title, 'Grant required');
    assert.equal(none.tone, 'warn');
    const missing = summary(
      [setup({ id: 's1', block_found: false, template_revision: null })],
      'full',
    );
    assert.equal(missing.eyebrow, 'Not set up yet');
    assert.equal(missing.title, 'No Laika block found');
    assert.equal(
      summary([setup({ id: 's1', prefix_match: false })], 'full').title,
      'An update is available',
    );
  });

  void test('a list row: Checked for a current local check, the reader’s word never', () => {
    assert.deepEqual(recordChip(setup({ id: 's1' })), { word: 'Checked', tone: 'ok' });
    assert.deepEqual(recordChip(self), { word: 'Recorded by you', tone: 'neutral' });
    assert.deepEqual(recordChip(setup({ id: 's1', template_revision: 1 })), {
      word: 'Update available',
      tone: 'warn',
    });
    assert.deepEqual(recordChip(setup({ id: 's1', block_found: false, template_revision: null })), {
      word: 'No block found',
      tone: 'warn',
    });
    assert.deepEqual(recordChip({ ...self, block_found: false }), {
      word: 'No block found',
      tone: 'warn',
    });
  });

  void test('a list row names the project, repository, tool and who said it', () => {
    const agents = [
      agent({ id: 'a1' }),
      agent({ id: 'a2', harness: 'codex', device_label: 'Strelka', status: 'revoked' }),
    ];
    assert.deepEqual(setupRow(setup({ id: 's1' }), agents, 'OnRoute'), {
      title: 'OnRoute · onroute-app',
      sub: 'Claude Code · Belka · CLAUDE.md · checked on Belka',
      chip: { word: 'Checked', tone: 'ok' },
      toolId: 'a1',
    });
    const mine = setupRow(self, agents, undefined);
    assert.equal(mine.title, 'onroute');
    assert.equal(mine.sub, 'Claude Code · Belka · CLAUDE.md · your word, not verified');
    // A disconnected tool, or one gone altogether, cannot be reopened.
    const revoked = setupRow(setup({ id: 's3', agent_id: 'a2' }), agents, 'OnRoute');
    assert.match(revoked.sub, /^Codex · Strelka · disconnected · /);
    assert.equal(revoked.toolId, null);
    const gone = setupRow(setup({ id: 's4', agent_id: null }), agents, 'OnRoute');
    assert.match(gone.sub, /^A tool no longer connected · /);
    assert.equal(gone.toolId, null);
  });
});
