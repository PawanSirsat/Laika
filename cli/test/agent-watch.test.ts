/**
 * The resource watcher (LAI-552) with a fake metrics source and an injected
 * clock: thresholds, hysteresis, dedup, unsupported readings, and what a
 * trigger reports when the save does not reach the board.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { type AutoOutcome, recordPath } from '../src/agent-checkpoint.ts';
import { type SessionState, writeState } from '../src/agent-session.ts';
import {
  type BatteryReading,
  batteryLine,
  INITIAL,
  linuxBattery,
  linuxMemory,
  type MemoryReading,
  memoryLine,
  parseMacPressure,
  parsePmset,
  parsePsi,
  type RequestDeps,
  type RequestOptions,
  requestCheckpoint,
  step,
  systemMetrics,
  watch,
  type WatchConfig,
  type WatchState,
} from '../src/agent-watch.ts';

const CONFIG: WatchConfig = { batteryPercent: 15, memorySustainMs: 60_000, memoryClearMs: 30_000 };
const bat = (percent: number, onBattery: boolean): BatteryReading => ({
  kind: 'battery',
  percent,
  onBattery,
});
const mem = (elevated: boolean): MemoryReading => ({
  kind: 'memory',
  elevated,
  detail: elevated ? 'warn' : 'normal',
});
const NO_BAT: BatteryReading = { kind: 'unsupported', why: 'no battery found' };
const NO_MEM: MemoryReading = { kind: 'unsupported', why: 'not supported on win32' };

/** Feed readings through `step`, one per tick at `t` ms, and collect every trigger. */
function run(
  ticks: readonly [number, BatteryReading, MemoryReading][],
  from: WatchState = INITIAL,
): { triggers: string[][]; state: WatchState } {
  let state = from;
  const triggers: string[][] = [];
  for (const [t, b, m] of ticks) {
    const r = step(state, b, m, t, CONFIG);
    state = r.state;
    triggers.push([...r.triggers]);
  }
  return { triggers, state };
}

void describe('battery threshold and hysteresis', () => {
  void test('fires at the threshold while unplugged, not above it', () => {
    const { triggers } = run([
      [0, bat(16, true), mem(false)],
      [1, bat(15, true), mem(false)],
    ]);
    assert.deepEqual(triggers, [[], ['battery_low']]);
  });

  void test('never fires while plugged in, however low', () => {
    const { triggers } = run([
      [0, bat(3, false), mem(false)],
      [1, bat(1, false), mem(false)],
    ]);
    assert.deepEqual(triggers, [[], []]);
  });

  void test('fires once: staying low, or dropping further, does not fire again', () => {
    const { triggers } = run([
      [0, bat(14, true), mem(false)],
      [1, bat(12, true), mem(false)],
      [2, bat(5, true), mem(false)],
    ]);
    assert.deepEqual(triggers, [['battery_low'], [], []]);
  });

  void test('a wobble inside the band does not re-arm; five points above does', () => {
    const { triggers } = run([
      [0, bat(15, true), mem(false)],
      [1, bat(19, true), mem(false)], // inside 15 + 5: still disarmed
      [2, bat(15, true), mem(false)],
      [3, bat(20, true), mem(false)], // re-armed
      [4, bat(15, true), mem(false)],
    ]);
    assert.deepEqual(triggers, [['battery_low'], [], [], [], ['battery_low']]);
  });

  void test('plugging in re-arms it', () => {
    const { triggers } = run([
      [0, bat(10, true), mem(false)],
      [1, bat(10, false), mem(false)],
      [2, bat(10, true), mem(false)],
    ]);
    assert.deepEqual(triggers, [['battery_low'], [], ['battery_low']]);
  });

  void test('the threshold is configurable', () => {
    const r = step(INITIAL, bat(25, true), mem(false), 0, { ...CONFIG, batteryPercent: 30 });
    assert.deepEqual(r.triggers, ['battery_low']);
  });
});

