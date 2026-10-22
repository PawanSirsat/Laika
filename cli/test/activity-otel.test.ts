/**
 * `laika activity on` sets Claude Code's telemetry up in
 * `~/.claude/settings.json` (LAI-867): the owner's manual fix on Belka, written
 * by the CLI — six non-secret variables, an `otelHeadersHelper` naming a 0700
 * script that reads the token each time it runs, and **no token written**.
 * `off` takes out exactly what `on` put in; `status` says whether telemetry
 * reaches the board, from one OTLP request that carries no metric.
 *
 * Every HOME here is a temp directory; the token is a fake one the stub board
 * accepts.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { activity, HOOK_SCRIPT, type ActivityIo } from '../src/activity.ts';
import { helperCommand, otelEnv, otelPaths } from '../src/activity-otel.ts';
import { closeAll, stubBoard, type StubBoard } from './support/stub-board.ts';

const TOKEN = 'lai_OtelTestTokenK2mVqNeverWritten';
const SHELL = '/bin/sh';

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

interface Harness {
  readonly home: string;
  readonly board: StubBoard;
  readonly out: string[];
  readonly settings: string;
  readonly run: (...argv: string[]) => Promise<number>;
}

/**
 * Connected the way `laika connect` leaves a machine: the token in
 * `~/.laika/env` only — never in the environment, so nothing here can pass by
 * reading a shell variable.
 */
async function harness(envFileToken = TOKEN): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'laika-otel-'));
  scratch.push(home);
  const board = await stubBoard(TOKEN);
  writeEnvFile(home, board.url, envFileToken);
  const out: string[] = [];
  const io: ActivityIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    home,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, 'no-global-gitconfig'),
    },
    nowMs: () => Date.now(),
    tz: 'UTC',
    hookScript: HOOK_SCRIPT,
    hookShell: SHELL,
    spawnDetached: () => undefined,
    exit: () => undefined,
    git: () => Promise.resolve(undefined),
  };
  return {
    home,
    board,
    out,
    settings: join(home, '.claude', 'settings.json'),
    run: (...argv) => activity(argv, io),
  };
}

function writeEnvFile(home: string, url: string, token: string): void {
  mkdirSync(join(home, '.laika'), { recursive: true });
  writeFileSync(
    join(home, '.laika', 'env'),
    `# Laika\nexport LAIKA_URL="${url}"\nexport LAIKA_TOKEN="${token}"\n`,
    { mode: 0o600 },
  );
}

/** Someone's settings, shaped like a real one, holding no token. */
const BEFORE = {
  env: { MY_OWN: 'kept' },
  permissions: { allow: ['Bash(ls)'] },
  model: 'opus',
};
const asText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function seed(h: Harness, doc: unknown = BEFORE): string {
  mkdirSync(join(h.home, '.claude'), { recursive: true });
  const text = asText(doc);
  writeFileSync(h.settings, text, { mode: 0o600 });
  return text;
}

const read = (path: string): string => readFileSync(path, 'utf8');
const json = (path: string): Record<string, unknown> =>
  JSON.parse(read(path)) as Record<string, unknown>;

