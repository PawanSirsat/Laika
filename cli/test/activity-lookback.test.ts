/**
 * The look-back (LAI-757, D-080): `laika activity backfill`, and the one-time
 * look-back a background sync runs for a repo it sees for the first time.
 *
 * Driven against the stub board, which refuses any report the contract (SPEC
 * §6.4, as `support/local-activity-contract.ts` reads it) refuses and keeps
 * what it accepts the way the server does: snapshots replaced per (collector,
 * day), keys a set at their earliest day. The clock is injected and shared with
 * the stub, so "ten minutes later" is exact and instant.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { activity, HOOK_SCRIPT, type ActivityIo } from '../src/activity.ts';
import { countLookback, gitRunner, localDay, pushedKey } from '../src/activity-census.ts';
import { lookbackReports } from '../src/activity-lookback.ts';
import { acquireLock, activityPaths, readState } from '../src/activity-store.ts';
import { startCollecting, sync, type SyncContext } from '../src/activity-sync.ts';
import { MAX_BODY_BYTES } from './support/local-activity-contract.ts';
import { closeAll, stubBoard, type StubBoard } from './support/stub-board.ts';

const TZ = 'Africa/Johannesburg';
const NOW_MS = Date.UTC(2026, 9, 15, 8, 0, 0);
const DAY = 86_400;
const TOKEN = 'lai_LookbackTestTokenZq7xNeverPrinted';
const ME = 'me@example.test';
const ME2 = 'me-at-home@example.test';
const OTHER = 'someone-else@example.test';

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

interface Put {
  readonly lookback?: true;
  readonly collector_id: string;
  readonly days: { day: string; commits_local?: number; pushed_keys?: string[] }[];
}

interface World {
  readonly home: string;
  readonly board: StubBoard;
  readonly io: ActivityIo;
  readonly ctx: SyncContext;
  readonly out: string[];
  readonly err: string[];
  readonly answers: string[];
  readonly paths: ReturnType<typeof activityPaths>;
  readonly nowS: () => number;
  readonly advance: (seconds: number) => void;
  readonly env: Record<string, string>;
  readonly run: (...argv: string[]) => Promise<number>;
  readonly puts: () => Put[];
  readonly lookbacks: () => Put[];
  /** A clone with a bare remote, `user.email` = ME, registered as a session repo. */
  readonly repo: (name: string, register?: boolean) => Repo;
}

interface Repo {
  readonly path: string;
  /** A commit authored `ago` seconds before now; returns its SHA. */
  readonly commit: (ago: number, options?: { email?: string; message?: string }) => string;
  readonly push: () => void;
  readonly git: (...args: string[]) => string;
}

