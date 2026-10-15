/**
 * `laika activity sync` against a stub board that implements the contract
 * (LAI-752). Every PUT the stub receives is checked against the contract's
 * rules first and refused 422 if it breaks one, so any test that sends a bad
 * body fails — and `violations` is asserted empty throughout.
 *
 * The clock is injected and shared with the stub, so "ten minutes later" and
 * "a day later" are exact and instant.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { addDays, gitRunner, localDay, pushedKey, type GitRunner } from '../src/activity-census.ts';
import { acquireLock, activityPaths, readState, writeState } from '../src/activity-store.ts';
import {
  compactEvents,
  credentialsFor,
  findCredentials,
  MAX_BACKOFF_S,
  retryAfterSeconds,
  startCollecting,
  sync,
  type SyncContext,
} from '../src/activity-sync.ts';
import { MAX_BODY_BYTES } from './support/local-activity-contract.ts';
import { closeAll, stubBoard, type StubBoard } from './support/stub-board.ts';

const TZ = 'Africa/Johannesburg';
const NOW_MS = Date.UTC(2026, 9, 15, 8, 0, 0);
const DAY = 86_400;
const TOKEN = 'lai_SyncTestTokenZq7xNeverPrinted';
const ME = 'me@example.test';

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(made);
  return made;
}

interface World {
  readonly home: string;
  readonly board: StubBoard;
  readonly ctx: SyncContext;
  readonly paths: ReturnType<typeof activityPaths>;
  readonly nowS: () => number;
  readonly advance: (seconds: number) => void;
  readonly repo: string;
  readonly pushedSha: string;
  readonly puts: () => {
    days: {
      day: string;
      prompts: Record<string, number>;
      sessions: number;
      commits_local: number;
      pushed_keys: string[];
    }[];
    collector_id: string;
  }[];
}

async function world(options: { git?: GitRunner } = {}): Promise<World> {
  const home = dir('laika-synchome-');
  const board = await stubBoard(TOKEN);
  let clock = NOW_MS;
  board.now = () => new Date(clock);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, 'no-global-gitconfig'),
    LAIKA_URL: board.url,
    LAIKA_TOKEN: TOKEN,
  };
  const ctx: SyncContext = {
    home,
    env,
    nowMs: () => clock,
    tz: TZ,
    ...(options.git === undefined ? {} : { git: options.git }),
  };
  const nowS = (): number => Math.floor(clock / 1000);

  // A repo with one pushed commit (two days ago) and one unpushed (yesterday).
  const remote = join(home, 'remote.git');
  const repo = join(home, 'work');
  const g = (cwd: string, args: string[], extra: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: 'pipe' });
  g(home, ['init', '-q', '--bare', '-b', 'main', remote]);
  g(home, ['clone', '-q', remote, repo]);
  g(repo, ['config', 'user.email', ME]);
  g(repo, ['checkout', '-q', '-B', 'main']);
  const at = (s: number): Record<string, string> => ({
    GIT_AUTHOR_NAME: 'Dev',
    GIT_AUTHOR_EMAIL: ME,
    GIT_COMMITTER_NAME: 'Dev',
    GIT_COMMITTER_EMAIL: ME,
    GIT_AUTHOR_DATE: `@${String(s)} +0000`,
    GIT_COMMITTER_DATE: `@${String(s)} +0000`,
  });
  g(repo, ['commit', '-q', '--allow-empty', '-m', 'msg-pushed-zq'], at(nowS() - 2 * DAY));
  const pushedSha = g(repo, ['rev-parse', 'HEAD']).trim();
  g(repo, ['push', '-q', 'origin', 'main']);
  g(repo, ['commit', '-q', '--allow-empty', '-m', 'msg-local-zq'], at(nowS() - DAY));

  const paths = activityPaths(home);
  startCollecting(
    paths,
    { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
    nowS() - 20 * DAY,
    board.url,
  );
  writeFileSync(paths.repos, `${String(nowS() - 100)}\t${repo}\n`, { mode: 0o600 });
  writeFileSync(
    paths.events,
    [
      `p claude-code ${String(nowS() - DAY)}`,
      `p claude-code ${String(nowS() - DAY + 60)}`,
      `p codex ${String(nowS() - 3600)}`,
      `s claude-code ${String(nowS() - DAY)}`,
      `p codex ${String(nowS() - 20 * DAY)}`,
    ].join('\n') + '\n',
    { mode: 0o600 },
  );

  return {
    home,
    board,
    ctx,
    paths,
    nowS,
    advance: (seconds) => {
      clock += seconds * 1000;
    },
    repo,
    pushedSha,
    puts: () =>
      board.requests
        .filter((r) => r.method === 'PUT')
        .map((r) => JSON.parse(r.body) as ReturnType<World['puts']>[number]),
  };
}

const today = localDay(NOW_MS / 1000, TZ);

void describe('a successful sync', () => {
  void test('one PUT the contract accepts, with the token as a bearer header', async () => {
    const w = await world();
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent');
    assert.deepEqual(w.board.violations, []);
    const put = w.board.requests.find((r) => r.method === 'PUT');
    assert.ok(put !== undefined);
    assert.equal(put.url, '/api/v1/me/local-activity');
    assert.equal(put.auth, `Bearer ${TOKEN}`);
    assert.equal(put.contentType, 'application/json');

    const body = w.puts()[0];
    assert.ok(body !== undefined);
    assert.equal(body.days.length, 14);
    const yesterday = body.days.find((d) => d.day === addDays(today, -1));
    assert.deepEqual(yesterday?.prompts, { 'claude-code': 2 });
    assert.equal(yesterday?.sessions, 1);
    assert.equal(yesterday?.commits_local, 1);
    assert.deepEqual(body.days.find((d) => d.day === addDays(today, -2))?.pushed_keys, [
      pushedKey(w.pushedSha),
    ]);
    assert.deepEqual(body.days.find((d) => d.day === today)?.prompts, { codex: 1 });
  });

  void test('nothing on the never-sent list leaves the machine', async () => {
    const w = await world();
    await sync(w.ctx);
    const raw = w.board.requests.map((r) => `${r.url} ${r.body}`).join('\n');
    const secrets = [
      w.repo,
      w.home,
      'remote.git',
      'main',
      ME,
      w.pushedSha,
      'msg-pushed-zq',
      'msg-local-zq',
    ];
    for (const secret of secrets) {
      assert.ok(!raw.includes(secret), `sent: ${secret}`);
    }
  });

  void test('then nothing until min_sync_interval_s has passed — and an acknowledged key is not resent', async () => {
    const w = await world();
    await sync(w.ctx);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
    w.advance(599);
    assert.equal((await sync(w.ctx)).kind, 'not-due');
    assert.equal(w.puts().length, 1);
    w.advance(1);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.equal(w.puts().length, 2);
    assert.deepEqual(
      w.puts()[1]?.days.flatMap((d) => d.pushed_keys),
      [],
    );
    assert.deepEqual(w.board.violations, []);
  });

  void test('a retry overwrites, it never adds: the same day sends the same numbers', async () => {
    const w = await world();
    await sync(w.ctx);
    w.advance(600);
    await sync(w.ctx);
    const [a, b] = w.puts();
    const strip = (days: ReturnType<World['puts']>[number]['days']) =>
      days.map(({ pushed_keys: _keys, ...rest }) => rest);
    assert.deepEqual(strip(b?.days ?? []), strip(a?.days ?? []));
    assert.equal(a?.collector_id, b?.collector_id);
  });

  void test('the event log keeps 15 days after a send, and a hook appending meanwhile is kept', async () => {
    const w = await world();
    await sync(w.ctx);
    const kept = readFileSync(w.paths.events, 'utf8').trim().split('\n');
    assert.equal(kept.length, 4, 'the 20-day-old line survived, or a recent one was lost');
    assert.ok(!existsSync(w.paths.eventsCompacting));

    // A crash between the move and the write-back leaves the moved file.
    writeFileSync(w.paths.eventsCompacting, `p codex ${String(w.nowS() - 10)}\n`);
    writeFileSync(w.paths.events, `p goose ${String(w.nowS() - 5)}\n`);
    compactEvents(w.paths, w.nowS());
    assert.deepEqual(
      readFileSync(w.paths.events, 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.split(' ')[1])
        .sort(),
      ['codex', 'goose'],
    );
  });

  void test('files stay 0600, and repos drop a deleted path', async () => {
    const w = await world();
    writeFileSync(
      w.paths.repos,
      `${String(w.nowS() - 100)}\t${w.repo}\n${String(w.nowS() - 100)}\t/no/such/repo\n`,
    );
    await sync(w.ctx);
    assert.equal(readFileSync(w.paths.repos, 'utf8'), `${String(w.nowS() - 100)}\t${w.repo}\n`);
    for (const file of [
      w.paths.state,
      w.paths.events,
      w.paths.repos,
      w.paths.sentKeys,
      w.paths.collectorId,
    ]) {
      const mode = statSync(file).mode & 0o777;
      assert.equal(mode, 0o600, `${file} is ${mode.toString(8)}`);
    }
  });
});

void describe('the board says no', () => {
  void test('403 local_activity_off: stop, clear the log, a new collector, recheck after 24 h', async () => {
    const w = await world();
    const firstId = readFileSync(w.paths.collectorId, 'utf8').trim();
    w.board.put = { kind: 'off' };
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'off');
    const state = readState(w.paths);
    assert.equal(state?.collect, false);
    assert.equal(state?.next_sync_at, w.nowS() + DAY);
    assert.ok(!existsSync(w.paths.events), 'the local log was kept');
    assert.ok(!existsSync(w.paths.collectorId));
    assert.match(
      readFileSync(w.paths.state, 'utf8'),
      /^\{"collect":false,/,
      'the hooks would keep counting',
    );

    // Nothing for a day — not even a check.
    const before = w.board.requests.length;
    w.advance(DAY - 1);
    assert.equal((await sync(w.ctx)).kind, 'not-due');
    assert.equal(w.board.requests.length, before);

    // A day later the switch is read again; it is back on.
    w.board.put = { kind: 'ok' };
    w.advance(1);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    const after24 = w.board.requests.slice(before).map((r) => r.method);
    assert.deepEqual(after24, ['GET', 'PUT']);
    const resumed = readState(w.paths);
    assert.equal(resumed?.collect, true);
    assert.equal(resumed?.since, w.nowS(), 'counting must restart from now');
    const second = w.puts().at(-1);
    assert.notEqual(
      second?.collector_id,
      firstId,
      'a new collector must not overwrite the old one’s days',
    );
    assert.equal(
      second?.days.reduce((n, d) => n + d.commits_local + d.sessions, 0),
      0,
    );
    assert.deepEqual(
      second?.days.flatMap((d) => d.pushed_keys),
      [],
      'a commit authored before sharing was turned back on was reported',
    );
    assert.deepEqual(w.board.violations, []);
  });

  void test('the daily check finding sharing off stops without sending', async () => {
    const w = await world();
    w.board.sharing = { ...w.board.sharing, enabled: false };
    assert.equal((await sync(w.ctx)).kind, 'off');
    assert.deepEqual(
      w.board.requests.map((r) => r.method),
      ['GET'],
    );
    assert.equal(readState(w.paths)?.collect, false);
    assert.ok(!existsSync(w.paths.events));
  });

  void test('the switch and the scope are read before every send', async () => {
    const w = await world();
    for (let i = 0; i < 6; i += 1) {
      await sync(w.ctx);
      w.advance(600);
    }
    assert.deepEqual(
      w.board.requests.map((r) => r.method),
      ['GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT'],
    );
  });

  void test('429: waits for Retry-After, never less than the interval', async () => {
    const w = await world();
    w.board.put = { kind: 'rate-limited', retryAfter: '1800' };
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'rate-limited');
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 1800);
    w.board.put = { kind: 'ok' };
    w.advance(1799);
    assert.equal((await sync(w.ctx)).kind, 'not-due');
    w.advance(1);
    assert.equal((await sync(w.ctx)).kind, 'sent');

    w.board.put = { kind: 'rate-limited', retryAfter: '5' };
    w.advance(600);
    await sync(w.ctx);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
  });

  void test('a board that does not answer is abandoned after 5 s, quietly', async () => {
    const w = await world();
    w.board.put = { kind: 'hang' };
    const started = Date.now();
    const outcome = await sync(w.ctx);
    const took = Date.now() - started;
    assert.equal(outcome.kind, 'error');
    assert.ok(took >= 4_500 && took < 9_000, `took ${String(took)} ms`);
    assert.match(readFileSync(w.paths.lastError, 'utf8'), /no answer within 5 s/);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
    assert.ok(existsSync(w.paths.events), 'an unsent log was thrown away');
  });

  void test('failures back off, doubling, and a success resets it', async () => {
    const w = await world();
    w.board.put = { kind: 'status', status: 500 };
    await sync(w.ctx);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
    w.advance(600);
    await sync(w.ctx);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 1200);
    w.advance(1200);
    await sync(w.ctx);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 2400);
    w.board.put = { kind: 'ok' };
    w.advance(2400);
    await sync(w.ctx);
    assert.equal(readState(w.paths)?.failures, 0);
    assert.ok(!existsSync(w.paths.lastError));
  });

  void test('a board that is down is an error in last-error, not a crash', async () => {
    const w = await world();
    w.board.close();
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'error');
    assert.match(readFileSync(w.paths.lastError, 'utf8'), /could not reach the board/);
  });
});

void describe('one at a time', () => {
  void test('a held lock means another sync is running: nothing is sent', async () => {
    const w = await world();
    const release = acquireLock(w.paths);
    assert.ok(release !== undefined);
    assert.equal((await sync(w.ctx)).kind, 'busy');
    assert.equal(w.board.requests.length, 0);
    release();
    assert.equal((await sync(w.ctx)).kind, 'sent');
  });

  void test('a lock left by a dead process is taken over', async () => {
    const w = await world();
    writeFileSync(w.paths.lock, `999999 ${String(Date.now())}\n`);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.ok(!existsSync(w.paths.lock));
  });

  void test('two syncs started together send once', async () => {
    const w = await world();
    const outcomes = await Promise.all([sync(w.ctx), sync(w.ctx)]);
    assert.deepEqual(outcomes.map((o) => o.kind).sort(), ['busy', 'sent']);
    assert.equal(w.puts().length, 1);
  });
});

void describe('16 KB', () => {
  void test('a body never exceeds it; keys that do not fit go next time', async () => {
    const shas = Array.from({ length: 1500 }, (_, i) =>
      execFileSync('shasum', ['-a', '1'], { input: String(i) })
        .toString()
        .slice(0, 40),
    );
    const answer = (args: readonly string[]): string | undefined => {
      if (args.includes('--git-common-dir')) return '/fake/.git\n';
      if (args[0] === 'config') return `${ME}\n`;
      if (args.includes('--verify')) return 'abc\n';
      if (args[0] === 'log' && args.includes('--not')) return '';
      if (args[0] === 'log') {
        const at = Math.floor(NOW_MS / 1000) - 3 * DAY;
        return shas.map((sha, i) => `${sha}\t${String(at + i)}\t${ME}`).join('\n');
      }
      return undefined;
    };
    const fakeGit: GitRunner = (_cwd, args) => Promise.resolve(answer(args));
    const w = await world({ git: fakeGit });
    const first = await sync(w.ctx);
    assert.equal(first.kind, 'sent');
    assert.ok(
      first.kind === 'sent' && first.deferredKeys > 0,
      'every key fit — this test proves nothing',
    );
    w.advance(600);
    await sync(w.ctx);
    const bodies = w.board.requests.filter((r) => r.method === 'PUT').map((r) => r.body);
    for (const body of bodies)
      assert.ok(Buffer.byteLength(body) <= MAX_BODY_BYTES, `${String(body.length)} bytes`);
    const sent = w.puts().flatMap((p) => p.days.flatMap((d) => d.pushed_keys));
    assert.equal(new Set(sent).size, sent.length, 'a key was sent twice');
    assert.deepEqual(new Set(sent), new Set(shas.map(pushedKey)));
    assert.deepEqual(w.board.violations, []);
  });
});

void describe('credentials', () => {
  void test('the environment, then ~/.claude/settings.json, then ~/.laika/env', () => {
    const home = dir('laika-credhome-');
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.laika'));
    writeFileSync(
      join(home, '.laika', 'env'),
      'LAIKA_URL="http://env-file"\nLAIKA_TOKEN="lai_file"\n',
    );
    assert.deepEqual(findCredentials(home, {}), { url: 'http://env-file', token: 'lai_file' });
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ env: { LAIKA_URL: 'http://settings/', LAIKA_TOKEN: 'lai_settings' } }),
    );
    assert.deepEqual(findCredentials(home, {}), { url: 'http://settings', token: 'lai_settings' });
    assert.deepEqual(findCredentials(home, { LAIKA_URL: 'http://live', LAIKA_TOKEN: 'lai_live' }), {
      url: 'http://live',
      token: 'lai_live',
    });
  });

  void test('none at all: the sync records why and backs off', async () => {
    const w = await world();
    const outcome = await sync({ ...w.ctx, env: { PATH: process.env.PATH ?? '', HOME: w.home } });
    assert.equal(outcome.kind, 'error');
    assert.equal(w.board.requests.length, 0);
    assert.match(readFileSync(w.paths.lastError, 'utf8'), /no token for/);
  });

  void test('Retry-After in either form', () => {
    assert.equal(retryAfterSeconds('120', 0), 120);
    assert.equal(retryAfterSeconds(new Date(60_000).toUTCString(), 0), 60);
    assert.equal(retryAfterSeconds(null, 0), undefined);
  });
});

void describe('state.json is what the hook reads', () => {
  void test('one line, `"collect"` first, `"next_sync_at"` a plain number', async () => {
    const w = await world();
    await sync(w.ctx);
    const raw = readFileSync(w.paths.state, 'utf8');
    assert.equal(raw.split('\n').length, 2, 'more than one line: the hook reads only the first');
    assert.match(raw, /^\{"collect":true,"next_sync_at":\d+,/);
  });

  void test('a hand-damaged state file is not trusted', () => {
    const home = dir('laika-badstate-');
    const paths = activityPaths(home);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.state, '{not json');
    assert.equal(readState(paths), undefined);
    writeState(paths, {
      collect: true,
      next_sync_at: 5,
      org_enabled: true,
      enabled: true,
      scope: 'laika-repos',
      min_sync_interval_s: 1,
      since: 0,
      checked_at: 0,
      failures: 0,
    });
    assert.equal(
      readState(paths)?.min_sync_interval_s,
      60,
      'an interval below a minute was trusted',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Review round 1                                                             */
