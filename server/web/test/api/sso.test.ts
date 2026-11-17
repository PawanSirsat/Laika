/**
 * `api/sso.ts` (LAI-1239): the one pure thing in it is what a directory sync's
 * failure code says to the owner. Mirrored here by LAI-1312, which found the
 * module had no test and the structure guard had not yet said so on this
 * branch. The words must name the remedy, never Microsoft's own text.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { directoryErrorWords, meetingsCount, meetingsErrorWords } from '../../src/api/sso.ts';

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

void describe('meetingsErrorWords (LAI-1313)', () => {
  // The codes `services/meetings-sync.ts` records in `FORBIDDEN`, each with
  // the permission it must name as Entra spells it.
  const grants: readonly (readonly [string, string])[] = [
    ['graph_forbidden_grant_calendars_read', 'Calendars.Read'],
    ['graph_forbidden_grant_user_read_all', 'User.Read.All'],
    ['graph_forbidden_grant_onlinemeetings_read_all', 'OnlineMeetings.Read.All'],
    ['graph_forbidden_grant_onlinemeetingartifact_read_all', 'OnlineMeetingArtifact.Read.All'],
    ['graph_forbidden_grant_onlinemeetingtranscript_read_all', 'OnlineMeetingTranscript.Read.All'],
  ];

  for (const [code, permission] of grants) {
    void test(`${code} names ${permission} and admin consent`, () => {
      const words = meetingsErrorWords(code);
      assert.ok(words.includes(`${permission} application permission`), words);
      assert.match(words, /admin consent/);
      assert.doesNotMatch(words, new RegExp(code), 'the fix, not the code');
    });
  }

  void test('the Teams grants also point at the application access policy; calendars do not', () => {
    assert.match(
      meetingsErrorWords('graph_forbidden_grant_onlinemeetings_read_all'),
      /Teams application access policy/,
    );
    assert.doesNotMatch(
      meetingsErrorWords('graph_forbidden_grant_calendars_read'),
      /access policy/,
    );
  });

  void test('a grant it does not know is still a grant, named', () => {
    const words = meetingsErrorWords('graph_forbidden_grant_something_new');
    assert.match(words, /graph_forbidden_grant_something_new/);
    assert.match(words, /admin consent/);
  });

  void test('sign-in, throttling, unreachable and anything else', () => {
    assert.match(meetingsErrorWords('token_401'), /client secret/);
    assert.match(meetingsErrorWords('graph_throttled'), /slow down/);
    assert.equal(
      meetingsErrorWords('graph_timeout'),
      'Microsoft could not be reached. It will try again.',
    );
    assert.equal(
      meetingsErrorWords('sync_failed'),
      'The meetings could not be read (sync_failed).',
    );
  });

  void test('meetingsCount says one meeting, and meetings otherwise', () => {
    assert.equal(meetingsCount(1), '1 meeting');
    assert.equal(meetingsCount(0), '0 meetings');
    assert.equal(meetingsCount(12), '12 meetings');
  });
});
