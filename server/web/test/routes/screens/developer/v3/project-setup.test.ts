/**
 * Project setup's decisions, without a browser (LAI-1052, plan §G, §H).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AGENT_CLIENTS } from '../../../../../src/api/agent-clients.ts';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { ProjectAccess } from '../../../../../src/api/project-access.ts';
import type { ProjectSetup } from '../../../../../src/api/project-setups.ts';
import {
  askedView,
  CLI_HARNESS,
  cliMatchHint,
  connectedTools,
  currentChoice,
  doneSummary,
  GRANT_MEANINGS,
  grantOptions,
  hasRecord,
  levelChip,
  noDeviceCheck,
  openingView,
  parseStep,
  projectCheckCommand,
  recordFinding,
  recordSource,
  recordState,
  setupEvidence,
  stepNumber,
  verificationWords,
  withOneGrant,
} from '../../../../../src/routes/screens/developer/v3/project-setup.ts';
import {
  catalogTool,
  TOOL_CATALOG,
} from '../../../../../src/routes/screens/developer/v3/tool-catalog.ts';
import { hazardsIn } from './shell-words.ts';
import { NEVER_REPORTED } from '../../../../helpers/launcher.ts';

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
  launcher: NEVER_REPORTED,
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
  repo_key: 'a'.repeat(64),
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

  void test('the command to run names the project and the tool picked in step 1 (LAI-1084)', () => {
    assert.equal(
      projectCheckCommand('onroute', 'claude-code'),
      'laika project check --project onroute --harness claude-code',
    );
    assert.equal(
      projectCheckCommand('onroute', 'codex'),
      'laika project check --project onroute --harness codex',
    );
    // The board's `vscode` is the CLI's Copilot in VS Code.
    assert.equal(
      projectCheckCommand('onroute', 'vscode'),
      'laika project check --project onroute --harness copilot-vscode',
    );
  });

  void test('a tool the CLI refuses, or cannot name, gets no command at all (LAI-1091)', () => {
    // Antigravity: `laika tool add` refuses it, so --harness antigravity exits 2.
    assert.equal(projectCheckCommand('onroute', 'antigravity'), null);
    // `other` is Copilot CLI or Copilot cloud, both refused; Claude Desktop has no adapter.
    assert.equal(projectCheckCommand('onroute', 'other'), null);
    assert.equal(projectCheckCommand('onroute', 'claude-desktop'), null);
    // Every tool the CLI sets up still gets its command.
    for (const tool of TOOL_CATALOG.filter((t) => t.cliSetup)) {
      assert.match(
        projectCheckCommand('onroute', tool.harness) ?? '',
        /^laika project check --project onroute --harness [a-z-]+$/,
        tool.harness,
      );
    }
  });

  void test('the harnesses that get a command are the ones laika tool add does not refuse (LAI-1091)', () => {
    const adapters = readFileSync(
      fileURLToPath(new URL('../../../../../../../cli/src/agent-adapters.ts', import.meta.url)),
      'utf8',
    );
    const list = /export const HARNESSES = \[([^\]]*)\]/.exec(adapters)?.[1] ?? '';
    const harnesses = [...list.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1] ?? '');
    assert.ok(harnesses.includes('claude-code') && harnesses.length >= 8, String(harnesses));

    // planFor's `case` labels above each `kind:`, and `default` for the rest.
    const toolAdd = readFileSync(
      fileURLToPath(new URL('../../../../../../../cli/src/tool-add.ts', import.meta.url)),
      'utf8',
    );
    const start = toolAdd.indexOf('export function planFor(');
    assert.ok(start >= 0, 'cli/src/tool-add.ts no longer exports planFor');
    const kinds = new Map<string, string>();
    let pending: string[] = [];
    let fallback: string | undefined;
    let inDefault = false;
    for (const line of toolAdd.slice(start, toolAdd.indexOf('\n}\n', start)).split('\n')) {
      const label = /^\s*case '([^']+)':/.exec(line)?.[1];
      if (label !== undefined) pending.push(label);
      if (/^\s*default:/.test(line)) inDefault = true;
      const kind = /kind: '([a-z-]+)'/.exec(line)?.[1];
      if (kind === undefined) continue;
      for (const slug of pending) kinds.set(slug, kind);
      if (inDefault) fallback = kind;
      pending = [];
    }
    const refused = harnesses.filter((h) => (kinds.get(h) ?? fallback) === 'refused');
    // The scan read the real thing.
    assert.deepEqual([...refused].sort(), ['antigravity', 'copilot-cli', 'copilot-cloud']);

    const commanded = AGENT_CLIENTS.map((client) => projectCheckCommand('p', client))
      .filter((command): command is string => command !== null)
      .map((command) => /--harness (\S+)$/.exec(command)?.[1] ?? command);
    assert.deepEqual(
      [...new Set(commanded)].sort(),
      harnesses.filter((h) => !refused.includes(h)).sort(),
    );
  });

  void test('instead of a command: the device cannot check it yet, I’ve added it, and the manual note (LAI-1091)', () => {
    const words = noDeviceCheck('Antigravity', 'antigravity');
    assert.equal(words.title, 'Laika can’t check Antigravity’s repository from your device yet');
    assert.equal(words.body, 'Record it yourself instead, with I’ve added it below.');
    assert.equal(words.note, catalogTool('antigravity')?.notes[0]);
    assert.match(words.note ?? '', /refuses Antigravity/);
    // `other` has no catalogue entry, so no note of one.
    assert.equal(noDeviceCheck('Copilot CLI', 'other').note, null);
  });

  void test('CLI_HARNESS is the CLI’s ADAPTERS read backwards, and shell-safe', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../../../../cli/src/agent-adapters.ts', import.meta.url)),
      'utf8',
    );
    const start = source.indexOf('export const ADAPTERS');
    const adapters = source.slice(start, source.indexOf('\n};', start));
    const pairs = [
      ...adapters.matchAll(/harness: '([a-z0-9-]+)'[\s\S]*?agentHarness: '([a-z0-9-]+)'/g),
    ].map((m) => [m[1] ?? '', m[2] ?? ''] as const);
    assert.ok(pairs.length >= 8, `parsed ${String(pairs.length)} adapters`);
    assert.ok(
      pairs.some(([h, slug]) => h === 'claude-code' && slug === 'claude-code'),
      'the list did not parse',
    );

    // Every slug exactly one adapter registers under, and no other.
    const bySlug = new Map<string, string[]>();
    for (const [harness, slug] of pairs) bySlug.set(slug, [...(bySlug.get(slug) ?? []), harness]);
    const expected = Object.fromEntries(
      [...bySlug].filter(([, hs]) => hs.length === 1).map(([slug, hs]) => [slug, hs[0]]),
    );
    assert.deepEqual({ ...CLI_HARNESS }, expected);
    for (const harness of Object.values(CLI_HARNESS)) {
      assert.match(harness ?? '', /^[a-z][a-z0-9-]*$/);
    }
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

  void test('a CLI that prints a commit updates itself; an older one is the guide’s (LAI-1093)', () => {
    const hint = cliMatchHint(undefined);
    assert.equal(hint.version, 'laika version');
    assert.equal(hint.update, 'laika update');
    // No checkout path is guessed here: `git -C ~/laika pull --ff-only` failed on a
    // laptop whose checkout was elsewhere, and on one laika update left detached.
    assert.deepEqual(Object.keys(hint).sort(), ['commit', 'update', 'version']);
    assert.doesNotMatch(JSON.stringify(hint), /pull|~\/laika/);
  });

  void test('every command in it pastes as it stands: nothing a shell acts on unquoted', () => {
    const hint = cliMatchHint({ url: 'https://github.com/PawanSirsat/Laika.git', commit: null });
    assert.deepEqual(hazardsIn([hint.version, hint.update]), []);
    // The check command above it, too, for every tool that gets one.
    const commands = (Object.keys(CLI_HARNESS) as (keyof typeof CLI_HARNESS)[])
      .map((client) => projectCheckCommand('laika', client))
      .filter((command): command is string => command !== null);
    assert.ok(commands.length > 0);
    assert.deepEqual(hazardsIn(commands), []);
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
});

void describe('which view Project setup opens on (LAI-321)', () => {
  const params = (query: string) => new URLSearchParams(query);

  void test('the address decides when it names a view, or a place in the wizard', () => {
    assert.equal(askedView(params('tab=projects&view=setups')), 'setups');
    assert.equal(askedView(params('tab=projects&view=wizard')), 'wizard');
    // Tools' Set up project, the list's Open, a bookmarked step.
    assert.equal(askedView(params('tab=projects&tool=a1')), 'wizard');
    assert.equal(askedView(params('tab=projects&project=onroute')), 'wizard');
    assert.equal(askedView(params('tab=projects&step=2')), 'wizard');
    // The list wins over a wizard place it was opened from.
    assert.equal(askedView(params('tab=projects&view=setups&tool=a1&step=3')), 'setups');
    // Otherwise the records decide; preview's own key is not a place in the wizard.
    assert.equal(askedView(params('tab=projects')), undefined);
    assert.equal(askedView(params('tab=projects&setup=v3')), undefined);
    assert.equal(askedView(params('tab=projects&view=nonsense')), undefined);
  });

  void test('a reader with a setup for a connected tool sees their repositories; one without, the wizard', () => {
    const agents = [agent({ id: 'a1' }), agent({ id: 'a2', status: 'revoked' })];
    assert.equal(openingView([{ agent_id: 'a1' }], agents), 'setups');
    assert.equal(openingView([], agents), 'wizard');
    // A record about a disconnected tool reaches nothing, and is not listed.
    assert.equal(openingView([{ agent_id: 'a2' }], agents), 'wizard');
    assert.equal(openingView([{ agent_id: 'gone' }], agents), 'wizard');
    assert.equal(openingView([{ agent_id: null }], agents), 'wizard');
  });
});
