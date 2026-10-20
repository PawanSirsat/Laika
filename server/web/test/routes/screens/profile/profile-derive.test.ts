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
import type { ProfileAgentToken } from '../../../../src/api/profiles.ts';
import {
  agentRows,
  columnCount,
  columnPlan,
  workTab,
  barHeights,
  countLabel,
  durationLabel,
  lastActive,
  monthYear,
  nextAttempt,
  ratingProblem,
  scoreLabel,
  sharePercents,
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
    assert.equal(durationLabel(90 * MIN), '1 h 30 min');
    assert.equal(durationLabel(3 * DAY), '3 d');
    assert.equal(durationLabel(1.8 * DAY), '1 d 19 h');
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

// ------------------------------------------------------------ LAI-750

const token = (
  id: string,
  client: ProfileAgentToken['client'],
  lastUsed: number | null,
  lastMcp: number | null = null,
): ProfileAgentToken => ({
  id,
  name: `Token ${id}`,
  client,
  client_name: null,
  last_used_at: lastUsed,
  last_mcp_at: lastMcp,
  created_at: 1,
});

void describe('sharePercents', () => {
  void test('adds up to exactly 100 by the largest remainder, never 33 + 33 + 33', () => {
    assert.deepEqual(sharePercents([1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(sharePercents([6, 3, 1]), [60, 30, 10]);
    assert.deepEqual(sharePercents([2, 1]), [67, 33]);
    for (const counts of [
      [7, 5, 3, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [99, 1, 1],
    ]) {
      assert.equal(
        sharePercents(counts).reduce((sum, n) => sum + n, 0),
        100,
        String(counts),
      );
    }
  });

  void test('invents no share of nothing', () => {
    assert.deepEqual(sharePercents([0, 0]), [0, 0]);
    assert.deepEqual(sharePercents([]), []);
  });
});

void describe('agentRows', () => {
  void test('one row per agent: those that wrote, most first, then those on a token that did not', () => {
    const rows = agentRows(
      [
        { client: 'codex', writes: 3 },
        { client: 'cursor', writes: 1 },
      ],
      [token('a', 'claude-code', 50), token('b', 'codex', 40), token('c', 'codex', 10)],
    );
    assert.deepEqual(
      rows.map((r) => [r.client, r.writes, r.percent, r.tokens.map((t) => t.id)]),
      [
        ['codex', 3, 75, ['b', 'c']],
        // Wrote through a token since revoked: a share, no usable token.
        ['cursor', 1, 25, []],
        ['claude-code', 0, 0, ['a']],
      ],
    );
  });

  void test('is empty for nobody’s agents', () => {
    assert.deepEqual(agentRows([], []), []);
  });

  void test('leaves out a token that never connected — it used no agent (LAI-751)', () => {
    const rows = agentRows(
      [{ client: 'codex', writes: 2 }],
      [
        token('a', 'codex', 40),
        // Minted and never used: its client is a guess from its name.
        token('b', 'codex', null),
        token('c', 'other', null),
        // Reached /mcp once, never a REST request: that is connecting.
        token('d', 'cursor', null, 30),
      ],
    );
    assert.deepEqual(
      rows.map((r) => [r.client, r.tokens.map((t) => t.id)]),
      [
        ['codex', ['a']],
        ['cursor', ['d']],
      ],
    );
  });

  void test('gives an agent online now its row, once (LAI-751, owner, 2026-10-16)', () => {
    const rows = agentRows(
      [{ client: 'codex', writes: 2 }],
      [token('a', 'codex', 40), token('b', 'cursor', 30)],
      ['codex', 'cursor', 'gemini-cli'],
    );
    assert.deepEqual(
      rows.map((r) => [r.client, r.writes, r.tokens.map((t) => t.id)]),
      [
        ['codex', 2, ['a']],
        ['cursor', 0, ['b']],
        // Online on a token the list does not show: still a row.
        ['gemini-cli', 0, []],
      ],
    );
  });
});

void describe('Current work (LAI-751)', () => {
  void test('opens on in progress, unless only review has work', () => {
    assert.equal(workTab({ in_progress_total: 9, in_review_total: 34 }), 'in_progress');
    assert.equal(workTab({ in_progress_total: 0, in_review_total: 34 }), 'in_review');
    assert.equal(workTab({ in_progress_total: 0, in_review_total: 0 }), 'in_progress');
  });
});

void describe('lastActive', () => {
  void test('is the latest request or MCP call on any of that agent’s tokens', () => {
    const tokens = [token('a', 'codex', 10, 30), token('b', 'codex', 20), token('c', 'cursor', 99)];
    assert.equal(lastActive(tokens, 'codex'), 30);
    assert.equal(lastActive(tokens, 'cursor'), 99);
  });

  void test('says never rather than the epoch', () => {
    assert.equal(lastActive([token('a', 'codex', null)], 'codex'), null);
    assert.equal(lastActive([], 'codex'), null);
  });
});

void describe('countLabel', () => {
  void test('says one and many', () => {
    assert.equal(countLabel(1, 'project', 'projects'), '1 project');
    assert.equal(countLabel(0, 'project', 'projects'), '0 projects');
    assert.equal(countLabel(3, 'type', 'types'), '3 types');
  });
});

void describe('the column layout (LAI-751, owner, 2026-10-16)', () => {
  void test('three columns from 1200 px, two from 768, one below', () => {
    assert.deepEqual(
      [390, 767, 768, 1024, 1199, 1200, 1366].map(columnCount),
      [1, 1, 2, 2, 2, 3, 3],
    );
  });

  void test('every card of a kind appears exactly once, at every width', () => {
    const cards = {
      builder: ['agents', 'current', 'delivery', 'projects', 'rating', 'review'],
      manager: ['decisions', 'projects', 'rating', 'review'],
    } as const;
    for (const kind of ['builder', 'manager'] as const) {
      for (const n of [1, 2, 3] as const) {
        const plan = columnPlan(kind, n);
        assert.equal(plan.length, n, `${kind} at ${String(n)}`);
        assert.deepEqual([...plan.flat()].sort(), [...cards[kind]], `${kind} at ${String(n)}`);
      }
    }
  });

  void test('one column is the reading order', () => {
    assert.deepEqual(columnPlan('builder', 1), [
      ['delivery', 'current', 'agents', 'review', 'projects', 'rating'],
    ]);
    assert.deepEqual(columnPlan('manager', 1), [['review', 'decisions', 'projects', 'rating']]);
  });

  void test('a builder’s two tall cards never share a column', () => {
    for (const n of [2, 3] as const) {
      const column = (id: string) =>
        columnPlan('builder', n).findIndex((c) => c.includes(id as never));
      assert.notEqual(column('current'), column('agents'), `at ${String(n)}`);
    }
  });
});
