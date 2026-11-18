/**
 * The Microsoft 365 card's words for the people sync (D-161, LAI-1330): the
 * counts, the leaver review — the dry run first — and each switch's note.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Leaver, PeopleSync } from '../../../../src/api/people-sync.ts';
import {
  leaverHeadline,
  leaverReasonWords,
  leaversNote,
  peopleCountsLine,
  profileNote,
  protectionWords,
} from '../../../../src/routes/screens/organisation/people-sync-derive.ts';

const off: PeopleSync = {
  connected: true,
  profile_enabled: false,
  leavers_enabled: false,
  photos_stored: true,
  sync_every_minutes: 60,
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  last_result: null,
  leavers: null,
};

const result = {
  people: 9,
  found: 8,
  not_found: 1,
  denied: 0,
  refused: 0,
  updated: 3,
  photos_fetched: 2,
  photos_unchanged: 6,
  photos_removed: 0,
  photos_refused: 1,
  photos_deferred: 0,
};

const leaver: Leaver = {
  user_id: 'u1',
  name: 'Ada',
  email: 'ada@example.test',
  reason: 'disabled',
  protected: null,
};

void describe('peopleCountsLine', () => {
  void test('what was read, then what changed in photos, leaving out the zeros', () => {
    assert.equal(
      peopleCountsLine(result),
      '9 people read: 8 found, 1 not in Microsoft; 2 photos updated, 1 photo refused',
    );
    assert.equal(
      peopleCountsLine({
        ...result,
        people: 1,
        found: 1,
        not_found: 0,
        photos_fetched: 0,
        photos_refused: 0,
      }),
      '1 person read: 1 found',
    );
  });
});

void describe('the leaver review', () => {
  void test('a dry run says who would go, and when the breaker would hold them', () => {
    const review = { at: 1, state: 'dry_run' as const, breaker: false, people: [leaver] };
    assert.match(
      leaverHeadline(review)!,
      /^Leavers is off\. Turned on, the next sync would deactivate:$/,
    );
    assert.match(leaverHeadline({ ...review, breaker: true })!, /deactivate nobody and hold these/);
  });

  void test('held, deactivated and none each say their own', () => {
    assert.match(
      leaverHeadline({ at: 1, state: 'held', breaker: true, people: [leaver] })!,
      /^Held for you to check — more than 3 people/,
    );
    assert.equal(
      leaverHeadline({ at: 1, state: 'deactivated', breaker: false, people: [leaver] }),
      'Deactivated by the last sync:',
    );
    assert.equal(leaverHeadline({ at: 1, state: 'none', breaker: false, people: [] }), null);
  });

  void test('why someone is listed, and why the sync never takes them', () => {
    assert.equal(leaverReasonWords(leaver), 'account turned off in Microsoft');
    assert.equal(
      leaverReasonWords({ ...leaver, reason: 'gone' }),
      'no longer in Microsoft for over an hour',
    );
    assert.equal(protectionWords(leaver), null);
    assert.equal(
      protectionWords({ ...leaver, protected: 'owner' }),
      'never deactivated: the owner',
    );
    assert.equal(
      protectionWords({ ...leaver, protected: 'last_admin' }),
      'never deactivated: the last admin',
    );
  });
});

void describe('the switches', () => {
  void test('Photos and profile says what it needs, and that photos stay here', () => {
    assert.equal(
      profileNote({ ...off, connected: false }),
      'Save the app’s tenant, client ID and secret first.',
    );
    assert.match(profileNote(off), /^Off: nothing is read\. Needs User\.Read\.All/);
    assert.match(
      profileNote({ ...off, profile_enabled: true }),
      /^On: every 60 minutes\. Photos are kept on this board/,
    );
    assert.match(
      profileNote({ ...off, photos_stored: false }),
      /no file store, so photos are left out/,
    );
  });

  void test('Leavers waits for Photos and profile, and for someone who may deactivate', () => {
    assert.match(leaversNote(off, true), /^Turn on Photos and profile first/);
    const on = { ...off, profile_enabled: true };
    assert.equal(
      leaversNote(on, false),
      'Only someone who may deactivate people can turn this on.',
    );
    assert.match(leaversNote(on, true), /^Off: each sync lists who would be deactivated/);
    assert.match(
      leaversNote({ ...on, leavers_enabled: true }, true),
      /^On: .*never the owner or the last admin/,
    );
  });
});