void describe('on writes exactly the reference', () => {
  void test('the six variables and the helper, nothing else; no token in either file; .bak first; mode kept', async () => {
    const h = await harness();
    const original = seed(h);
    assert.equal(await h.run('on'), 0, h.out.join('\n'));

    const after = json(h.settings);
    delete after.hooks; // the activity hooks, asserted in activity-command.test.ts
    assert.deepEqual(after, {
      ...BEFORE,
      env: { ...BEFORE.env, ...otelEnv(h.board.url) },
      otelHeadersHelper: helperCommand(h.home),
    });
    assert.equal(
      (after.env as Record<string, string>).OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
      `${h.board.url}/api/v1/otlp/v1/metrics`,
    );

    const helper = otelPaths(h.home).helper;
    assert.ok(!read(h.settings).includes(TOKEN), 'the token was written into settings.json');
    assert.ok(!read(helper).includes(TOKEN), 'the token was written into the helper');
    assert.equal(statSync(helper).mode & 0o777, 0o700);
    assert.equal(statSync(h.settings).mode & 0o777, 0o600, 'settings.json was widened');
    assert.equal(read(`${h.settings}.bak`), original);

    // Run as Claude Code runs it: a command, through the shell.
    const printed = execFileSync('/bin/sh', ['-c', helperCommand(h.home)], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(printed), { Authorization: `Bearer ${TOKEN}` });

    // Read each time it runs: a new token in ~/.laika/env is the one it prints.
    writeEnvFile(h.home, h.board.url, 'lai_SecondFakeTokenAfterRotation');
    assert.deepEqual(
      JSON.parse(execFileSync('/bin/sh', ['-c', helperCommand(h.home)], { encoding: 'utf8' })),
      { Authorization: 'Bearer lai_SecondFakeTokenAfterRotation' },
    );
  });

  void test('a second on leaves every byte as it was', async () => {
    const h = await harness();
    seed(h);
    assert.equal(await h.run('on'), 0);
    const p = otelPaths(h.home);
    const files = [h.settings, p.helper, p.record];
    const first = files.map((f) => [read(f), statSync(f).mtimeMs, statSync(f).mode]);
    assert.equal(await h.run('on'), 0);
    assert.deepEqual(
      files.map((f) => [read(f), statSync(f).mtimeMs, statSync(f).mode]),
      first,
    );
    assert.match(h.out.join('\n'), /telemetry already set up/);
  });

  void test('a key of the person’s own with another value is left, said, and status reports it', async () => {
    const h = await harness();
    seed(h, { env: { OTEL_METRICS_EXPORTER: 'console' } });
    assert.equal(await h.run('on'), 0);
    assert.equal((json(h.settings).env as Record<string, string>).OTEL_METRICS_EXPORTER, 'console');
    assert.match(h.out.join('\n'), /left as you set it: OTEL_METRICS_EXPORTER/);
    h.out.length = 0;
    assert.equal(await h.run('status'), 0);
    assert.match(
      h.out.join('\n'),
      /OpenTelemetry\s+set up, but your own settings disagree: OTEL_METRICS_EXPORTER/,
    );
  });

  void test('a helper file that is not Laika’s is refused, untouched', async () => {
    const h = await harness();
    writeFileSync(otelPaths(h.home).helper, '#!/bin/sh\necho mine\n', { mode: 0o700 });
    await h.run('on');
    assert.equal(read(otelPaths(h.home).helper), '#!/bin/sh\necho mine\n');
    assert.match(h.out.join('\n'), /is not Laika's — left alone/);
    assert.equal(json(h.settings).otelHeadersHelper, undefined);
  });
});

void describe('off removes exactly what on added', () => {
  void test('on then off restores the original byte for byte, and deletes the helper', async () => {
    const h = await harness();
    const original = seed(h);
    assert.equal(await h.run('on'), 0);
    assert.equal(await h.run('off'), 0, h.out.join('\n'));
    assert.equal(read(h.settings), original);
    assert.throws(() => statSync(otelPaths(h.home).helper), { code: 'ENOENT' });
    assert.throws(() => statSync(otelPaths(h.home).record), { code: 'ENOENT' });
  });

  void test('a settings.json that on created goes again with off', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    assert.equal(await h.run('off'), 0);
    assert.throws(() => statSync(h.settings), { code: 'ENOENT' });
  });

  void test('a key the person changed after on survives off, and one they already had stays', async () => {
    const h = await harness();
    // Belka's manual fix had this exact value before any `on`: it is theirs.
    seed(h, { env: { OTEL_LOGS_EXPORTER: 'none' } });
    assert.equal(await h.run('on'), 0);
    const doc = json(h.settings);
    (doc.env as Record<string, string>).OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
    writeFileSync(h.settings, asText(doc));
    assert.equal(await h.run('off'), 0);
    const left = json(h.settings);
    assert.deepEqual(left.env, { OTEL_LOGS_EXPORTER: 'none', OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' });
    assert.equal(left.otelHeadersHelper, undefined);
    assert.match(h.out.join('\n'), /kept: OTEL_EXPORTER_OTLP_PROTOCOL/);
  });
});

void describe('status says whether telemetry reaches the board', () => {
  const line = (h: Harness): string =>
    h.out.find((l) => l.startsWith('OpenTelemetry')) ?? '(no OpenTelemetry line)';
  const probes = (h: Harness) =>
    h.board.requests.filter((r) => r.url === '/api/v1/otlp/v1/metrics');

  async function statusOf(h: Harness): Promise<string> {
    h.out.length = 0;
    assert.equal(await h.run('status'), 0);
    assert.ok(
      !h.out.some((l) => l.includes('laika activity otel')),
      'status still points at the shell line',
    );
    return line(h);
  }

  void test('reaching the board, from a probe that carries no metric', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    assert.match(await statusOf(h), /OpenTelemetry\s+reaching http:/);
    const sent = probes(h);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.body, '{"resourceMetrics":[]}');
    assert.equal(sent[0]?.auth, `Bearer ${TOKEN}`);
  });

  void test('not set up', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    const doc = json(h.settings);
    delete doc.env;
    delete doc.otelHeadersHelper;
    writeFileSync(h.settings, asText(doc));
    assert.match(await statusOf(h), /OpenTelemetry\s+not set up/);
    assert.equal(probes(h).length, 0);
  });

  void test('set up, but the helper finds no token', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    writeFileSync(join(h.home, '.laika', 'env'), `LAIKA_URL="${h.board.url}"\n`);
    assert.match(
      await statusOf(h),
      /OpenTelemetry\s+set up, but the header helper fails: .*no LAIKA_TOKEN/,
    );
    assert.equal(probes(h).length, 0);
  });

  void test('set up, but the board refuses the token (401)', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    writeEnvFile(h.home, h.board.url, 'lai_NotTheBoardsFakeToken');
    assert.match(await statusOf(h), /OpenTelemetry\s+set up, but .* refuses the token \(401\)/);
  });

  void test('set up, but sharing is off (403 local_activity_off)', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    h.board.otlp = 'off';
    assert.match(
      await statusOf(h),
      /OpenTelemetry\s+set up, but .* refuses it \(403 local_activity_off\)/,
    );
  });
});