void describe('memory pressure: sustained, then hysteresis', () => {
  void test('fires only after 60 s of unbroken elevated readings', () => {
    const { triggers } = run([
      [0, NO_BAT, mem(true)],
      [30_000, NO_BAT, mem(true)],
      [59_999, NO_BAT, mem(true)],
      [60_000, NO_BAT, mem(true)],
    ]);
    assert.deepEqual(triggers, [[], [], [], ['memory_pressure']]);
  });

  void test('one normal reading restarts the 60 s', () => {
    const { triggers } = run([
      [0, NO_BAT, mem(true)],
      [50_000, NO_BAT, mem(false)],
      [60_000, NO_BAT, mem(true)],
      [110_000, NO_BAT, mem(true)],
      [120_000, NO_BAT, mem(true)],
    ]);
    assert.deepEqual(triggers, [[], [], [], [], ['memory_pressure']]);
  });

  void test('an unsupported reading breaks the run: nothing sustained is claimed', () => {
    const { triggers } = run([
      [0, NO_BAT, mem(true)],
      [40_000, NO_BAT, NO_MEM],
      [70_000, NO_BAT, mem(true)],
    ]);
    assert.deepEqual(triggers, [[], [], []]);
  });

  void test('fires once, and re-arms only after 30 s of normal readings', () => {
    const { triggers } = run([
      [0, NO_BAT, mem(true)],
      [60_000, NO_BAT, mem(true)], // fires
      [90_000, NO_BAT, mem(true)], // still elevated: no repeat
      [100_000, NO_BAT, mem(false)],
      [120_000, NO_BAT, mem(true)], // a blip before the 30 s: not re-armed
      [130_000, NO_BAT, mem(false)],
      [159_999, NO_BAT, mem(false)],
      [160_000, NO_BAT, mem(false)], // 30 s normal: re-armed
      [170_000, NO_BAT, mem(true)],
      [230_000, NO_BAT, mem(true)], // fires again
    ]);
    assert.deepEqual(triggers, [
      [],
      ['memory_pressure'],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      ['memory_pressure'],
    ]);
  });

  void test('both conditions on one tick are one step with two triggers', () => {
    const { triggers } = run([
      [0, bat(20, true), mem(true)],
      [60_000, bat(10, true), mem(true)],
    ]);
    assert.deepEqual(triggers, [[], ['battery_low', 'memory_pressure']]);
  });
});

