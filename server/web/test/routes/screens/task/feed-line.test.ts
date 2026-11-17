/** `src/routes/screens/task/feed-line.ts` — the task feed's own wording (LAI-1122). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ICON_PATHS } from '../../../../src/components/icon/icon-paths.ts';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import { describeEvent } from '../../../../src/api/activity.ts';
import type { AgentNaming } from '../../../../src/api/selected-agent.ts';
import {
  createdVia,
  FEED_ICONS,
  feedLines,
  feedMeta,
  sessionMeta,
} from '../../../../src/routes/screens/task/feed-line.ts';

function row(over: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 'e',
    seq: 1,
    type: 'task.updated',
    project_id: 'p',
    task_id: 't',
    actor_id: 'u1',
    actor_kind: 'user',
    actor_token_id: null,
    payload: null,
    created_at: 1,
    ...over,
  };
}

const AGENTS: ReadonlyMap<string, AgentNaming> = new Map([
  ['g1', { harness: 'claude-code', display_name: null, device_label: 'laptop-1' }],
]);

const SESSION = {
  id: 's1',
  harness: 'claude-code',
  harness_version: '2.1.280',
  model: 'claude-opus-5-5',
};

const TASK = { created_via: 'mcp', created_by_client: 'Polly' };

/**
 * Each kind's mark, as a character, so a line reads as one string. The feed
 * draws a registry icon (`FEED_ICONS`, LAI-1213); this pins which kind it is.
 */
const MARK: Readonly<Record<keyof typeof FEED_ICONS, string>> = {
  created: '+',
  request: '⇄',
  moved: '→',
  started: '▶',
  sent_back: '↩',
  finished: '✓',
  edited: '✎',
  other: '•',
};

/** A line as one string, the way a reader sees it. */
function said(event: ActivityEvent): string[] {
  return feedLines(event, AGENTS).map((line) =>
    [
      MARK[line.icon],
      line.text,
      line.object,
      line.tail,
      line.move === undefined ? undefined : `${line.move.from} → ${line.move.to}`,
    ]
      .filter((part) => part !== undefined)
      .join(' '),
  );
}

void describe('feedLines: the design’s words for the facts it shows', () => {
  void test('created, the work request sent and withdrawn', () => {
    assert.deepEqual(said(row({ type: 'task.created', payload: { key: 'LC-1' } })), [
      '+ Created this task',
    ]);
    assert.deepEqual(
      said(row({ type: 'task.agent_selected', payload: { from: null, to: 'g1' } })),
      ['⇄ Sent the work request to Claude Code · laptop-1'],
    );
    // An agent this reader cannot name is never given one.
    assert.deepEqual(
      said(row({ type: 'task.agent_selected', payload: { from: null, to: 'g9' } })),
      ['⇄ Sent the work request to a registered agent'],
    );
    assert.deepEqual(
      said(row({ type: 'task.agent_selected', payload: { from: 'g1', to: null } })),
      ['⇄ Withdrew the work request'],
    );
    // A null `to` the server withheld is not a withdrawal (LAI-1011).
    assert.deepEqual(
      said(
        row({
          type: 'task.agent_selected',
          payload: { from: null, to: null },
          agent_redacted: true,
        }),
      ),
      ['⇄ Changed the agent selection on this task'],
    );
  });

  void test('a move, a send-back and an approval, with the status names as pills', () => {
    const names = { from_status_name: 'In progress', to_status_name: 'Review' };
    assert.deepEqual(
      said(
        row({
          type: 'task.status_changed',
          payload: { from: 'in_progress', to: 'review', ...names },
        }),
      ),
      ['→ Moved In progress → Review'],
    );
    assert.deepEqual(
      said(
        row({
          type: 'task.status_changed',
          payload: {
            from: 'review',
            to: 'in_progress',
            from_status_name: 'Review',
            to_status_name: 'In progress',
            via: 'send_back',
          },
        }),
      ),
      ['↩ Sent back Review → In progress'],
    );
    assert.deepEqual(
      said(
        row({
          type: 'task.status_changed',
          payload: { from: 'review', to: 'done', via: 'accept' },
        }),
      ),
      // No names on an older row: the categories in words.
      ['✓ Accepted Review → Done'],
    );
  });

  void test('a claim taken is work started; a claim ended is not', () => {
    assert.deepEqual(
      said(row({ payload: { field: 'claim', from: null, to: { generation: 1 } } })),
      ['▶ Accepted and started work'],
    );
    assert.deepEqual(
      said(row({ payload: { field: 'claim', from: { generation: 1 }, to: null } })),
      ['• Ended the claim'],
    );
  });

  void test('deliverables marked read one line each; an edit of the lists reads as one', () => {
    assert.deepEqual(
      said(
        row({
          payload: {
            field: 'deliverables',
            marked: [
              { id: 'd1', title: 'Terminal viewer', from: 'in_progress', to: 'done' },
              { id: 'd2', title: 'Watch view', from: 'pending', to: 'in_progress' },
              { id: 'd3', title: 'Notifications', from: 'done', to: 'pending' },
            ],
          },
        }),
      ),
      ['✓ Marked Terminal viewer built', '▶ Started Watch view', '✎ Reopened Notifications'],
    );
    assert.deepEqual(said(row({ payload: { changed: ['solves'] } })), [
      '✎ Edited what this delivers',
    ]);
    assert.deepEqual(said(row({ payload: { changed: ['unlocks', 'title'] } })), [
      '✎ Edited what this delivers',
      '✎ Edited this task',
    ]);
  });

  void test('anything else keeps the shared wording, capitalised — and the shared wording is untouched', () => {
    const expired = row({ type: 'task.claim_expired', actor_kind: 'system', actor_id: null });
    const shared = describeEvent(expired);
    assert.match(shared, /^expired an agent’s claim/);
    assert.deepEqual(said(expired), [`• E${shared.slice(1)}`]);
    assert.deepEqual(said(row({ type: 'comment.edited' })), ['✎ Edited a comment']);
    assert.deepEqual(said(row({ type: 'not.a.type' })), ['• Not.a.type']);
  });
});

