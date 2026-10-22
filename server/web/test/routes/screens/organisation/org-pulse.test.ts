/**
 * Organisation → Overview's pulse (LAI-989): the tiles `GET /org/overview`
 * draws. Every number is the server's; this module only names them.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OrgOverview } from '../../../../src/api/org.ts';
import { pulseTiles } from '../../../../src/routes/screens/organisation/org-pulse.ts';

// Odd, distinct numbers, so a tile showing another tile's figure is caught.
const OVERVIEW: OrgOverview = {
  people: { active: 17, seen_this_week: 11, since: 0 },
  tasks: { open: 43, in_review: 5, blocked: 3, overdue: 7 },
};

void describe('pulseTiles', () => {
  void test('one tile per figure, each carrying its own number', () => {
    assert.deepEqual(
      pulseTiles(OVERVIEW).map((tile) => [tile.id, tile.value]),
      [
        ['people', '17'],
        ['open', '43'],
        ['review', '5'],
        ['blocked', '3'],
        ['overdue', '7'],
      ],
    );
  });

  void test('people says how many were seen this week', () => {
    const people = pulseTiles(OVERVIEW).find((tile) => tile.id === 'people');
    assert.equal(people?.sub, '11 seen this week');
  });

  void test('a zero is drawn as 0, not hidden', () => {
    const quiet = pulseTiles({
      people: { active: 1, seen_this_week: 0, since: 0 },
      tasks: { open: 0, in_review: 0, blocked: 0, overdue: 0 },
    });
    assert.equal(quiet.length, 5);
    assert.ok(quiet.slice(1).every((tile) => tile.value === '0'));
    assert.equal(quiet[0]?.sub, 'none seen this week');
  });

  void test('every tile has a label and a line under it', () => {
    for (const tile of pulseTiles(OVERVIEW)) {
      assert.ok(tile.label.length > 0, `${tile.id} has no label`);
      assert.ok(tile.sub.length > 0, `${tile.id} has no line`);
    }
  });
});