/* -------------------------------------------------------------------------- */

/** A process's start time the way the lock records it: in UTC, C locale. */
const lstart = (pid: number): string =>
  execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
  }).trim();

const until = async (check: () => boolean, ms = 5_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((res) => setTimeout(res, 20));
  }
};

void describe('syncs cannot pile up (review 1, item 1)', () => {
  void test('a live holder keeps the lock, however old it is', async () => {
    const w = await world();
    const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      const pid = holder.pid ?? 0;
      const content = `${JSON.stringify({ pid, start: lstart(pid) })}\n`;
      writeFileSync(w.paths.lock, content);
      const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
      utimesSync(w.paths.lock, sixMinutesAgo, sixMinutesAgo);
      assert.equal((await sync(w.ctx)).kind, 'busy');
      assert.equal(readFileSync(w.paths.lock, 'utf8'), content, 'a live sync’s lock was taken');
      assert.equal(w.board.requests.length, 0);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  void test('a pid that now belongs to a process started at another time is not the holder', async () => {
    const w = await world();
    writeFileSync(
      w.paths.lock,
      `${JSON.stringify({ pid: process.pid, start: 'Thu Jan  1 00:00:00 1970' })}\n`,
    );
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.ok(!existsSync(w.paths.lock));
  });

  /**
   * Held at the very first call — the board's GET never answers — so nothing
   * but the claim made on starting can have moved `next_sync_at`. (Holding it
   * in the census instead proves nothing: by then the GET's answer has been
   * saved, which moves it too.)
   */
  void test('the next sync is claimed when a sync starts, before any work', async () => {
    const w = await world();
    w.board.get = 'hang';
    const running = sync(w.ctx);
    await until(() => w.board.requests.some((r) => r.method === 'GET'));
    // Mid-sync: a session start now would find the sync not due, and launch nothing.
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
    assert.equal((await sync(w.ctx)).kind, 'busy');
    const outcome = await running;
    assert.equal(outcome.kind, 'error', 'the GET should have timed out');
  });

  void test(
    'a sync that hangs is abandoned at its deadline, and writes nothing after',
    { timeout: 10_000 },
    async () => {
      let resume: () => void = () => undefined;
      const gate = new Promise<void>((res) => {
        resume = res;
      });
      const hungGit: GitRunner = async () => {
        await gate;
        return undefined;
      };
      const w = await world({ git: hungGit });
      const started = Date.now();
      const outcome = await sync({ ...w.ctx, deadlineMs: 300 });
      assert.ok(Date.now() - started < 2_000, `took ${String(Date.now() - started)} ms`);
      assert.equal(outcome.kind, 'error');
      assert.ok(outcome.kind === 'error' && outcome.deadline === true);
      assert.ok(!existsSync(w.paths.lock), 'the lock outlived the sync');
      assert.match(readFileSync(w.paths.lastError, 'utf8'), /did not finish within 0\.3 s/);
      const state = readFileSync(w.paths.state, 'utf8');
      assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
      assert.equal(readState(w.paths)?.failures, 1);

      // The stuck call returns later: the abandoned run must not send or write.
      resume();
      await new Promise((res) => setTimeout(res, 300));
      assert.deepEqual(
        w.board.requests.map((r) => r.method),
        ['GET'],
      );
      assert.equal(readFileSync(w.paths.state, 'utf8'), state);
    },
  );

  /**
   * `ps -o lstart` prints in the caller's time zone. An agent started with
   * another `TZ` wrote its start time in that zone; read back in this one it
   * looked like a different process, and the lock was taken from a live sync.
   */
  void test(
    'a holder that started under another time zone keeps the lock',
    { timeout: 30_000 },
    async () => {
      const w = await world();
      const store = pathToFileURL(
        fileURLToPath(new URL('../src/activity-store.ts', import.meta.url)),
      ).href;
      const script =
        `const m = await import(${JSON.stringify(store)});\n` +
        `if (m.acquireLock(m.activityPaths(${JSON.stringify(w.home)})) === undefined) process.exit(3);\n` +
        'setInterval(() => {}, 1000);\n';
      const holder = spawn(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TZ: 'Pacific/Kiritimati' },
        stdio: 'ignore',
      });
      const ownTz = process.env.TZ;
      try {
        await until(() => existsSync(w.paths.lock), 20_000);
        const content = readFileSync(w.paths.lock, 'utf8');
        assert.match(content, new RegExp(`"pid":${String(holder.pid)}[,}]`));
        // This side reads it in a zone 24 hours away from the holder's.
        process.env.TZ = 'Pacific/Pago_Pago';
        assert.equal((await sync(w.ctx)).kind, 'busy', 'a live sync’s lock was taken');
        assert.equal(readFileSync(w.paths.lock, 'utf8'), content);
      } finally {
        if (ownTz === undefined) delete process.env.TZ;
        else process.env.TZ = ownTz;
        holder.kill('SIGKILL');
      }
    },
  );

  /**
   * The deadline must end a git that ignores SIGTERM too. It was sent SIGTERM
   * only, and the 10 s SIGKILL timer went with the callback.
   */
  void test(
    'a git that ignores SIGTERM is gone soon after the deadline aborts',
    { timeout: 30_000 },
    async () => {
      const bin = dir('laika-stubborngit-');
      const pidFile = join(bin, 'pid');
      writeFileSync(
        join(bin, 'git'),
        `#!/bin/sh\ntrap '' TERM\necho $$ > '${pidFile}'\nwhile :; do sleep 0.2; done\n`,
        { mode: 0o755 },
      );
      const controller = new AbortController();
      const run = gitRunner({ PATH: `${bin}:${process.env.PATH ?? ''}` }, controller.signal);
      const pending = run(bin, ['log']);
      await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      try {
        controller.abort();
        assert.equal(await pending, undefined);
        // Well inside git's own 10 s timeout: the abort itself must end it.
        await until(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        }, 5_000);
      } finally {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone, which is the point.
        }
      }
    },
  );

  void test(
    'a git stuck on a dead mount is killed when the deadline aborts',
    { timeout: 20_000 },
    async () => {
      const bin = dir('laika-hunggit-');
      const pidFile = join(bin, 'pid');
      writeFileSync(join(bin, 'git'), `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`, {
        mode: 0o755,
      });
      const controller = new AbortController();
      const run = gitRunner({ PATH: `${bin}:${process.env.PATH ?? ''}` }, controller.signal);
      const started = Date.now();
      const pending = run(bin, ['log']);
      await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
      controller.abort();
      assert.equal(await pending, undefined);
      assert.ok(Date.now() - started < 3_000);
      const pid = Number(readFileSync(pidFile, 'utf8'));
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    },
  );
});

