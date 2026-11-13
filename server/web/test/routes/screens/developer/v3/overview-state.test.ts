/**
 * What the V3 Overview says (LAI-1048, LAI-1079), from `GET /devices` and the
 * reader's setup records alone: the hero's one next step and where it goes,
 * the journey's three steps, the connection status card, the setups list and
 * what needs the reader — and that its numbers are the Devices tab's.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { Device } from '../../../../../src/api/devices.ts';
import type { ProjectSetup } from '../../../../../src/api/project-setups.ts';
import type { TokenView } from '../../../../../src/api/tokens.ts';
import { deviceCounts } from '../../../../../src/routes/screens/developer/v3/devices-view.ts';
import {
  ADVANCED_ADDRESS,
  OVERVIEW_ADDRESSES,
  SETUP_CHIPS,
  attentionItems,
  attentionWord,
  heroOf,
  journeyComplete,
  journeyRows,
  overviewState,
  overviewSummary,
  statusLines,
  toolAddress,
  wizardAddress,
  type OverviewState,
} from '../../../../../src/routes/screens/developer/v3/overview-state.ts';
import {
  deviceLine,
  repoMeta,
  repoTitle,
} from '../../../../../src/routes/screens/developer/v3/repo-groups.ts';
import type { UpdateStatus } from '../../../../../src/routes/screens/developer/v3/update-status.ts';
import { NEVER_REPORTED } from '../../../../helpers/launcher.ts';

const NOW = 1_800_000_000_000;
const PROJECTS = '/developer?tab=projects';
/** Project setup's wizard, which the tab opens on only for a reader with no setup (LAI-321). */
const WIZARD = '/developer?tab=projects&view=wizard';
const TOOLS = '/developer?tab=tools';

const token = (over: Partial<TokenView> = {}): TokenView => ({
  id: 't1',
  name: 't1',
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_id: 'a1',
  agent_label: 'Claude Code · Belka',
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  ...over,
});

const agent = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [],
  tokens: [token()],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  launcher: NEVER_REPORTED,
  ...over,
});

const device = (over: Partial<Device> & { id: string; agents: RegisteredAgent[] }): Device => {
  const active = over.agents.filter((a) => a.status === 'active').length;
  return {
    display_name: 'Belka',
    device_label: 'belka',
    kind: 'local',
    origin: 'paired',
    status: 'active',
    confirmed: true,
    confirmed_at: null,
    paired_at: 1,
    key_fingerprint: null,
    last_seen_at: null,
    active_count: active,
    revoked_count: over.agents.length - active,
    created_at: 1,
    revoked_at: null,
    launcher: NEVER_REPORTED,
    ...over,
  };
};

const setup = (over: Partial<ProjectSetup> & { id: string }): ProjectSetup => ({
  agent_id: 'a1',
  device_label: 'Belka',
  project_id: 'p1',
  project_slug: 'onroute',
  repo_label: null,
  repo_key: '',
  instructions_path: 'CLAUDE.md',
  block_found: true,
  template_revision: 2,
  project_match: null,
  prefix_match: null,
  source: 'self_reported_browser',
  checked_at: NOW - 60_000,
  ...over,
});

const check = (over: Partial<ProjectSetup> & { id: string }): ProjectSetup =>
  setup({
    source: 'local_check',
    repo_label: 'onroute-app',
    repo_key: 'a'.repeat(64),
    project_match: true,
    prefix_match: true,
    ...over,
  });

/** A tool whose own credential has reached the board a minute ago. */
const seen = (over: Partial<RegisteredAgent> & { id: string }): RegisteredAgent =>
  agent({ last_seen_at: NOW - 60_000, ...over });

const state = (devices: Device[], records: ProjectSetup[] = []): OverviewState =>
  overviewState(devices, records, NOW);

