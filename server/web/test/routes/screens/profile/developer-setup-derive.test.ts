import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activityLine,
  anchorFor,
  attentionItems,
  attentionWord,
  checkMarks,
  confirmCopy,
  doneLine,
  firstName,
  isEmptySetup,
  noTokensLine,
  notifyLine,
  refusalLine,
  repoRows,
  SEARCH_OVER,
  shownTokens,
  tokenCounts,
  tokenState,
  toolState,
} from '../../../../src/routes/screens/profile/developer-setup-derive.ts';
import { ApiError } from '../../../../src/api/errors.ts';
import { DAY, NOW, setup, token, tool } from '../../../helpers/developer-setup-fixture.ts';

void describe('tokens: state, filter and search (frames 2p, 2s)', () => {
  void test('each token reads by revoked, then expired, then use', () => {
    assert.equal(
      tokenState(token('a', { revoked_at: NOW - DAY, expires_at: NOW - DAY }), NOW),
      'revoked',
    );
    assert.equal(tokenState(token('b', { expires_at: NOW - 1 }), NOW), 'expired');
    assert.equal(tokenState(token('c', { last_used_at: null }), NOW), 'never');
    assert.equal(tokenState(token('d', { last_used_at: NOW - 60 * DAY }), NOW), 'idle');
    assert.equal(tokenState(token('e'), NOW), 'active');
  });

  void test('Active counts every token that still works; All counts them all', () => {
    const view = setup();
    const all = [...view.tokens.personal, ...view.tokens.tool_credentials];
    assert.deepEqual(tokenCounts(all, NOW), { active: 3, expired: 1, revoked: 1, all: 5 });
  });

  void test('the search matches a name or a prefix, case aside, inside the filter', () => {
    const view = setup();
    const all = [...view.tokens.personal, ...view.tokens.tool_credentials];
    assert.deepEqual(
      shownTokens(all, 'all', 'DEPLOY', NOW).map((t) => t.id),
      ['p1'],
    );
    assert.deepEqual(
      shownTokens(all, 'active', 'gone', NOW).map((t) => t.id),
      [],
      'a revoked token is not under Active',
    );
    assert.equal(noTokensLine('revoked', ''), 'No revoked tokens.');
    assert.equal(noTokensLine('active', ' zz '), 'No token matches “zz”.');
    assert.equal(SEARCH_OVER, 8);
  });
});

void describe('tools: status and checks', () => {
  void test('a tool whose MCP never connected is not Ready, and its check says so', () => {
    const view = setup();
    const [ready, notConnected] = view.tools;
    assert.notEqual(toolState(notConnected!, NOW).key, 'ready');
    const marks = checkMarks(notConnected!);
    assert.deepEqual(
      marks.map((m) => [m.label, m.ok]),
      [
        ['Device paired', true],
        ['Credential installed', true],
        ['Credential used', true],
        ['MCP connected', false],
        ['Required capabilities', true],
      ],
    );
    assert.ok(checkMarks(ready!).every((m) => m.ok));
  });

  void test('a revoked tool passes no check', () => {
    const revoked = tool('r', 'codex', { status: 'revoked', revoked_at: NOW - DAY });
    assert.ok(checkMarks(revoked).every((m) => !m.ok));
    assert.equal(toolState(revoked, NOW).key, 'revoked');
  });
});

void describe('the health line, derived on the client', () => {
  void test('names each thing that needs attention and where it is', () => {
    const view = setup();
    const items = attentionItems(view, undefined);
    assert.deepEqual(items, [
      { label: 'Codex on rowan-box: MCP not connected', target: anchorFor.tool('a2') },
      {
        label: 'fixture-org/fixture-app: project check failed',
        target: anchorFor.repo(repoRows(view.repositories, view.tools, view.devices)[0]!.key),
      },
    ]);
    assert.equal(attentionWord(items.length), '2 things need attention');
  });

  void test('a credential never used outranks MCP for that tool, and a revoked tool needs nothing', () => {
    const view = setup({
      tools: [
        tool('a1', 'claude-code', { used: false, mcp: false }),
        tool('a2', 'codex', { mcp: false, status: 'revoked' }),
      ],
      repositories: [],
    });
    assert.deepEqual(
      attentionItems(view, undefined).map((i) => i.label),
      ['Claude Code on rowan-box: credential never used'],
    );
  });

  void test('nothing to fix reads All set up', () => {
    assert.equal(attentionWord(0), 'All set up');
    assert.equal(attentionWord(1), '1 thing needs attention');
  });
});

