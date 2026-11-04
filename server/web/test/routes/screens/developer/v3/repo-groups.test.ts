/**
 * *Your repository setups* as one row per repository (LAI-321), checked
 * against the owner's own records on 2026-11-04: Laika set up by three tools
 * on two laptops, and OnRoute checked once and said once.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../../../src/api/agents.ts';
import type { ProjectSetup } from '../../../../../src/api/project-setups.ts';
import {
  repoGroups,
  repoMeta,
  repoTitle,
  sameName,
} from '../../../../../src/routes/screens/developer/v3/repo-groups.ts';
import { NEVER_REPORTED } from '../../../../helpers/launcher.ts';

const LAIKA = 'a'.repeat(64);
const ONROUTE = 'b'.repeat(64);

const agent = (id: string, harness: string, device: string): RegisteredAgent => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: id,
  harness,
  device_label: device,
  status: 'active',
  grants: [],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  launcher: NEVER_REPORTED,
});

const check = (over: Partial<ProjectSetup> & { id: string; agent_id: string }): ProjectSetup => ({
  device_label: null,
  project_id: 'p-laika',
  project_slug: 'laika',
  repo_label: 'Laika',
  repo_key: LAIKA,
  instructions_path: 'CLAUDE.md',
  block_found: true,
  template_revision: 2,
  project_match: true,
  prefix_match: true,
  source: 'local_check',
  checked_at: 1,
  ...over,
});

const said = (over: Partial<ProjectSetup> & { id: string }): ProjectSetup =>
  check({
    agent_id: 'g6',
    source: 'self_reported_browser',
    repo_label: null,
    repo_key: '',
    project_match: null,
    prefix_match: null,
    ...over,
  });

// The owner's tools: two on the 36 GB laptop, two on the 16 GB one.
const TOOLS = [
  agent('cc36', 'claude-code', 'KvellD’s MacBook 36 GB'),
  agent('om36', 'omnigent', 'KvellD’s MacBook 36 GB'),
  agent('polly', 'omnigent', 'Pawan’s MacBook 16 GB'),
  agent('g6', 'claude-code', 'Pawan’s MacBook 16 GB'),
];

const OWNERS_RECORDS: ProjectSetup[] = [
  check({ id: 's1', agent_id: 'cc36' }),
  check({ id: 's2', agent_id: 'polly' }),
  check({ id: 's3', agent_id: 'om36', instructions_path: 'AGENTS.md' }),
  check({
    id: 's4',
    agent_id: 'g6',
    project_id: 'p-onroute',
    project_slug: 'onroute',
    repo_label: 'On-Route',
    repo_key: ONROUTE,
  }),
  said({ id: 's5', project_id: 'p-onroute', project_slug: 'onroute' }),
];

void describe('one row per repository (LAI-321)', () => {
  void test('the owner’s records: Laika once with two laptops under it, OnRoute once', () => {
    const groups = repoGroups(OWNERS_RECORDS, TOOLS);
    assert.deepEqual(
      groups.map((g) => [g.projectSlug, g.repoLabel, g.devices.length]),
      [
        ['laika', 'Laika', 2],
        ['onroute', 'On-Route', 1],
      ],
    );
    const laika = groups[0]!;
    assert.deepEqual(
      laika.devices.map((d) => [d.device, d.tools.map((t) => t.name)]),
      [
        ['KvellD’s MacBook 36 GB', ['Claude Code', 'Omnigent']],
        ['Pawan’s MacBook 16 GB', ['Omnigent']],
      ],
    );
    assert.equal(laika.chip, 'checked');
  });

  void test('the reader’s word joins the repository the same tool checked', () => {
    const onroute = repoGroups(OWNERS_RECORDS, TOOLS)[1]!;
    assert.equal(onroute.key, `p-onroute:${ONROUTE}`);
    assert.deepEqual(
      onroute.devices.map((d) => [d.device, d.recordedByYou]),
      [['Pawan’s MacBook 16 GB', true]],
    );
  });

  void test('the name is said once when the repository is named after its project', () => {
    const [laika, onroute] = repoGroups(OWNERS_RECORDS, TOOLS);
    assert.equal(repoTitle(laika!, 'Laika'), 'Laika');
    assert.equal(repoMeta(laika!, 'Laika'), 'CLAUDE.md');
    assert.equal(repoTitle(onroute!, 'OnRoute'), 'On-Route');
    assert.equal(repoMeta(onroute!, 'OnRoute'), 'CLAUDE.md');
    assert.equal(sameName('On-Route', 'OnRoute'), true);
    assert.equal(sameName('laika-web', 'Laika'), false);
    assert.equal(sameName('---', '+++'), false, 'two names of no letters are not one name');
    assert.equal(
      repoMeta({ repoLabel: 'laika-web', instructionsPath: 'CLAUDE.md' }, 'Laika'),
      'Laika · CLAUDE.md',
    );
  });

  void test('two repositories that share a label stay two', () => {
    const groups = repoGroups(
      [
        check({ id: 's1', agent_id: 'cc36', repo_label: 'api', repo_key: 'c'.repeat(64) }),
        check({ id: 's2', agent_id: 'cc36', repo_label: 'api', repo_key: 'd'.repeat(64) }),
      ],
      TOOLS,
    );
    assert.equal(groups.length, 2);
  });

  void test('the reader’s word stands alone when its project has two repositories and the tool checked neither', () => {
    const groups = repoGroups(
      [
        check({ id: 's1', agent_id: 'cc36' }),
        check({ id: 's2', agent_id: 'cc36', repo_label: 'laika-web', repo_key: 'e'.repeat(64) }),
        said({ id: 's3', agent_id: 'polly', project_id: 'p-laika', project_slug: 'laika' }),
      ],
      TOOLS,
    );
    assert.deepEqual(
      groups.map((g) => [g.key, g.repoLabel]),
      [
        [`p-laika:${LAIKA}`, 'Laika'],
        [`p-laika:${'e'.repeat(64)}`, 'laika-web'],
        ['p-laika:self:polly', null],
      ],
    );
    assert.equal(groups[2]!.chip, 'recorded');
  });

  void test('a disconnected tool’s records go with it', () => {
    const groups = repoGroups(
      OWNERS_RECORDS,
      TOOLS.filter((a) => a.id !== 'polly'),
    );
    assert.deepEqual(
      groups[0]!.devices.map((d) => d.device),
      ['KvellD’s MacBook 36 GB'],
    );
  });

  void test('a repository reads as its worst device', () => {
    const groups = repoGroups(
      [
        check({ id: 's1', agent_id: 'cc36' }),
        check({ id: 's2', agent_id: 'polly', block_found: false }),
      ],
      TOOLS,
    );
    assert.deepEqual(
      groups[0]!.devices.map((d) => d.chip),
      ['checked', 'missing'],
    );
    assert.equal(groups[0]!.chip, 'missing');
  });
});