void describe('readers: unsupported is printed as unsupported, never as a number', () => {
  void test('pmset on battery and on AC', () => {
    assert.deepEqual(
      parsePmset(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t12%; discharging; 0:40 remaining present: true\n",
      ),
      bat(12, true),
    );
    assert.deepEqual(
      parsePmset(
        "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t54%; charging; 1:40 remaining present: true\n",
      ),
      bat(54, false),
    );
  });

  void test('a Mac without a battery is unsupported', () => {
    const r = parsePmset("Now drawing from 'AC Power'\n");
    assert.equal(r.kind, 'unsupported');
    assert.equal(batteryLine(r), 'battery: unsupported (no battery found (pmset))');
  });

  void test('the macOS pressure level', () => {
    const level = (text: string): MemoryReading => parseMacPressure(text);
    assert.deepEqual(level('1\n'), {
      kind: 'memory',
      elevated: false,
      detail: 'kernel level 1, normal',
    });
    assert.deepEqual(level('2\n'), {
      kind: 'memory',
      elevated: true,
      detail: 'kernel level 2, warn',
    });
    assert.deepEqual(level('4'), {
      kind: 'memory',
      elevated: true,
      detail: 'kernel level 4, critical',
    });
    assert.equal(level('').kind, 'unavailable');
  });

  void test('Linux PSI against its threshold', () => {
    const psi = (avg: string): string =>
      `some avg10=${avg} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;
    assert.equal((parsePsi(psi('12.50'), 10) as { elevated: boolean }).elevated, true);
    assert.equal((parsePsi(psi('9.99'), 10) as { elevated: boolean }).elevated, false);
    assert.equal(parsePsi('garbage', 10).kind, 'unavailable');
  });

  void test('Linux battery from /sys/class/power_supply', () => {
    const files: Record<string, string> = {
      '/p/AC/type': 'Mains\n',
      '/p/BAT0/type': 'Battery\n',
      '/p/BAT0/capacity': '9\n',
      '/p/BAT0/status': 'Discharging\n',
    };
    const fs = {
      list: () => ['BAT0', 'AC'],
      read: (p: string) => {
        const v = files[p];
        if (v === undefined) throw new Error('ENOENT');
        return v;
      },
    };
    assert.deepEqual(linuxBattery(fs, '/p'), bat(9, true));
    assert.equal(linuxBattery({ ...fs, list: () => ['AC'] }, '/p').kind, 'unsupported');
    assert.equal(linuxMemory(fs, 10).kind, 'unsupported');
  });

  void test('any other OS reports both metrics unsupported, with the platform', async () => {
    const m = systemMetrics('win32', { psiPercent: 10 });
    const b = await m.battery();
    const r = await m.memory();
    assert.equal(batteryLine(b), 'battery: unsupported (not supported on win32)');
    assert.equal(memoryLine(r), 'memory pressure: unsupported (not supported on win32)');
    assert.doesNotMatch(`${batteryLine(b)} ${memoryLine(r)}`, /\d+%|\b0\b/);
  });

  void test('a failing command is unavailable, not zero', async () => {
    const m = systemMetrics('darwin', {
      psiPercent: 10,
      run: () => Promise.reject(new Error('ENOENT')),
    });
    assert.equal(batteryLine(await m.battery()), 'battery: unavailable (pmset failed)');
    assert.equal(memoryLine(await m.memory()), 'memory pressure: unavailable (sysctl failed)');
  });
});

void describe('the loop, with a fake source and clock', () => {
  void test('--once prints the readings and requests nothing', async () => {
    const out: string[] = [];
    let requested = 0;
    const code = await watch({ out: (l) => out.push(l), err: () => undefined }, ['--once'], {
      now: () => 0,
      sleep: () => Promise.resolve(),
      metrics: { battery: () => Promise.resolve(NO_BAT), memory: () => Promise.resolve(NO_MEM) },
      request: () => {
        requested += 1;
        return Promise.resolve([]);
      },
    });
    assert.equal(code, 0);
    assert.equal(requested, 0);
    assert.deepEqual(out, [
      'battery: unsupported (no battery found)',
      'memory pressure: unsupported (not supported on win32)',
    ]);
  });

  void test('one request per firing, both reasons in it; nothing repeated while low', async () => {
    let t = 0;
    const readings: [BatteryReading, MemoryReading][] = [
      [bat(20, true), mem(true)],
      [bat(10, true), mem(true)], // t = 60 s: both fire together
      [bat(9, true), mem(true)],
      [bat(8, true), mem(true)],
    ];
    let i = 0;
    const requests: RequestOptions[] = [];
    const out: string[] = [];
    await watch(
      { out: (l) => out.push(l), err: () => undefined },
      ['--interval-seconds', '60', '--offer-to', '01J000000000000000000000AG'],
      {
        now: () => t,
        sleep: (ms) => {
          t += ms;
          return Promise.resolve();
        },
        metrics: {
          battery: () => Promise.resolve(readings[i]?.[0] ?? NO_BAT),
          memory: () => Promise.resolve((readings[i++] ?? [])[1] ?? NO_MEM),
        },
        request: (o) => {
          requests.push(o);
          return Promise.resolve(['nothing saved: test']);
        },
        maxTicks: readings.length,
      },
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0]?.reason ?? '', /battery low and unplugged and memory pressure/);
    assert.equal(requests[0]?.offerTo, '01J000000000000000000000AG');
    assert.ok(out.includes('watch: nothing saved: test'));
  });

  void test('a bad --offer-to is refused before anything runs', async () => {
    await assert.rejects(
      watch({ out: () => undefined, err: () => undefined }, ['--offer-to', 'nobody'], {
        now: () => 0,
        sleep: () => Promise.resolve(),
        metrics: { battery: () => Promise.resolve(NO_BAT), memory: () => Promise.resolve(NO_MEM) },
        request: () => Promise.resolve([]),
        maxTicks: 1,
      }),
      /--offer-to must be an agent id/,
    );
  });
});

void describe('what a trigger requests, and what it reports', () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
  });

  const TASK = '01J0000000000000000000TASK';
  const AGENT = '01J000000000000000000AGENT';
  const CKPT = '01J000000000000000000CKPT1';
  const URL = 'http://board.test';

  function home(withSession: boolean): string {
    const h = mkdtempSync(join(tmpdir(), 'laika-watch-'));
    homes.push(h);
    if (withSession) {
      const state: SessionState = {
        version: 1,
        harness: 'claude-code',
        harness_session_id: 'hs-1',
        url: URL,
        status: 'live',
        session_id: '01J00000000000000000SESSN1',
        agent_id: AGENT,
        harness_pid: 1,
        harness_started: 'x',
        started_at: 0,
        beats: 0,
        failures: 0,
        claims: [{ task_id: TASK, generation: 3, lease_expires_at: 1 }],
        noticed: [],
      };
      writeState(h, state);
      const cred = join(h, '.laika', 'agents', 'claude-code.json');
      mkdirSync(dirname(cred), { recursive: true });
      writeFileSync(cred, JSON.stringify({ url: URL, token: 'tok' }));
    }
    return h;
  }

  function writeRecord(h: string, stage: string, extra: Record<string, unknown> = {}): void {
    const path = recordPath(h, CKPT);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        id: CKPT,
        idempotency_key: 'k',
        harness: 'claude-code',
        url: URL,
        task_id: TASK,
        task_segment: 'LAI-552',
        generation: 3,
        worktree: '/w',
        remote: 'origin',
        repo: 'o/r',
        branch: 'LAI-552-x',
        commit_sha: 'a'.repeat(40),
        tag_ref: 'refs/tags/laika/checkpoints/LAI-552/x',
        manifest: [],
        summary: null,
        summary_commit_sha: null,
        auto: true,
        created_at: 10,
        stage,
        attempts: 1,
        retags: [],
        ...extra,
      }),
    );
  }

  interface Call {
    url: string;
    method: string;
    body?: unknown;
    headers: Record<string, string>;
  }

  function deps(
    h: string,
    outcome: AutoOutcome,
    onSave: () => void = () => undefined,
    board: (c: Call) => { status: number; body: unknown } = () => ({ status: 404, body: {} }),
  ): RequestDeps & { calls: Call[]; saves: number } {
    const calls: Call[] = [];
    const d = {
      calls,
      saves: 0,
      home: h,
      env: {},
      now: () => 5,
      sleep: () => Promise.resolve(),
      git: (() => {
        throw new Error('no git in this test');
      }) as unknown as RequestDeps['git'],
      fetch: (input: string, init: RequestInit) => {
        const call: Call = {
          url: input,
          method: init.method ?? 'GET',
          headers: init.headers as Record<string, string>,
          ...(typeof init.body === 'string' && init.body !== ''
            ? { body: JSON.parse(init.body) as unknown }
            : {}),
        };
        calls.push(call);
        const r = board(call);
        return Promise.resolve(
          new Response(JSON.stringify(r.body), {
            status: r.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
      autoSave: () => {
        d.saves += 1;
        onSave();
        return Promise.resolve(outcome);
      },
    };
    return d;
  }

  const OPTS: RequestOptions = { reason: 'battery low', offerWaitMs: 0 };

  void test('no live claim on this machine: says so, saves nothing', async () => {
    const d = deps(home(false), 'saved');
    const lines = await requestCheckpoint(d, OPTS);
    assert.deepEqual(lines, [
      'no agent session on this machine holds a live claim: nothing saved, nothing offered',
    ]);
    assert.equal(d.saves, 0);
  });

  void test('consent off: says why, offers nothing', async () => {
    const d = deps(home(true), 'no_consent');
    const lines = await requestCheckpoint(d, { ...OPTS, offerTo: AGENT });
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /automatic checkpoints are off for this agent; nothing saved/);
    assert.equal(d.calls.length, 0, 'no offer was attempted');
  });

  void test('save failed: a refused save is reported as refused, never as saved', async () => {
    const d = deps(home(true), 'refused');
    const lines = await requestCheckpoint(d, OPTS);
    assert.match(lines[0] ?? '', /the save was refused — the reason is in .*helper\.log/);
    assert.doesNotMatch(lines.join('\n'), /registered/);
  });

  void test('save failed: committed and pushed but unregistered is NOT reported as success', async () => {
    const h = home(true);
    const d = deps(h, 'saved', () => {
      writeRecord(h, 'tag_pushed', { created_at: 5, last_error: 'network: ECONNRESET' });
    });
    const lines = await requestCheckpoint(d, { ...OPTS, offerTo: AGENT });
    assert.equal(lines.length, 1);
    assert.match(
      lines[0] ?? '',
      /is tag pushed here but NOT registered on the board \(network: ECONNRESET\)/,
    );
    assert.equal(d.calls.length, 0, 'an unregistered save is never offered');
  });

  void test('a "saved" with no record of it is not confirmed', async () => {
    const d = deps(home(true), 'saved');
    const lines = await requestCheckpoint(d, OPTS);
    assert.match(lines[0] ?? '', /no record of it is here; not confirmed/);
  });

  void test('registered, no --offer-to: reports the save and that no offer was made', async () => {
    const h = home(true);
    const d = deps(h, 'saved', () => {
      writeRecord(h, 'registered', { created_at: 5, verification: 'pending' });
    });
    const lines = await requestCheckpoint(d, OPTS);
    assert.match(
      lines[0] ?? '',
      new RegExp(`checkpoint ${CKPT} \\(aaaaaaaaaaaa\\) registered on the board for LAI-552$`),
    );
    assert.match(lines[1] ?? '', /no offer made/);
  });

  void test('an offer waits for verification and is not made from a pending checkpoint', async () => {
    const h = home(true);
    const d = deps(
      h,
      'saved',
      () => {
        writeRecord(h, 'registered', { created_at: 5 });
      },
      (c) =>
        c.method === 'GET'
          ? { status: 200, body: { data: [{ id: CKPT, verification: 'pending' }] } }
          : { status: 500, body: {} },
    );
    const lines = await requestCheckpoint(d, { ...OPTS, offerTo: AGENT });
    assert.match(
      lines[1] ?? '',
      /not offered: checkpoint .* is pending, and an offer needs a verified one/,
    );
    assert.ok(d.calls.every((c) => c.method === 'GET'));
  });

  void test('a verified checkpoint is offered through the hand-off endpoint, under the claim generation', async () => {
    const h = home(true);
    const d = deps(
      h,
      'unchanged',
      () => {
        writeRecord(h, 'registered');
      },
      (c) =>
        c.method === 'GET'
          ? { status: 200, body: { data: [{ id: CKPT, verification: 'verified' }] } }
          : { status: 201, body: { id: '01J00000000000000000OFFER1', state: 'open' } },
    );
    const lines = await requestCheckpoint(d, { ...OPTS, offerTo: AGENT });
    const post = d.calls.find((c) => c.method === 'POST');
    assert.equal(post?.url, `${URL}/api/v1/tasks/${TASK}/handoff-offers`);
    assert.equal(post.headers['X-Laika-Claim-Generation'], '3');
    assert.deepEqual(post.body, {
      idempotency_key: `watch-${CKPT}-${AGENT}`,
      to_agent_id: AGENT,
      checkpoint_id: CKPT,
      reason: 'Resource watcher: battery low',
    });
    assert.match(lines[0] ?? '', /registered on the board for LAI-552 — nothing new since it/);
    assert.match(lines[1] ?? '', /offered to .*: offer 01J00000000000000000OFFER1 is open/);
  });

  void test('a refused offer says what the board answered', async () => {
    const h = home(true);
    const d = deps(
      h,
      'unchanged',
      () => {
        writeRecord(h, 'registered');
      },
      (c) =>
        c.method === 'GET'
          ? { status: 200, body: { data: [{ id: CKPT, verification: 'verified' }] } }
          : { status: 409, body: { code: 'conflict', reason: 'offer_live' } },
    );
    const lines = await requestCheckpoint(d, { ...OPTS, offerTo: AGENT });
    assert.match(lines[1] ?? '', /not offered: the board answered 409/);
  });
});
