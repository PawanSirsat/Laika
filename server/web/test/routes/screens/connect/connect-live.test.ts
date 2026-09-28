/**
 * The Connect page's "did it work?" check (LAI-622).
 *
 * The page's whole value is that it *proves* the setup worked rather than
 * asserting it, so the rules below are the feature.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  findMySession,
  liveStateFrom,
  LIVE_BUDGET_MS,
  LIVE_POLL_MS,
  LIVE_TICKS,
} from '../../../../src/routes/screens/connect/connect-live.ts';
import type { PresenceEntry, PresenceView } from '../../../../src/api/presence.ts';

const ME = 'u1';

function entry(over: Partial<PresenceEntry>): PresenceEntry {
  return {
    user_id: ME,
    name: 'Ada Lovelace',
    matched_task_id: null,
    project_ids: [],
    is_agent: true,
    last_seen: 1_788_272_050_095,
    ...over,
  };
}

const view = (present: readonly PresenceEntry[], enabled = true): PresenceView => ({
  enabled,
  present,
});

void describe('finding my session', () => {
  void test('an agent session of mine counts', () => {
    const found = findMySession(view([entry({ repo: 'me/app', branch: 'main' })]), ME);
    assert.ok(found !== undefined);
    assert.equal(found.user_id, ME);
  });

  void test('CONTROL: my own browser does not count', () => {
    /*
     * **The failure this exists to prevent is the page congratulating itself.**
     * A heartbeat is `is_agent` only when it carried a token, which the plugin
     * sends and the browser never does. Matching on `user_id` alone would be
     * satisfied by the reader's open tab — reporting success in exactly the
     * state where nothing was installed.
     */
    assert.equal(findMySession(view([entry({ is_agent: false })]), ME), undefined);
  });

  void test('somebody else’s agent is not mine', () => {
    assert.equal(findMySession(view([entry({ user_id: 'u2' })]), ME), undefined);
  });

  void test('a session that withholds where it is still counts', () => {
    // No repo, no branch, no projects — the shape presence returns when the
    // location is withheld. A check that required `repo` would go permanently
    // blind for anyone working outside a project the reader can see.
    const found = findMySession(view([entry({})]), ME);
    assert.ok(found !== undefined, 'a located-elsewhere session was not recognised');
  });
});

void describe('what one answer means', () => {
  void test('presence switched off is said, never inferred', () => {
    // `{enabled: false}` and an empty list are opposite claims. A page that
    // guesses between them tells an org with presence off that its setup failed.
    assert.deepEqual(liveStateFrom(view([], false), ME, 0), { kind: 'disabled' });
  });

  void test('an empty list while enabled is still watching', () => {
    assert.deepEqual(liveStateFrom(view([]), ME, 3), { kind: 'watching', ticks: 3 });
  });

  void test('the budget ends the watch', () => {
    assert.deepEqual(liveStateFrom(view([]), ME, LIVE_TICKS), { kind: 'spent' });
  });

  void test('a hit wins even on the last tick', () => {
    const state = liveStateFrom(view([entry({})]), ME, LIVE_TICKS + 5);
    assert.equal(state.kind, 'found');
  });
});

void describe('the watch is bounded', () => {
  void test('CONTROL: nobody can quietly make this poll forever', () => {
    assert.equal(LIVE_TICKS, 36);
    assert.equal(LIVE_BUDGET_MS / LIVE_POLL_MS, LIVE_TICKS);
    assert.ok(LIVE_BUDGET_MS <= 5 * 60_000, 'the watch outlives presence’s own window');
    assert.ok(LIVE_POLL_MS >= 2_000, 'this would hammer the board');
  });
});
