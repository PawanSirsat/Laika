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
import { STREAM_TYPES } from '../../src/api/use-events.ts';

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
