/**
 * The checkpoint helper's review fixes (LAI-547, Codex review of #154), each
 * reproduced against a real board and a real bare remote before it was fixed.
 * One test per finding, named for it.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import * as checkpoint from '../src/agent-checkpoint.ts';
import {
  activityPath,
  autoCheckpoint,
  inflight,
  markInflight,
  writeActivity,
} from '../src/agent-checkpoint.ts';
import { credentialPath, readProc, readState, statePath, UNKNOWN } from '../src/agent-session.ts';
import { type Bench, HOOK_ENTRY, HS, sleep, startBench } from './support/checkpoint-board.ts';

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

  void test("P1-1: a remote whose default cannot be told is refused (fail closed)", () => {
    const repo = b.freshRepo('p11b');
    b.git(repo.remote, 'symbolic-ref', 'HEAD', 'refs/heads/nothing-here');
    const before = b.remoteRefs(repo);
    writeFileSync(join(repo.wt, 'app.ts'), 'export const a = 102;\n');

    const r = b.cli(repo.wt, ['checkpoint', 'save']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /cannot tell origin's default branch/);
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
    for (const leaked of ['aws-sekrit-value', 'gh-sekrit-value', 'app-sekrit-value', b.seeded.agentToken]) {
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
        if (phase === 'quiet') markInflight(b.home, 'claude-code', HS, 'toolu_late', harnessOwner());
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
    const release = checkpoint.takeSaveInterlock(b.home, 'claude-code', HS, harnessOwner());
    const startedAt = Date.now();
    const hook = new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [HOOK_ENTRY, 'hook', 'pre-tool', 'claude-code'], {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: { PATH: process.env.PATH ?? '', HOME: b.home },
      });
      child.stdin.end(JSON.stringify({ session_id: HS, tool_name: 'Edit', tool_use_id: 'toolu_w' }));
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

    // A tool whose PostToolUse never came (it failed) is cleared at Stop: the turn is over.
    markInflight(b.home, 'claude-code', HS, 'toolu_failed', harnessOwner());
    execFileSync(process.execPath, [HOOK_ENTRY, 'hook', 'stop', 'claude-code'], {
      input: JSON.stringify({ session_id: HS }),
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
      assert.match(r.out, new RegExp(`Checkpoint ${String(first.id)} registered on the board — Verification pending`));
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
        (JSON.parse(readFileSync(activityPath(b.home, 'claude-code', HS), 'utf8')) as {
          mutations: number;
        }).mutations,
        0,
      );
    } finally {
      b.credentialAt(b.board.url);
      await b.consent(false);
    }
  });
});