/** The card's lines as the page draws them: the tools chip from what needs the reader. */
const lines = (s: OverviewState, updates: ReadonlyMap<string, UpdateStatus> = new Map()) =>
  statusLines(s, attentionItems(s, updates, NOW));

void describe('the hero: one next step, from real data', () => {
  void test('nothing at all: start by connecting a device', () => {
    const s = state([]);
    assert.equal(s.hero, 'no-device');
    const hero = heroOf(s, NOW, PROJECTS, TOOLS);
    assert.equal(hero.eyebrow, 'Start here');
    assert.equal(hero.title, 'Start by connecting your device');
    // The design's sentence (LAI-1096), true before anything is paired.
    assert.equal(
      hero.sub,
      'Pair your laptop or cloud runner with Laika. No coding tool selection is needed yet.',
    );
    assert.deepEqual(hero.primary, { label: 'Add a device', href: OVERVIEW_ADDRESSES.addDevice });
    assert.equal(hero.secondary, undefined);
  });

  void test('a paired device with no tool yet: connect a coding tool on it', () => {
    const s = state([device({ id: 'd1', agents: [] })]);
    assert.equal(s.hero, 'no-tool');
    const hero = heroOf(s, NOW, PROJECTS, TOOLS);
    assert.equal(hero.eyebrow, 'Start here');
    assert.equal(hero.title, 'Connect a coding tool');
    assert.match(hero.sub, / on Belka\./);
    assert.deepEqual(hero.primary, {
      label: 'Add your first tool',
      href: OVERVIEW_ADDRESSES.addTool,
    });
    assert.equal(hero.secondary, undefined);
  });

  void test('a tool registered and never heard from: finish connecting it, at its row', () => {
    const s = state([
      device({
        id: 'd1',
        agents: [agent({ id: 'a1', harness: 'codex', created_at: 2 }), agent({ id: 'a0' })],
      }),
    ]);
    assert.equal(s.hero, 'finish-tool');
    assert.equal(s.pending?.id, 'a1', 'the newest tool that needs setup');
    const hero = heroOf(s, NOW, PROJECTS, TOOLS);
    assert.equal(hero.eyebrow, 'Your next step');
    assert.equal(hero.title, 'Finish connecting Codex · Belka');
    assert.equal(
      hero.sub,
      'Credential created, never used. Finish its setup on Belka; this page moves on once it has connected.',
    );
    assert.deepEqual(hero.primary, { label: 'Continue setup', href: toolAddress('a1') });
    assert.equal(hero.secondary, undefined);
  });

  void test('a tool seen once whose credential has expired still needs finishing', () => {
    const s = state([
      device({
        id: 'd1',
        agents: [seen({ id: 'a1', tokens: [token({ expires_at: NOW - 1 })] })],
      }),
    ]);
    assert.equal(s.hero, 'finish-tool');
    assert.match(heroOf(s, NOW, PROJECTS, TOOLS).sub, /^Its credential has expired\. /);
  });

  void test('a connected tool and no setup: set up the project repository, or manage tools', () => {
    const s = state([device({ id: 'd1', agents: [seen({ id: 'a1' })] })]);
    assert.equal(s.hero, 'no-setup');
    const hero = heroOf(s, NOW, PROJECTS, TOOLS);
    assert.equal(hero.eyebrow, 'Your next step');
    assert.equal(hero.title, 'Set up your project repository');
    assert.deepEqual(hero.primary, { label: 'Set up a project', href: WIZARD });
    assert.deepEqual(hero.secondary, { label: 'Manage tools', href: TOOLS });
  });

  void test('a recorded setup: set up another repository', () => {
    const s = state([device({ id: 'd1', agents: [seen({ id: 'a1' })] })], [setup({ id: 's1' })]);
    assert.equal(s.hero, 'all-done');
    const hero = heroOf(s, NOW, PROJECTS, TOOLS);
    assert.equal(hero.title, 'Set up another repository');
    assert.match(hero.sub, /^1 repository setup so far\./);
    assert.deepEqual(hero.primary, { label: 'Set up a repository', href: WIZARD });
    assert.deepEqual(hero.secondary, { label: 'Manage tools', href: TOOLS });
  });

  void test('a check that found no block is not a setup: the next step stays', () => {
    const s = state(
      [device({ id: 'd1', agents: [seen({ id: 'a1' })] })],
      [check({ id: 's1', block_found: false, template_revision: null })],
    );
    assert.equal(s.hero, 'no-setup');
    assert.equal(s.setUp, 0);
    assert.equal(s.setups.length, 1, 'still listed, as what the check found');
  });

  void test('one connected tool is enough to move past the tool step', () => {
    const s = state([
      device({ id: 'd1', agents: [seen({ id: 'a1' }), agent({ id: 'a2', created_at: 2 })] }),
    ]);
    assert.equal(s.hero, 'no-setup');
    assert.equal(s.pending, undefined);
  });
});

