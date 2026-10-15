/**
 * The member profile's presentation rules (LAI-743).
 *
 * Every figure on the profile is the server's; these functions only say how a
 * figure reads. The cases that matter are the ones where reading it wrongly
 * would claim something: a cycle time of `0` when nothing was measured, a
 * chart whose tallest bar is scaled by an empty week, a rating sent with a note
 * the server will refuse.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  barHeights,
  durationLabel,
  monthYear,
  nextAttempt,
  ratingProblem,
  scoreLabel,
  weekLabel,
} from '../../../../src/routes/screens/profile/profile-derive.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

void describe('durationLabel', () => {
  void test('says nothing was measured rather than zero', () => {
    assert.equal(durationLabel(null), '—');
  });

  void test('reads minutes, hours and days at the scale they are', () => {
    assert.equal(durationLabel(25 * MIN), '25 min');
    assert.equal(durationLabel(4 * HOUR), '4 h');
    assert.equal(durationLabel(90 * MIN), '1.5 h');
    assert.equal(durationLabel(3 * DAY), '3 d');
    assert.equal(durationLabel(1.8 * DAY), '1.8 d');
    assert.equal(durationLabel(0), '0 min');
  });
});

void describe('weekLabel', () => {
  void test('names the Monday a week starts, in UTC, as the server counts it', () => {
    assert.equal(weekLabel(Date.UTC(2026, 9, 12)), '12 Oct');
    assert.equal(weekLabel(Date.UTC(2026, 6, 27)), '27 Jul');
  });
});

void describe('monthYear', () => {
  void test('says when someone joined as a month, in UTC', () => {
    assert.equal(monthYear(Date.UTC(2026, 7, 3)), 'Aug 2026');
    assert.equal(monthYear(Date.UTC(2025, 0, 31, 23)), 'Jan 2025');
  });
});

void describe('barHeights', () => {
  void test('scales to the busiest week, as a share of it', () => {
    assert.deepEqual(barHeights([0, 1, 2, 4]), [0, 0.25, 0.5, 1]);
  });

  void test('an empty window draws no bars rather than dividing by zero', () => {
    assert.deepEqual(barHeights([0, 0, 0]), [0, 0, 0]);
  });
});

void describe('scoreLabel', () => {
  void test('reads as a score out of five', () => {
    assert.equal(scoreLabel(4), '4 / 5');
  });
});

void describe('ratingProblem — the form refuses what the server would', () => {
  void test('needs a score', () => {
    assert.equal(ratingProblem(undefined, 'Fine.'), 'Choose a score from 1 to 5.');
  });

  void test('needs a note, after trimming', () => {
    assert.equal(ratingProblem(3, ''), 'Write a short note — what the rating is based on.');
    assert.equal(ratingProblem(3, '   '), 'Write a short note — what the rating is based on.');
  });

  void test('caps the note at the server’s 500', () => {
    assert.equal(ratingProblem(3, 'x'.repeat(500)), undefined);
    assert.equal(ratingProblem(3, 'x'.repeat(501)), 'Keep the note to 500 characters.');
    // Trimmed first, as the server trims it.
    assert.equal(ratingProblem(3, `  ${'x'.repeat(500)}  `), undefined);
  });

  void test('is satisfied by a score and a note', () => {
    assert.equal(ratingProblem(5, 'Clears review fast.'), undefined);
  });
});

void describe('nextAttempt — one key per rating the reader is trying to save (LAI-746)', () => {
  let made = 0;
  const make = (): string => {
    made += 1;
    return `k${String(made)}`;
  };

  void test('starts a fresh attempt when there is none', () => {
    made = 0;
    assert.deepEqual(nextAttempt(undefined, 'u2', 4, 'Steady.', make), {
      key: 'k1',
      userId: 'u2',
      score: 4,
      note: 'Steady.',
    });
  });

  void test('keeps the key for a retry of the same rating, so a lost answer cannot duplicate it', () => {
    made = 0;
    const first = nextAttempt(undefined, 'u2', 4, 'Steady.', make);
    assert.equal(nextAttempt(first, 'u2', 4, 'Steady.', make).key, 'k1');
    // The note is compared as the server stores it: trimmed.
    assert.equal(nextAttempt(first, 'u2', 4, '  Steady.  ', make).key, 'k1');
  });

  void test('takes a new key when the rating changed — the old one would be a 409', () => {
    made = 0;
    const first = nextAttempt(undefined, 'u2', 4, 'Steady.', make);
    assert.equal(nextAttempt(first, 'u2', 5, 'Steady.', make).key, 'k2');
    assert.equal(nextAttempt(first, 'u2', 4, 'Steadier.', make).key, 'k3');
  });

  void test('takes a new key for another member, whatever the score and note (LAI-749)', () => {
    // The same score and note about somebody else is a different rating: the
    // first member's key would answer 409, or worse, name the wrong person.
    made = 0;
    const first = nextAttempt(undefined, 'u2', 4, 'Steady.', make);
    const other = nextAttempt(first, 'u3', 4, 'Steady.', make);
    assert.equal(other.key, 'k2');
    assert.equal(other.userId, 'u3');
  });
});
