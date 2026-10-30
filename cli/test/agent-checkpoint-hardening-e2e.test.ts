/**
 * The checkpoint helper's review fixes (LAI-547, Codex review of #154), each
 * reproduced against a real board and a real bare remote before it was fixed.
 * One test per finding, named for it.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import * as checkpoint from '../src/agent-checkpoint.ts';
import {
  activityPath,
  autoCheckpoint,
  clearInflight,
  inflight,
  markInflight,
  writeActivity,
} from '../src/agent-checkpoint.ts';
import { credentialPath, readProc, readState, statePath, UNKNOWN } from '../src/agent-session.ts';
import {
  type Bench,
  HOOK_ENTRY,
  HS,
  type Repo,
  sleep,
  startBench,
} from './support/checkpoint-board.ts';

let b: Bench;

before(async () => {
  b = await startBench();
});

after(async () => {
  await (b as Bench | undefined)?.stop();
});

const creds = (): { url: string; token: string } => ({
  url: b.board.url,
  token: b.seeded.agentToken,
});

/** The harness process the session is bound to: this test process. */
function harnessOwner(): { pid: number; started: string } {
  const state = readState(statePath(b.home, 'claude-code', HS));
  assert.ok(state !== undefined);
  return { pid: state.harness_pid, started: state.harness_started };
}

function clearInflightDir(): void {
  rmSync(join(b.home, '.laika', 'agent-checkpoints', 'inflight'), {
    recursive: true,
    force: true,
  });
}

/** A ULID-free Laika token, assembled so this file never holds the shape. */
const laikaToken = (): string => `${'lai'}_${'A1b2C3d4E5'.repeat(4)}`;