void describe('which devices and tools count: the Devices tab’s', () => {
  void test('a paired device with no tool counts — the old read skipped it', () => {
    const devices = [device({ id: 'd1', agents: [] })];
    const s = state(devices);
    assert.equal(s.devices.length, 1);
    assert.deepEqual(s.counts, deviceCounts(devices));
  });

  void test('revoked devices, an imported label with no tool, and revoked tools count for nothing', () => {
    const devices = [
      device({ id: 'd1', agents: [seen({ id: 'a1' }), agent({ id: 'gone', status: 'revoked' })] }),
      device({ id: 'd2', display_name: 'Old', status: 'revoked', agents: [] }),
      device({ id: 'd3', display_name: 'Label', origin: 'imported', agents: [] }),
    ];
    const s = state(devices);
    assert.deepEqual(
      s.devices.map((d) => d.id),
      ['d1'],
    );
    assert.deepEqual(
      s.tools.map((t) => t.id),
      ['a1'],
    );
    assert.deepEqual(s.counts, deviceCounts(devices));
    assert.equal(s.counts.devices, 1);
    assert.equal(s.counts.tools, 1);
  });

  void test('tools newest first across devices; needs setup is the Devices tab’s word', () => {
    const s = state([
      device({ id: 'd1', agents: [seen({ id: 'a1' }), agent({ id: 'a2', created_at: 3 })] }),
      device({
        id: 'd2',
        display_name: 'Strelka',
        device_label: 'strelka',
        agents: [agent({ id: 'a3', device_label: 'Strelka', created_at: 2, tokens: [] })],
      }),
    ]);
    assert.deepEqual(
      s.tools.map((t) => t.id),
      ['a2', 'a3', 'a1'],
    );
    assert.deepEqual(
      s.needSetup.map((t) => t.id),
      ['a2', 'a3'],
    );
  });
});

