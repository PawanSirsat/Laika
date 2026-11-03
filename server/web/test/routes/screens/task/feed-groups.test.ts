/** `src/routes/screens/task/feed-groups.ts` — the activity feed in runs (LAI-1117). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  actorKey,
  commentKind,
  firstLine,
  foldLabel,
  groupRuns,
  runPositions,
  summaryPoints,
} from '../../../../src/routes/screens/task/feed-groups.ts';

void describe('groupRuns', () => {
  void test('cuts where the key changes and keeps the order', () => {
    const runs = groupRuns(['a1', 'a2', 'b1', 'a3'], (s) => s[0]!);
    assert.deepEqual(
      runs.map((r) => [r.key, r.items]),
      [
        ['a', ['a1', 'a2']],
        ['b', ['b1']],
        ['a', ['a3']],
      ],
    );
  });
});

void describe('actorKey', () => {
  void test('tells a person from the agent acting for them, and one session from another', () => {
    const person = actorKey({ actor_id: 'u', actor_kind: 'user' });
    const agentS1 = actorKey({
      actor_id: 'u',
      actor_kind: 'agent',
      agent_id: 'g',
      agent_session: { id: 's1' },
    });
    const agentS2 = actorKey({
      actor_id: 'u',
      actor_kind: 'agent',
      agent_id: 'g',
      agent_session: { id: 's2' },
    });
    assert.notEqual(person, agentS1);
    assert.notEqual(agentS1, agentS2);
    assert.equal(
      agentS1,
      actorKey({ actor_id: 'u', actor_kind: 'agent', agent_id: 'g', agent_session: { id: 's1' } }),
    );
  });

  void test('keys a redacted agent apart from its person without naming it, and the system as one', () => {
    assert.notEqual(
      actorKey({ actor_id: 'u', actor_kind: 'agent', agent_id: null }),
      actorKey({ actor_id: 'u', actor_kind: 'user' }),
    );
    assert.equal(actorKey({ actor_id: null, actor_kind: 'system' }), 'system');
  });
});

void describe('commentKind', () => {
  const round = { number: 1, summary_md: 'Done.', created_at: 100, finished_by: 'u' };

  void test('a send-back reason first', () => {
    assert.deepEqual(
      commentKind({ sent_back: true, body_md: 'Done.', created_at: 100, author_id: 'u' }, [round]),
      { kind: 'send_back' },
    );
  });

  void test('a finish summary only on the same text, author and instant as the round', () => {
    assert.deepEqual(
      commentKind({ sent_back: false, body_md: 'Done.', created_at: 100, author_id: 'u' }, [round]),
      { kind: 'finish_summary', round: 1 },
    );
    for (const near of [
      { body_md: 'Done.', created_at: 101, author_id: 'u' },
      { body_md: 'Done!', created_at: 100, author_id: 'u' },
      { body_md: 'Done.', created_at: 100, author_id: 'v' },
    ]) {
      assert.deepEqual(commentKind({ sent_back: false, ...near }, [round]), { kind: 'plain' });
    }
  });
});

void describe('firstLine', () => {
  void test('takes the first non-blank line without its markdown marks', () => {
    assert.equal(firstLine('\n\n- **Notify** on `start`\nmore'), 'Notify on start');
    assert.equal(firstLine('x'.repeat(10), 5), 'xxxx…');
  });
});

void describe('runPositions', () => {
  void test('one header per run: solo alone, start then mid then end inside one', () => {
    assert.deepEqual(
      runPositions(['a1', 'a2', 'a3', 'b1', 'c1', 'c2'], (s) => s[0]!),
      ['start', 'mid', 'end', 'solo', 'start', 'end'],
    );
    assert.deepEqual(
      runPositions([], (s: string) => s),
      [],
    );
  });
});

void describe('summaryPoints and foldLabel', () => {
  const SUMMARY = [
    'LAI-1113 is in review as PR #260.',
    'CI is green on every gate job.',
    '',
    '- **Notifications** on start and exit.',
    '- `watch`: read-only.',
    '  1. nested item',
    '',
    '```sh',
    '- not a list item, a line of code',
    '',
    '```',
    '',
    '## After',
    'The D-128 draft is in the PR body.',
  ].join('\n');

  void test('a paragraph is one point however many lines, a fence one however long', () => {
    // Paragraph, two items, a nested item, the fence, the heading, the paragraph.
    assert.equal(summaryPoints(SUMMARY), 7);
    assert.equal(summaryPoints(''), 0);
    assert.equal(summaryPoints('One line.'), 1);
  });

  void test('names every point after the first, and Show less once open', () => {
    assert.equal(foldLabel(SUMMARY, false), 'Show full summary · 6 more points');
    assert.equal(foldLabel('First.\n\n- second', false), 'Show full summary · 1 more point');
    assert.equal(foldLabel('One long paragraph.', false), 'Show full summary');
    assert.equal(foldLabel(SUMMARY, true), 'Show less');
  });
});