void describe('checkpoint review fixes (LAI-547, #154)', () => {
  void test("P1-1: the remote's CURRENT default branch is refused, whatever the clone cached", () => {
    const repo = b.freshRepo('p11');
    // The remote's default moves to the task branch after the clone cached `master`.
    b.git(repo.remote, 'branch', 'LAI-547-p11', 'master');
    b.git(repo.remote, 'symbolic-ref', 'HEAD', 'refs/heads/LAI-547-p11');
    const before = b.remoteRefs(repo);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 101;\n');

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-p11 is a protected branch/);
    assert.deepEqual(b.remoteRefs(repo), before, 'nothing pushed');
  });

  void test('P1-1: a remote whose default cannot be told is refused (fail closed)', () => {
    const repo = b.freshRepo('p11b');
    b.git(repo.remote, 'symbolic-ref', 'HEAD', 'refs/heads/nothing-here');
    const before = b.remoteRefs(repo);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 102;\n');

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /cannot tell the default branch of origin's push destination/);
    assert.deepEqual(b.remoteRefs(repo), before, 'nothing pushed');
  });

  void test('P1-2: push.followTags=true never carries another tag into a checkpoint push', () => {
    const repo = b.freshRepo('p12');
    b.git(repo.clone, 'config', 'push.followTags', 'true');
    b.git(repo.clone, 'tag', '-a', 'v-private', '-m', 'not for the remote', 'master');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 103;\n');

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 0, r.out);
    const record = b.newestRecord();
    assert.equal(b.remoteRefs(repo).has('refs/tags/v-private'), false, 'the annotated tag stayed');
    assert.deepEqual(b.pushesReceived(repo), [['refs/heads/LAI-547-p12'], [record.tag_ref]]);
  });

  void test('P1-3: by default only tracked changes are saved; a new file only when listed', () => {
    const repo = b.freshRepo('p13');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 104;\n');
    writeFileSync(join(repo.wt, 'new.ts'), 'export const n = 1;\n');
    writeFileSync(join(repo.wt, 'scratch.txt'), 'notes\n');

    let r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 0, r.out);
    assert.equal(b.git(repo.wt, 'ls-tree', '--name-only', 'HEAD', 'new.ts'), '', 'not committed');
    assert.equal(b.git(repo.wt, 'show', 'HEAD:app.ts'), 'export const a = 104;');
    assert.deepEqual(
      (b.newestRecord().manifest as { path: string }[]).map((m) => m.path),
      ['app.ts'],
    );

    r = b.cli(repo.wt, ['checkpoint', 'save', '--file', 'new.ts']);
    assert.equal(r.code, 0, r.out);
    assert.equal(b.git(repo.wt, 'ls-tree', '--name-only', 'HEAD', 'new.ts'), 'new.ts');
    assert.equal(b.git(repo.wt, 'ls-tree', '--name-only', 'HEAD', 'scratch.txt'), '');
  });

  void test("P1-4: Laika's own token is refused in a file and in a note", () => {
    const repo = b.freshRepo('p14');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    writeFileSync(join(repo.wt, 'app.ts'), `export const t = '${laikaToken()}';\n`);
    let r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /app\.ts \(looks like it holds a Laika token\)/);

    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 105;\n');
    r = b.cli(repo.wt, ['checkpoint', 'note'], JSON.stringify({ work_done: laikaToken() }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /note\.work_done looks like it holds a Laika token/);
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head);
  });

  void test("P1-5: no git call the helper makes runs the repo's fsmonitor", () => {
    const repo = b.freshRepo('p15');
    const ran = join(repo.root, 'fsmonitor-ran');
    const script = join(repo.root, 'fsmonitor.sh');
    writeFileSync(script, `#!/bin/sh\ntouch '${ran}'\nexit 1\n`);
    chmodSync(script, 0o755);
    b.git(repo.clone, 'config', 'core.fsmonitor', script);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 106;\n');
    rmSync(ran, { force: true });

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 0, r.out);
    assert.equal(existsSync(ran), false, 'the fsmonitor hook never ran');
  });

  void test("P1-6: git's children see an allowlisted environment — no cloud key, no GitHub or Laika token", () => {
    const repo = b.freshRepo('p16');
    const dump = join(repo.root, 'receive-pack-env');
    const script = join(repo.root, 'receive-pack.sh');
    writeFileSync(script, `#!/bin/sh\nenv > '${dump}'\nexec git receive-pack "$@"\n`);
    chmodSync(script, 0o755);
    b.git(repo.clone, 'config', 'remote.origin.receivepack', script);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 107;\n');

    const r = b.cli(repo.wt, ['checkpoint', 'save'], '', {
      AWS_SECRET_ACCESS_KEY: 'aws-sekrit-value',
      GH_TOKEN: 'gh-sekrit-value',
      SOME_APP_PASSWORD: 'app-sekrit-value',
      LAIKA_AGENT_TOKEN: b.seeded.agentToken,
      LAIKA_AGENT_URL: b.board.url,
    });
    assert.equal(r.code, 0, r.out);
    const env = readFileSync(dump, 'utf8');
    assert.match(env, /^PATH=/m, 'the dump ran');
    for (const leaked of [
      'aws-sekrit-value',
      'gh-sekrit-value',
      'app-sekrit-value',
      b.seeded.agentToken,
    ]) {
      assert.equal(env.includes(leaked), false, `${leaked.slice(0, 8)}… reached git's child`);
    }
  });

  void test('P1-7: a tool that starts after the quiet check stops the save before it stages', async () => {
    const repo = b.freshRepo('p17');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 108;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });

    const deps = {
      ...b.engine(),
      onPhase: (phase: string) => {
        if (phase === 'quiet')
          markInflight(b.home, 'claude-code', HS, 'toolu_late', harnessOwner());
      },
    };
    assert.equal(await autoCheckpoint(deps, 'claude-code', HS, creds(), 1000), 'busy');
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head, 'no commit');
    assert.equal(b.git(repo.wt, 'diff', '--cached', '--name-only'), '', 'nothing staged');
    clearInflightDir();
    await b.consent(false);
  });

  void test('P1-7: a tool that starts while the save stages stops it before the commit, and the index is put back', async () => {
    const repo = b.freshRepo('p17b');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 112;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    let staged = '';
    const deps = {
      ...b.engine(),
      onPhase: (phase: string) => {
        if (phase !== 'staged') return;
        staged = b.git(repo.wt, 'diff', '--cached', '--name-only');
        markInflight(b.home, 'claude-code', HS, 'toolu_mid', harnessOwner());
      },
    };
    assert.equal(await autoCheckpoint(deps, 'claude-code', HS, creds(), 1000), 'busy');
    assert.equal(staged, 'app.ts', 'it had staged');
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head, 'no commit');
    assert.equal(b.git(repo.wt, 'diff', '--cached', '--name-only'), '', 'the index is put back');
    assert.equal(b.git(repo.wt, 'diff', '--name-only'), 'app.ts', 'the work is untouched');
    clearInflightDir();
    await b.consent(false);
  });

  void test('P1-7: PreToolUse waits while a save holds the interlock', async () => {
    clearInflightDir();
    const release = checkpoint.takeSaveInterlock(b.home, 'claude-code', HS);
    const startedAt = Date.now();
    const hook = new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [HOOK_ENTRY, 'hook', 'pre-tool', 'claude-code'], {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: { PATH: process.env.PATH ?? '', HOME: b.home },
      });
      child.stdin.end(
        JSON.stringify({ session_id: HS, tool_name: 'Edit', tool_use_id: 'toolu_w' }),
      );
      child.on('close', () => resolve(Date.now() - startedAt));
    });
    await sleep(1500);
    release();
    const took = await hook;
    assert.ok(took >= 1400, `the hook waited for the save (${String(took)} ms)`);
    clearInflightDir();
  });

  void test('P1-8: a marker is a running tool while its harness lives, whatever its age; stale once it is dead', async () => {
    const repo = b.freshRepo('p18');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 109;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');

    // An hour old, its harness alive: still running.
    markInflight(b.home, 'claude-code', HS, 'toolu_long', harnessOwner());
    const dir = join(b.home, '.laika', 'agent-checkpoints', 'inflight');
    const { readdirSync } = await import('node:fs');
    for (const sub of readdirSync(dir)) {
      for (const name of readdirSync(join(dir, sub))) {
        const old = new Date(Date.now() - 3_600_000);
        utimesSync(join(dir, sub, name), old, old);
      }
    }
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    assert.equal(await autoCheckpoint(b.engine(), 'claude-code', HS, creds(), 600), 'busy');
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head);
    clearInflightDir();

    // Fresh, but its harness is dead: stale.
    const child = spawn('/bin/sleep', ['1']);
    await sleep(200);
    const proc = readProc(child.pid ?? 0);
    assert.ok(proc !== undefined && proc !== UNKNOWN, 'read the short-lived process');
    await new Promise((r) => child.on('close', r));
    markInflight(b.home, 'claude-code', HS, 'toolu_dead', { pid: proc.pid, started: proc.started });
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    assert.equal(await autoCheckpoint(b.engine(), 'claude-code', HS, creds(), 600), 'saved');
    clearInflightDir();

    // A tool whose PostToolUse never came is cleared at a Stop that lists
    // no background task: the turn is over and nothing of it still runs.
    markInflight(b.home, 'claude-code', HS, 'toolu_failed', harnessOwner());
    execFileSync(process.execPath, [HOOK_ENTRY, 'hook', 'stop', 'claude-code'], {
      input: JSON.stringify({ session_id: HS, background_tasks: [] }),
      env: { PATH: process.env.PATH ?? '', HOME: b.home },
    });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'Stop cleared the markers');
    await b.consent(false);
  });

  void test('P2-9: `save` on a pushed but unregistered checkpoint registers it, same key, and says so', async () => {
    b.credentialAt(b.proxyUrl);
    try {
      const repo = b.freshRepo('p29');
      writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 110;\n');
      b.setProxy('fail-register');
      let r = await b.cliAsync(repo.wt, ['checkpoint', 'save']);
      assert.equal(r.code, 1, r.out);
      const first = b.newestRecord();
      const records = b.recordCount();

      b.setProxy('pass');
      r = await b.cliAsync(repo.wt, ['checkpoint', 'save']);
      assert.equal(r.code, 0, r.out);
      assert.match(
        r.out,
        new RegExp(`Checkpoint ${String(first.id)} registered on the board — Verification pending`),
      );
      assert.equal(b.recordCount(), records, 'no second checkpoint');
      assert.equal(b.newestRecord().stage, 'registered');
      assert.equal(b.newestRecord().idempotency_key, first.idempotency_key);
      assert.equal((await b.boardCheckpoints()).filter((c) => c.id === first.id).length, 1);
    } finally {
      b.setProxy('pass');
      b.credentialAt(b.board.url);
    }
  });

  void test("P2-10: an automatic save uses the credential it was handed, not the disk's or the env's", async () => {
    const repo = b.freshRepo('p210');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 111;\n');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    // Logged in by the environment only: no credential file on disk.
    rmSync(credentialPath(b.home, 'claude-code'), { force: true });
    try {
      assert.equal(await autoCheckpoint(b.engine(), 'claude-code', HS, creds(), 600), 'saved');
      const record = b.newestRecord();
      assert.equal(b.remoteRefs(repo).get(String(record.tag_ref)), record.commit_sha);
      assert.equal(record.stage, 'registered');
      assert.equal(
        (
          JSON.parse(readFileSync(activityPath(b.home, 'claude-code', HS), 'utf8')) as {
            mutations: number;
          }
        ).mutations,
        0,
      );
    } finally {
      b.credentialAt(b.board.url);
      await b.consent(false);
    }
  });
});

