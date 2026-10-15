/**
 * Counting commits for the activity heatmap, on real repositories (LAI-752).
 *
 * Every scenario the research found a trap in (`/tmp/laika-heatmap-research/
 * REPORT.md` B11) is built with real git against a bare remote, under a
 * temporary HOME with no global or system git config — so nothing on the
 * machine running the test can change what git prints.
 *
 * Days are in Africa/Johannesburg (UTC+2, no DST), and every commit carries an
 * explicit author and committer date, so the expected day of each one is
 * fixed rather than whatever the clock says.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  addDays,
  authorIdentity,
  buildSnapshot,
  countCommits,
  gitRunner,
  hasLaikaBlock,
  LAIKA_BLOCK_MARKER,
  localDay,
  pushedKey,
  windowDays,
  type CommitCensus,
  type GitRunner,
  type SentMemory,
} from '../src/activity-census.ts';
import { activityPaths, writeState, type ActivityState } from '../src/activity-store.ts';

const TZ = 'Africa/Johannesburg';
/** 2026-10-15 10:00 in Johannesburg. */
const NOW = Date.UTC(2026, 9, 15, 8, 0, 0) / 1000;
const TODAY = localDay(NOW, TZ);
const DAY = 86_400;
const ME = 'me@example.test';

const scratch: string[] = [];
after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const root = mkdtempSync(join(tmpdir(), 'laika-census-'));
scratch.push(root);
const HOME = join(root, 'home');
mkdirSync(HOME);

/** git with no global or system config: only what each test sets. */
const ENV: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: join(HOME, 'no-global-gitconfig'),
  TZ: 'UTC',
};

function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...ENV, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

