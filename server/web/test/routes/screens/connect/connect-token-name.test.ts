/**
 * The minted token's default name (LAI-622).
 *
 * The point of the name is that somebody can revoke the right row a year from
 * now without guessing, so the assertions are about *which machine it names*,
 * not about the string's shape.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { suggestTokenName } from '../../../../src/routes/screens/connect/connect-token-name.ts';

const AGENTS = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
} as const;

void describe('the default name for a minted token', () => {
  void test('it names the agent, then the platform the browser is running on', () => {
    /*
     * LAI-737 re-aimed this from `laika-claude on …`: the first word is now
     * the agent's slug, because LAI-736 identifies a client that introduces
     * itself generically (Omnigent and Hermes both send `mcp`) by the first
     * word of its token's name.
     */
    assert.equal(suggestTokenName(AGENTS.mac, 'codex'), 'codex on macOS');
    assert.equal(suggestTokenName(AGENTS.windows, 'omnigent'), 'omnigent on Windows');
    assert.equal(suggestTokenName(AGENTS.linux, 'gemini-cli'), 'gemini-cli on Linux');
  });

  void test('with no agent named it is Claude Code’s, as the page was before', () => {
    assert.equal(suggestTokenName(AGENTS.mac), 'claude-code on macOS');
  });

  void test('an unrecognised agent still gets a usable name, never "undefined"', () => {
    /*
     * The failure worth guarding: a template that interpolates an absent
     * platform produces `cursor on undefined`, which is a row nobody can
     * act on — and it is minted into a real token name, where it is permanent.
     */
    for (const agent of ['', 'curl/8.4.0', 'Mozilla/5.0 (PlayStation; 5)']) {
      const name = suggestTokenName(agent, 'cursor');
      assert.equal(name, 'cursor', `unexpected name for ${JSON.stringify(agent)}`);
      assert.doesNotMatch(name, /undefined/, 'the platform leaked as the word undefined');
    }
  });

  void test('CONTROL: the three platforms are told apart, not collapsed', () => {
    // If the branches ever fall through to one answer, the first test would
    // still pass on whichever platform that answer happened to be.
    const names = new Set(Object.values(AGENTS).map((ua) => suggestTokenName(ua, 'codex')));
    assert.equal(names.size, 3, `platforms collapsed: ${[...names].join(', ')}`);
  });
});