void describe('one board (review 1, item 3)', () => {
  void test('a session pointed at another board sends to neither and wipes nothing', async () => {
    const w = await world();
    const other = await stubBoard(TOKEN);
    other.put = { kind: 'off' };
    const id = readFileSync(w.paths.collectorId, 'utf8');
    const events = readFileSync(w.paths.events, 'utf8');
    const outcome = await sync({ ...w.ctx, env: { ...w.ctx.env, LAIKA_URL: other.url } });
    assert.equal(outcome.kind, 'refused');
    assert.equal(other.requests.length, 0, 'counts went to a board activity was not turned on for');
    assert.equal(w.board.requests.length, 0);
    assert.equal(readFileSync(w.paths.collectorId, 'utf8'), id);
    assert.equal(readFileSync(w.paths.events, 'utf8'), events);
    assert.equal(readState(w.paths)?.collect, true);
    assert.equal(readState(w.paths)?.last_result?.outcome, 'refused');
    assert.match(readFileSync(w.paths.lastError, 'utf8'), /set up for/);
  });

  void test('the token comes from ~/.laika/env for the board activity was turned on for', async () => {
    const w = await world();
    mkdirSync(join(w.home, '.laika'), { recursive: true });
    writeFileSync(
      join(w.home, '.laika', 'env'),
      `LAIKA_URL="${w.board.url}/"\nLAIKA_TOKEN="${TOKEN}"\n`,
    );
    const bare = { PATH: process.env.PATH ?? '', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1' };
    assert.equal((await sync({ ...w.ctx, env: bare })).kind, 'sent');
    assert.ok(w.board.requests.every((r) => r.auth === `Bearer ${TOKEN}`));
    assert.equal(credentialsFor(w.home, {}, 'http://elsewhere'), undefined);
  });

  void test('turning activity on for another board starts over', async () => {
    const w = await world();
    const id = readFileSync(w.paths.collectorId, 'utf8');
    startCollecting(
      w.paths,
      { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
      w.nowS(),
      'http://another-board',
    );
    assert.ok(!existsSync(w.paths.events), 'counts for one board would go to another');
    assert.notEqual(readFileSync(w.paths.collectorId, 'utf8'), id);
    assert.equal(readState(w.paths)?.since, w.nowS());
    assert.equal(readState(w.paths)?.board, 'http://another-board');
  });
});

void describe('the scope as the board says it now (review 1, item 4)', () => {
  void test('narrowed in the web app, it applies on the very next sync — pushed keys too', async () => {
    const w = await world();
    w.board.sharing = { ...w.board.sharing, scope: 'laika-repos' };
    assert.equal(readState(w.paths)?.scope, 'agent-repos');
    assert.equal((await sync(w.ctx)).kind, 'sent');
    const body = w.puts()[0];
    assert.equal(
      body?.days.reduce((n, d) => n + d.commits_local, 0),
      0,
    );
    assert.deepEqual(
      body?.days.flatMap((d) => d.pushed_keys),
      [],
      'a repo outside the scope was reported',
    );
    assert.equal(readState(w.paths)?.scope, 'laika-repos');
  });
});

void describe('exceptions back off too (review 1, item 5)', () => {
  void test('doubling from the interval, capped at 6 hours', async () => {
    const broken: GitRunner = () => Promise.reject(new Error('census exploded'));
    const w = await world({ git: broken });
    let outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'error');
    assert.match(readFileSync(w.paths.lastError, 'utf8'), /census exploded/);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 600);
    w.advance(600);
    outcome = await sync(w.ctx);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + 1200);

    const state = readState(w.paths);
    assert.ok(state !== undefined);
    writeState(w.paths, { ...state, failures: 20, next_sync_at: 0 });
    await sync(w.ctx);
    assert.equal(MAX_BACKOFF_S, 6 * 3600);
    assert.equal(readState(w.paths)?.next_sync_at, w.nowS() + MAX_BACKOFF_S);
    assert.equal(w.puts().length, 0);
  });
});