let tick = 0;
/** An empty commit authored at `at` by `email`, committed at `committed` (default: `at`). */
function commit(
  cwd: string,
  options: { at: number; email?: string; committed?: number; message?: string },
): string {
  tick += 1;
  const email = options.email ?? ME;
  // Distinct seconds: two commits by one author in one second share an identity.
  const at = options.at + tick;
  git(cwd, ['commit', '-q', '--allow-empty', '-m', options.message ?? `c${String(tick)}`], {
    GIT_AUTHOR_NAME: 'Dev',
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: `@${String(at)} +0000`,
    GIT_COMMITTER_NAME: 'Dev',
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: `@${String(options.committed ?? at)} +0000`,
  });
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

/** Midday, `daysAgo` days before today, Johannesburg time. */
const dayAt = (daysAgo: number): number => NOW - daysAgo * DAY;
const dayOf = (daysAgo: number): string => addDays(TODAY, -daysAgo);

function newRemote(name: string): string {
  const path = join(root, `${name}.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', path], { env: ENV });
  return path;
}

function clone(remote: string, name: string, email = ME): string {
  const path = join(root, name);
  execFileSync('git', ['clone', '-q', remote, path], { env: ENV, stdio: 'pipe' });
  git(path, ['config', 'user.email', email]);
  git(path, ['config', 'user.name', 'Dev']);
  git(path, ['checkout', '-q', '-B', 'main']);
  return path;
}

const NOTHING_SENT: SentMemory = { keys: new Set(), identities: new Set() };
const DAYS = windowDays(NOW, TZ);

async function census(
  repos: readonly string[],
  options: { sent?: SentMemory; extra?: string[]; since?: number; git?: GitRunner } = {},
) {
  return countCommits({
    repos,
    extraEmails: options.extra ?? [],
    days: DAYS,
    tz: TZ,
    nowS: NOW,
    sinceS: options.since ?? 0,
    sent: options.sent ?? NOTHING_SENT,
    git: options.git ?? gitRunner(ENV),
  });
}

const keysOn = (c: CommitCensus, daysAgo: number): string[] =>
  (c.pendingByDay.get(dayOf(daysAgo)) ?? []).map((p) => p.key);

void describe('days', () => {
  void test('the window is today and the 13 days before it, oldest first', () => {
    assert.equal(DAYS.length, 14);
    assert.equal(DAYS[13], TODAY);
    assert.equal(DAYS[0], addDays(TODAY, -13));
    assert.equal(TODAY, '2026-10-15');
  });

  void test('a day is the machine zone’s calendar day, not UTC’s', () => {
    // 23:30 UTC on the 14th is 01:30 on the 15th in Johannesburg.
    const late = Date.UTC(2026, 9, 14, 23, 30) / 1000;
    assert.equal(localDay(late, 'UTC'), '2026-10-14');
    assert.equal(localDay(late, TZ), '2026-10-15');
  });

  void test('the key is the contract’s: 16 hex of sha256("laika-commit:" + sha)', () => {
    // Computed independently with shasum for this exact input.
    const sha = 'a'.repeat(40);
    const expected = execFileSync('shasum', ['-a', '256'], { input: `laika-commit:${sha}` })
      .toString()
      .slice(0, 16);
    assert.equal(pushedKey(sha), expected);
    assert.match(pushedKey(sha), /^[0-9a-f]{16}$/);
  });
});

void describe('pushed and unpushed', () => {
  const remote = newRemote('basic');
  const work = clone(remote, 'basic-work');
  const pushed = commit(work, { at: dayAt(3) });
  git(work, ['push', '-q', 'origin', 'main']);
  const local = commit(work, { at: dayAt(1) });

  void test('a commit on a remote is a pushed key on its author day', async () => {
    const c = await census([work]);
    assert.deepEqual(keysOn(c, 3), [pushedKey(pushed)]);
  });

  void test('a commit on no remote is commits_local on its author day', async () => {
    const c = await census([work]);
    assert.equal(c.local.get(dayOf(1)), 1);
    assert.ok(
      !c.pending.some((p) => p.key === pushedKey(local)),
      'an unpushed commit sent as pushed',
    );
  });

  void test('a pushed commit authored before sharing was turned on is not reported', async () => {
    const c = await census([work], { since: dayAt(2) });
    assert.deepEqual(keysOn(c, 3), [], 'pushed work from before the consent was sent');
    const d = await census([work], { since: dayAt(4) });
    assert.deepEqual(keysOn(d, 3), [pushedKey(pushed)]);
  });

  void test('a key the board already has is not sent again', async () => {
    const c = await census([work], {
      sent: { keys: new Set([pushedKey(pushed)]), identities: new Set() },
    });
    assert.deepEqual(keysOn(c, 3), []);
  });
});

void describe('author date, not committer date', () => {
  const remote = newRemote('dates');
  const work = clone(remote, 'dates-work');
  // Authored six days ago, committed (rebased) now.
  commit(work, { at: dayAt(6), committed: NOW });
  // Authored twenty days ago — outside the window — committed now.
  commit(work, { at: dayAt(20), committed: NOW });
  // Committed long ago by the clock, authored inside the window.
  commit(work, { at: dayAt(2), committed: dayAt(40) });

  void test('each commit is counted on its author day, and only inside the window', async () => {
    const c = await census([work]);
    assert.equal(c.local.get(dayOf(6)), 1, 'counted on the committer day instead');
    assert.equal(
      c.local.get(dayOf(2)),
      1,
      'a wide --since must still reach a commit with an old committer date',
    );
    const total = [...c.local.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 2, 'a commit authored 20 days ago was counted');
  });
});

void describe('amend after push', () => {
  const remote = newRemote('amend');
  const work = clone(remote, 'amend-work');
  const original = commit(work, { at: dayAt(2) });
  git(work, ['push', '-q', 'origin', 'main']);
  // Amend keeps the author date; the new SHA exists only locally.
  git(work, ['commit', '-q', '--amend', '--allow-empty', '-m', 'amended'], {
    GIT_COMMITTER_DATE: `@${String(NOW)} +0000`,
  });
  const amended = git(work, ['rev-parse', 'HEAD']).trim();

  void test('the amended copy is not counted as local work — it is the pushed commit again', async () => {
    assert.notEqual(amended, original);
    const c = await census([work]);
    assert.equal(c.local.get(dayOf(2)) ?? 0, 0, 'amend after push double counted as local');
    assert.deepEqual(keysOn(c, 2), [pushedKey(original)]);
  });

  void test('once force-pushed, the amended key is not sent if the original was', async () => {
    git(work, ['push', '-q', '--force', 'origin', 'main']);
    const sent: SentMemory = {
      keys: new Set([pushedKey(original)]),
      identities: new Set([
        authorIdentity(ME, Number(git(work, ['log', '-1', '--format=%at']).trim())),
      ]),
    };
    const c = await census([work], { sent });
    assert.deepEqual(keysOn(c, 2), [], 'the same work counted twice on the board');
    assert.equal(c.local.get(dayOf(2)) ?? 0, 0);
  });
});

void describe('squash merge, then fetch --prune', () => {
  const remote = newRemote('squash');
  const work = clone(remote, 'squash-work');
  commit(work, { at: dayAt(9) });
  git(work, ['push', '-q', 'origin', 'main']);
  git(work, ['checkout', '-q', '-b', 'feature']);
  const f1 = commit(work, { at: dayAt(5) });
  const f2 = commit(work, { at: dayAt(4) });
  git(work, ['push', '-q', 'origin', 'feature']);

  // While the remote branch existed, a sync saw F1 and F2 as pushed. Then
  // somebody squash-merges the PR on the server and deletes the branch.
  let seen: CommitCensus | undefined;
  let sent: SentMemory = NOTHING_SENT;
  let squash = '';
  before(async () => {
    seen = await census([work]);
    sent = {
      keys: new Set(seen.pending.map((p) => p.key)),
      identities: new Set(seen.pending.map((p) => p.identity)),
    };
    const other = clone(remote, 'squash-other');
    git(other, ['merge', '-q', '--squash', 'origin/feature']);
    squash = commit(other, { at: dayAt(1), message: 'squash' });
    git(other, ['push', '-q', 'origin', 'main']);
    git(other, ['push', '-q', 'origin', '--delete', 'feature']);
    git(work, ['fetch', '-q', '--prune']);
  });

  void test('before the merge, the feature commits were pushed keys', () => {
    assert.ok(seen !== undefined);
    assert.deepEqual(keysOn(seen, 5), [pushedKey(f1)]);
    assert.deepEqual(keysOn(seen, 4), [pushedKey(f2)]);
  });

  void test('after the prune they are not counted again as local work', async () => {
    const c = await census([work], { sent });
    assert.equal(c.local.get(dayOf(5)) ?? 0, 0, 'shipped work came back as local');
    assert.equal(c.local.get(dayOf(4)) ?? 0, 0);
    assert.deepEqual(keysOn(c, 1), [pushedKey(squash)]);
  });

  void test('without that memory they would be — which is why the keys are remembered', async () => {
    const c = await census([work]);
    assert.equal(c.local.get(dayOf(5)), 1);
    assert.equal(c.local.get(dayOf(4)), 1);
  });
});

void describe('whose commits', () => {
  const remote = newRemote('people');
  const work = clone(remote, 'people-work');
  commit(work, { at: dayAt(3), email: ME });
  commit(work, { at: dayAt(3), email: 'second@example.test' });
  commit(work, { at: dayAt(3), email: 'stranger@example.test' });
  commit(work, { at: dayAt(3), email: 'mapped@example.test' });
  // A .mailmap that would make the stranger's and another's commits "mine".
  writeFileSync(
    join(work, '.mailmap'),
    `Dev <${ME}> <mapped@example.test>\nDev <${ME}> <stranger@example.test>\n`,
  );
  git(work, ['add', '.mailmap']);
  commit(work, { at: dayAt(2), email: ME });

  void test('the repo’s user.email counts; a mailmap cannot add anyone else', async () => {
    const c = await census([work]);
    assert.equal(c.local.get(dayOf(3)), 1, 'mailmap widened the count');
    assert.equal(c.local.get(dayOf(2)), 1);
  });

  void test('a second email from `laika activity emails` counts too, exactly', async () => {
    const c = await census([work], { extra: ['Second@Example.test'] });
    assert.equal(c.local.get(dayOf(3)), 2);
  });

  void test('emails match whole, not as a substring', async () => {
    const c = await census([work], { extra: ['ond@example.test'] });
    assert.equal(c.local.get(dayOf(3)), 1);
  });
});

void describe('worktrees, no remote, deleted repos', () => {
  const remote = newRemote('trees');
  const work = clone(remote, 'trees-work');
  commit(work, { at: dayAt(5) });
  git(work, ['push', '-q', 'origin', 'main']);
  const tree = join(root, 'trees-wt');
  git(work, ['worktree', 'add', '-q', '-b', 'side', tree]);
  commit(tree, { at: dayAt(2) });

  const solo = join(root, 'solo');
  mkdirSync(solo);
  git(solo, ['init', '-q', '-b', 'main']);
  git(solo, ['config', 'user.email', ME]);
  commit(solo, { at: dayAt(4) });
  commit(solo, { at: dayAt(4) });

  void test('a repo and its worktree are counted once', async () => {
    const c = await census([work, tree]);
    assert.equal(c.local.get(dayOf(2)), 1, 'a worktree double counted its repo');
  });

  void test('a repo with no remote: every commit of mine is local', async () => {
    const c = await census([solo]);
    assert.equal(c.local.get(dayOf(4)), 2);
    assert.equal(c.pending.length, 0);
  });

  void test('a deleted repo counts nothing and does not stop the others', async () => {
    const gone = join(root, 'gone');
    mkdirSync(gone);
    git(gone, ['init', '-q', '-b', 'main']);
    rmSync(gone, { recursive: true, force: true });
    const c = await census([gone, solo]);
    assert.equal(c.local.get(dayOf(4)), 2);
  });

  void test('unpushed work from before collection started is not this collector’s', async () => {
    const c = await census([solo], { since: dayAt(3) });
    assert.equal(c.local.get(dayOf(4)) ?? 0, 0);
  });
});

void describe('the snapshot', () => {
  const remote = newRemote('snap');
  const work = clone(remote, 'snap-work');
  git(work, ['checkout', '-q', '-b', 'branch-name-zq9']);
  commit(work, { at: dayAt(3), message: 'commit message zq9' });
  git(work, ['push', '-q', 'origin', 'branch-name-zq9']);
  writeFileSync(join(work, 'file-name-zq9.txt'), 'x\n');
  git(work, ['add', 'file-name-zq9.txt']);
  commit(work, { at: dayAt(1), message: 'another message zq9' });

  const home = join(root, 'snap-home');
  const paths = activityPaths(home);
  mkdirSync(paths.dir, { recursive: true });
  const state: ActivityState = {
    collect: true,
    next_sync_at: 0,
    org_enabled: true,
    enabled: true,
    scope: 'agent-repos',
    min_sync_interval_s: 600,
    since: NOW - 30 * DAY,
    checked_at: NOW,
    failures: 0,
  };
  writeState(paths, state);
  const gone = join(root, 'snap-gone');
  writeFileSync(
    paths.repos,
    `${String(NOW - DAY)}\t${work}\n${String(NOW - DAY)}\t${gone}\n${String(NOW - 40 * DAY)}\t${work}-old\n`,
  );
  writeFileSync(
    paths.events,
    `p claude-code ${String(dayAt(1))}\np copilot ${String(dayAt(1))}\ns codex ${String(dayAt(1))}\ngarbage line\n`,
  );

  const snapshot = (scope: ActivityState['scope']) =>
    buildSnapshot({
      paths,
      state: { ...state, scope },
      collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      tz: TZ,
      nowS: NOW,
      extraEmails: [],
      git: gitRunner(ENV),
    });

  void test('fourteen days, every one present, counts where they happened', async () => {
    const s = await snapshot('agent-repos');
    assert.equal(s.body.days.length, 14);
    const yesterday = s.body.days.find((d) => d.day === dayOf(1));
    assert.deepEqual(yesterday, {
      day: dayOf(1),
      prompts: { 'claude-code': 1, other: 1 },
      sessions: 1,
      commits_local: 1,
      pushed_keys: [],
    });
    assert.equal(s.body.days.find((d) => d.day === dayOf(3))?.pushed_keys.length, 1);
  });

  void test('an agent the contract does not name is sent as `other`', async () => {
    const s = await snapshot('agent-repos');
    const kinds = s.body.days.flatMap((d) => Object.keys(d.prompts));
    assert.ok(!kinds.includes('copilot'));
  });

  void test('a deleted or expired repo is dropped from the remembered list', async () => {
    const s = await snapshot('agent-repos');
    assert.equal(s.prunedRepos, `${String(NOW - DAY)}\t${work}\n`);
  });

  void test('laika-repos counts only a repo carrying the Connect block', async () => {
    assert.equal(
      (await snapshot('laika-repos')).body.days.find((d) => d.day === dayOf(1))?.commits_local,
      0,
    );
    writeFileSync(
      join(work, 'AGENTS.md'),
      `# Notes\n\n## Laika\n\n${LAIKA_BLOCK_MARKER} Mirror work onto it.\n`,
    );
    assert.ok(await hasLaikaBlock(work));
    assert.equal(
      (await snapshot('laika-repos')).body.days.find((d) => d.day === dayOf(1))?.commits_local,
      1,
    );
  });

  void test('nothing on the contract’s never-sent list is in the body', async () => {
    const raw = JSON.stringify((await snapshot('agent-repos')).body);
    const head = git(work, ['rev-parse', 'HEAD']).trim();
    const secrets = [
      work,
      'snap-work',
      remote,
      'branch-name-zq9',
      'file-name-zq9',
      'message zq9',
      ME,
      head,
    ];
    for (const secret of secrets) {
      assert.ok(!raw.includes(secret), `the body carries ${secret}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Review round 1                                                             */
/* -------------------------------------------------------------------------- */

void describe('merge commits (review 1, item 7)', () => {
  const solo = join(root, 'merges');
  mkdirSync(solo);
  git(solo, ['init', '-q', '-b', 'main']);
  git(solo, ['config', 'user.email', ME]);
  commit(solo, { at: dayAt(5) });
  git(solo, ['checkout', '-q', '-b', 'side']);
  commit(solo, { at: dayAt(4) });
  git(solo, ['checkout', '-q', 'main']);
  commit(solo, { at: dayAt(4) });
  const mergedAt = dayAt(3);
  git(solo, ['merge', '-q', '--no-ff', 'side', '-m', 'merge side'], {
    GIT_AUTHOR_NAME: 'Dev',
    GIT_AUTHOR_EMAIL: ME,
    GIT_AUTHOR_DATE: `@${String(mergedAt)} +0000`,
    GIT_COMMITTER_NAME: 'Dev',
    GIT_COMMITTER_EMAIL: ME,
    GIT_COMMITTER_DATE: `@${String(mergedAt)} +0000`,
  });

  void test('a merge commit of mine is not counted; the commits it joins are, once', async () => {
    assert.equal(git(solo, ['log', '-1', '--format=%p']).trim().split(' ').length, 2);
    const c = await census([solo]);
    assert.equal(c.local.get(dayOf(3)) ?? 0, 0, 'a merge was counted as work');
    assert.equal(c.local.get(dayOf(4)), 2);
    assert.equal(c.local.get(dayOf(5)), 1);
  });
});

void describe('older git (review 1, item 2)', () => {
  const a = join(root, 'old-git-a');
  const b = join(root, 'old-git-b');
  for (const repo of [a, b]) {
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', ME]);
    commit(repo, { at: dayAt(2) });
  }
  /**
   * git before 2.31: `rev-parse` does not know `--path-format=absolute`, prints
   * it back, and exits 0 — and `--git-common-dir` alone answers `.git`,
   * relative, for every repo. Everything else is the real git.
   */
  const real = gitRunner(ENV);
  const oldGit: GitRunner = (cwd, args) => {
    if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) {
      const echoed = args.filter((x) => x.startsWith('--path-format'));
      return Promise.resolve([...echoed, '.git'].join('\n') + '\n');
    }
    return real(cwd, args);
  };

  void test('two repos are two repos, even when rev-parse answers with a relative path', async () => {
    const c = await census([a, b], { git: oldGit });
    assert.equal(c.local.get(dayOf(2)), 2, 'every repo after the first was skipped');
  });

  void test('an answer that is not one plain path counts nothing rather than guessing', async () => {
    const garbage: GitRunner = (cwd, args) =>
      args[0] === 'rev-parse' ? Promise.resolve('--unknown\n.git\n') : real(cwd, args);
    const c = await census([a], { git: garbage });
    assert.equal(c.local.size, 0);
  });
});
