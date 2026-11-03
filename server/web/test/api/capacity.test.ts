/**
 * `src/api/capacity.ts` — launcher presence and capacity pings (LAI-1102;
 * API by LAI-1038, SPEC §4.83, §4.84, D-126).
 *
 * **The field comparison lives here, not in `view-type-drift.test.ts`.** The
 * server's response census (`response-type-coverage.test.ts`, CORE's) names
 * these types in its `UNPAIRED` list, and reads `server: '…'` literals in the
 * drift check's `PAIRS` to decide what is paired — so a `PAIRS` entry would
 * turn its staleness check red until that list changes in the same landing.
 * Until it does, this is the comparison: both directions, every field, by the
 * same `fieldsOf` the drift check uses.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  ANSWERED_BY,
  ANSWER_STALE_MS,
  BATTERY_STATES,
  CAPACITY_PING_STATES,
  MEMORY_STATES,
  LAUNCHER_STATES,
  PING_WAIT_MS,
  getAgentCapacity,
  getCapacityPing,
  pingAgent,
  startsOnSelect,
} from '../../src/api/capacity.ts';
import { fieldsOf } from '../helpers/interfaces.ts';
import { NEVER_REPORTED, reported } from '../helpers/launcher.ts';

const SERVER = readFileSync(
  new URL('../../../src/services/agent-capacity.ts', import.meta.url),
  'utf8',
);
const CLIENT = readFileSync(new URL('../../src/api/capacity.ts', import.meta.url), 'utf8');

const PAIRS: readonly (readonly [server: string, client: string])[] = [
  ['LauncherView', 'Launcher'],
  ['AutoPickup', 'AutoPickup'],
  ['CapacityAnswer', 'CapacityAnswer'],
  ['CapacityPingView', 'CapacityPing'],
  ['PingAgentResult', 'PingResult'],
  ['AgentCapacityView', 'AgentCapacity'],
];

void test('every pair is read whole: one line a field on both sides', () => {
  // `fieldsOf` reads every line that starts `name:` — a nested object written
  // over several lines would add its own fields. The answer's levels are named
  // types on the client for this reason; the words below cover what is in them.
  assert.ok(
    !(fieldsOf(CLIENT, 'CapacityAnswer') ?? []).includes('percent'),
    'a nested field leaked into CapacityAnswer',
  );
});

void describe('the client types are the server’s, field for field', () => {
  for (const [server, client] of PAIRS) {
    void test(`${server} ↔ ${client}`, () => {
      const served = fieldsOf(SERVER, server);
      const declared = fieldsOf(CLIENT, client);
      // A rename must fail loudly: an empty set would compare equal for ever.
      assert.ok(served !== undefined && served.length > 0, `${server} not found on the server`);
      assert.ok(declared !== undefined && declared.length > 0, `${client} not found in the client`);
      assert.deepEqual(declared, served);
    });
  }
});

/** The server's `export const NAME = [...] as const`, as its words. */
function serverWords(name: string): string[] {
  const found = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(SERVER);
  assert.ok(found, `the server no longer declares ${name} as a literal array`);
  return [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

void describe('the closed words and the clocks are the server’s', () => {
  void test('launcher states and ping states, in order', () => {
    assert.deepEqual([...LAUNCHER_STATES], serverWords('LAUNCHER_STATES'));
    assert.deepEqual([...CAPACITY_PING_STATES], serverWords('CAPACITY_PING_STATES'));
  });

  void test('the answer’s words: battery, memory, who answered', () => {
    assert.deepEqual([...BATTERY_STATES], serverWords('BATTERY_STATES'));
    assert.deepEqual([...MEMORY_STATES], serverWords('MEMORY_STATES'));
    assert.deepEqual([...ANSWERED_BY], serverWords('ANSWERED_BY'));
  });

  void test('the wait is under the server’s cap, so the board ends the hold', () => {
    const cap = /maxWaitMs: ([0-9_]+),/.exec(SERVER)?.[1];
    assert.ok(cap !== undefined, 'the server no longer names maxWaitMs');
    const maxWait = Number(cap.replaceAll('_', ''));
    assert.ok(PING_WAIT_MS > 0 && PING_WAIT_MS < maxWait, `${String(PING_WAIT_MS)} ≥ ${cap}`);
    assert.equal(ANSWER_STALE_MS, 5 * 60_000);
  });
});

void describe('startsOnSelect: the board’s word, never a time', () => {
  const now = 1_800_000_000_000;

  void test('on, picking up work requests: a selection starts by itself', () => {
    assert.equal(startsOnSelect(reported('on', now - 10_000)), true);
  });

  void test('on, but work requests switched off: it does not', () => {
    const l = reported('on', now - 10_000);
    assert.equal(
      startsOnSelect({ ...l, auto_pickup: { work_requests: false, handoffs: true } }),
      false,
    );
  });

  void test('unknown and off never start anything — a fresh-looking time changes nothing', () => {
    // `reported_at` a second ago on an `unknown` word: the word decides.
    assert.equal(startsOnSelect(reported('unknown', now - 1000)), false);
    assert.equal(startsOnSelect(reported('off', now - 1000)), false);
    assert.equal(startsOnSelect(NEVER_REPORTED), false);
  });
});

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(status: number, answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

const PING = {
  id: 'cp1',
  agent_id: 'a/1',
  project_id: 'p1',
  task_id: null,
  state: 'pending',
  requested_by: { user_id: 'u1', agent_id: null },
  created_at: 1,
  expires_at: 60_001,
  answered_at: null,
  answer: null,
};

void describe('the three calls', () => {
  void test('pingAgent POSTs the project, the task and the wait, to the agent named', async () => {
    const sent = stub(201, { ping: PING, created: true });
    const answer = await pingAgent('a/1', { project: 'laika', task_id: 't1', wait_ms: 8000 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, 'POST');
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/agents\/a%2F1\/capacity-pings$/);
    assert.deepEqual(sent[0]?.body, { project: 'laika', task_id: 't1', wait_ms: 8000 });
    assert.deepEqual(answer, { ping: PING, created: true });
  });

  void test('a refusal is the board’s 404, and a rate limit keeps its wait', async () => {
    stub(404, { error: { code: 'not_found', message: 'No such agent' } });
    await assert.rejects(pingAgent('a1', { project: 'laika' }), { status: 404, code: 'not_found' });
    stub(429, {
      error: {
        code: 'rate_limited',
        message: 'Too many capacity pings for this agent',
        details: { reason: 'capacity_ping_rate', retry_after_seconds: 12 },
      },
    });
    await assert.rejects(pingAgent('a1', { project: 'laika' }), {
      status: 429,
      code: 'rate_limited',
      details: { reason: 'capacity_ping_rate', retry_after_seconds: 12 },
    });
  });

  void test('getCapacityPing GETs the one ping', async () => {
    const sent = stub(200, { ping: PING });
    assert.deepEqual(await getCapacityPing('cp1'), { ping: PING });
    assert.equal(sent[0]?.method, 'GET');
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/capacity-pings\/cp1$/);
  });

  void test('getAgentCapacity GETs presence and the latest answer, in one project', async () => {
    const served = { agent_id: 'a1', launcher: NEVER_REPORTED, latest_answer: null, now: 5 };
    const sent = stub(200, served);
    assert.deepEqual(await getAgentCapacity('a1', 'my space'), served);
    assert.equal(sent[0]?.method, 'GET');
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/agents\/a1\/capacity\?project=my%20space$/);
  });
});