async function world(options: { sinceAgo?: number } = {}): Promise<World> {
  const home = dir('laika-lbhome-');
  const board = await stubBoard(TOKEN);
  let clock = NOW_MS;
  board.now = () => new Date(clock);
  const nowS = (): number => Math.floor(clock / 1000);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, 'no-global-gitconfig'),
    LAIKA_URL: board.url,
    LAIKA_TOKEN: TOKEN,
  };
  const out: string[] = [];
  const err: string[] = [];
  const answers: string[] = [];
  const io: ActivityIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    home,
    env,
    nowMs: () => clock,
    tz: TZ,
    hookScript: HOOK_SCRIPT,
    hookShell: '/bin/sh',
    spawnDetached: () => undefined,
    exit: () => undefined,
    ask: (question) => {
      out.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
  };
  const ctx: SyncContext = { home, env, nowMs: () => clock, tz: TZ };
  const paths = activityPaths(home);
  startCollecting(
    paths,
    { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
    nowS() - (options.sinceAgo ?? DAY),
    board.url,
  );

  const g = (cwd: string, args: string[], extra: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: 'pipe' });
  const repo = (name: string, register = true): Repo => {
    const remote = join(home, `${name}.git`);
    const path = join(home, name);
    g(home, ['init', '-q', '--bare', '-b', 'main', remote]);
    g(home, ['clone', '-q', remote, path]);
    g(path, ['config', 'user.email', ME]);
    g(path, ['checkout', '-q', '-B', 'main']);
    if (register) {
      const existing = existsSync(paths.repos) ? readFileSync(paths.repos, 'utf8') : '';
      writeFileSync(paths.repos, `${existing}${String(nowS() - 100)}\t${path}\n`, { mode: 0o600 });
    }
    return {
      path,
      commit: (ago, o = {}) => {
        const at = `@${String(nowS() - ago)} +0000`;
        const email = o.email ?? ME;
        g(path, ['commit', '-q', '--allow-empty', '-m', o.message ?? `msg-${String(ago)}-zq`], {
          GIT_AUTHOR_NAME: 'Dev',
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: 'Dev',
          GIT_COMMITTER_EMAIL: email,
          GIT_AUTHOR_DATE: at,
          GIT_COMMITTER_DATE: at,
        });
        return g(path, ['rev-parse', 'HEAD']).trim();
      },
      push: () => {
        g(path, ['push', '-q', 'origin', 'HEAD:main']);
      },
      git: (...args) => g(path, args),
    };
  };

  const puts = (): Put[] =>
    board.requests.filter((r) => r.method === 'PUT').map((r) => JSON.parse(r.body) as Put);
  return {
    home,
    board,
    io,
    ctx,
    out,
    err,
    answers,
    paths,
    nowS,
    advance: (seconds) => {
      clock += seconds * 1000;
    },
    env,
    run: (...argv) => activity(argv, io),
    puts,
    lookbacks: () => puts().filter((p) => p.lookback === true),
    repo,
  };
}

const dayOf = (w: World, ago: number): string => localDay(w.nowS() - ago, TZ);
const keysIn = (puts: readonly Put[]): string[] =>
  puts.flatMap((p) => p.days.flatMap((d) => d.pushed_keys ?? []));

/**
 * The shapes a year of history comes in, one commit each, made oldest first
 * as real history is: `git log --since` stops at the first commit older than
 * the cut, so a history whose dates jump backwards hides what lies behind it.
 */
function history(w: World) {
  const r = w.repo('work');
  const tooOld = r.commit(370 * DAY);
  const year = r.commit(200 * DAY);
  const theirs = r.commit(100 * DAY, { email: OTHER });
  // A merge of mine, 50 days ago.
  r.git('checkout', '-q', '-b', 'side');
  const sideTip = r.commit(51 * DAY);
  r.git('checkout', '-q', 'main');
  const at = `@${String(w.nowS() - 50 * DAY)} +0000`;
  execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'merge-zq', 'side'], {
    cwd: r.path,
    env: {
      ...w.env,
      GIT_AUTHOR_NAME: 'Dev',
      GIT_AUTHOR_EMAIL: ME,
      GIT_COMMITTER_NAME: 'Dev',
      GIT_COMMITTER_EMAIL: ME,
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: at,
    },
    stdio: 'pipe',
  });
  const merge = r.git('rev-parse', 'HEAD').trim();
  const home = r.commit(40 * DAY, { email: ME2 });
  const month = r.commit(30 * DAY);
  // Before sharing was on, but inside today's snapshot window.
  const beforeOn = r.commit(10 * DAY);
  // Since sharing went on: the snapshot's, pushed.
  const afterOn = r.commit(2 * 3600);
  r.push();
  // Not on any remote.
  const unpushed = r.commit(60 * DAY);
  // A .mailmap claiming someone else's commit for me changes nothing.
  writeFileSync(join(r.path, '.mailmap'), `Dev <${ME}> <${OTHER}>\n`);
  return { r, year, month, beforeOn, tooOld, theirs, home, sideTip, merge, afterOn, unpushed };
}