void describe('the setup journey', () => {
  void test('fresh: the first step is next, the others locked with a reason', () => {
    const rows = journeyRows(state([]), PROJECTS, TOOLS);
    assert.deepEqual(
      rows.map((r) => [r.step, r.state, r.action.label, r.locked ?? '']),
      [
        ['device', 'active', 'Start', ''],
        ['tool', 'pending', 'Start', 'Add a device first'],
        ['project', 'pending', 'Start', 'Connect a tool first'],
      ],
    );
    assert.equal(rows[0].action.href, OVERVIEW_ADDRESSES.addDevice);
    // The design's lines for the steps still to do (LAI-1096).
    assert.deepEqual(
      rows.map((r) => r.line),
      [
        'Pair laptop or cloud runner only',
        'Give the tool its own credential and verify it',
        'Project-specific prompt · no new token · no re-install',
      ],
    );
    assert.equal(journeyComplete(rows), '0 of 3 complete');
  });

  void test('a device only: Manage it, and the tool step is next', () => {
    const rows = journeyRows(
      state([
        device({ id: 'd1', agents: [] }),
        device({ id: 'd2', display_name: 'Strelka', agents: [] }),
      ]),
      PROJECTS,
      TOOLS,
    );
    assert.deepEqual(rows[0], {
      step: 'device',
      name: 'Connect a device',
      state: 'done',
      line: '2 devices · Belka, Strelka',
      action: { label: 'Manage', href: OVERVIEW_ADDRESSES.devices },
    });
    assert.equal(rows[1].state, 'active');
    assert.equal(rows[1].locked, undefined);
    assert.equal(rows[1].action.href, OVERVIEW_ADDRESSES.addTool);
    assert.equal(rows[2].state, 'pending');
    assert.equal(journeyComplete(rows), '1 of 3 complete');
  });

  void test('a tool never seen: the tool step names it and Start goes to its row', () => {
    const rows = journeyRows(
      state([device({ id: 'd1', agents: [agent({ id: 'a1', harness: 'codex' })] })]),
      PROJECTS,
      TOOLS,
    );
    assert.equal(rows[1].state, 'active');
    assert.equal(rows[1].line, 'Codex · Belka registered, not connected yet');
    assert.deepEqual(rows[1].action, { label: 'Start', href: toolAddress('a1') });
  });

  void test('connected: real counts on the tool step, the project step next', () => {
    const rows = journeyRows(
      state([
        device({
          id: 'd1',
          agents: [seen({ id: 'a1' }), agent({ id: 'a2' }), agent({ id: 'a3' })],
        }),
      ]),
      PROJECTS,
      TOOLS,
    );
    assert.deepEqual(rows[1], {
      step: 'tool',
      name: 'Add your coding tool',
      state: 'done',
      line: '3 tools registered, 1 connected',
      action: { label: 'Manage', href: TOOLS },
    });
    assert.equal(rows[2].state, 'active');
    assert.deepEqual(rows[2].action, { label: 'Start', href: WIZARD });
    assert.equal(journeyComplete(rows), '2 of 3 complete');
  });

  void test('all done: Open the setups, with how many a check confirmed', () => {
    const rows = journeyRows(
      state(
        [device({ id: 'd1', agents: [seen({ id: 'a1' }), seen({ id: 'a2', harness: 'codex' })] })],
        [check({ id: 's1' }), setup({ id: 's2', agent_id: 'a2', project_id: 'p2' })],
      ),
      PROJECTS,
      TOOLS,
    );
    assert.deepEqual(rows[2], {
      step: 'project',
      name: 'Set up a project repository',
      state: 'done',
      line: '2 repository setups · 1 checked',
      action: { label: 'Open', href: PROJECTS },
    });
    assert.equal(journeyComplete(rows), '3 of 3 complete');
  });
});

