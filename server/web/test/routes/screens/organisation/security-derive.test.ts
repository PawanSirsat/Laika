import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  riskSummary,
  searchPeople,
  tokenRisks,
} from '../../../../src/routes/screens/organisation/security-derive.ts';

/**
 * Security's flags and search (LAI-1210): every flag is one field the server
 * sent, read literally; the search is name or email.
 */

const NOW = new Date(2026, 10, 12, 15, 0).getTime();
const DAY = 86_400_000;

const tok = (over: Partial<Parameters<typeof tokenRisks>[0]>) => ({
  last_used_at: NOW - 3_600_000,
  expires_at: null,
  revoked_at: null,
  created_at: NOW - 10 * DAY,
  ...over,
});

void describe('Security: flags from the fields alone', () => {
  void test('never used, stale and expiring each come from one field', () => {
    assert.deepEqual(tokenRisks(tok({}), NOW), []);
    assert.deepEqual(tokenRisks(tok({ last_used_at: null }), NOW), ['never-used']);
    assert.deepEqual(tokenRisks(tok({ last_used_at: NOW - 90 * DAY }), NOW), ['stale']);
    assert.deepEqual(tokenRisks(tok({ last_used_at: NOW - 89 * DAY }), NOW), []);
    assert.deepEqual(tokenRisks(tok({ expires_at: NOW + 2 * DAY }), NOW), ['expiring']);
  });

  void test('a token made today is new, not never used; a dead token has nothing to act on', () => {
    assert.deepEqual(tokenRisks(tok({ last_used_at: null, created_at: NOW - 60_000 }), NOW), []);
    assert.deepEqual(tokenRisks(tok({ last_used_at: null, revoked_at: NOW - DAY }), NOW), []);
    assert.deepEqual(tokenRisks(tok({ last_used_at: null, expires_at: NOW - 1 }), NOW), []);
  });

  void test('the summary counts every token listed and each flag once', () => {
    assert.equal(
      riskSummary(
        [
          tok({}),
          tok({ last_used_at: null }),
          tok({ last_used_at: NOW - 200 * DAY, expires_at: NOW + DAY }),
          tok({ revoked_at: NOW - DAY }),
        ],
        NOW,
      ),
      '4 tokens · 3 working · 1 never used · 1 unused 90+ days · 1 expires within 7 days',
    );
    assert.equal(riskSummary([tok({})], NOW), '1 token');
  });

  void test('the search is name or email, any case, order kept', () => {
    const people = [
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Grace Hopper', email: 'g@navy.example' },
    ];
    assert.deepEqual(searchPeople(people, '  NAVY '), [people[1]]);
    assert.equal(searchPeople(people, '').length, 2);
  });
});
