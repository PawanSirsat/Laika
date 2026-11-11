/**
 * Tool details and Device details, folded (LAI-1100): the one next action at
 * the top of each, and the words on each folded row.
 *
 * - A tool leads with the most pressing thing — revoked, needs setup, a
 *   helper the board refuses, a missing check, no project — or nothing.
 * - A device leads with *Add a tool* or the helper steps only when nothing
 *   needs the owner's attention: an imported confirmation or a duplicate
 *   pair is the action itself, shown as it is.
 * - Each row's summary says the section's state in a few words, and the
 *   consent switch is offered only where checkpoints can be saved at all.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checksSummary,
  consentSummary,
  deviceNext,
  deviceToolsSummary,
  helperSummary,
  supportsCheckpoints,
  toolNext,
  type DeviceNextInput,
  type ToolNextInput,
} from '../../../../../src/routes/screens/developer/v3/details-sections.ts';
import {
  TOOL_CATALOG,
  catalogTool,
} from '../../../../../src/routes/screens/developer/v3/tool-catalog.ts';
import type { CheckLine } from '../../../../../src/routes/screens/developer/v3/tool-readiness.ts';

const line = (id: CheckLine['id'], state: CheckLine['state']): CheckLine => ({
  id,
  label: `label of ${id}`,
  state,
  detail: `detail of ${id}`,
});

const PASSING: readonly CheckLine[] = [
  line('device_paired', 'pass'),
  line('credential_installed', 'pass'),
  line('tool_request', 'pass'),
  line('session_hooks', 'pass'),
];

/** Codex with its credential unused: the request and the session still missing. */
const UNUSED: readonly CheckLine[] = [
  line('device_paired', 'pass'),
  line('credential_installed', 'pass'),
  line('tool_request', 'fail'),
  line('session_hooks', 'fail'),
];

const tool = (over: Partial<ToolNextInput> = {}): ToolNextInput => ({
  active: true,
  status: 'ready',
  lines: PASSING,
  update: 'up-to-date',
  projects: 1,
  ...over,
});

void describe('a tool’s one next action', () => {
  void test('a revoked tool says so, whatever else is true of it', () => {
    assert.deepEqual(
      toolNext(tool({ active: false, status: 'needs-setup', update: 'required', projects: 0 })),
      { kind: 'revoked' },
    );
  });

  void test('needs setup leads with the first check still missing', () => {
    const next = toolNext(tool({ status: 'needs-setup', lines: UNUSED, update: 'required' }));
    assert.equal(next.kind, 'finish');
    assert.equal(next.kind === 'finish' ? next.check?.id : undefined, 'tool_request');
  });

  void test('needs setup before its checks are in still leads with finishing, naming no check', () => {
    assert.deepEqual(toolNext(tool({ status: 'needs-setup', lines: undefined })), {
      kind: 'finish',
      check: undefined,
    });
  });

  void test('a helper the board refuses comes before a missing check and before projects', () => {
    assert.deepEqual(
      toolNext(tool({ status: 'connected', lines: UNUSED, update: 'required', projects: 0 })),
      { kind: 'update' },
    );
  });

  void test('an update merely available is not the next action', () => {
    assert.deepEqual(toolNext(tool({ update: 'available' })), { kind: 'none' });
  });

  void test('connected with a check missing leads with that check', () => {
    const next = toolNext(tool({ status: 'connected', lines: UNUSED }));
    assert.equal(next.kind, 'check');
    assert.equal(next.kind === 'check' ? next.check.id : undefined, 'tool_request');
  });

  void test('every check done and no project: set one up', () => {
    assert.deepEqual(toolNext(tool({ projects: 0 })), { kind: 'project' });
  });

  void test('nothing to do: the status alone', () => {
    assert.deepEqual(toolNext(tool()), { kind: 'none' });
  });
});

void describe('a tool’s folded rows', () => {
  void test('Checks: done of those that apply; a check the tool cannot have is not counted', () => {
    assert.equal(checksSummary(UNUSED), '2 of 4 done');
    assert.equal(checksSummary(PASSING), 'All 4 done');
    assert.equal(
      checksSummary([...PASSING.slice(0, 3), line('session_hooks', 'unsupported')]),
      'All 3 done',
    );
    assert.equal(checksSummary([line('session_hooks', 'unsupported')]), 'None apply');
  });

  void test('Helper: the chip’s words, Up to date under its own heading, Checking while read', () => {
    assert.equal(helperSummary('up-to-date'), 'Up to date');
    assert.equal(helperSummary('required'), 'Update required');
    assert.equal(helperSummary('available'), 'Update available');
    assert.equal(helperSummary('unknown'), 'Version unknown');
    assert.equal(helperSummary('unchecked'), 'Could not check');
    assert.equal(helperSummary('checking'), 'Checking…');
    assert.equal(helperSummary(undefined), 'Checking…');
  });

  void test('Automatic checkpoints: what the switch read, never a guess', () => {
    assert.equal(consentSummary('on'), 'On');
    assert.equal(consentSummary('off'), 'Off');
    assert.equal(consentSummary('reading'), 'Reading…');
    assert.equal(consentSummary('failed'), 'Could not be read');
  });

  void test('the switch is offered for exactly the tools whose hooks open sessions', () => {
    const offered = TOOL_CATALOG.filter((t) => supportsCheckpoints(t)).map((t) => t.harness);
    assert.deepEqual(offered, ['claude-code', 'codex']);
    assert.equal(supportsCheckpoints(catalogTool('cursor')), false);
    // A tool the catalog does not know is never assumed to save checkpoints.
    assert.equal(supportsCheckpoints(undefined), false);
  });
});

const device = (over: Partial<DeviceNextInput> = {}): DeviceNextInput => ({
  live: true,
  attention: false,
  tools: 2,
  canAddTool: true,
  worst: 'up-to-date',
  ...over,
});

void describe('a device’s one next action', () => {
  void test('a paired device with no tool: add one', () => {
    assert.equal(deviceNext(device({ tools: 0 })), 'add-tool');
  });

  void test('no tool, and none can be added here: nothing to lead with', () => {
    assert.equal(deviceNext(device({ tools: 0, canAddTool: false })), 'none');
  });

  void test('a helper the board refuses: its steps', () => {
    assert.equal(deviceNext(device({ worst: 'required' })), 'update');
    assert.equal(deviceNext(device({ worst: 'available' })), 'none');
  });

  void test('an imported confirmation or a duplicate pair is the action: nothing else leads', () => {
    assert.equal(deviceNext(device({ attention: true, worst: 'required' })), 'none');
    assert.equal(deviceNext(device({ attention: true, tools: 0 })), 'none');
  });

  void test('a revoked device leads with nothing', () => {
    assert.equal(deviceNext(device({ live: false, tools: 0, worst: 'required' })), 'none');
  });

  void test('its Tools row counts active and revoked', () => {
    assert.equal(deviceToolsSummary(3, 1), '3 active · 1 revoked');
    assert.equal(deviceToolsSummary(2, 0), '2 active');
    assert.equal(deviceToolsSummary(0, 2), 'None active · 2 revoked');
    assert.equal(deviceToolsSummary(0, 0), 'None active');
  });
});
