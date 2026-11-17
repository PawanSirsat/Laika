/**
 * `api/sso.ts` (LAI-1239): the one pure thing in it is what a directory sync's
 * failure code says to the owner. Mirrored here by LAI-1312, which found the
 * module had no test and the structure guard had not yet said so on this
 * branch. The words must name the remedy, never Microsoft's own text.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { directoryErrorWords } from '../../src/api/sso.ts';

void describe('directoryErrorWords', () => {
  void test('a missing grant names the permission and the consent', () => {
    const words = directoryErrorWords('graph_forbidden_grant_user_read_all');
    assert.match(words, /User\.Read\.All/);
    assert.match(words, /admin consent/);
  });

  void test('a refused app sign-in names the code and the likely cause', () => {
    const words = directoryErrorWords('token_invalid_client');
    assert.match(words, /token_invalid_client/);
    assert.match(words, /client secret/);
  });

  void test('Microsoft out of reach says it will retry', () => {
    assert.equal(
      directoryErrorWords('graph_unreachable'),
      'Microsoft could not be reached. It will try again.',
    );
  });

  void test('anything else is named, so it can be looked up', () => {
    assert.equal(
      directoryErrorWords('weird_code'),
      'The directory could not be read (weird_code).',
    );
  });
});
