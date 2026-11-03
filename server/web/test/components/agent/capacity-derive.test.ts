/**
 * LAI-1102: what the screens say about a launcher and a capacity ping — the
 * *Auto-pickup* chip, who is offered *Ping*, and the answer in words. Built
 * from the shapes `src/api/capacity.ts` mirrors, which `test/api/capacity.test.ts`
 * holds to the server's.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RegisteredAgent } from '../../../src/api/agents.ts';
import type { CapacityAnswer, Launcher } from '../../../src/api/capacity.ts';
import { ApiError } from '../../../src/api/errors.ts';
import type { MeProfile } from '../../../src/api/me.ts';
import { clockTime } from '../../../src/api/time-label.ts';
import {
  PING_WORDS,
  answerItems,
  answeredAgo,
  autoPickupWords,
  isStale,
  pingProjectFor,
  pingRefusal,
} from '../../../src/components/agent/capacity-derive.ts';
import { NEVER_REPORTED, reported } from '../../helpers/launcher.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

void describe('the Auto-pickup chip says the board’s word', () => {
  void test('on: the word, how fresh, and what it picks up', () => {
    const w = autoPickupWords(reported('on', NOW - 40_000), NOW, 'Belka');
    assert.equal(w.state, 'on');
    assert.equal(w.word, 'Auto-pickup: on · 40 s');
    assert.equal(w.tone, 'ok');
    assert.match(w.reason, /^The launcher on Belka reported just now that it is on; /);
    assert.match(w.reason, /it starts work requests and hand-offs addressed here by itself\./);
    assert.match(w.reason, /0 of 1 running\.$/);
  });

  void test('a report two minutes old is still on, in minutes', () => {
    assert.equal(
      autoPickupWords(reported('on', NOW - 2 * MIN - 5000), NOW, 'Belka').word,
      'Auto-pickup: on · 2 min',
    );
  });

  void test('a stale report reads “not heard since …”, never on', () => {
    // The board said `unknown`: its report is over three minutes old. Whatever
    // the reader's clock thinks of `reported_at`, the chip never says on.
    for (const age of [4 * MIN, 30 * MIN, 1000]) {
      const w = autoPickupWords(reported('unknown', NOW - age), NOW, 'Belka');
      assert.equal(w.state, 'unknown');
      assert.equal(w.word, `Auto-pickup: not heard since ${clockTime(NOW - age)}`);
      assert.doesNotMatch(w.word, /: on\b/);
      assert.equal(w.tone, 'warn');
      assert.match(w.reason, /stopped reporting over three minutes ago/);
      assert.match(w.reason, /Nothing starts here until it reports again\.$/);
    }
  });

  void test('older than a day: the date, not a bare time of day', () => {
    const w = autoPickupWords(reported('unknown', NOW - 3 * 24 * 60 * MIN), NOW, 'Belka');
    assert.match(w.word, /^Auto-pickup: not heard since \d{1,2} [A-Z][a-z]{2}/);
  });

  void test('on is the board’s to say: the reader’s clock does not overrule it', () => {
    // A reader whose clock runs ahead sees an `on` report as old. The board's
    // word stands, as it is the one the launcher's work follows.
    assert.equal(autoPickupWords(reported('on', NOW - 10 * MIN), NOW, 'Belka').state, 'on');
  });

  void test('unknown with no time (presence off in the organisation) says so', () => {
    const w = autoPickupWords(reported('unknown', null), NOW, 'Belka');
    assert.equal(w.word, 'Auto-pickup: unknown');
    assert.match(w.reason, /keeps no presence times/);
  });

  void test('never reported: off, and how to turn it on', () => {
    const w = autoPickupWords(NEVER_REPORTED, NOW, 'Belka');
    assert.equal(w.state, 'off');
    assert.equal(w.word, 'Auto-pickup: off');
    assert.equal(w.tone, 'neutral');
    assert.equal(
      w.reason,
      'No launcher on Belka has reported, so nothing starts here by itself. `laika agent launcher enable` on that device turns it on.',
    );
  });

  void test('reported off: off, from its own report', () => {
    const w = autoPickupWords(reported('off', NOW - 2 * MIN), NOW, 'Belka');
    assert.equal(w.word, 'Auto-pickup: off');
    assert.equal(
      w.reason,
      'The launcher on Belka reported 2 min ago that it is off, so nothing starts here by itself.',
    );
  });

  void test('on with a switch off says which', () => {
    const l: Launcher = {
      ...reported('on', NOW - 5000),
      auto_pickup: { work_requests: false, handoffs: true },
    };
    assert.match(autoPickupWords(l, NOW, 'Belka').reason, /hand-offs only, not work requests/);
  });
});

// ------------------------------------------------------------------ who may ping

const agent = (over: Partial<RegisteredAgent> = {}): RegisteredAgent => ({
  id: 'a1',
  owner_user_id: 'u1',
  owner_display_name: 'Ada',
  display_name: 'a1',
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  grants: [{ project_id: 'p2', scope: 'full' }],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  launcher: NEVER_REPORTED,
  ...over,
});

const project = (id: string, over: { agents_allowed?: boolean; archived_at?: number } = {}) => ({
  id,
  slug: `space-${id}`,
  agents_allowed: over.agents_allowed ?? true,
  archived_at: over.archived_at ?? null,
});

const me = (over: Partial<MeProfile> = {}): MeProfile =>
  ({
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada',
    org_role: 'member',
    is_active: true,
    memberships: [
      { project_id: 'p1', role: 'member' },
      { project_id: 'p2', role: 'member' },
    ],
    ...over,
  }) as MeProfile;

void describe('Ping is offered only where the reader may ping (D-126 item 1)', () => {
  const projects = [project('p1'), project('p2')];

  void test('their own active agent, full access, agents allowed, a member: that space', () => {
    assert.equal(pingProjectFor(agent(), projects, me()), 'space-p2');
  });

  void test('the first such space, in the list’s order', () => {
    const both = agent({
      grants: [
        { project_id: 'p2', scope: 'full' },
        { project_id: 'p1', scope: 'full' },
      ],
    });
    assert.equal(pingProjectFor(both, projects, me()), 'space-p1');
  });

  void test('none for an agent that is not theirs, or revoked', () => {
    assert.equal(pingProjectFor(agent({ owner_user_id: 'u2' }), projects, me()), undefined);
    assert.equal(pingProjectFor(agent({ status: 'revoked' }), projects, me()), undefined);
  });

  void test('none where the grant is read-only, agents are off, or the space is archived', () => {
    assert.equal(
      pingProjectFor(agent({ grants: [{ project_id: 'p2', scope: 'read_only' }] }), projects, me()),
      undefined,
    );
    assert.equal(
      pingProjectFor(agent(), [project('p2', { agents_allowed: false })], me()),
      undefined,
    );
    assert.equal(pingProjectFor(agent(), [project('p2', { archived_at: 5 })], me()), undefined);
  });

  void test('none for a viewer: of the organisation, or of that space', () => {
    assert.equal(pingProjectFor(agent(), projects, me({ org_role: 'viewer' })), undefined);
    assert.equal(
      pingProjectFor(agent(), projects, me({ memberships: [{ project_id: 'p2', role: 'viewer' }] })),
      undefined,
    );
  });

  void test('an owner or admin holds every space, a membership or not', () => {
    assert.equal(
      pingProjectFor(agent(), projects, me({ org_role: 'admin', memberships: [] })),
      'space-p2',
    );
  });

  void test('nothing until both reads are in', () => {
    assert.equal(pingProjectFor(agent(), undefined, me()), undefined);
    assert.equal(pingProjectFor(agent(), projects, undefined), undefined);
  });
});

// ------------------------------------------------------------------ an answer

const answer = (over: Partial<CapacityAnswer> = {}): CapacityAnswer => ({
  launcher: {
    state: 'on',
    auto_pickup: { work_requests: true, handoffs: true },
    running: 0,
    max_concurrent: 1,
  },
  harness_ready: { credential: true, argv: true, hooks: true },
  session_live: false,
  battery: { state: 'ok', percent: 64, plugged: true },
  memory: { state: 'normal' },
  cli_version: '0.4.2',
  answered_by: 'launcher',
  ...over,
});

const texts = (a: CapacityAnswer): Record<string, string> =>
  Object.fromEntries(answerItems(a).map((i) => [i.key, i.text]));

void describe('the answer, in words, every fact its own', () => {
  void test('a launcher that is on: online, auto-pickup, free runs, battery, memory, CLI', () => {
    assert.deepEqual(texts(answer()), {
      online: 'Online — its launcher answered',
      pickup: 'Auto-pickup: on, for work requests and hand-offs',
      runs: 'Free runs: 1 of 1',
      ready: 'Tool ready to run',
      battery: 'Battery: 64 %, plugged in',
      memory: 'Memory: normal',
      cli: 'Laika CLI 0.4.2',
    });
  });

  void test('answered by its session with no launcher: off, and no run count invented', () => {
    const t = texts(answer({ launcher: { state: 'off' }, answered_by: 'session' }));
    assert.equal(t.online, 'Online — its open session answered; no launcher is running');
    assert.equal(t.pickup, 'Auto-pickup: off');
    assert.equal(t.runs, undefined);
  });

  void test('a reading the device could not take is a word, never a number', () => {
    const t = texts(
      answer({ battery: { state: 'unsupported' }, memory: { state: 'unavailable' } }),
    );
    assert.equal(t.battery, 'Battery: unsupported on this device');
    assert.equal(t.memory, 'Memory: could not be read');
    assert.doesNotMatch(`${t.battery ?? ''} ${t.memory ?? ''}`, /\d/);
    assert.equal(texts(answer({ battery: { state: 'unavailable' } })).battery, 'Battery: could not be read');
  });

  void test('low and on battery, a full launcher, a tool not ready', () => {
    const t = texts(
      answer({
        battery: { state: 'low', percent: 9, plugged: false },
        memory: { state: 'warn' },
        launcher: {
          state: 'on',
          auto_pickup: { work_requests: true, handoffs: false },
          running: 2,
          max_concurrent: 2,
        },
        harness_ready: { credential: true, argv: false, hooks: false },
      }),
    );
    assert.equal(t.battery, 'Battery: 9 %, low, on battery');
    assert.equal(t.memory, 'Memory: under pressure');
    assert.equal(t.pickup, 'Auto-pickup: on, for work requests only');
    assert.equal(t.runs, 'Free runs: 0 of 2');
    assert.equal(t.ready, 'Tool not ready: its command does not check out, session hooks off');
  });

  void test('how long ago, never negative, and stale after five minutes', () => {
    assert.equal(answeredAgo(NOW - 3000, NOW), 'answered 3 s ago');
    assert.equal(answeredAgo(NOW + 2000, NOW), 'answered 0 s ago');
    assert.equal(answeredAgo(NOW - 4 * MIN, NOW), 'answered 4 min ago');
    assert.equal(isStale({ answered_at: NOW - 5 * MIN }, NOW), false);
    assert.equal(isStale({ answered_at: NOW - 5 * MIN - 1 }, NOW), true);
    assert.equal(isStale({ answered_at: null }, NOW), false);
  });
});

void describe('a ping that did not answer, in the screen’s terms', () => {
  void test('404 is a refusal, whatever the reason behind it', () => {
    assert.deepEqual(pingRefusal(new ApiError('not_found', 'No such agent', 404)), {
      kind: 'refused',
    });
  });

  void test('429 keeps the board’s wait, or a minute when it names none', () => {
    const limited = new ApiError('rate_limited', 'Too many', 429, {
      reason: 'capacity_ping_rate',
      retry_after_seconds: 12,
    });
    assert.deepEqual(pingRefusal(limited), { kind: 'limited', seconds: 12 });
    assert.deepEqual(pingRefusal(new ApiError('rate_limited', 'Too many', 429)), {
      kind: 'limited',
      seconds: 60,
    });
  });

  void test('anything else is a failure, with its message', () => {
    assert.deepEqual(pingRefusal(new ApiError('internal', 'Boom', 500)), {
      kind: 'failed',
      message: 'Boom',
    });
    assert.deepEqual(pingRefusal('x'), { kind: 'failed', message: 'The ping failed.' });
  });

  void test('the words', () => {
    const target = 'Claude Code · Belka';
    assert.equal(PING_WORDS.waiting(target), 'Waiting for Claude Code · Belka…');
    assert.equal(
      PING_WORDS.noAnswer(8),
      'No answer within 8 s — the device may be offline or its launcher is off. Still listening until the ping expires.',
    );
    assert.match(PING_WORDS.expired, /^Expired: no answer within a minute/);
    assert.equal(
      PING_WORDS.limited(target, 12),
      'Too many pings for Claude Code · Belka — try again in 12 s.',
    );
    assert.match(PING_WORDS.refused(target), /^Claude Code · Belka cannot be pinged here/);
  });
});
