/**
 * The device's answer to a capacity ping and its presence report (D-126,
 * LAI-1038's CLI half). The board is a stub: slice A's routes are coded to
 * plan §4–§5, and a board without them is "not supported", never an error.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  batteryState,
  capacityAnswer,
  launcherAnswerer,
  memoryState,
  replyPing,
  reportPresence,
} from '../src/agent-capacity.ts';
import type { EventDeps, EventRecord } from '../src/agent-events.ts';
import type { LauncherSnapshot } from '../src/agent-launcher.ts';
import type { Fetch } from '../src/agent-session.ts';

const credential = { url: 'http://board.invalid', token: 'lai_CAPACITY_SENTINEL' };
const PING = '01M6G9MFEQ5GT1Q7NBFDVMY12B';
const snapshot: LauncherSnapshot = {
  enabled: true,
  auto_pickup: { work_requests: true, handoffs: true },
  running: 1,
  max_concurrent: 1,
  started_at: 1_793_695_800_000,
  harnesses: ['claude-code'],
};

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function board(
  status: number,
  body: string,
): { fetch: Fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(body, { status }));
    },
  };
}

void describe('the answer', () => {
  void test('is the closed object, and nothing else', () => {
    const a = capacityAnswer({
      snapshot,
      harnessReady: true,
      sessionLive: false,
      battery: { kind: 'battery', percent: 64.4, onBattery: true },
      memory: { kind: 'memory', elevated: false, detail: 'kernel level 1, normal' },
      cliVersion: '0.1.0+668092cc0000',
      answeredBy: 'launcher',
    });
    assert.deepEqual(a, {
      launcher: {
        state: 'on',
        auto_pickup: { work_requests: true, handoffs: true },
        running: 1,
        max_concurrent: 1,
      },
      harness_ready: true,
      session_live: false,
      battery: { state: 'ok', percent: 64, plugged: false },
      memory: { state: 'normal' },
      cli_version: '0.1.0+668092cc0000',
      answered_by: 'launcher',
    });
  });

  void test('no launcher is off with nothing picked up; an unknown reading is never a number', () => {
    const a = capacityAnswer({
      snapshot: undefined,
      harnessReady: false,
      sessionLive: true,
      battery: { kind: 'unsupported', why: 'no battery' },
      memory: { kind: 'unavailable', why: 'sysctl failed' },
      cliVersion: 'weird version; rm -rf',
      answeredBy: 'session',
    });
    assert.deepEqual(a.launcher, {
      state: 'off',
      auto_pickup: { work_requests: false, handoffs: false },
      running: 0,
      max_concurrent: 1,
    });
    assert.deepEqual(a.battery, { state: 'unsupported' });
    assert.deepEqual(a.memory, { state: 'unavailable' });
    assert.equal(a.cli_version, 'unknown');
    assert.ok(!JSON.stringify(a).includes('why'), 'the reason words stay on the device');
  });

  void test('battery low only on battery at or under 15 %; memory level 4 is critical', () => {
    assert.equal(batteryState({ kind: 'battery', percent: 15, onBattery: true }).state, 'low');
    assert.equal(batteryState({ kind: 'battery', percent: 5, onBattery: false }).state, 'ok');
    assert.equal(
      memoryState({ kind: 'memory', elevated: true, detail: 'kernel level 4, critical' }).state,
      'critical',
    );
    assert.equal(
      memoryState({ kind: 'memory', elevated: true, detail: 'kernel level 2, warn' }).state,
      'warn',
    );
    assert.equal(
      memoryState({ kind: 'memory', elevated: true, detail: 'some avg10=12' }).state,
      'warn',
    );
  });
});

void describe('the reply', () => {
  const answer = capacityAnswer({
    snapshot,
    harnessReady: true,
    sessionLive: false,
    battery: { kind: 'unsupported', why: 'x' },
    memory: { kind: 'unsupported', why: 'x' },
    cliVersion: '0.1.0',
    answeredBy: 'launcher',
  });

  void test('goes to the ping’s reply route with the agent’s own token', async () => {
    const b = board(200, '{"ping":{"state":"answered"}}');
    assert.equal(await replyPing(b.fetch, credential, PING, answer), 'answered');
    assert.equal(
      b.calls[0]?.url,
      `http://board.invalid/api/v1/agents/me/capacity-pings/${PING}/reply`,
    );
    assert.equal(
      (b.calls[0]?.init.headers as Record<string, string>).Authorization,
      `Bearer ${credential.token}`,
    );
    assert.deepEqual(JSON.parse(b.calls[0]?.init.body as string), answer);
  });

  void test('expired, already answered and not addressed are settled; a missing route is unsupported', async () => {
    const coded = (status: number, code: string) =>
      board(status, JSON.stringify({ error: { code, message: 'm' } })).fetch;
    assert.equal(await replyPing(coded(409, 'conflict'), credential, PING, answer), 'closed');
    assert.equal(await replyPing(coded(404, 'not_found'), credential, PING, answer), 'closed');
    assert.equal(
      await replyPing(board(404, 'Not Found').fetch, credential, PING, answer),
      'unsupported',
    );
    assert.equal(await replyPing(board(503, '{}').fetch, credential, PING, answer), 'error');
    assert.equal(
      await replyPing(board(200, '{}').fetch, credential, 'not-an-id', answer),
      'closed',
    );
  });

  void test('the launcher answers as itself, with its snapshot', async () => {
    const home = mkdtempSync(join(tmpdir(), 'laika-1039-cap-'));
    temps.push(home);
    const b = board(200, '{}');
    const deps: EventDeps & { metrics: unknown } = {
      home,
      fetch: b.fetch,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
      metrics: {
        battery: () => Promise.resolve({ kind: 'battery', percent: 80, onBattery: false }),
        memory: () =>
          Promise.resolve({ kind: 'memory', elevated: false, detail: 'kernel level 1' }),
      },
    };
    const record = { type: 'agent.capacity_requested', ping_id: PING } as unknown as EventRecord;
    const settled = await launcherAnswerer(() => snapshot)(
      deps,
      record,
      { harness: 'claude-code', fp: '0'.repeat(16) },
      credential,
    );
    assert.equal(settled, true);
    const sent = JSON.parse(b.calls[0]?.init.body as string) as Record<string, unknown>;
    assert.equal(sent.answered_by, 'launcher');
    assert.equal(sent.harness_ready, true);
    assert.deepEqual(sent.battery, { state: 'ok', percent: 80, plugged: true });
    assert.deepEqual((sent.launcher as Record<string, unknown>).state, 'on');
  });
});

void describe('presence', () => {
  void test('PUT /agents/me/launcher with the snapshot and the version only', async () => {
    const b = board(200, '{"launcher":{"state":"on"}}');
    assert.equal(await reportPresence(b.fetch, credential, snapshot, '0.1.0'), 'ok');
    assert.equal(b.calls[0]?.init.method, 'PUT');
    assert.equal(b.calls[0]?.url, 'http://board.invalid/api/v1/agents/me/launcher');
    assert.deepEqual(JSON.parse(b.calls[0]?.init.body as string), {
      enabled: true,
      auto_pickup: { work_requests: true, handoffs: true },
      running: 1,
      max_concurrent: 1,
      cli_version: '0.1.0',
      started_at: snapshot.started_at,
    });
  });

  void test('a board without the route is unsupported — the SPA’s 200 HTML included', async () => {
    assert.equal(
      await reportPresence(board(404, '{"error":{}}').fetch, credential, snapshot, 'v'),
      'unsupported',
    );
    assert.equal(
      await reportPresence(board(405, '').fetch, credential, snapshot, 'v'),
      'unsupported',
    );
    assert.equal(
      await reportPresence(
        board(200, '<!doctype html><html></html>').fetch,
        credential,
        snapshot,
        'v',
      ),
      'unsupported',
    );
    assert.equal(
      await reportPresence(board(401, '{}').fetch, credential, snapshot, 'v'),
      'refused',
    );
    assert.equal(await reportPresence(board(500, '{}').fetch, credential, snapshot, 'v'), 'error');
  });
});
