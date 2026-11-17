/**
 * The profile developer tab's summary (LAI-1217): token flags from the
 * token's own fields, and the one next step — your own links into Developer
 * access, someone else's never does.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  attentionItems,
  DEVELOPER_HREF,
  flaggedTokens,
  flaggedTokensLine,
  nextStep,
  PENDING_ANCHOR,
  summaryHeadline,
  tokenFlags,
} from '../../../../src/routes/screens/profile/developer-setup-derive.ts';
import { DAY, NOW, setup, token, tool } from '../../../helpers/developer-setup-fixture.ts';

void describe('token flags, from real fields only', () => {
  void test('never used, unused 90+ days, expires soon', () => {
    assert.deepEqual(tokenFlags(token('a', { last_used_at: null }), NOW), ['never']);
    assert.deepEqual(tokenFlags(token('b', { last_used_at: NOW - 91 * DAY }), NOW), ['stale']);
    assert.deepEqual(tokenFlags(token('c', { last_used_at: NOW - 89 * DAY }), NOW), []);
    assert.deepEqual(tokenFlags(token('d', { expires_at: NOW + 4 * DAY }), NOW), ['expiring']);
    assert.deepEqual(tokenFlags(token('e', { expires_at: NOW + 15 * DAY }), NOW), []);
    assert.deepEqual(tokenFlags(token('f', { last_used_at: null, expires_at: NOW + DAY }), NOW), [
      'never',
      'expiring',
    ]);
  });

  void test('a token that no longer works is never flagged', () => {
    assert.deepEqual(
      tokenFlags(token('r', { last_used_at: null, revoked_at: NOW - DAY }), NOW),
      [],
    );
    assert.deepEqual(
      tokenFlags(token('x', { last_used_at: null, expires_at: NOW - DAY }), NOW),
      [],
    );
  });

  void test('flagged tokens are counted across personal and tool credentials', () => {
    // The fixture's codex credential has never been used.
    const view = setup();
    assert.deepEqual(
      flaggedTokens(view, NOW).map((t) => t.id),
      ['c-a2'],
    );
    assert.equal(flaggedTokensLine(0), undefined);
    assert.equal(flaggedTokensLine(1), '1 token to review');
    assert.equal(flaggedTokensLine(3), '3 tokens to review');
  });
});

void describe('the one next step', () => {
  const empty = setup({
    devices: [],
    tools: [],
    pending_pairing: [],
    repositories: [],
    tokens: { personal: [], tool_credentials: [] },
  });

  void test('your own, nothing set up: pair a device in Developer access', () => {
    const step = nextStep(empty, [], true);
    assert.deepEqual(step?.kind === 'link' ? [step.label, step.href] : step, [
      'Pair a device',
      DEVELOPER_HREF.devices,
    ]);
    assert.equal(summaryHeadline(empty, 0), 'Nothing set up yet');
  });

  void test('someone else’s, nothing set up: no step at all — only they can start', () => {
    assert.equal(nextStep(empty, [], false), undefined);
  });

  void test('your own, a claimed pairing waits: review it here, before anything else', () => {
    const view = setup({
      pending_pairing: [
        {
          id: 'pr2',
          state: 'claimed',
          kind: 'local',
          display_name: 'ada-spare',
          device_id: null,
          claimed: { key_fingerprint: 'k', os: null, cli_version: null, claimed_at: NOW },
          created_at: NOW,
          expires_at: NOW + DAY,
          decided_at: null,
          completed_at: null,
        },
      ],
    });
    const step = nextStep(view, attentionItems(view, undefined), true);
    assert.equal(step?.kind, 'jump');
    assert.equal(step?.kind === 'jump' ? step.target : '', PENDING_ANCHOR);
  });

  void test('your own, a device with no live tool: add a tool', () => {
    const view = setup({ tools: [], repositories: [] });
    const step = nextStep(view, [], true);
    assert.equal(step?.kind === 'link' ? step.href : undefined, DEVELOPER_HREF.connect);
  });

  void test('your own, a tool needs setup: fix it in Developer access’s Tools tab', () => {
    const view = setup();
    const step = nextStep(view, attentionItems(view, undefined), true);
    assert.equal(step?.kind === 'link' ? step.href : undefined, DEVELOPER_HREF.tools);
    assert.equal(step?.label, 'Fix in Developer access');
  });

  void test('someone else’s, a tool needs setup: a jump within the tab, never a link', () => {
    const view = setup();
    const step = nextStep(view, attentionItems(view, undefined), false);
    assert.equal(step?.kind, 'jump');
    assert.equal(step?.kind === 'jump' ? step.target : '', 'dev-tool-a2');
  });

  void test('your own, all healthy but a token is flagged: review tokens', () => {
    const tools = [tool('a1', 'claude-code')];
    const view = setup({
      tools,
      repositories: [],
      tokens: {
        personal: [token('p9', { last_used_at: NOW - 200 * DAY })],
        tool_credentials: tools.flatMap((t) => t.tokens),
      },
    });
    const items = attentionItems(view, undefined);
    assert.deepEqual(items, []);
    const step = nextStep(view, items, true);
    assert.equal(step?.kind === 'link' ? step.href : undefined, DEVELOPER_HREF.tokens);
    assert.equal(summaryHeadline(view, 0), 'All set up');
  });

  void test('your own, all healthy and nothing flagged: no step', () => {
    const tools = [tool('a1', 'claude-code')];
    const view = setup({
      tools,
      repositories: [],
      tokens: { personal: [], tool_credentials: tools.flatMap((t) => t.tokens) },
    });
    assert.equal(nextStep(view, attentionItems(view, undefined), true), undefined);
  });
});