void describe('feedMeta', () => {
  void test('how a task was created, with its client when one is named', () => {
    assert.equal(feedMeta(row({ type: 'task.created' }), TASK), 'via MCP · Polly');
    assert.equal(createdVia('web', null), 'via web');
    assert.equal(createdVia('api', '  '), 'via API');
  });

  void test('what the session said ran, on the claim and the move, never on a withheld row', () => {
    const agent = { actor_kind: 'agent' as const, agent_id: 'g1', agent_session: SESSION };
    const claim = row({ ...agent, payload: { field: 'claim', from: null, to: { generation: 1 } } });
    assert.equal(feedMeta(claim, TASK), 'Claude Code 2.1.280 · claude-opus-5-5');
    const move = row({ ...agent, type: 'task.status_changed', payload: { from: 'a', to: 'b' } });
    assert.equal(feedMeta(move, TASK), 'Claude Code 2.1.280 · claude-opus-5-5');
    assert.equal(feedMeta(row({ ...agent, type: 'comment.edited' }), TASK), undefined);
    assert.equal(feedMeta({ ...claim, agent_redacted: true }, TASK), undefined);
    // A person's move carries no session.
    assert.equal(feedMeta(row({ type: 'task.status_changed' }), TASK), undefined);
  });

  void test('sessionMeta leaves out what the session did not send', () => {
    assert.equal(
      sessionMeta({ ...SESSION, harness_version: null }),
      'Claude Code · claude-opus-5-5',
    );
    assert.equal(sessionMeta({ ...SESSION, model: null }), 'Claude Code 2.1.280');
    assert.equal(
      sessionMeta({ ...SESSION, harness: 'codex', harness_version: null }),
      'Codex · claude-opus-5-5',
    );
    assert.equal(
      sessionMeta({ id: 's', harness: null, harness_version: null, model: null }),
      undefined,
    );
    assert.equal(sessionMeta(null), undefined);
  });
});

void describe('FEED_ICONS (LAI-1213)', () => {
  void test('each kind draws its own registry icon, never a typed character', () => {
    const names = Object.values(FEED_ICONS);
    assert.equal(new Set(names).size, names.length, 'two kinds draw the same icon');
    for (const name of names)
      assert.ok(ICON_PATHS[name].length > 0, `${name} is not in the registry`);
  });
});
