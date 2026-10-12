/**
 * Connect as a wizard (LAI-740): the parts the wizard adds, without a browser.
 *
 * The content — blocks, mint, watch — is asserted where it lives
 * (`connect-agents.test.ts`, `connect-live.test.ts`); this covers grouping,
 * locking, the footer, and the token highlight that must never change a
 * block's text.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_GUIDES,
  setupBlocks,
} from '../../../../src/routes/screens/connect/connect-agents.ts';
import {
  AGENT_GROUPS,
  canContinue,
  commandLines,
  EXTRAS,
  extrasFor,
  footerHint,
  groupedAgents,
  noteAbove,
  railLabel,
  requirementChips,
  setupModes,
  stepOpen,
} from '../../../../src/routes/screens/connect/connect-wizard.ts';

const SECRET = 'lai_ThisIsTheWholeSecretAndMustNotEscape';
const ORIGIN = 'http://board.example.test:9999';

void describe('the picker headings', () => {
  void test('every guide sits under exactly one heading, and every heading names a guide', () => {
    const grouped = AGENT_GROUPS.flatMap((g) => g.members);
    const ids = AGENT_GUIDES.map((g) => g.id);
    assert.deepEqual([...grouped].sort(), [...ids].sort(), 'a guide is missing or invented');
    assert.equal(new Set(grouped).size, grouped.length, 'a guide sits under two headings');
  });

  void test('Claude Code then Codex lead, so the arrow keys walk as they did', () => {
    const order = groupedAgents('').flatMap((g) => g.guides.map((guide) => guide.id));
    assert.deepEqual(order.slice(0, 2), ['claude-code', 'codex']);
    assert.equal(order.length, AGENT_GUIDES.length);
  });

  void test('the two answers for an unlisted agent sit under Anything else', () => {
    const other = AGENT_GROUPS.find((g) => g.id === 'other');
    assert.deepEqual(other?.members, ['any', 'rest']);
  });

  void test('search matches name or slug, any case, and drops empty headings', () => {
    const shown = groupedAgents('  GEMini ');
    assert.deepEqual(
      shown.map((g) => g.guides.map((guide) => guide.id)),
      [['gemini-cli']],
    );
    assert.deepEqual(
      groupedAgents('vscode').flatMap((g) => g.guides.map((guide) => guide.id)),
      ['vscode'],
    );
  });

  void test('CONTROL: a search that matches nothing leaves nothing', () => {
    assert.deepEqual(groupedAgents('teleporter'), []);
  });
});

void describe('locking', () => {
  void test('steps 3 and 4 open only once there is a token', () => {
    assert.deepEqual(
      ([1, 2, 3, 4] as const).map((n) => stepOpen(n, false)),
      [true, true, false, false],
    );
    assert.deepEqual(
      ([1, 2, 3, 4] as const).map((n) => stepOpen(n, true)),
      [true, true, true, true],
    );
  });

  void test('Continue from step 2 waits for the token; the last step has nowhere to go', () => {
    assert.equal(canContinue(1, false), true);
    assert.equal(canContinue(2, false), false);
    assert.equal(canContinue(2, true), true);
    assert.equal(canContinue(3, true), true);
    assert.equal(canContinue(4, true), false);
  });

  void test('the footer says what unlocks it', () => {
    const base = {
      ready: false,
      mintedHere: false,
      copied: false,
      connected: false,
      agentName: 'Codex',
    };
    assert.equal(footerHint(2, base), 'Mint a token to continue');
    assert.equal(
      footerHint(2, { ...base, ready: true, mintedHere: true }),
      'Token minted — continue',
    );
    assert.equal(footerHint(1, base), 'Continue with Codex');
    assert.equal(footerHint(4, { ...base, connected: true }), 'Connected');
  });

  void test('the rail says each step’s state in words', () => {
    const s = {
      agentName: 'Cursor',
      tokenName: undefined,
      brought: false,
      copied: false,
      connected: false,
      watching: false,
    };
    assert.equal(railLabel(1, s), 'Cursor');
    assert.equal(railLabel(2, s), 'Not minted yet');
    assert.equal(railLabel(2, { ...s, tokenName: 'cursor on macOS' }), 'cursor on macOS');
    assert.equal(railLabel(3, { ...s, copied: true }), 'Command copied');
    assert.equal(railLabel(4, { ...s, watching: true }), 'Waiting for check-in');
    assert.equal(railLabel(4, { ...s, connected: true }), 'Connected');
  });
});

void describe('the token highlight and the hanging lines', () => {
  const join = (lines: readonly { readonly text: string }[]): string =>
    lines.map((l) => l.text).join('\n');

  void test('marks exactly the lines holding the real token, and changes no character', () => {
    for (const id of AGENT_GUIDES.map((g) => g.id)) {
      for (const block of setupBlocks(id, { origin: ORIGIN, secret: SECRET, project: undefined })) {
        const lines = commandLines(block.text, SECRET);
        assert.equal(join(lines), block.text, `${id}/${block.key}: the text changed`);
        const marked = lines.filter((l) => l.token);
        for (const line of marked)
          assert.ok(line.text.includes(SECRET), `${id}/${block.key}: marked a line without it`);
        const holding = block.text.split('\n').filter((l) => l.includes(SECRET)).length;
        assert.equal(marked.length, holding, `${id}/${block.key}: missed a token line`);
      }
    }
  });

  void test('the Claude Code prompt has its Token line marked', () => {
    const prompt = setupBlocks('claude-code', {
      origin: ORIGIN,
      secret: SECRET,
      project: undefined,
    })[0];
    assert.ok(prompt !== undefined);
    const marked = commandLines(prompt.text, SECRET).filter((l) => l.token);
    assert.ok(
      marked.some((l) => l.text.startsWith('Token:')),
      'the Token: line is not marked',
    );
  });

  void test('CONTROL: before a mint nothing is marked — a placeholder is not a token', () => {
    const blocks = setupBlocks('claude-code', {
      origin: ORIGIN,
      secret: undefined,
      project: undefined,
    });
    for (const block of blocks) {
      assert.deepEqual(
        commandLines(block.text, undefined).filter((l) => l.token),
        [],
        block.key,
      );
    }
    assert.deepEqual(
      commandLines('a\nb', '').map((l) => l.token),
      [false, false],
    );
  });

  void test('each line knows where its own text starts (LAI-742)', () => {
    assert.deepEqual(
      commandLines('cd x\n   git clone \\\n\n      --flag', undefined).map((l) => l.lead),
      [0, 3, 0, 6],
    );
  });
});

void describe('step 3’s toggle and chips', () => {
  const ctx = { origin: ORIGIN, secret: SECRET, project: undefined };

  void test('an agent with both paths offers both; one with one path offers one', () => {
    const both = AGENT_GUIDES.map((g) => g.id).filter(
      (id) => setupModes(setupBlocks(id, ctx)).length === 2,
    );
    assert.ok(both.includes('claude-code'), 'Claude Code lost its by-hand path');
    for (const id of AGENT_GUIDES.map((g) => g.id)) {
      assert.ok(setupModes(setupBlocks(id, ctx)).length >= 1, `${id} has nothing to show`);
    }
  });

  void test('the chips are read from the blocks, never claimed', () => {
    const blocks = setupBlocks('codex', ctx).filter((b) => b.group === 'manual');
    const chips = requirementChips(blocks, 'mcp');
    assert.equal(chips[0], 'MCP over HTTP');
    for (const chip of chips.slice(1)) {
      const lang = {
        Terminal: 'sh',
        'JSON config': 'json',
        'TOML config': 'toml',
        'YAML config': 'yaml',
      }[chip];
      assert.ok(
        blocks.some((b) => b.lang === lang),
        `${chip} claimed with no such block`,
      );
    }
    assert.equal(requirementChips([], 'api')[0], 'REST API');
  });
});

void describe('the optional entries and the notes (LAI-741)', () => {
  void test('three extras, Invite only for someone who can invite', () => {
    assert.deepEqual(
      EXTRAS.map((e) => e.name),
      ['Share with your project', 'What agents can do', 'Invite a teammate'],
    );
    assert.deepEqual(
      extrasFor(false).map((e) => e.id),
      ['share', 'tools'],
    );
    assert.deepEqual(
      extrasFor(true).map((e) => e.id),
      ['share', 'tools', 'invite'],
    );
  });

  void test('a recommended block’s note introduces it; every other note follows', () => {
    /*
     * Written out per block rather than derived (LAI-742): a loop comparing
     * `noteAbove(b)` with `b.group === 'recommended'` restates the function,
     * so a block regrouped in `connect-agents.ts` moved its note unnoticed.
     * Only blocks that carry a note are listed.
     */
    const expected: Readonly<Record<string, Readonly<Record<string, 'above' | 'below'>>>> = {
      'claude-code': {
        'claude-prompt': 'above',
        'claude-manual': 'below',
        'claude-mcp-add': 'below',
        'claude-mcp-json': 'below',
      },
      codex: { cli: 'above', env: 'below', 'codex-toml': 'below' },
      cursor: { cli: 'above', env: 'below', 'cursor-json': 'below' },
      antigravity: { cli: 'above', 'antigravity-json': 'below' },
      opencode: { cli: 'above', env: 'below', 'opencode-json': 'below', 'opencode-add': 'below' },
      'gemini-cli': { cli: 'above', env: 'below', 'gemini-add': 'below' },
      vscode: { env: 'below', 'vscode-json': 'below', 'vscode-input-json': 'below' },
      omnigent: { env: 'below', 'omnigent-sidecar': 'below', 'omnigent-inline': 'below' },
      any: { env: 'below', 'any-json': 'below', 'any-bridge': 'below' },
      rest: { env: 'below', 'rest-curl': 'below', 'rest-cli': 'below' },
      windsurf: { env: 'below' },
      hermes: { 'hermes-add': 'above', env: 'below', 'hermes-yaml': 'below' },
      zed: { 'zed-bridge': 'above', 'zed-env': 'below' },
      cline: { env: 'below', 'cline-json': 'below', 'roo-json': 'below' },
      continue: { 'continue-yaml': 'below' },
      'claude-desktop': { 'claude-desktop-bridge': 'above' },
      kiro: { 'kiro-bridge': 'above' },
      goose: { env: 'below', 'goose-yaml': 'below' },
      amp: { env: 'below' },
      junie: { 'jetbrains-bridge': 'below' },
      warp: {},
    };
    assert.deepEqual(
      Object.keys(expected).sort(),
      AGENT_GUIDES.map((g) => g.id).sort(),
      'an agent is missing from the table',
    );
    for (const guide of AGENT_GUIDES) {
      const actual = Object.fromEntries(
        setupBlocks(guide.id, { origin: ORIGIN, secret: undefined, project: undefined })
          .filter((b) => b.note !== undefined)
          .map((b) => [b.key, noteAbove(b) ? 'above' : 'below']),
      );
      assert.deepEqual(actual, expected[guide.id], guide.id);
    }
  });
});