void describe('connection status', () => {
  void test('fresh: nothing added, the setups are the next step', () => {
    assert.deepEqual(
      lines(state([])).map((l) => [l.key, l.count, l.names, l.chip.word, l.chip.tone]),
      [
        ['devices', '0 devices', 'No paired devices', 'Not added', 'neutral'],
        ['tools', '0 tools', 'No tools yet', 'Not added', 'neutral'],
        [
          'setups',
          '0 repositories set up',
          'Project prompts and instructions files',
          'Next step',
          'accent',
        ],
      ],
    );
  });

  void test('names, and a word only as far as the evidence goes', () => {
    const drawn = lines(
      state(
        [
          device({
            id: 'd1',
            agents: [seen({ id: 'a1' }), agent({ id: 'a2', harness: 'codex', created_at: 2 })],
          }),
          device({
            id: 'd2',
            display_name: 'Strelka',
            origin: 'imported',
            agents: [seen({ id: 'a3', device_label: 'Strelka', harness: 'omnigent' })],
          }),
        ],
        [check({ id: 's1' }), setup({ id: 's2', agent_id: 'a3', project_id: 'p2' })],
      ),
    );
    assert.deepEqual(
      drawn.map((l) => [l.count, l.names, l.chip.word, l.chip.tone]),
      [
        ['2 devices', 'Belka, Strelka', '1 imported', 'neutral'],
        // The tools by name alone: their devices are the line above (LAI-1096).
        ['3 tools', 'Codex, Claude Code, Omnigent', '1 needs setup', 'warn'],
        ['2 repositories set up', '1 checked, 1 not verified', '1 to verify', 'neutral'],
      ],
    );
  });

  void test('every device paired, every tool connected, every setup checked', () => {
    const drawn = lines(
      state([device({ id: 'd1', agents: [seen({ id: 'a1' })] })], [check({ id: 's1' })]),
    );
    assert.deepEqual(
      drawn.map((l) => l.chip),
      [
        { word: 'Paired', tone: 'ok' },
        { word: 'Connected', tone: 'ok' },
        { word: 'Checked', tone: 'ok' },
      ],
    );
    assert.equal(drawn[0]?.count, '1 device');
    assert.equal(drawn[2]?.count, '1 repository set up');
  });

  void test('a setup a check found out of date is to update, not checked and not yours', () => {
    const [, , setups] = lines(
      state(
        [device({ id: 'd1', agents: [seen({ id: 'a1' })] })],
        [check({ id: 's1' }), check({ id: 's2', project_id: 'p2', template_revision: 1 })],
      ),
    );
    assert.deepEqual(setups, {
      key: 'setups',
      icon: 'repo',
      count: '2 repositories set up',
      names: '1 checked, 1 to update',
      chip: { word: '1 needs an update', tone: 'warn' },
    });
  });

  void test('two tools that need setup say so in the plural; all imported is Imported', () => {
    const drawn = lines(
      state([
        device({
          id: 'd1',
          origin: 'imported',
          agents: [seen({ id: 'a1' }), agent({ id: 'a2' }), agent({ id: 'a3' })],
        }),
      ]),
    );
    assert.equal(drawn[0]?.chip.word, 'Imported');
    assert.equal(drawn[1]?.chip.word, '2 need setup');
  });

  void test('a tool on two devices is named once on the tools line', () => {
    const drawn = lines(
      state([
        device({ id: 'd1', agents: [seen({ id: 'a1', created_at: 2 })] }),
        device({
          id: 'd2',
          display_name: 'Strelka',
          agents: [seen({ id: 'a2', device_label: 'Strelka' })],
        }),
      ]),
    );
    assert.equal(drawn[1]?.count, '2 tools');
    assert.equal(drawn[1]?.names, 'Claude Code');
  });

  void test('the tools chip says what the tools need: setup, an update, or attention (LAI-1096)', () => {
    const required: UpdateStatus = {
      key: 'required',
      word: 'Update required',
      tone: 'danger',
      reason: '',
      requiredFor: [],
      aheadOfBoard: false,
    };
    const one = state([device({ id: 'd1', agents: [seen({ id: 'a1' })] })]);
    assert.deepEqual(lines(one, new Map([['a1', required]]))[1]?.chip, {
      word: '1 needs an update',
      tone: 'warn',
    });
    const mixed = state([
      device({ id: 'd1', agents: [seen({ id: 'a1' }), agent({ id: 'a2', harness: 'codex' })] }),
    ]);
    assert.deepEqual(lines(mixed, new Map([['a1', required]]))[1]?.chip, {
      word: '2 need attention',
      tone: 'warn',
    });
    // Without the update it is the one tool not connected.
    assert.equal(lines(mixed)[1]?.chip.word, '1 needs setup');
  });
});

/** A second repository's key, beside `check`'s. */
const WEB = 'b'.repeat(64);