void describe('laika activity backfill', () => {
  void test('sends one-way keys for my pushed commits of the last 365 days, by author day, and nothing else', async () => {
    const w = await world();
    const h = history(w);
    assert.equal(await w.run('backfill', '--yes'), 0, w.err.join('\n'));
    assert.deepEqual(w.board.violations, []);

    const sent = w.lookbacks();
    assert.ok(sent.length >= 1, 'no look-back report was sent');
    const byKey = new Map(
      sent.flatMap((p) =>
        p.days.flatMap((d) => (d.pushed_keys ?? []).map((k) => [k, d.day] as const)),
      ),
    );
    // 51 days ago: the side branch's commit is mine, pushed, and not a merge.
    assert.deepEqual(
      [...byKey.keys()].sort(),
      [h.year, h.month, h.beforeOn, h.sideTip].map(pushedKey).sort(),
    );
    assert.equal(byKey.get(pushedKey(h.year)), dayOf(w, 200 * DAY));
    assert.equal(byKey.get(pushedKey(h.beforeOn)), dayOf(w, 10 * DAY));

    // Never on the wire: SHAs, messages, paths, repo names, emails.
    const raw = w.board.requests.map((r) => `${r.url} ${r.body}`).join('\n');
    for (const secret of [
      h.year,
      h.merge,
      h.r.path,
      'work',
      w.home,
      ME,
      ME2,
      OTHER,
      'msg-',
      'merge-zq',
      'main',
    ]) {
      assert.ok(!raw.includes(secret), `sent: ${secret}`);
    }
  });

  void test('counts the extra emails set with `laika activity emails`', async () => {
    const w = await world();
    const h = history(w);
    assert.equal(await w.run('emails', ME2), 0);
    assert.equal(await w.run('backfill', '--yes'), 0, w.err.join('\n'));
    assert.ok(keysIn(w.lookbacks()).includes(pushedKey(h.home)));
    assert.ok(!keysIn(w.lookbacks()).includes(pushedKey(h.theirs)));
  });

  void test('prints the summary — commits, days, per month — and sends nothing unless the answer is y', async () => {
    const w = await world();
    history(w);
    w.answers.push('n');
    assert.equal(await w.run('backfill'), 0);
    assert.deepEqual(w.lookbacks(), [], 'sent without a yes');
    const text = w.out.join('\n');
    assert.match(text, /4 pushed commits on 4 days/);
    assert.match(text, new RegExp(`${dayOf(w, 200 * DAY).slice(0, 7)}\\s+1\\b`));
    assert.match(text, /\[y\/N\]/);
    assert.match(text, /Nothing sent/);

    w.out.length = 0;
    w.answers.push('y');
    assert.equal(await w.run('backfill'), 0, w.err.join('\n'));
    assert.equal(keysIn(w.lookbacks()).length, 4);
  });

  void test('answered N, nothing is sent — not now, and not by a later sync either', async () => {
    const w = await world();
    history(w);
    w.answers.push('n');
    assert.equal(await w.run('backfill'), 0);
    assert.deepEqual(w.lookbacks(), []);
    // The review's case: an hour later a background sync sent the declined commits.
    w.advance(3600);
    const outcome = await sync(w.ctx);
    assert.equal(outcome.kind, 'sent');
    assert.deepEqual(w.lookbacks(), [], 'a sync sent what was declined');
    assert.equal(outcome.kind === 'sent' ? outcome.lookback : undefined, undefined);
    w.advance(DAY);
    await sync(w.ctx);
    assert.deepEqual(w.lookbacks(), [], 'a later sync sent what was declined');
    assert.match(
      w.out.join('\n'),
      /The automatic look-back will not send these either; run `laika activity backfill` again to send them\./,
    );
  });

  void test('declined, then `backfill --yes`, sends — and the repo is done', async () => {
    const w = await world();
    const h = history(w);
    w.answers.push('n');
    assert.equal(await w.run('backfill'), 0);
    w.advance(3600);
    assert.equal(await w.run('backfill', '--yes'), 0, w.err.join('\n'));
    assert.deepEqual(
      keysIn(w.lookbacks()).sort(),
      [h.year, h.month, h.beforeOn, h.sideTip].map(pushedKey).sort(),
    );
    w.out.length = 0;
    assert.equal(await w.run('status'), 0);
    assert.match(w.out.join('\n'), /Look-back\s+done for 1 repo\b/);
  });

  void test('declined, then a narrower `backfill --yes`, sends that window and no more', async () => {
    const w = await world();
    const h = history(w);
    w.answers.push('n');
    assert.equal(await w.run('backfill'), 0);
    assert.equal(await w.run('backfill', '--days', '45', '--yes'), 0, w.err.join('\n'));
    assert.deepEqual(keysIn(w.lookbacks()).sort(), [h.month, h.beforeOn].map(pushedKey).sort());
    w.advance(3600);
    await sync(w.ctx);
    assert.deepEqual(
      keysIn(w.lookbacks()).sort(),
      [h.month, h.beforeOn].map(pushedKey).sort(),
      'the automatic look-back sent the year that was declined',
    );
  });

  void test('a decline stops a look-back still under way', async () => {
    const w = await world();
    history(w);
    assert.equal(await w.run('backfill', '--yes'), 0);
    // Straight after: paced, so this one is left as a job for the next sync.
    assert.equal(await w.run('backfill', '--yes'), 0);
    assert.match(w.out.join('\n'), /goes with the next sync/);
    const sent = w.lookbacks().length;
    w.answers.push('n');
    assert.equal(await w.run('backfill'), 0);
    w.advance(3600);
    await sync(w.ctx);
    assert.equal(w.lookbacks().length, sent, 'the job under way was sent after the no');
  });

  void test('--days narrows the window; 0, 366 and junk are refused', async () => {
    const w = await world();
    const h = history(w);
    assert.equal(await w.run('backfill', '--days', '45', '--yes'), 0, w.err.join('\n'));
    assert.deepEqual(keysIn(w.lookbacks()).sort(), [h.month, h.beforeOn].map(pushedKey).sort());
    for (const bad of ['0', '366', 'ten']) {
      w.err.length = 0;
      assert.equal(await w.run('backfill', '--days', bad, '--yes'), 1, bad);
      assert.match(w.err.join('\n'), /--days/);
    }
  });

  void test('a path given counts even if no session ran there; one that is not a repo is refused', async () => {
    const w = await world();
    const other = w.repo('elsewhere', false);
    const sha = other.commit(5 * DAY + 3600);
    other.push();
    // Not registered: no snapshot ever counted it, so even a commit since
    // sharing went on is the look-back's.
    const recent = other.commit(3600);
    other.push();
    assert.equal(await w.run('backfill', '--yes', other.path), 0, w.err.join('\n'));
    assert.deepEqual(keysIn(w.lookbacks()).sort(), [sha, recent].map(pushedKey).sort());

    w.err.length = 0;
    assert.equal(await w.run('backfill', '--yes', dir('laika-notrepo-')), 1);
    assert.match(w.err.join('\n'), /not a git repository/);
  });

  void test('run twice, the board holds the same keys at the same days', async () => {
    const w = await world();
    history(w);
    assert.equal(await w.run('backfill', '--yes'), 0);
    const once = [...w.board.keys].sort();
    w.advance(3600);
    assert.equal(await w.run('backfill', '--yes'), 0, w.err.join('\n'));
    assert.deepEqual([...w.board.keys].sort(), once);
    assert.equal(
      w.lookbacks().length,
      2,
      'the second run sent nothing at all — this proves nothing',
    );
  });

  void test('a commit counted local, then pushed, is counted once — never local and pushed', async () => {
    const w = await world();
    const r = w.repo('work');
    const sha = r.commit(3600);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    const day = dayOf(w, 3600);
    const collector = w.puts()[0]?.collector_id ?? '';
    assert.equal(w.board.snapshots.get(`${collector}|${day}`)?.commits_local, 1);

    r.push();
    assert.equal(await w.run('backfill', '--yes'), 0, w.err.join('\n'));
    assert.ok(
      !keysIn(w.lookbacks()).includes(pushedKey(sha)),
      'the look-back took the snapshot’s commit',
    );

    w.advance(600);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.equal(w.board.snapshots.get(`${collector}|${day}`)?.commits_local, 0);
    assert.equal(w.board.keys.get(pushedKey(sha)), day);
  });

  void test('waits for the sync lock, and refuses when activity is off here', async () => {
    const w = await world();
    history(w);
    const release = acquireLock(w.paths);
    assert.ok(release !== undefined);
    assert.equal(await w.run('backfill', '--yes'), 1);
    assert.match(w.err.join('\n'), /Another sync is running/);
    assert.deepEqual(w.lookbacks(), []);
    release();

    rmSync(w.paths.dir, { recursive: true, force: true });
    w.err.length = 0;
    assert.equal(await w.run('backfill', '--yes'), 1);
    assert.match(w.err.join('\n'), /laika activity on/);
  });

  void test('stops at the deadline with a hung git, and says so', { timeout: 10_000 }, async () => {
    const w = await world();
    history(w);
    const io: ActivityIo = {
      ...w.io,
      git: () => new Promise<string | undefined>(() => undefined),
      deadlineMs: 300,
    };
    assert.equal(await activity(['backfill', '--yes'], io), 1);
    assert.match(w.err.join('\n'), /did not finish within/);
    assert.deepEqual(w.lookbacks(), []);
  });

  void test('a board that refuses look-backs is told apart, asked again a day later, and nothing is lost', async () => {
    const w = await world();
    const h = history(w);
    w.board.put = { kind: 'unprocessable', reason: 'validation_failed' };
    assert.equal(await w.run('backfill', '--yes'), 1);
    assert.match(w.err.join('\n'), /does not take a look-back/);
    assert.equal(w.board.keys.size, 0);
    w.board.put = { kind: 'ok' };
    // Not at the next sync: a board that refused the shape is asked a day later.
    w.advance(600);
    const tried = w.lookbacks().length;
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.equal(w.lookbacks().length, tried, 'asked again at once');
    w.advance(DAY);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    for (const sha of [h.year, h.month, h.beforeOn, h.sideTip]) {
      assert.ok(w.board.keys.has(pushedKey(sha)), 'the job was not kept for a later sync');
    }
  });

  void test('a 403 local_activity_off during a backfill stops collecting, as a sync does', async () => {
    const w = await world();
    history(w);
    w.board.put = { kind: 'off' };
    assert.equal(await w.run('backfill', '--yes'), 1);
    assert.match(w.err.join('\n'), /sharing is off/);
    assert.equal(readState(w.paths)?.collect, false);
  });
});