/** Run one hook the way the harness does: its JSON on stdin; resolves with its stdout and when it ended. */
function runHook(
  event: string,
  input: Record<string, unknown>,
  harness = 'claude-code',
): Promise<{ stdout: string; endedAt: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK_ENTRY, 'hook', event, harness], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: process.env.PATH ?? '', HOME: b.home },
    });
    let stdout = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    // A hook may stop reading early (its input is capped) and exit: the
    // harness then sees a broken pipe, which is not the hook's failure.
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ session_id: HS, ...input }));
    child.on('close', () => resolve({ stdout, endedAt: Date.now() }));
  });
}

const denied = (stdout: string): boolean => {
  try {
    const out = JSON.parse(stdout) as {
      hookSpecificOutput?: { hookEventName?: string; permissionDecision?: string };
    };
    return (
      out.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
      out.hookSpecificOutput.permissionDecision === 'deny'
    );
  } catch {
    return false;
  }
};

void describe('checkpoint review fixes, round 2 (LAI-547, #154 at 2e401f3c)', () => {
  /** A second bare repo to push to, whose HEAD names `head` (or nothing). */
  function pushTarget(repoRoot: string, name: string, clone: string, head?: string): string {
    const target = join(repoRoot, `${name}.git`);
    b.git(repoRoot, 'init', '-q', '--bare', '-b', 'master', target);
    b.git(clone, 'push', '-q', target, 'master');
    if (head !== undefined) {
      if (head !== 'master') b.git(target, 'branch', head, 'master');
      b.git(target, 'symbolic-ref', 'HEAD', `refs/heads/${head}`);
    } else {
      b.git(target, 'symbolic-ref', 'HEAD', 'refs/heads/nothing-here');
    }
    return target;
  }

  void test('R2-1: a pushurl whose default branch is the task branch is refused, whatever the fetch URL says', () => {
    const repo = b.freshRepo('r21');
    const target = pushTarget(repo.root, 'push', repo.clone, 'LAI-547-r21');
    b.git(repo.clone, 'config', 'remote.origin.pushurl', target);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 201;\n');
    const before = b.git(repo.clone, 'ls-remote', target);

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-r21 is a protected branch/);
    assert.equal(b.git(repo.clone, 'ls-remote', target), before, 'nothing pushed to the pushurl');
  });

  void test('R2-1: every pushurl is asked; one whose default cannot be told is refused', () => {
    const repo = b.freshRepo('r21b');
    const good = pushTarget(repo.root, 'good', repo.clone, 'master');
    const unknown = pushTarget(repo.root, 'unknown', repo.clone);
    b.git(repo.clone, 'config', '--add', 'remote.origin.pushurl', good);
    b.git(repo.clone, 'config', '--add', 'remote.origin.pushurl', unknown);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 202;\n');
    const before = b.git(repo.clone, 'ls-remote', good);

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /cannot tell the default branch of .*unknown\.git/);
    assert.equal(b.git(repo.clone, 'ls-remote', good), before, 'nothing pushed to either');
  });

  void test('R2-1: a pushurl with a sane default is pushed to (the positive control)', () => {
    const repo = b.freshRepo('r21c');
    const target = pushTarget(repo.root, 'push', repo.clone, 'master');
    b.git(repo.clone, 'config', 'remote.origin.pushurl', target);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 203;\n');

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 0, r.out);
    const record = b.newestRecord();
    assert.match(b.git(repo.clone, 'ls-remote', target), new RegExp(String(record.tag_ref)));
  });

  void test('R2-2: a delayed commit keeps PreToolUse waiting until the interlock is released', async () => {
    const repo = b.freshRepo('r22');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 204;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });

    let hook: Promise<{ stdout: string; endedAt: number }> | undefined;
    let releasedAt = 0;
    const deps = {
      ...b.engine(),
      onPhase: async (phase: string) => {
        if (phase === 'staged') {
          // Codex's probe: a tool arrives while the save is slow to commit.
          hook = runHook('pre-tool', { tool_name: 'Edit', tool_use_id: 'toolu_r22' });
          await sleep(6000);
        }
        if (phase === 'released') releasedAt = Date.now();
      },
    };
    assert.equal(await autoCheckpoint(deps, 'claude-code', HS, creds(), 1000), 'busy');
    assert.ok(hook !== undefined);
    const { stdout, endedAt } = await hook;
    assert.ok(releasedAt > 0, 'the interlock was released');
    assert.ok(
      endedAt >= releasedAt || denied(stdout),
      `PreToolUse let the tool go ${String(releasedAt - endedAt)} ms before the save let go`,
    );
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head, 'the tool stopped the save');
    clearInflightDir();
    await b.consent(false);
  });

  void test('R2-2: a save past its time budget aborts cleanly before it commits', async () => {
    const repo = b.freshRepo('r22b');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 205;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    const index = b.git(repo.wt, 'write-tree');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    const deps = {
      ...b.engine(),
      saveBudgetMs: 1500,
      onPhase: async (phase: string) => {
        if (phase === 'staged') await sleep(2500);
      },
    };
    assert.equal(await autoCheckpoint(deps, 'claude-code', HS, creds(), 1000), 'busy');
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head, 'no commit');
    assert.equal(b.git(repo.wt, 'write-tree'), index, 'the index is as it was');
    assert.equal(checkpoint.interlockHeld(b.home, 'claude-code', HS), false, 'and let go');
    await b.consent(false);
  });

  void test('R2-2: an interlock still held past its deadline makes PreToolUse deny the tool', async () => {
    clearInflightDir();
    const release = checkpoint.takeSaveInterlock(b.home, 'claude-code', HS, { budgetMs: 500 });
    try {
      const startedAt = Date.now();
      const { stdout, endedAt } = await runHook('pre-tool', {
        tool_name: 'Bash',
        tool_use_id: 'toolu_r22c',
      });
      assert.ok(denied(stdout), `PreToolUse did not deny: ${stdout}`);
      assert.ok(endedAt - startedAt >= 400, 'it waited for the deadline first');
      assert.equal(inflight(b.home, 'claude-code', HS), 0, 'a denied tool leaves no marker');
    } finally {
      release();
    }
  });

  void test('R2-3: an aborted save restores the index exactly, partial staging included', async () => {
    const repo = b.freshRepo('r23');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 206;\n');
    b.git(repo.wt, 'add', 'app.ts');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 207;\n');
    const staged = b.git(repo.wt, 'rev-parse', ':app.ts');
    const index = b.git(repo.wt, 'write-tree');
    assert.notEqual(staged, b.git(repo.wt, 'rev-parse', 'HEAD:app.ts'), 'partially staged');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    const deps = {
      ...b.engine(),
      onPhase: (phase: string) => {
        if (phase === 'staged')
          markInflight(b.home, 'claude-code', HS, 'toolu_r23', harnessOwner());
      },
    };
    assert.equal(await autoCheckpoint(deps, 'claude-code', HS, creds(), 1000), 'busy');
    assert.equal(b.git(repo.wt, 'rev-parse', ':app.ts'), staged, 'the staged blob is back');
    assert.equal(b.git(repo.wt, 'write-tree'), index, 'the whole index is as it was');
    assert.equal(readFileSync(join(repo.wt, 'app.ts'), 'utf8'), 'export const a = 207;\n');
    clearInflightDir();
    await b.consent(false);
  });

  void test('R2-4: Stop clears no marker while a background task runs, and only finished main-turn markers once none does', async () => {
    // The documented payload (code.claude.com/docs/en/hooks#stop-input):
    // entries are { id, type, status, description, command? }.
    const shell = (status: string) => ({
      id: 'task-001',
      type: 'shell',
      status,
      description: 'tail logs',
      command: 'tail -f /var/log/syslog',
    });
    clearInflightDir();
    markInflight(b.home, 'claude-code', HS, 'toolu_live', harnessOwner());
    markInflight(b.home, 'claude-code', HS, 'toolu_done', harnessOwner());
    await runHook('stop', { background_tasks: [shell('running')] });
    assert.equal(
      inflight(b.home, 'claude-code', HS),
      3,
      'a running task: nothing cleared, and the task itself is marked',
    );

    // A status nobody documented is not taken as finished.
    await runHook('stop', { background_tasks: [shell('paused')] });
    assert.equal(inflight(b.home, 'claude-code', HS), 3, 'an unknown status clears nothing');

    // Every entry finished: the main turn's markers are finished tools.
    await runHook('stop', { background_tasks: [shell('completed')] });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'all terminal: cleared');

    // A Stop that does not say what still runs (Codex's) clears nothing live.
    markInflight(b.home, 'claude-code', HS, 'toolu_live', harnessOwner());
    await runHook('stop', {}, 'codex');
    await runHook('stop', {});
    assert.equal(inflight(b.home, 'claude-code', HS), 1, 'no background_tasks: nothing cleared');

    // An empty list is "nothing in flight": a finished turn's markers go.
    await runHook('stop', { background_tasks: [] });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'an empty list clears them');

    // A subagent's tool is not the main turn's: the main Stop leaves it, and
    // its PreToolUse records the subagent from the harness's agent_id.
    await runHook('pre-tool', { tool_name: 'Bash', tool_use_id: 'toolu_sub', agent_id: 'agent_1' });
    assert.equal(inflight(b.home, 'claude-code', HS), 1, 'the subagent tool is marked');
    await runHook('stop', { background_tasks: [] });
    assert.equal(inflight(b.home, 'claude-code', HS), 1, 'the main Stop leaves a subagent tool');
    await runHook('tool', { tool_name: 'Bash', tool_use_id: 'toolu_sub', agent_id: 'agent_1' });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'its own PostToolUse clears it');

    // A failed tool clears its own marker (Claude Code's PostToolUseFailure).
    markInflight(b.home, 'claude-code', HS, 'toolu_failed2', harnessOwner());
    await runHook('tool-failed', { tool_name: 'Bash', tool_use_id: 'toolu_failed2' });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'PostToolUseFailure cleared it');
    clearInflightDir();
  });

  void test('R2-5: an interlock whose PID was reused is taken over; a live holder is respected', async () => {
    clearInflightDir();
    const dir = checkpoint.inflightDir(b.home, 'claude-code', HS);
    mkdirSync(dir, { recursive: true });
    // This process's PID, alive — but with a start time that is not its own.
    writeFileSync(
      join(dir, '.saving'),
      JSON.stringify({ pid: process.pid, started_ms: 1_000_000, deadline: Date.now() + 600_000 }),
    );
    assert.equal(
      checkpoint.interlockHeld(b.home, 'claude-code', HS),
      false,
      'a reused PID holds nothing',
    );
    // The same through the process table, as the hook sees another process:
    // a live PID whose start time is not the holder's holds nothing either.
    const other = spawn('/bin/sleep', ['30']);
    try {
      await sleep(200);
      const live = readProc(other.pid ?? 0);
      assert.ok(live !== undefined && live !== UNKNOWN, 'read the other process');
      const started = Date.parse(live.started.trim());
      writeFileSync(
        join(dir, '.saving'),
        JSON.stringify({
          pid: other.pid,
          started_ms: started - 3_600_000,
          deadline: Date.now() + 600_000,
        }),
      );
      assert.equal(checkpoint.interlockHeld(b.home, 'claude-code', HS), false, 'reused, by ps');
      writeFileSync(
        join(dir, '.saving'),
        JSON.stringify({ pid: other.pid, started_ms: started, deadline: Date.now() + 600_000 }),
      );
      assert.equal(
        checkpoint.interlockHeld(b.home, 'claude-code', HS),
        true,
        'its own start: held',
      );
      rmSync(join(dir, '.saving'), { force: true });
    } finally {
      other.kill();
    }
    const release = checkpoint.takeSaveInterlock(b.home, 'claude-code', HS);
    try {
      assert.throws(
        () => checkpoint.takeSaveInterlock(b.home, 'claude-code', HS),
        (e: unknown) => e instanceof Error && e.message.includes('holds this session'),
        'the real holder is respected',
      );
      assert.equal(checkpoint.interlockHeld(b.home, 'claude-code', HS), true);
    } finally {
      release();
    }
    assert.equal(checkpoint.interlockHeld(b.home, 'claude-code', HS), false);
  });
});