void describe('the setups chip: the most useful true thing, in order', () => {
  const tools = [
    seen({ id: 'a1' }),
    seen({ id: 'a2', harness: 'codex' }),
    seen({ id: 'a3', harness: 'omnigent' }),
  ];
  const chipOf = (records: ProjectSetup[]) =>
    lines(state([device({ id: 'd1', agents: tools })], records))[2]?.chip;

  void test('an update available comes first, whatever else is there', () => {
    assert.deepEqual(
      chipOf([
        check({ id: 's1' }),
        setup({ id: 's2', agent_id: 'a2' }),
        check({ id: 's3', agent_id: 'a3', template_revision: 1 }),
      ]),
      { word: '1 needs an update', tone: 'warn' },
    );
    assert.deepEqual(
      chipOf([
        check({ id: 's1', template_revision: 1 }),
        check({ id: 's2', agent_id: 'a2', template_revision: 1, repo_key: WEB }),
      ]),
      { word: '2 need an update', tone: 'warn' },
    );
    // One repository out of date on two devices is one to update, not two (LAI-321).
    assert.deepEqual(
      chipOf([
        check({ id: 's1', template_revision: 1 }),
        check({ id: 's2', agent_id: 'a2', template_revision: 1 }),
      ]),
      { word: '1 needs an update', tone: 'warn' },
    );
  });

  void test('a check that found no block is warned of too, before anything only recorded', () => {
    assert.deepEqual(
      chipOf([
        check({ id: 's1', block_found: false, template_revision: null }),
        setup({ id: 's2', agent_id: 'a2' }),
      ]),
      { word: '1 has no block', tone: 'warn' },
    );
    assert.deepEqual(
      chipOf([
        check({ id: 's1', block_found: false, template_revision: null }),
        check({
          id: 's2',
          agent_id: 'a2',
          block_found: false,
          template_revision: null,
          repo_key: WEB,
        }),
      ]),
      { word: '2 have no block', tone: 'warn' },
    );
  });

  void test('else the reader’s own word still to verify, even beside a check', () => {
    assert.deepEqual(chipOf([check({ id: 's1' }), setup({ id: 's2', agent_id: 'a2' })]), {
      word: '1 to verify',
      tone: 'neutral',
    });
    assert.deepEqual(
      chipOf([setup({ id: 's1' }), setup({ id: 's2', agent_id: 'a2', project_id: 'p2' })]),
      { word: '2 to verify', tone: 'neutral' },
    );
  });

  void test('else Checked, only when a check found every one current', () => {
    assert.deepEqual(
      chipOf([check({ id: 's1' }), check({ id: 's2', agent_id: 'a2', repo_label: 'web' })]),
      { word: 'Checked', tone: 'ok' },
    );
  });

  void test('none at all is the next step', () => {
    assert.deepEqual(chipOf([]), { word: 'Next step', tone: 'accent' });
  });
});