void describe('the automatic look-back', () => {
  void test('a repo seen for the first time is looked back over once, after the snapshot', async () => {
    const w = await world();
    const h = history(w);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    const puts = w.puts();
    assert.equal(puts[0]?.lookback, undefined, 'the snapshot goes first');
    assert.deepEqual(
      keysIn(puts.slice(1)).sort(),
      [h.year, h.month, h.beforeOn, h.sideTip].map(pushedKey).sort(),
    );
    assert.ok(keysIn(puts.slice(0, 1)).includes(pushedKey(h.afterOn)), 'the snapshot’s own key');
    assert.ok(!keysIn(puts.slice(1)).includes(pushedKey(h.afterOn)));

    // Recorded: it never repeats, whatever is pushed later.
    const lookbackFile = join(w.paths.dir, 'lookback.json');
    assert.equal(statSync(lookbackFile).mode & 0o777, 0o600);
    assert.ok(!readFileSync(lookbackFile, 'utf8').includes(ME), 'emails do not belong in it');
    h.r.commit(90 * DAY);
    h.r.push();
    w.advance(600);
    const before = w.lookbacks().length;
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.equal(w.lookbacks().length, before, 'the look-back ran again');
  });

  void test('a repo registered later gets its own, and days its snapshots never covered count', async () => {
    // Sharing on for two months: the first repo's look-back is done at once.
    const w = await world({ sinceAgo: 60 * DAY });
    // Known before the first look-back: taken to have been counted since
    // sharing went on, so a commit since then is the snapshots' — however old.
    const first = w.repo('first');
    const countedBySnapshots = first.commit(30 * DAY);
    first.push();
    assert.equal((await sync(w.ctx)).kind, 'sent');
    const done = w.lookbacks().length;
    assert.ok(!keysIn(w.lookbacks()).includes(pushedKey(countedBySnapshots)));

    const later = w.repo('later');
    const beforeItsWindow = later.commit(30 * DAY); // after sharing went on
    const inItsWindow = later.commit(5 * DAY);
    later.push();
    w.advance(600);
    assert.equal((await sync(w.ctx)).kind, 'sent');
    assert.deepEqual(keysIn(w.lookbacks().slice(done)), [pushedKey(beforeItsWindow)]);
    const snapshot = w
      .puts()
      .filter((p) => p.lookback !== true)
      .at(-1);
    assert.ok(keysIn(snapshot === undefined ? [] : [snapshot]).includes(pushedKey(inItsWindow)));
  });

  void test(
    'a look-back stays inside the report bucket: big histories are chunked over syncs',
    { timeout: 120_000 },
    async () => {
      const w = await world();
      w.board.bucket.on = true;
      const r = w.repo('big');
      // 20,000 commits of mine over the last 365 days, through fast-import.
      const first = w.nowS() - 364 * DAY;
      const lines: string[] = [];
      for (let i = 0; i < 20_000; i += 1) {
        const at = first + Math.floor((i * 364 * DAY) / 20_000);
        lines.push(
          'commit refs/heads/main',
          `author Dev <${ME}> ${String(at)} +0000`,
          `committer Dev <${ME}> ${String(at)} +0000`,
          'data 2',
          'c\n',
        );
      }
      execFileSync('git', ['fast-import', '--quiet'], {
        cwd: r.path,
        input: `${lines.join('\n')}\n`,
        env: w.env,
      });
      r.git('reset', '-q', '--hard', 'main');
      r.push();

      const t0 = performance.now();
      const census = await countLookback({
        repos: [{ path: r.path }],
        extraEmails: [],
        days: 365,
        tz: TZ,
        nowS: w.nowS(),
        sinceS: w.nowS(),
        git: gitRunner(w.env),
      });
      const ms = performance.now() - t0;
      console.log(`look-back census of a 20,000-commit repo: ${ms.toFixed(0)} ms`);
      assert.equal(census.commits, 20_000);

      let runs = 0;
      for (; runs < 40; runs += 1) {
        const sent = w.lookbacks().length;
        const outcome = await sync(w.ctx);
        assert.equal(outcome.kind, 'sent', JSON.stringify(outcome));
        if (runs > 0 && w.lookbacks().length === sent) break;
        assert.ok(w.lookbacks().length - sent <= 4, 'more than 4 look-back reports in one sync');
        w.advance(600);
      }
      assert.deepEqual(w.board.violations, []);
      for (const req of w.board.requests) assert.ok(Buffer.byteLength(req.body) <= MAX_BODY_BYTES);
      assert.equal(w.board.bucket.limited, 0, 'the look-back tripped the report bucket');
      assert.equal(w.board.keys.size, 20_000);
      console.log(
        `delivered in ${String(w.lookbacks().length)} look-back reports over ${String(runs)} syncs`,
      );
    },
  );

  void test('a git failure in the look-back leaves the repo due, says so, and is retried after the backoff', async () => {
    const w = await world();
    const h = history(w);
    const real = gitRunner(w.env);
    let broken = true;
    let lookbackLogs = 0;
    // The look-back's log asks git for a year; the snapshot's for 45 days.
    const flaky: typeof real = (cwd, args) => {
      const since = args.find((a) => a.startsWith('--since=@'));
      if (since !== undefined && Number(since.slice(9)) < w.nowS() - 60 * DAY) {
        lookbackLogs += 1;
        if (broken) return Promise.resolve(undefined);
      }
      return real(cwd, args);
    };
    const ctx = { ...w.ctx, git: flaky };
    assert.equal((await sync(ctx)).kind, 'sent');
    assert.equal(lookbackLogs, 1);
    assert.deepEqual(w.lookbacks(), []);
    assert.match(readFileSync(w.paths.lastError, 'utf8'), /look-back/);
    const recorded = Object.values(
      (
        JSON.parse(readFileSync(join(w.paths.dir, 'lookback.json'), 'utf8')) as {
          repos: Record<string, { done_at?: number }>;
        }
      ).repos,
    );
    assert.ok(recorded.length > 0 && recorded.every((r) => r.done_at === undefined), 'marked done');

    // Failing again doubles the wait, as a sync's backoff does: 600 s, then 1200 s.
    w.advance(600);
    await sync(ctx);
    assert.equal(lookbackLogs, 2);
    w.advance(600);
    await sync(ctx);
    assert.equal(lookbackLogs, 2, 'retried before the backoff');

    broken = false;
    w.advance(600);
    await sync(ctx);
    assert.equal(lookbackLogs, 3);
    assert.deepEqual(
      keysIn(w.lookbacks()).sort(),
      [h.year, h.month, h.beforeOn, h.sideTip].map(pushedKey).sort(),
    );
    w.advance(600);
    await sync(ctx);
    assert.equal(lookbackLogs, 3, 'done, and yet looked back again');
  });

  void test('a backfill run straight after another waits for the bucket instead of spending it', async () => {
    const w = await world();
    w.board.bucket.on = true;
    history(w);
    assert.equal(await w.run('backfill', '--yes'), 0);
    const sent = w.lookbacks().length;
    for (let i = 0; i < 10; i += 1)
      assert.equal(await w.run('backfill', '--yes'), 0, w.err.join('\n'));
    assert.equal(w.lookbacks().length, sent, 'repeated runs kept sending');
    assert.match(w.out.join('\n'), /goes with the next sync/);
    assert.equal(w.board.bucket.limited, 0);
  });

  void test('status says how the look-back stands', async () => {
    const w = await world();
    history(w);
    await sync(w.ctx);
    w.out.length = 0;
    assert.equal(await w.run('status'), 0);
    assert.match(w.out.join('\n'), /Look-back\s+done for 1 repo\b/);
    assert.equal(readState(w.paths)?.collect, true);
  });
});