void describe('checkpoint review fixes, round 3 (LAI-547, #154 at d79523e3)', () => {
  /** A bare repo's refs read in the repo itself: no URL, so no rewrite can redirect the reading. */
  const refsOf = (bare: string): string =>
    b.git(bare, 'for-each-ref', '--format=%(objectname) %(refname)');
  /**
   * A remote reached through URL rewriting. The clone's origin becomes
   * `alias:<name>`, rewritten once (as `git push` does) to the repo's own
   * remote A. A second rule rewrites A's path to another bare repo B — the
   * place a second rewrite would wrongly send a check. A's HEAD is the task
   * branch (a push there is a push to its default); B's is master.
   */
  function rewritten(name: string, tie: boolean): { repo: Repo; a: string; b: string } {
    const repo = b.freshRepo(name);
    const a = repo.remote;
    const other = join(repo.root, `${tie ? 'tie' : 'other'}-b.git`);
    b.git(repo.root, 'init', '-q', '--bare', '-b', 'master', other);
    b.git(repo.clone, 'push', '-q', other, 'master');
    b.git(a, 'branch', `LAI-547-${name}`, 'master');
    b.git(a, 'symbolic-ref', 'HEAD', `refs/heads/LAI-547-${name}`);
    b.git(repo.clone, 'config', 'remote.origin.url', `alias:${name}`);
    b.git(repo.clone, 'config', `url.${a}.insteadOf`, `alias:${name}`);
    if (tie) {
      // A rule whose value is A exactly: it ties with any override, and wins.
      b.git(repo.clone, 'config', `url.${other}.insteadOf`, a);
    } else {
      // A shorter prefix of A: `…/remote.git` becomes `…/other-b.git`.
      b.git(
        repo.clone,
        'config',
        `url.${join(repo.root, 'other-b')}.insteadOf`,
        join(repo.root, 'remote'),
      );
    }
    return { repo, a, b: other };
  }

  void test('R3-1: chained insteadOf — the check asks the repo the push reaches, not a second rewrite of it', () => {
    const { repo, a, b: other } = rewritten('r31', false);
    // The instrument: a plain ls-remote of A really does land on B here.
    assert.match(
      b.git(repo.clone, 'ls-remote', '--symref', '--', a, 'HEAD'),
      /^ref: refs\/heads\/master\tHEAD/,
      'git rewrites the destination a second time',
    );
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 301;\n');
    const before = [refsOf(other), refsOf(repo.remote)];

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-r31 is a protected branch/);
    assert.deepEqual([refsOf(other), refsOf(repo.remote)], before, 'nothing pushed anywhere');
  });

  void test('R3-1: a rule naming the destination exactly cannot be overridden, so it is refused', () => {
    const { repo, b: other } = rewritten('r31b', true);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 302;\n');
    const before = [refsOf(other), refsOf(repo.remote)];

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /an insteadOf rule names it exactly/);
    assert.deepEqual([refsOf(other), refsOf(repo.remote)], before, 'nothing pushed anywhere');
  });

  void test('R3-1: pushInsteadOf wins over insteadOf for a push, and that is the repo checked', () => {
    const repo = b.freshRepo('r31c');
    const fetchSide = join(repo.root, 'fetch-side.git');
    b.git(repo.root, 'init', '-q', '--bare', '-b', 'master', fetchSide);
    b.git(repo.clone, 'push', '-q', fetchSide, 'master');
    b.git(repo.remote, 'branch', 'LAI-547-r31c', 'master');
    b.git(repo.remote, 'symbolic-ref', 'HEAD', 'refs/heads/LAI-547-r31c');
    b.git(repo.clone, 'config', 'remote.origin.url', 'alias:r31c');
    b.git(repo.clone, 'config', `url.${repo.remote}.pushInsteadOf`, 'alias:r31c');
    b.git(repo.clone, 'config', `url.${fetchSide}.insteadOf`, 'alias:r31c');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 303;\n');
    const before = refsOf(repo.remote);

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-r31c is a protected branch/);
    assert.deepEqual(refsOf(repo.remote), before, 'nothing pushed');
  });

  void test('R3-1: through a rewrite whose destination is sane, the save reaches it (the positive control)', () => {
    const { repo, a, b: other } = rewritten('r31d', false);
    b.git(a, 'symbolic-ref', 'HEAD', 'refs/heads/master');
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 304;\n');
    const otherBefore = refsOf(other);

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 0, r.out);
    const record = b.newestRecord();
    assert.ok(
      refsOf(a).includes(`${String(record.commit_sha)} ${String(record.tag_ref)}`),
      'the tag is in A',
    );
    assert.equal(refsOf(other), otherBefore, 'and B is untouched');
  });

  void test('R3-2: the documented running shell task keeps every live marker at Stop', async () => {
    clearInflightDir();
    markInflight(b.home, 'claude-code', HS, 'toolu_r32', harnessOwner());
    await runHook('stop', {
      background_tasks: [{ id: 'task-001', type: 'shell', status: 'running' }],
    });
    assert.ok(inflight(b.home, 'claude-code', HS) >= 1, 'the live marker survived Stop');
    // And an automatic save waits for that task rather than racing it.
    clearInflight(b.home, 'claude-code', HS, 'toolu_r32');
    assert.equal(inflight(b.home, 'claude-code', HS), 1, 'the running task itself is marked');
    clearInflightDir();
  });
});