void describe('repository setups: one row per repository, each device under it (LAI-321)', () => {
  const laptops = [
    device({
      id: 'd1',
      agents: [seen({ id: 'a1' }), seen({ id: 'a3', harness: 'omnigent', created_at: 2 })],
    }),
    device({
      id: 'd2',
      display_name: 'Strelka',
      agents: [seen({ id: 'a2', harness: 'codex', device_label: 'Strelka' })],
    }),
  ];

  void test('one repository set up by three tools on two devices is one row, not three', () => {
    const s = state(laptops, [
      check({ id: 's1' }),
      check({ id: 's2', agent_id: 'a3', instructions_path: 'AGENTS.md' }),
      check({ id: 's3', agent_id: 'a2' }),
    ]);
    assert.equal(s.setups.length, 1);
    const [repo] = s.setups;
    assert.equal(repoTitle(repo!, 'OnRoute'), 'onroute-app');
    assert.equal(repoMeta(repo!, 'OnRoute'), 'OnRoute · CLAUDE.md');
    assert.deepEqual(
      repo!.devices.map((d) => [d.device, deviceLine(d), SETUP_CHIPS[d.chip].word]),
      [
        ['Belka', 'Claude Code, Omnigent', 'Checked'],
        ['Strelka', 'Codex', 'Checked'],
      ],
    );
    // Counted as the one repository it is, on the card and the journey alike.
    assert.equal(s.setUp, 1);
    assert.equal(s.checked, 1);
    assert.equal(lines(s)[2]?.count, '1 repository set up');
    assert.equal(journeyRows(s, PROJECTS, TOOLS)[2].line, '1 repository setup · 1 checked');
  });

  void test('the reader’s word joins the repository, and its device says it is not verified', () => {
    const s = state(laptops, [
      check({ id: 's1' }),
      setup({ id: 's2', agent_id: 'a2', instructions_path: 'AGENTS.md' }),
    ]);
    assert.equal(s.setups.length, 1);
    const [repo] = s.setups;
    assert.deepEqual(
      repo!.devices.map((d) => [d.device, deviceLine(d), SETUP_CHIPS[d.chip].word]),
      [
        ['Belka', 'Claude Code', 'Checked'],
        ['Strelka', 'Codex · not verified', 'Recorded by you'],
      ],
    );
    // A repository reads as its least certain device.
    assert.equal(repo!.chip, 'recorded');
    assert.deepEqual(SETUP_CHIPS.recorded, { word: 'Recorded by you', tone: 'neutral' });
    assert.deepEqual(SETUP_CHIPS.checked, { word: 'Checked', tone: 'ok' });
  });

  void test('a repository named after its project says the name once', () => {
    const [repo] = state(laptops, [check({ id: 's1', repo_label: 'On-Route' })]).setups;
    assert.equal(repoTitle(repo!, 'OnRoute'), 'On-Route');
    assert.equal(repoMeta(repo!, 'OnRoute'), 'CLAUDE.md');
  });

  void test('an older template revision is Update available; no block found says so', () => {
    const s = state(laptops, [
      check({ id: 's1', template_revision: 1 }),
      check({
        id: 's2',
        agent_id: 'a2',
        block_found: false,
        template_revision: null,
        repo_key: WEB,
      }),
    ]);
    assert.deepEqual(
      s.setups.map((r) => r.chip),
      ['update-available', 'missing'],
    );
    assert.deepEqual(SETUP_CHIPS['update-available'], { word: 'Update available', tone: 'warn' });
    assert.deepEqual(SETUP_CHIPS.missing, { word: 'No block found', tone: 'warn' });
  });

  void test('a disconnected tool’s records go with it; one naming no tool says so', () => {
    const s = state(laptops, [
      setup({ id: 's1', agent_id: 'gone' }),
      setup({ id: 's2', agent_id: null, instructions_path: null }),
    ]);
    assert.equal(s.setups.length, 1);
    assert.equal(repoMeta(s.setups[0]!, 'OnRoute'), 'instructions file');
    assert.equal(deviceLine(s.setups[0]!.devices[0]!), 'No tool named · not verified');
  });
});

