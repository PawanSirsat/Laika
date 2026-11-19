/**
 * The header bell's rules (LAI-1221): which rows it lists and where each
 * leads, what counts as new — the server's own read state for notices, a
 * per-device *last seen* for everything else — and that storage refusing is
 * never an error. The browser half is `test/browser/header-actions.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Notice } from '../../../src/api/notices.ts';
import type { ReviewQueueItem } from '../../../src/api/review.ts';
import type { TokenAlert } from '../../../src/api/token-alerts.ts';
import type { UnlistedWork } from '../../../src/api/unlisted.ts';
import type { PersonHandoffView } from '../../../src/api/handoffs.ts';
import {
  ago,
  badgeCount,
  bellLabel,
  buildNotifications,
  groupNotifications,
  lastSeenKey,
  noticeHref,
  readLastSeen,
  writeLastSeen,
} from '../../../src/components/shell/notifications-model.ts';

const review = (id: string, at: number, canDecide = true): ReviewQueueItem =>
  ({
    task: { id, key: `LC-${id}`, title: `Task ${id}` },
    project: { id: 'p1', slug: 'core', name: 'Laika Core', prefix: 'LC' },
    assignee_name: null,
    waiting_since: at,
    round: null,
    finished_by_name: null,
    can_decide: canDecide,
    cue: null,
  }) as unknown as ReviewQueueItem;

const notice = (id: string, at: number, read: boolean): Notice => ({
  id,
  kind: 'added_to_space',
  actor: { id: 'u2', name: 'Grace' },
  project: { id: 'p1', slug: 'core', name: 'Laika Core' },
  task: null,
  subject: null,
  message: null,
  created_at: at,
  read_at: read ? at + 1 : null,
});

const alert = (id: string, at: number): TokenAlert => ({
  id,
  kind: 'budget',
  scope: 'project',
  threshold: 80,
  tokens: 800,
  limit_tokens: 1000,
  created_at: at,
  project: { slug: 'core', name: 'Laika Core' },
  task: null,
  sprint: null,
});

const note = (id: string, at: number, over: Partial<UnlistedWork> = {}): UnlistedWork => ({
  id,
  user_id: 'u1',
  token_id: null,
  repo: 'laika',
  note: 'Fixed the flaky test\nand more',
  promoted_task_id: null,
  dismissed_at: null,
  created_at: at,
  files: [],
  ...over,
});

const offer = (id: string, at: number, over: Partial<PersonHandoffView> = {}) =>
  ({
    id,
    kind: 'handoff',
    state: 'open',
    task_id: 't',
    task_key: 'LC-9',
    task_title: 'Port the CLI',
    project_id: 'p1',
    project_slug: 'core',
    reason: null,
    created_at: at,
    next_action: 'accept_with_your_agent',
    ...over,
  }) as unknown as PersonHandoffView;

void describe('the rows', () => {
  void test('a review row only for what the reader may decide, opening that review', () => {
    const rows = buildNotifications({ review: [review('1', 10), review('2', 20, false)] }, 0);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.href]),
      [['review', '/inbox?tab=review&item=1']],
    );
  });

  void test('every source in its group, newest first, each to the screen that shows it', () => {
    const rows = buildNotifications(
      {
        review: [review('1', 10)],
        handoffs: [offer('h1', 40), offer('h1', 40), offer('h2', 41, { state: 'expired' })],
        unlisted: [note('n1', 30), note('n2', 31, { dismissed_at: 32 })],
        alerts: [alert('a1', 50)],
        notices: [notice('x', 20, false)],
      },
      0,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['budget:a1', 'handoff:h1', 'unlisted:n1', 'notice:x', 'review:1'],
    );
    assert.equal(rows.find((r) => r.kind === 'unlisted')?.href, '/inbox?tab=unlisted');
    assert.equal(
      rows.find((r) => r.kind === 'unlisted')?.text,
      'Unlisted work: Fixed the flaky test',
    );
    assert.equal(rows.find((r) => r.kind === 'handoff')?.href, '/inbox?tab=review&view=handoffs');
    assert.deepEqual(
      groupNotifications(rows).map((g) => g.group),
      ['waiting', 'alerts', 'updates'],
    );
  });

  void test('a review or budget row names its space for the mark; others name none (D-152)', () => {
    const rows = buildNotifications(
      { review: [review('1', 10)], alerts: [alert('a1', 50)], unlisted: [note('n1', 30)] },
      0,
    );
    const space = { slug: 'core', name: 'Laika Core' };
    assert.deepEqual(rows.find((r) => r.kind === 'review')?.space, space);
    assert.deepEqual(rows.find((r) => r.kind === 'budget')?.space, space);
    assert.equal(rows.find((r) => r.kind === 'unlisted')?.space, undefined);
  });

  void test('a notice leads to its space or card; a revoked tool to Developer access', () => {
    assert.equal(noticeHref(notice('x', 1, false)), '/board?project=core');
    assert.equal(
      noticeHref({ ...notice('x', 1, false), task: { id: 't9', key: 'LC-9', title: 'x' } }),
      '/board?project=core&task=t9',
    );
    assert.equal(noticeHref({ ...notice('x', 1, false), kind: 'token_revoked' }), '/developer');
    assert.equal(noticeHref({ ...notice('x', 1, false), kind: 'time_changed' }), '/my-day');
  });
});

void describe('a partial row', () => {
  void test('costs the row its words, never a throw: the bell is on every screen', () => {
    const partial = { task: { id: 't8' }, waiting_since: 5, can_decide: true };
    const rows = buildNotifications(
      {
        review: [partial as unknown as ReviewQueueItem],
        alerts: [{ id: 'a' } as unknown as TokenAlert],
        handoffs: [{ id: 'h', created_at: 1 } as unknown as PersonHandoffView],
      },
      0,
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.text]),
      [
        ['review:t8', 'A task waits for your review'],
        ['handoff:h', 'Hand-off for you: '],
      ],
    );
  });
});

void describe('what is new', () => {
  void test('a notice is new by the server’s read_at, whatever this device saw', () => {
    const [unread] = buildNotifications({ notices: [notice('x', 5, false)] }, 100);
    const [read] = buildNotifications({ notices: [notice('y', 500, true)] }, 100);
    assert.equal(unread?.unread, true);
    assert.equal(read?.unread, false);
  });

  void test('everything else is new when it arrived after this device last looked', () => {
    const rows = buildNotifications({ review: [review('old', 50), review('new', 150)] }, 100);
    assert.deepEqual(
      rows.map((r) => [r.id, r.unread]),
      [
        ['review:new', true],
        ['review:old', false],
      ],
    );
  });

  void test('the badge: waiting items since last seen, plus the server’s unread notices', () => {
    const sources = { review: [review('1', 50), review('2', 150)], alerts: [alert('a', 200)] };
    assert.equal(badgeCount(sources, 100, 3), 5);
    assert.equal(badgeCount(sources, 1_000, undefined), 0);
    assert.equal(bellLabel(0), 'Notifications');
    assert.equal(bellLabel(5), 'Notifications, 5 new');
  });
});

void describe('last seen, on this device', () => {
  void test('per person, and a refusing or empty storage is 0, never a throw', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    writeLastSeen(storage, 'u1', 1234);
    assert.equal(readLastSeen(storage, 'u1'), 1234);
    assert.equal(readLastSeen(storage, 'u2'), 0);
    assert.equal(lastSeenKey('u1'), 'laika.notifications.seen.u1');
    map.set(lastSeenKey('u3'), 'not a number');
    assert.equal(readLastSeen(storage, 'u3'), 0);
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    assert.equal(readLastSeen(refusing, 'u1'), 0);
    assert.doesNotThrow(() => {
      writeLastSeen(refusing, 'u1', 1);
    });
    assert.equal(readLastSeen(undefined, 'u1'), 0);
  });

  void test('ago is coarse', () => {
    assert.equal(ago(1_000, 1_000), 'just now');
    assert.equal(ago(0, 5 * 60_000), '5 min ago');
    assert.equal(ago(0, 3 * 3_600_000), '3 h ago');
    assert.equal(ago(0, 2 * 86_400_000), '2 d ago');
  });
});