void describe('checkpoint review fixes, round 4 (LAI-547, #154 at 84c4ebc2)', () => {
  const refsOf = (bare: string): string =>
    b.git(bare, 'for-each-ref', '--format=%(objectname) %(refname)');

  /**
   * origin pushes to the relative local path `A.git` (resolved, as a push
   * resolves it, from the worktree), a bare repo whose HEAD is the task
   * branch. B's HEAD is master. With `named`, a remote called `A.git` points
   * at B — so `ls-remote A.git` would read the remote name and ask B.
   */
  function relativePush(name: string, named: boolean): { repo: Repo; a: string; other: string } {
    const repo = b.freshRepo(name);
    const a = join(repo.wt, 'A.git');
    const other = join(repo.root, 'B.git');
    for (const bare of [a, other]) {
      b.git(repo.root, 'init', '-q', '--bare', '-b', 'master', bare);
      b.git(repo.clone, 'push', '-q', bare, 'master');
    }
    b.git(a, 'branch', `LAI-547-${name}`, 'master');
    b.git(a, 'symbolic-ref', 'HEAD', `refs/heads/LAI-547-${name}`);
    b.git(repo.clone, 'config', 'remote.origin.pushurl', 'A.git');
    if (named) b.git(repo.clone, 'config', 'remote.A.git.url', other);
    return { repo, a, other };
  }

  void test('R4-1: a destination that is also a configured remote name is refused, never read as that remote', () => {
    const { repo, a, other } = relativePush('r41', true);
    // The instrument: ls-remote really does read `A.git` as the remote and ask B.
    assert.match(
      b.git(repo.wt, 'ls-remote', '--symref', '--', 'A.git', 'HEAD'),
      /^ref: refs\/heads\/master\tHEAD/,
    );
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 401;\n');
    const before = [refsOf(a), refsOf(other)];

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /is also the name of a configured remote/);
    assert.deepEqual([refsOf(a), refsOf(other)], before, 'nothing pushed anywhere');
  });

  void test('R4-1: a relative local path is asked as the absolute repo the push reaches', () => {
    const { repo, a, other } = relativePush('r41b', false);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 402;\n');
    const before = [refsOf(a), refsOf(other)];

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-r41b is a protected branch/);
    assert.deepEqual([refsOf(a), refsOf(other)], before, 'nothing pushed');
  });

  void test('R4-1: a remote named only in a legacy .git/remotes file cannot catch a local path either', () => {
    // Not in the config, so the name refusal cannot see it: the absolute
    // file:// URL is what keeps `ls-remote` from reading `A.git` as it.
    const { repo, a, other } = relativePush('r41c', false);
    mkdirSync(join(repo.clone, '.git', 'remotes'), { recursive: true });
    writeFileSync(join(repo.clone, '.git', 'remotes', 'A.git'), `URL: ${other}\n`);
    assert.match(
      b.git(repo.wt, 'ls-remote', '--symref', '--', 'A.git', 'HEAD'),
      /^ref: refs\/heads\/master\tHEAD/,
      'git reads the legacy remote',
    );
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 403;\n');
    const before = [refsOf(a), refsOf(other)];

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-r41c is a protected branch/);
    assert.deepEqual([refsOf(a), refsOf(other)], before, 'nothing pushed anywhere');
  });

  void test('R4-2: every background task is read — 200 finished and 1 running keep the live marker', async () => {
    clearInflightDir();
    markInflight(b.home, 'claude-code', HS, 'toolu_r42', harnessOwner());
    const tasks = [
      ...Array.from({ length: 200 }, (_, i) => ({
        id: `task-${String(i)}`,
        type: 'shell',
        status: 'completed',
      })),
      { id: 'task-200', type: 'shell', status: 'running' },
    ];
    await runHook('stop', { background_tasks: tasks });
    assert.ok(inflight(b.home, 'claude-code', HS) >= 1, 'the 201st, running, kept the marker');

    // The cap is explicit, and the list is really read up to it: 1000
    // finished tasks (well past the ~23–70 KB a non-blocking stdin gave up
    // at) are judged and clear the markers; 1001 are past the cap and,
    // unjudged, clear nothing.
    const finished = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `task-${String(i)}`,
        type: 'shell',
        status: 'completed',
        description: 'a finished task, described at some length',
      }));
    assert.ok(JSON.stringify(finished(1000)).length > 70_000, 'the list is past the old read');
    await runHook('stop', { background_tasks: finished(1000) });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, '1000 finished: read, judged, cleared');
    markInflight(b.home, 'claude-code', HS, 'toolu_r42b', harnessOwner());
    await runHook('stop', { background_tasks: finished(1001) });
    assert.equal(inflight(b.home, 'claude-code', HS), 1, 'past the cap: nothing cleared');
    clearInflightDir();
  });

  void test('R4-2: a hook reads its whole input — a large PostToolUse clears its marker; past 4 MB, nothing is read', async () => {
    clearInflightDir();
    markInflight(b.home, 'claude-code', HS, 'toolu_big', harnessOwner());
    await runHook('tool', {
      tool_name: 'Read',
      tool_use_id: 'toolu_big',
      tool_response: { content: 'x'.repeat(200_000) },
    });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'a 200 KB input was read and cleared it');

    markInflight(b.home, 'claude-code', HS, 'toolu_huge', harnessOwner());
    await runHook('tool', {
      tool_name: 'Read',
      tool_use_id: 'toolu_huge',
      tool_response: { content: 'x'.repeat(5 * 1024 * 1024) },
    });
    assert.equal(inflight(b.home, 'claude-code', HS), 1, 'past the 4 MB read: nothing done');
    clearInflightDir();
  });
});

