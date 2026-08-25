/**
 * `src/api/use-events.ts` — the stream's event names (LAI-070).
 *
 * `EventSource` fires `onmessage` only for **unnamed** frames, and the server
 * names every activity frame with its §4.8 type. So a client subscribing to the
 * wrong names receives **nothing at all while looking perfectly connected** —
 * no error, no warning, an empty rail and a green pill.
 *
 * I wrote the first version of that list from memory and got it wrong in both
 * directions: invented `sprint.created`, `sprint.updated`, `sprint.deleted`,
 * `invite.created`, `invite.accepted`, `meeting.reviewed`; missed
 * `token.created`, `token.revoked`, `heartbeat.session`, `meeting.applied`,
 * `unlisted.logged`. Hence this test — read the enum, never remember it.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { nextGap, STREAM_TYPES } from '../../src/api/use-events.ts';

void describe('the stream subscribes to exactly what the server emits', () => {
  void test('STREAM_TYPES equals ACTIVITY_TYPES, in order', async () => {
    const enums = await readFile(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
    const block = /export const ACTIVITY_TYPES = \[([\s\S]*?)\] as const;/.exec(enums);
    assert.notEqual(block, null, 'could not find ACTIVITY_TYPES in the server enums');

    const server = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(server.length > 10, 'sanity: the server should define many activity types');

    assert.deepEqual([...STREAM_TYPES], server);
  });

  void test('control frames are not subscribed as activity', () => {
    // `ready`, `gap` and `closing` carry no `id:` and are not activity rows.
    // Treating one as a task event would put a control frame in the feed.
    for (const control of ['ready', 'gap', 'closing']) {
      assert.ok(!STREAM_TYPES.includes(control), `${control} is a control frame`);
    }
  });
});

void describe('a gap is acted on whether or not it carries a watermark', () => {
  /**
   * Both bodies are copied from the running server, not invented — read off
   * `GET /api/v1/events` on a live instance while writing LAI-070.
   */
  const REPLAY_TOO_LARGE =
    '{"reason":"replay_too_large","missed":812,"limit":500,"updated_since":1756000000000}';
  const UNKNOWN_ID =
    '{"reason":"unknown_last_event_id","missed":-1,"limit":500,"updated_since":null}';

  void test('the watermark is taken when the server has one', () => {
    assert.deepEqual(nextGap(undefined, REPLAY_TOO_LARGE), {
      seq: 1,
      since: 1756000000000,
    });
  });

  void test('a gap with updated_since: null still moves seq', () => {
    // The whole point. `unknown_last_event_id` — a restored backup, a replaced
    // laika.db — carries no watermark, because the server genuinely does not
    // know what this client already has. An implementation keyed on the
    // timestamp reloads nothing here, and the board sits stale underneath a
    // pill that still reads LIVE.
    const gap = nextGap(undefined, UNKNOWN_ID);
    assert.equal(gap.since, undefined, 'null is not a timestamp of 0');
    assert.equal(gap.seq, 1, 'seq must move so the consumer catches up anyway');
  });

  void test('an unparseable body is still a gap', () => {
    // Truncated frame, future field, proxy mangling — none of it makes the
    // missed events come back, so none of it may swallow the signal.
    for (const junk of ['', 'not json', '{"updated_since":', 'null', '[]']) {
      assert.equal(nextGap(undefined, junk).seq, 1, `swallowed: ${junk}`);
    }
  });

  void test('seq rises on every gap, so repeats are not deduplicated away', () => {
    // Two gaps with an identical watermark are two separate catch-ups. Keyed
    // on `since`, the second would be indistinguishable from the first and the
    // effect would not re-run.
    let gap = nextGap(undefined, REPLAY_TOO_LARGE);
    gap = nextGap(gap, REPLAY_TOO_LARGE);
    assert.equal(gap.seq, 2);

    gap = nextGap(gap, UNKNOWN_ID);
    assert.equal(gap.seq, 3, 'mixing shapes must not reset the counter');
  });

  void test('a non-numeric updated_since is refused rather than passed through', () => {
    for (const bad of ['"1756000000000"', 'true', '{}', '[1]']) {
      const gap = nextGap(undefined, `{"updated_since":${bad}}`);
      assert.equal(gap.since, undefined, `accepted ${bad} as a timestamp`);
    }
  });
});
