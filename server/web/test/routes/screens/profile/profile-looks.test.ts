import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { WhoLooked } from '../../../../src/api/people-analytics.ts';
import {
  LOOKS_WINDOW_MS,
  lookCount,
  lookTab,
  pastWindow,
  recentLooks,
  viewerRole,
} from '../../../../src/routes/screens/profile/profile-looks.ts';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const look = (id: string, kind: string, ago: number, role?: string): WhoLooked => ({
  id,
  viewer: {
    id: `v-${id}`,
    name: `Viewer ${id}`,
    ...(role === undefined ? {} : { org_role: role }),
  },
  kind,
  day: null,
  viewed_at: NOW - ago,
});

/** *Who looked · last 30 days* on your own profile (D-139 item 3, LAI-1152). */
void describe('Who looked on your own profile', () => {
  void test('names the tab each look came from, in the profile’s words', () => {
    assert.deepEqual(
      ['profile', 'time', 'activity', 'local_activity', 'usage', 'developer_setup'].map(lookTab),
      ['Overview', 'Time report', 'Activity', 'Activity', 'LLM tokens', 'Developer access'],
    );
    // A kind this client has not heard of is said, not dropped.
    assert.equal(lookTab('board_export'), 'board export');
  });

  void test('lists every look inside 30 days — two by one person are two lines', () => {
    const rows = [look('a', 'time', DAY), look('b', 'time', 2 * DAY), look('c', 'usage', 31 * DAY)];
    // `b` and `a` come from different viewers here; the point is the window.
    assert.deepEqual(
      recentLooks(rows, NOW).map((r) => r.id),
      ['a', 'b'],
    );
    const same = [
      look('a', 'time', DAY),
      { ...look('b', 'profile', 2 * DAY), viewer: look('a', 'x', 0).viewer },
    ];
    assert.equal(recentLooks(same, NOW).length, 2);
  });

  void test('a look exactly 30 days old is still in; a minute older is out', () => {
    assert.equal(recentLooks([look('a', 'time', LOOKS_WINDOW_MS)], NOW).length, 1);
    assert.equal(recentLooks([look('a', 'time', LOOKS_WINDOW_MS + 60_000)], NOW).length, 0);
  });

  void test('stops paging once a page reaches past the window', () => {
    assert.equal(pastWindow([look('a', 'time', DAY)], NOW), false);
    assert.equal(pastWindow([look('a', 'time', DAY), look('b', 'time', 40 * DAY)], NOW), true);
    assert.equal(pastWindow([], NOW), true);
  });

  void test('counts the server’s total when it sends one, else the looks read', () => {
    const rows = [look('a', 'time', DAY), look('b', 'time', 40 * DAY)];
    assert.equal(lookCount(rows, undefined, NOW), 1);
    assert.equal(lookCount(rows, 7, NOW), 7);
  });

  void test('says the viewer’s role only when the server sent it', () => {
    assert.equal(viewerRole(look('a', 'time', 0, 'admin').viewer), 'Admin');
    assert.equal(viewerRole(look('a', 'time', 0).viewer), undefined);
  });
});
