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
  void test('it names the platform the browser is running on', () => {
    assert.equal(suggestTokenName(AGENTS.mac), 'laika-claude on macOS');
    assert.equal(suggestTokenName(AGENTS.windows), 'laika-claude on Windows');
    assert.equal(suggestTokenName(AGENTS.linux), 'laika-claude on Linux');
  });

  void test('an unrecognised agent still gets a usable name, never "undefined"', () => {
    /*
     * The failure worth guarding: a template that interpolates an absent
     * platform produces `laika-claude on undefined`, which is a row nobody can
     * act on — and it is minted into a real token name, where it is permanent.
     */
    for (const agent of ['', 'curl/8.4.0', 'Mozilla/5.0 (PlayStation; 5)']) {
      const name = suggestTokenName(agent);
      assert.equal(name, 'laika-claude', `unexpected name for ${JSON.stringify(agent)}`);
      assert.doesNotMatch(name, /undefined/, 'the platform leaked as the word undefined');
    }
  });

  void test('CONTROL: the three platforms are told apart, not collapsed', () => {
    // If the branches ever fall through to one answer, the first test would
    // still pass on whichever platform that answer happened to be.
    const names = new Set(Object.values(AGENTS).map(suggestTokenName));
    assert.equal(names.size, 3, `platforms collapsed: ${[...names].join(', ')}`);
  });
});