void describe('the census and its reports', () => {
  void test('a commit a snapshot counts in one clone is not the look-back’s in another', async () => {
    const w = await world();
    const known = w.repo('known');
    const sha = known.commit(3600);
    known.push();
    // A second clone of the same remote, given by hand: no snapshot counts it.
    const copy = join(w.home, 'copy');
    execFileSync('git', ['clone', '-q', join(w.home, 'known.git'), copy], {
      env: w.env,
      stdio: 'pipe',
    });
    execFileSync('git', ['-C', copy, 'config', 'user.email', ME], { env: w.env, stdio: 'pipe' });
    const census = await countLookback({
      repos: [{ path: known.path, snapshotFrom: dayOf(w, 13 * DAY) }, { path: copy }],
      extraEmails: [],
      days: 365,
      tz: TZ,
      nowS: w.nowS(),
      sinceS: w.nowS() - DAY,
      git: gitRunner(w.env),
    });
    assert.ok(!(census.byDay.get(dayOf(w, 3600)) ?? []).includes(pushedKey(sha)));
    assert.equal(census.commits, 0);
  });

  void test('a commit copied with its authorship (a cherry-pick, a rebase) counts once', async () => {
    const w = await world();
    const r = w.repo('work');
    r.commit(20 * DAY);
    r.git('checkout', '-q', '-b', 'copy');
    const original = r.commit(10 * DAY);
    r.git('checkout', '-q', 'main');
    execFileSync('git', ['cherry-pick', '--allow-empty', '--keep-redundant-commits', original], {
      cwd: r.path,
      env: { ...w.env, GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: ME },
      stdio: 'pipe',
    });
    r.push();
    execFileSync('git', ['push', '-q', 'origin', 'copy'], {
      cwd: r.path,
      env: w.env,
      stdio: 'pipe',
    });
    const census = await countLookback({
      repos: [{ path: r.path }],
      extraEmails: [],
      days: 365,
      tz: TZ,
      nowS: w.nowS(),
      sinceS: w.nowS(),
      git: gitRunner(w.env),
    });
    assert.equal(census.byDay.get(dayOf(w, 10 * DAY))?.length, 1);
    assert.equal(census.commits, 2);
  });

  void test('a day too big for one report is split; every key goes once, no report over 16 KB', () => {
    const big = Array.from({ length: 2500 }, (_, i) => i.toString(16).padStart(16, '0'));
    const byDay = new Map([
      ['2026-01-01', ['ffffffffffffffaa']],
      ['2026-01-02', big],
      ['2026-01-03', ['ffffffffffffffbb']],
    ]);
    const reports = lookbackReports({
      collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      tz: TZ,
      byDay,
      through: '',
    });
    assert.ok(reports.length >= 3, String(reports.length));
    const seen: string[] = [];
    for (const report of reports) {
      assert.ok(
        Buffer.byteLength(report.body) <= MAX_BODY_BYTES,
        String(Buffer.byteLength(report.body)),
      );
      const days = (JSON.parse(report.body) as Put).days.map((d) => d.day);
      assert.equal(new Set(days).size, days.length, 'a day twice in one report');
      seen.push(...keysIn([JSON.parse(report.body) as Put]));
    }
    assert.equal(seen.length, 2502);
    assert.equal(new Set(seen).size, 2502);
    // The cursor only passes a day once all of it is out.
    assert.deepEqual(
      reports.map((r) => r.through),
      [...reports.slice(1).map(() => '2026-01-01'), '2026-01-03'],
    );
    // And a resumed job sends nothing it has passed.
    const resumed = lookbackReports({
      collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      tz: TZ,
      byDay,
      through: '2026-01-02',
    });
    assert.deepEqual(keysIn(resumed.map((r) => JSON.parse(r.body) as Put)), ['ffffffffffffffbb']);
  });

  void test(
    'a look-back still under way when the deadline nears stops itself; the snapshot stands',
    { timeout: 30_000 },
    async () => {
      const w = await world();
      history(w);
      const real = gitRunner(w.env);
      // The deadline is 10 s, so no new look-back report starts after 7.5 s.
      // The look-back's own log (it asks git for a year; the snapshot asks for
      // 45 days) answers only once that point has passed, however loaded the
      // machine — so its census finishes past the soft stop, before the hard one.
      const deadlineMs = 10_000;
      const started = Date.now();
      const slowLookback: typeof real = async (cwd, args) => {
        const since = args.find((a) => a.startsWith('--since=@'));
        if (since !== undefined && Number(since.slice(9)) < w.nowS() - 60 * DAY) {
          const wait = started + deadlineMs * 0.75 + 300 - Date.now();
          if (wait > 0) await new Promise((res) => setTimeout(res, wait));
        }
        return real(cwd, args);
      };
      const outcome = await sync({ ...w.ctx, git: slowLookback, deadlineMs });
      assert.equal(outcome.kind, 'sent', JSON.stringify(outcome));
      assert.ok(Date.now() - started < deadlineMs, 'the hard deadline was reached');
      assert.equal(w.puts().length, 1, 'the snapshot was not sent');
      assert.deepEqual(w.lookbacks(), [], 'a look-back report started past the soft stop');
      assert.equal(readState(w.paths)?.failures, 0, 'the run was counted as failed');
    },
  );
});