void describe('what needs the reader', () => {
  const update = (key: UpdateStatus['key'], word: string): UpdateStatus => ({
    key,
    word,
    tone: 'danger',
    reason: '',
    requiredFor: [],
    aheadOfBoard: false,
  });

  void test('tools not connected yet, and a helper the board needs updated, each to its row', () => {
    const s = state([
      device({
        id: 'd1',
        agents: [
          seen({ id: 'a1' }),
          seen({ id: 'a2', harness: 'codex', created_at: 2 }),
          agent({ id: 'a3', harness: 'omnigent', created_at: 3 }),
        ],
      }),
    ]);
    const items = attentionItems(
      s,
      new Map([
        ['a1', update('up-to-date', 'Up to date')],
        ['a2', update('required', 'Update required for pairing devices')],
      ]),
      NOW,
    );
    assert.deepEqual(items, [
      {
        agentId: 'a3',
        label: 'Omnigent · Belka',
        why: 'credential created, never used',
        href: toolAddress('a3'),
        setup: true,
        update: false,
        action: 'Finish setup',
      },
      {
        agentId: 'a2',
        label: 'Codex · Belka',
        why: 'update required for pairing devices',
        href: toolAddress('a2'),
        setup: false,
        update: true,
        action: 'Open details',
      },
    ]);
  });

  void test('behind the chip the hero’s tool is listed too, so the list matches its count (LAI-1096)', () => {
    const s = state([
      device({
        id: 'd1',
        agents: [agent({ id: 'a1', created_at: 2 }), agent({ id: 'a2', harness: 'codex' })],
      }),
    ]);
    assert.equal(s.pending?.id, 'a1');
    const items = attentionItems(s, new Map(), NOW);
    assert.deepEqual(
      items.map((i) => i.agentId),
      ['a1', 'a2'],
    );
    assert.equal(lines(s)[1]?.chip.word, '2 need setup');
  });

  void test('the chip’s word: one need named, a mix is attention', () => {
    const setupOnly = { setup: true, update: false };
    const updateOnly = { setup: false, update: true };
    const both = { setup: true, update: true };
    assert.equal(attentionWord([setupOnly]), '1 needs setup');
    assert.equal(attentionWord([setupOnly, setupOnly]), '2 need setup');
    assert.equal(attentionWord([updateOnly]), '1 needs an update');
    assert.equal(attentionWord([updateOnly, updateOnly]), '2 need an update');
    assert.equal(attentionWord([setupOnly, updateOnly]), '2 need attention');
    assert.equal(attentionWord([both]), '1 needs attention');
  });

  void test('Update available, Version unknown and Could not check are not attention', () => {
    const s = state([device({ id: 'd1', agents: [seen({ id: 'a1' })] })]);
    for (const [key, word] of [
      ['available', 'Update available'],
      ['unknown', 'Version unknown'],
      ['unchecked', 'Could not check'],
    ] as const) {
      assert.deepEqual(attentionItems(s, new Map([['a1', update(key, word)]]), NOW), []);
    }
  });
});

void describe('overviewSummary: what the live region says', () => {
  void test('the next step, then the tools on the board and how many have connected', () => {
    assert.equal(overviewSummary(state([])), 'Next step: Start by connecting your device.');
    assert.equal(
      overviewSummary(
        state([
          device({ id: 'd1', agents: [seen({ id: 'a1' })] }),
          device({
            id: 'd2',
            display_name: 'Strelka',
            agents: [agent({ id: 'a2', device_label: 'Strelka', created_at: 2 })],
          }),
        ]),
      ),
      'Next step: Set up your project repository. 2 tools on this board, 1 connected.',
    );
  });

  void test('a tool registered and never used is on the board, not connected', () => {
    const said = overviewSummary(state([device({ id: 'd1', agents: [agent({ id: 'a1' })] })]));
    assert.equal(
      said,
      'Next step: Finish connecting Claude Code · Belka. 1 tool on this board, 0 connected.',
    );
  });
});

void describe('addresses', () => {
  void test('Set up a repository opens Project setup’s wizard, in either mode (LAI-321)', () => {
    assert.equal(wizardAddress(PROJECTS), WIZARD);
    assert.equal(
      wizardAddress('/developer?tab=projects&setup=v3'),
      '/developer?tab=projects&setup=v3&view=wizard',
    );
    assert.equal(wizardAddress(WIZARD), WIZARD);
  });

  void test('Advanced is where scripts and the API get a credential', () => {
    assert.equal(ADVANCED_ADDRESS, '/developer?tab=advanced');
  });

  void test('Manage tools is the Tools tab, and a tool opens there with its Details (LAI-1080)', () => {
    assert.equal(OVERVIEW_ADDRESSES.tools, '/developer?tab=tools');
    assert.equal(toolAddress('a 1'), '/developer?tab=tools&agent=a%201');
  });
});