void describe('repositories', () => {
  void test('one row per repository, from its newest record, with its tools', () => {
    const view = setup();
    const [row] = repoRows(view.repositories, view.tools, view.devices);
    assert.equal(row?.repo, 'fixture-org/fixture-app');
    assert.deepEqual(row?.usedBy, ['Claude Code · rowan-box']);
    assert.equal(row?.prefix, false);
    assert.equal(row?.failed, true);
    assert.match(row?.key ?? '', /^[A-Za-z0-9_-]+$/, 'the key is a usable element id');
  });
});

void describe('the confirms (frames 2v–2x)', () => {
  const view = setup();

  void test('unpair lists what stops working, and says Laika, never email', () => {
    const copy = confirmCopy({ kind: 'unpair', id: 'd1' }, view, 'Rowan');
    assert.equal(copy?.title, 'Unpair rowan-box?');
    assert.equal(copy?.stops.length, 3);
    assert.match(copy?.stops[0] ?? '', /Claude Code and Codex on rowan-box stop now/);
    assert.match(copy?.stops[1] ?? '', /2 tool credentials are revoked/);
    assert.equal(copy?.notify, 'Rowan is notified in Laika, and it shows in their setup activity.');
    assert.doesNotMatch(notifyLine('Rowan'), /email/i);
  });

  void test('revoke tool and revoke token say what they end', () => {
    const tool_ = confirmCopy({ kind: 'tool', id: 'a2' }, view, 'Rowan');
    assert.equal(tool_?.title, 'Revoke Codex on rowan-box?');
    assert.equal(tool_?.cta, 'Revoke Codex');
    const tok = confirmCopy({ kind: 'token', id: 'p1' }, view, 'Rowan');
    assert.equal(tok?.title, 'Revoke deploy-key?');
    assert.match(tok?.stops[0] ?? '', /Anything using lai_p1xx… is refused/);
  });

  void test('a row that is gone has no confirm', () => {
    assert.equal(confirmCopy({ kind: 'tool', id: 'nope' }, view, 'Rowan'), undefined);
  });

  void test('the success line names the thing and the person', () => {
    assert.equal(
      doneLine({ kind: 'unpair', id: 'd1' }, view, 'Rowan'),
      'rowan-box is unpaired. Rowan was notified.',
    );
    assert.equal(
      doneLine({ kind: 'token', id: 'p1' }, view, 'Rowan'),
      'Token revoked. Rowan was notified.',
    );
  });

  void test('403 not_for_owner is said in the reader’s terms; anything else is the server’s sentence', () => {
    const owner = new ApiError('forbidden', "An admin cannot change the owner's setup", 403, {
      reason: 'not_for_owner',
    });
    assert.equal(
      refusalLine(owner, 'x'),
      'Only the owner can change the owner’s setup. Nothing was changed.',
    );
    const other = new ApiError('not_found', 'No such device', 404);
    assert.equal(refusalLine(other, 'x'), 'No such device');
  });
});

void describe('the whole', () => {
  void test('empty only when there is nothing at all (frame 2y)', () => {
    assert.equal(isEmptySetup(setup()), false);
    const none = setup({
      devices: [],
      tools: [],
      pending_pairing: [],
      repositories: [],
      tokens: { personal: [], tool_credentials: [] },
    });
    assert.equal(isEmptySetup(none), true);
    assert.equal(
      isEmptySetup({ ...none, tokens: { personal: [token('p')], tool_credentials: [] } }),
      false,
      'a personal token alone is something to show',
    );
  });

  void test('activity lines name who acted', () => {
    const [revoked, added] = setup().activity;
    assert.equal(activityLine(revoked!), 'Token gone-key revoked by Ada Admin');
    assert.equal(activityLine(added!), 'Added codex');
  });

  void test('first names, and a blank name', () => {
    assert.equal(firstName('Rowan Vale'), 'Rowan');
    assert.equal(firstName('  '), 'This person');
  });
});
