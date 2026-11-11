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
  hiddenGrants,
  hiddenSetupsLine,
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
  void test('a tool whose credential nothing has used is not Ready, and its checks say so', () => {
    const view = setup();
    const [ready, unused] = view.tools;
    assert.equal(toolState(unused!, NOW).key, 'needs-setup');
    assert.deepEqual(
      checkMarks(unused!).map((m) => [m.label, m.ok]),
      [
        ['Device paired', true],
        ['Credential installed', true],
        ['Credential used', false],
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

/** A tool whose only credential has expired: the server's checks count only a live token. */
const expired = (harness: string) => {
  const base = tool('x1', harness);
  return tool('x1', harness, {
    tokens: base.tokens.map((t) => ({ ...t, expires_at: NOW - DAY })),
    checks: {
      ...base.checks,
      credential_installed: {
        state: 'fail',
        at: null,
        detail: { token_id: null, via_exchange: false },
      },
    },
  });
};

void describe('the health line, by Developer access’s own rules', () => {
  void test('names a tool its chip calls Needs setup, and a setup recordState calls Update available', () => {
    const view = setup();
    const [row] = repoRows(view.repositories, view.tools, view.devices);
    assert.equal(row?.chip, 'update-available', 'a prefix mismatch is Update available');
    assert.deepEqual(attentionItems(view, undefined), [
      {
        label: 'Codex on rowan-box: credential installed; nothing has used it yet',
        target: anchorFor.tool('a2'),
      },
      { label: 'fixture-org/fixture-app: update available', target: anchorFor.repo(row.key) },
    ]);
    assert.equal(attentionWord(2), '2 things need attention');
  });

  void test('a tool whose only credential has expired is flagged', () => {
    for (const harness of ['codex', 'not-in-the-catalog']) {
      const view = setup({ tools: [expired(harness)], repositories: [] });
      const [item] = attentionItems(view, undefined);
      assert.equal(toolState(view.tools[0]!, NOW).key, 'needs-setup', harness);
      assert.equal(item?.target, anchorFor.tool('x1'), harness);
      assert.match(
        item?.label ?? '',
        /no credential on this device yet|its credential has expired/,
      );
    }
  });

  void test('the chip and the health line agree for every tool', () => {
    const tools = [
      tool('t1', 'claude-code'),
      tool('t2', 'codex', { mcp: false }),
      tool('t3', 'codex', { mcp: false, used: false }),
      expired('codex'),
      tool('t5', 'codex', { status: 'revoked', revoked_at: NOW - DAY }),
    ];
    const view = setup({ tools, repositories: [] });
    const flagged = new Set(attentionItems(view, undefined).map((i) => i.target));
    for (const t of tools) {
      const needs = t.status === 'active' && toolState(t, NOW).key === 'needs-setup';
      assert.equal(flagged.has(anchorFor.tool(t.id)), needs, `${t.id}: ${toolState(t, NOW).word}`);
    }
    assert.ok(flagged.size >= 2, 'the case would pass vacantly with nothing flagged');
  });

  void test('a missing block is No block found; a checked one is not listed', () => {
    const base = setup().repositories[0]!;
    const missing = setup({ repositories: [{ ...base, block_found: false }] });
    assert.equal(
      repoRows(missing.repositories, missing.tools, missing.devices)[0]?.chip,
      'missing',
    );
    const ok = setup({ repositories: [{ ...base, prefix_match: true, template_revision: 999 }] });
    const [row] = repoRows(ok.repositories, ok.tools, ok.devices);
    assert.equal(row?.chip, 'checked');
    assert.ok(!attentionItems(ok, undefined).some((i) => i.target === anchorFor.repo(row.key)));
  });

  void test('nothing to fix reads All set up', () => {
    assert.equal(attentionWord(0), 'All set up');
    assert.equal(attentionWord(1), '1 thing needs attention');
  });
});

void describe('repositories', () => {
  void test('grouped by repoGroups, with its tools and the newest check as the facts', () => {
    const view = setup();
    const rows = repoRows(view.repositories, view.tools, view.devices);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row?.repo, 'fixture-org/fixture-app');
    assert.deepEqual(row?.usedBy, ['Claude Code · rowan-box']);
    assert.equal(row?.prefix, false);
    assert.match(row?.key ?? '', /^[A-Za-z0-9_-]+$/, 'the key is a usable element id');
    assert.equal(hiddenSetupsLine(2), '2 setups in spaces you can’t see');
    assert.equal(hiddenSetupsLine(1), '1 setup in spaces you can’t see');
  });

  void test('hidden grants of live tools are counted for Spaces reachable', () => {
    assert.equal(
      hiddenGrants([
        tool('a', 'codex', { grants_hidden: 2 }),
        tool('b', 'codex', { grants_hidden: 1, status: 'revoked' }),
      ]),
      2,
    );
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