void describe('checkpoint review fixes, round 5 (LAI-547, #154 at 3405354c)', () => {
  const refsOf = (bare: string): string =>
    b.git(bare, 'for-each-ref', '--format=%(objectname) %(refname)');

  /** A hook through the real entry, the harness named by PID, its stdin left as `stdin` says. */
  function rawHook(
    event: string,
    write: (stdin: NodeJS.WritableStream) => void,
  ): Promise<{ stdout: string; ms: number }> {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(process.execPath, [HOOK_ENTRY, 'hook', event, 'claude-code'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { PATH: process.env.PATH ?? '', HOME: b.home, LAIKA_AGENT_HARNESS_PID: String(process.pid) },
      });
      let stdout = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      child.stdin.on('error', () => undefined);
      write(child.stdin);
      child.on('close', () => {
        child.stdin.destroy();
        resolve({ stdout, ms: Date.now() - started });
      });
    });
  }

  const fiveMegabyteWrite = (stdin: NodeJS.WritableStream): void => {
    stdin.end(
      JSON.stringify({
        session_id: HS,
        tool_name: 'Write',
        tool_use_id: 'toolu_r53',
        tool_input: { file_path: '/x', content: 'x'.repeat(5 * 1024 * 1024) },
      }),
    );
  };

  void test('R5-1: a destination through a symlink and .. is asked where the filesystem, and git, take it', () => {
    const repo = b.freshRepo('r51');
    // link -> real/sub, so link/../A.git is real/A.git on disk, and ./A.git on paper.
    mkdirSync(join(repo.wt, 'real', 'sub'), { recursive: true });
    const physical = join(repo.wt, 'real', 'A.git');
    const lexical = join(repo.wt, 'A.git');
    for (const bare of [physical, lexical]) {
      b.git(repo.root, 'init', '-q', '--bare', '-b', 'master', bare);
      b.git(repo.clone, 'push', '-q', bare, 'master');
    }
    b.git(physical, 'branch', 'LAI-547-r51', 'master');
    b.git(physical, 'symbolic-ref', 'HEAD', 'refs/heads/LAI-547-r51');
    symlinkSync(join('real', 'sub'), join(repo.wt, 'link'));
    b.git(repo.clone, 'config', 'remote.origin.pushurl', 'link/../A.git');
    // The instrument: git itself reaches the physical repo.
    assert.match(
      b.git(repo.wt, 'ls-remote', '--symref', '--', 'link/../A.git', 'HEAD'),
      /^ref: refs\/heads\/LAI-547-r51\tHEAD/,
    );
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 501;\n');
    const before = [refsOf(physical), refsOf(lexical)];

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /LAI-547-r51 is a protected branch/);
    assert.deepEqual([refsOf(physical), refsOf(lexical)], before, 'nothing pushed anywhere');
  });

  void test('R5-2: a list too long to judge leaves a session marker that holds saves off until a readable Stop', async () => {
    const repo = b.freshRepo('r52');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    const running = Array.from({ length: 1001 }, (_, i) => ({
      id: `task-${String(i)}`,
      type: 'shell',
      status: 'running',
    }));
    await runHook('stop', { background_tasks: running });
    assert.ok(inflight(b.home, 'claude-code', HS) >= 1, 'an unjudged list is marked');

    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 502;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    assert.equal(await autoCheckpoint(b.engine(), 'claude-code', HS, creds(), 600), 'busy');
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head, 'no save went through');

    await runHook('stop', { background_tasks: [] });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'a readable, empty list clears it');
    await b.consent(false);
  });

  void test('R5-3: a PreToolUse whose input cannot be read (5 MB) still marks the tool, through the real entry', async () => {
    const repo = b.freshRepo('r53');
    await b.consent(true);
    await b.beat();
    clearInflightDir();
    const { stdout } = await rawHook('pre-tool', fiveMegabyteWrite);
    assert.equal(denied(stdout), false, 'no save holds the interlock: not denied');
    assert.ok(inflight(b.home, 'claude-code', HS) >= 1, 'a conservative marker was written');

    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 503;\n');
    const head = b.git(repo.wt, 'rev-parse', 'HEAD');
    writeActivity(b.home, 'claude-code', HS, { mutations: 3, cwd: repo.wt });
    assert.equal(await autoCheckpoint(b.engine(), 'claude-code', HS, creds(), 600), 'busy');
    assert.equal(b.git(repo.wt, 'rev-parse', 'HEAD'), head, 'no save ran beside it');

    await runHook('stop', { background_tasks: [] });
    assert.equal(inflight(b.home, 'claude-code', HS), 0, 'the next readable Stop clears it');
    await b.consent(false);
  });

  void test('R5-3: an unreadable PreToolUse while a save holds the interlock is denied', async () => {
    clearInflightDir();
    const release = checkpoint.takeSaveInterlock(b.home, 'claude-code', HS, { budgetMs: 500 });
    try {
      const { stdout } = await rawHook('pre-tool', fiveMegabyteWrite);
      assert.ok(denied(stdout), `not denied: ${stdout.slice(0, 200)}`);
      assert.equal(inflight(b.home, 'claude-code', HS), 0, 'a denied tool leaves no marker');
    } finally {
      release();
    }
  });

  void test('R5-4: a writer that never closes stdin cannot hold the hook past its read deadline', async () => {
    clearInflightDir();
    const { ms } = await rawHook('pre-tool', (stdin) => {
      stdin.write('{"session_id":'); // and never ends
    });
    assert.ok(ms < 8000, `the hook returned after ${String(ms)} ms`);
    assert.ok(inflight(b.home, 'claude-code', HS) >= 1, 'and, unable to read, it marked the tool');
    clearInflightDir();
  });
});
