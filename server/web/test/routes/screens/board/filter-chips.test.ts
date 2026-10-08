/**
 * The chips under the toolbar say which filter, in the popover's words
 * (LAI-717).
 *
 * The set of chips is `activeFilters`' — asserted here against it, so a chip
 * cannot appear for a value the board ignores or go missing for one it sends.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { activeFilters } from '../../../../src/routes/screens/board/filter-keys.ts';
import { filterChips, type ChipNames } from '../../../../src/routes/screens/board/filter-chips.ts';

const NAMES: ChipNames = {
  status: (s) => (s === 'in_progress' ? 'In progress' : s),
  member: (id) => (id === 'u1' ? 'Ada Lovelace' : undefined),
  sprint: (id) => (id === 's1' ? 'S1 · Foundations' : undefined),
};

const chips = (query: string) => filterChips(new URLSearchParams(query), NAMES);

void describe('filterChips', () => {
  void test('names each filter and its value, in the one list’s order', () => {
    assert.deepEqual(
      chips(
        'project=x&status=in_progress&priority=p1&assignee=u1&tag=auth&sprint=s1&updated=7d' +
          '&ready=true&blocked=true&agent=true&top=true&overdue=true',
      ).map((c) => c.label),
      [
        'Status: In progress',
        'Priority: P1',
        'Assignee: Ada Lovelace',
        'Label: auth',
        'Sprint: S1 · Foundations',
        'Updated: Last 7 days',
        'Ready only',
        'Blocked only',
        'Agent-created only',
        'Top-level only',
        'Overdue',
      ],
    );
  });

  void test('says Unassigned, No sprint and Not ready rather than an id or a blank', () => {
    assert.deepEqual(
      chips('assignee=none&sprint=none&ready=false').map((c) => c.label),
      ['Assignee: Unassigned', 'Sprint: No sprint', 'Not ready'],
    );
  });

  void test('an id nobody knows still reads as a sentence, never as the raw id', () => {
    const labels = chips('assignee=01ZZZ&sprint=01YYY').map((c) => c.label);
    assert.deepEqual(labels, ['Assignee: Unknown member', 'Sprint: Unknown sprint']);
  });

  void test('is exactly what the badge counts: search, junk and `sprint=all` make no chip', () => {
    for (const query of [
      'q=login',
      'status=bogus',
      'updated=90d',
      'blocked=yes',
      'sprint=all',
      'project=x&group=assignee&sort=key&page=2',
    ]) {
      assert.deepEqual(chips(query), [], query);
    }

    const query = 'q=x&status=done&sprint=s1&blocked=true';
    const expected = activeFilters(new URLSearchParams(query), NAMES)
      .filter((f) => f.key !== 'q')
      .map((f) => f.key);
    assert.deepEqual(
      chips(query).map((c) => c.key),
      expected,
    );
    assert.deepEqual(expected, ['status', 'sprint', 'blocked'], 'positive control');
  });
});
