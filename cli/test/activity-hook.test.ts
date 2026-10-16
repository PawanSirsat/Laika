/**
 * `plugin/scripts/laika-activity-hook`, driven as the agents drive it
 * (LAI-752).
 *
 * Its contract is mostly about what it must not do, and none of it is visible
 * from outside a session: print (Claude Code feeds that to the model), fail
 * (exit 2 blocks the prompt in four agents), keep the prompt (every agent hands
 * it over), or cost time (it runs before every prompt). Each of those is
 * asserted here, under a temporary HOME, for both shells it can run under.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const HOOK = fileURLToPath(new URL('../../plugin/scripts/laika-activity-hook', import.meta.url));
const ZSH = existsSync('/bin/zsh') ? '/bin/zsh' : undefined;
const SHELLS: readonly (readonly string[])[] = [
  ['/bin/sh'],
  ...(ZSH === undefined ? [] : [[ZSH, '-f']]),
];

const scratch: string[] = [];
after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(made);
  return made;
}

const ON = (nextSyncAt = 9_999_999_999): string =>
  `${JSON.stringify({ collect: true, next_sync_at: nextSyncAt, org_enabled: true, enabled: true })}\n`;

/** A HOME with activity turned on (or `state` as given; `null`: no state.json), 0700. */
function home(state: string | null = ON()): string {
  const h = dir('laika-acthome-');
  const d = join(h, '.laika', 'activity');
  mkdirSync(d, { recursive: true, mode: 0o700 });
  if (state !== null) writeFileSync(join(d, 'state.json'), state, { mode: 0o600 });
  return h;
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** `EPIPE` here means the hook exited without draining its stdin. */
  readonly error: string | undefined;
}

function run(
  shell: readonly string[],
  args: readonly string[],
  options: {
    home: string;
    cwd?: string;
    input?: string;
    env?: Record<string, string>;
    script?: string;
  },
): Run {
  const [cmd, ...flags] = shell;
  const result = spawnSync(cmd ?? '/bin/sh', [...flags, options.script ?? HOOK, ...args], {
    cwd: options.cwd ?? options.home,
    input: options.input ?? '{"prompt":"hello"}',
    env: { PATH: process.env.PATH ?? '', HOME: options.home, ...options.env },
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: (result.error as NodeJS.ErrnoException | undefined)?.code,
  };
}

/** The three markers of a session no person is typing in (LAI-757, D-080). */
const AUTOMATED: readonly Record<string, string>[] = [
  { OMNIGENT: '1' },
  { CI: 'true' },
  { LAIKA_ACTIVITY_SKIP: '1' },
];

const events = (h: string): string[] => {
  try {
    return readFileSync(join(h, '.laika', 'activity', 'events.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

/** Every file under `root`, recursively. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function gitRepo(): string {
  const path = dir('laika-actrepo-');
  execFileSync('git', ['init', '-q', '-b', 'main', path], { stdio: 'pipe' });
  return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

for (const shell of SHELLS) {
  const label = shell.join(' ');

  void describe(`under ${label}`, () => {
    void test('a prompt appends one `p <agent> <epoch>` line, prints nothing, exits 0', () => {
      const h = home();
      const before = Math.floor(Date.now() / 1000);
      const r = run(shell, ['prompt', 'claude-code'], { home: h });
      assert.equal(r.code, 0);
      assert.equal(r.stdout, '', 'stdout from UserPromptSubmit goes into the model’s context');
      assert.equal(r.stderr, '');
      const lines = events(h);
      assert.equal(lines.length, 1);
      const [kind, agent, at] = (lines[0] ?? '').split(' ');
      assert.equal(kind, 'p');
      assert.equal(agent, 'claude-code');
      assert.ok(Number(at) >= before && Number(at) <= before + 5, `epoch ${String(at)}`);
    });

    void test('the prompt text is stored nowhere — not from stdin, not from $USER_PROMPT', () => {
      // Not due: the launched sync is covered below with a fake CLI, and a real
      // one writing here while the files are read would make this flaky.
      const h = home();
      const marker = `MARKER-${String(process.pid)}-q7Zx`;
      const repoDir = gitRepo();
      for (const mode of ['prompt', 'session-start', 'session-end']) {
        const r = run(shell, [mode, 'kiro'], {
          home: h,
          cwd: repoDir,
          input: JSON.stringify({ prompt: `please ${marker} now`, session_id: 's' }),
          env: { USER_PROMPT: `please ${marker} now` },
        });
        assert.equal(r.code, 0);
      }
      const files = filesUnder(h);
      assert.ok(files.length >= 2, 'nothing was written — this test proves nothing');
      for (const file of files) {
        assert.ok(!readFileSync(file, 'utf8').includes(marker), `${file} holds the prompt`);
      }
    });

    void test('a large prompt is drained, not left in the pipe', () => {
      const h = home();
      const r = run(shell, ['prompt', 'codex'], { home: h, input: 'x'.repeat(512 * 1024) });
      assert.equal(r.code, 0);
      assert.equal(events(h).length, 1);
    });

    void test('off means off: no state, or collect false, writes nothing', () => {
      for (const state of [null, `${JSON.stringify({ collect: false, next_sync_at: 9e9 })}\n`]) {
        const h = home(state);
        for (const mode of ['prompt', 'session-start', 'session-end']) {
          const r = run(shell, [mode, 'codex'], { home: h, cwd: gitRepo() });
          assert.equal(r.code, 0);
          assert.equal(r.stdout + r.stderr, '');
        }
        assert.deepEqual(events(h), []);
        assert.ok(!existsSync(join(h, '.laika', 'activity', 'repos')));
      }
    });

    void test('an automated session counts nothing: no event, no repo, no output, stdin drained', () => {
      for (const env of AUTOMATED) {
        const label = Object.keys(env).join('');
        const h = home();
        const repoDir = gitRepo();
        for (const mode of ['prompt', 'session-start', 'session-end']) {
          // Larger than any pipe buffer: a hook that exits without reading it
          // leaves the writer with EPIPE — the agent's write would fail.
          const r = run(shell, [mode, 'claude-code'], {
            home: h,
            cwd: repoDir,
            env,
            input: 'x'.repeat(512 * 1024),
          });
          assert.equal(r.code, 0, `${label} ${mode}`);
          assert.equal(r.stdout + r.stderr, '', `${label} ${mode}`);
          assert.equal(r.error, undefined, `${label} ${mode}: stdin was not drained`);
        }
        assert.deepEqual(events(h), [], `${label}: counted`);
        assert.deepEqual(
          readdirSync(join(h, '.laika', 'activity')),
          ['state.json'],
          `${label}: wrote under ~/.laika/activity`,
        );
      }
    });

    void test('with no marker set — or OMNIGENT set to something else — it counts as before', () => {
      for (const env of [{}, { OMNIGENT: '0' }, { CI: '' }, { LAIKA_ACTIVITY_SKIP: '' }]) {
        const h = home();
        const repoDir = gitRepo();
        run(shell, ['prompt', 'claude-code'], { home: h, cwd: repoDir, env });
        run(shell, ['session-start', 'claude-code'], { home: h, cwd: repoDir, env });
        assert.deepEqual(
          events(h).map((l) => l.split(' ')[0]),
          ['p', 's'],
          JSON.stringify(env),
        );
        assert.ok(
          readFileSync(join(h, '.laika', 'activity', 'repos'), 'utf8').includes(repoDir),
          JSON.stringify(env),
        );
      }
    });

    void test('no HOME directory at all is still a silent exit 0', () => {
      const r = run(shell, ['prompt', 'codex'], {
        home: join(tmpdir(), 'laika-no-such-home-zz'),
        cwd: tmpdir(),
      });
      assert.equal(r.code, 0);
      assert.equal(r.stdout + r.stderr, '');
    });

    void test('an unknown or hostile agent name is recorded as `other`', () => {
      const h = home();
      run(shell, ['prompt', 'x;rm -rf /'], { home: h });
      run(shell, ['prompt', ''], { home: h });
      assert.deepEqual(
        events(h).map((l) => l.split(' ')[1]),
        ['other', 'other'],
      );
    });

    void test('Claude Code hooks running under Devin CLI are not counted', () => {
      const h = home();
      run(shell, ['prompt', 'claude-code'], { home: h, env: { DEVIN_PROJECT_DIR: '/x' } });
      run(shell, ['prompt', 'codex'], { home: h, env: { DEVIN_PROJECT_DIR: '/x' } });
      assert.deepEqual(
        events(h).map((l) => l.split(' ')[1]),
        ['codex'],
      );
    });

    void test('files are 0600 in a 0700 directory', () => {
      const h = home();
      const r = gitRepo();
      run(shell, ['prompt', 'codex'], { home: h });
      run(shell, ['session-start', 'codex'], { home: h, cwd: r });
      for (const name of ['events.log', 'repos']) {
        const mode = statSync(join(h, '.laika', 'activity', name)).mode & 0o777;
        assert.equal(mode, 0o600, `${name} is ${mode.toString(8)}`);
      }
      assert.equal(statSync(join(h, '.laika', 'activity')).mode & 0o777, 0o700);
    });

    void test('session start records `s`, and the repo — deduped, with stale entries pruned', () => {
      const h = home();
      const repoDir = gitRepo();
      const reposFile = join(h, '.laika', 'activity', 'repos');
      const now = Math.floor(Date.now() / 1000);
      writeFileSync(
        reposFile,
        `${String(now - 40 * 86_400)}\t/old/repo\n${String(now - 100)}\t${repoDir}\n${String(now - 100)}\t/kept/repo\n`,
      );
      const sub = join(repoDir, 'deep', 'er');
      mkdirSync(sub, { recursive: true });
      const r = run(shell, ['session-start', 'gemini-cli'], { home: h, cwd: sub });
      assert.equal(r.code, 0);
      assert.equal(r.stdout + r.stderr, '');
      assert.deepEqual(
        events(h).map((l) => l.split(' ').slice(0, 2).join(' ')),
        ['s gemini-cli'],
      );
      const lines = readFileSync(reposFile, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2, lines.join(' | '));
      assert.ok(lines.some((l) => l.endsWith('\t/kept/repo')));
      const mine = lines.find((l) => l.endsWith(`\t${repoDir}`));
      assert.ok(mine !== undefined, 'the session’s repo was not recorded at its top level');
      assert.ok(Number(mine.split('\t')[0]) >= now);
    });

    void test('session start outside a repo records the session and no repo', () => {
      const h = home();
      run(shell, ['session-start', 'goose'], { home: h, cwd: dir('laika-norepo-') });
      assert.equal(events(h).length, 1);
      const repos = join(h, '.laika', 'activity', 'repos');
      assert.ok(!existsSync(repos) || readFileSync(repos, 'utf8') === '');
    });
  });
}

/**
 * Wait for `check`, polling, for at most `ms`. A detached launch lands when the
 * machine gets round to it — milliseconds when idle, seconds under the full
 * gate — so these tests wait for the thing itself, never for a fixed time.
 */
async function until(check: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`not within ${String(ms / 1000)} s`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

const textOf = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/**
 * The sync is started detached and the hook does not wait for it. Driven with
 * a copy of the hook beside a fake `cli/bin/laika` that records how it was
 * called, then its whole environment followed by an `__END__` line (so a test
 * never reads half a dump), and then sleeps far longer than any hook budget.
 */
void describe('starting the sync', () => {
  function layout(): { script: string; calls: string } {
    const root = dir('laika-actlayout-');
    mkdirSync(join(root, 'plugin', 'scripts'), { recursive: true });
    mkdirSync(join(root, 'cli', 'bin'), { recursive: true });
    const script = join(root, 'plugin', 'scripts', 'laika-activity-hook');
    copyFileSync(HOOK, script);
    const calls = join(root, 'calls.txt');
    const fake = join(root, 'cli', 'bin', 'laika');
    writeFileSync(
      fake,
      `#!/bin/sh\necho "$*" >> '${calls}'\n{ env; echo __END__; } >> '${calls}.env'\nsleep 4\n`,
    );
    chmodSync(fake, 0o755);
    return { script, calls };
  }

  const shell = SHELLS[SHELLS.length - 1] ?? ['/bin/sh'];

  void test('session end launches `activity sync --background` and returns at once', async () => {
    const { script, calls } = layout();
    const h = home(ON(0));
    const started = Date.now();
    const r = run(shell, ['session-end', 'claude-code'], { home: h, script });
    const took = Date.now() - started;
    assert.equal(r.code, 0);
    assert.ok(took < 1000, `took ${String(took)} ms — Claude Code gives SessionEnd 1.5 s in all`);
    await until(() => textOf(calls).endsWith('\n'));
    assert.equal(readFileSync(calls, 'utf8').trim(), 'activity sync --background');
  });

  void test('the launched sync never inherits the prompt', async () => {
    const { script, calls } = layout();
    const h = home(ON(0));
    run(shell, ['session-start', 'kiro'], {
      home: h,
      script,
      env: { USER_PROMPT: 'SECRET-PROMPT-zz' },
    });
    await until(() => textOf(`${calls}.env`).includes('__END__'));
    const dump = readFileSync(`${calls}.env`, 'utf8');
    assert.ok(
      dump.includes(`HOME=${h}`),
      'not this hook’s launch — the check below proves nothing',
    );
    assert.ok(!dump.includes('SECRET-PROMPT-zz'));
  });

  /**
   * A launch is asynchronous, so "nothing appeared within N ms" proves nothing
   * on a loaded machine. Instead a due hook runs last, from its own HOME, and
   * the test waits for *its* launch: anything the earlier hooks started began
   * before it, and must have landed too.
   */
  void test('not before next_sync_at, and never while off', async () => {
    const { script, calls } = layout();
    const notDue = home(ON(9_999_999_999));
    const off = home(null);
    const due = home(ON(0));
    run(shell, ['session-end', 'codex'], { home: notDue, script });
    run(shell, ['session-start', 'codex'], { home: off, script });
    run(shell, ['session-end', 'codex'], { home: due, script });
    await until(() => {
      const dump = textOf(`${calls}.env`);
      return dump.includes(`HOME=${due}`) && dump.includes('__END__');
    });
    await new Promise((res) => setTimeout(res, 500));
    const homes = readFileSync(`${calls}.env`, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('HOME='));
    assert.deepEqual(homes, [`HOME=${due}`], 'a sync was started early, or while off');
  });

  /** Same shape as the test above: skipped hooks first, then one that is not. */
  void test('an automated session never starts a sync, however due', async () => {
    const { script, calls } = layout();
    const skipped = AUTOMATED.map(() => home(ON(0)));
    AUTOMATED.forEach((env, i) => {
      const h = skipped[i] ?? '';
      run(shell, ['session-start', 'codex'], { home: h, script, env });
      run(shell, ['session-end', 'codex'], { home: h, script, env });
    });
    const due = home(ON(0));
    run(shell, ['session-end', 'codex'], { home: due, script });
    await until(() => {
      const dump = textOf(`${calls}.env`);
      return dump.includes(`HOME=${due}`) && dump.includes('__END__');
    });
    await new Promise((res) => setTimeout(res, 500));
    const homes = readFileSync(`${calls}.env`, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('HOME='));
    assert.deepEqual(homes, [`HOME=${due}`], 'an automated session started a sync');
  });

  void test('the hook’s stdout pipe is not held open by the sync', async () => {
    const { script } = layout();
    const h = home(ON(0));
    const [cmd, ...flags] = shell;
    // spawn (not spawnSync): 'close' fires only once every holder of the pipe is gone.
    const child = spawn(cmd ?? '/bin/sh', [...flags, script, 'session-end', 'codex'], {
      env: { PATH: process.env.PATH ?? '', HOME: h },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end('{}');
    const started = Date.now();
    await new Promise((res) => child.on('close', res));
    assert.ok(Date.now() - started < 1500, 'the agent would wait for the sync to finish');
  });
});

/**
 * The budget: ≤ 5 ms for the prompt path. Run the way an agent does (a fresh
 * process per prompt), median of many, interleaved with the bare interpreter so
 * a loaded machine is told apart from a slow script.
 */
void describe('cost of the prompt path', () => {
  const shell = ZSH === undefined ? ['/bin/sh'] : [ZSH, '-f'];

  void test(
    'under zsh it forks nothing: it still works with an empty PATH',
    { skip: ZSH === undefined },
    () => {
      const h = home();
      const r = run(shell, ['prompt', 'codex'], { home: h, env: { PATH: '' } });
      assert.equal(r.code, 0);
      assert.equal(r.stdout + r.stderr, '');
      assert.match(
        events(h).join('\n'),
        /^p codex \d{10}$/,
        'the prompt path needed an external command',
      );
    },
  );

  void test(
    'under zsh a skipped session needs no external command: empty PATH, stdin still drained',
    { skip: ZSH === undefined },
    () => {
      for (const env of AUTOMATED) {
        const h = home();
        for (const mode of ['prompt', 'session-start', 'session-end']) {
          const r = run(shell, [mode, 'codex'], {
            home: h,
            env: { ...env, PATH: '' },
            input: 'x'.repeat(512 * 1024),
          });
          assert.equal(r.code, 0);
          assert.equal(r.stdout + r.stderr, '');
          assert.equal(r.error, undefined, 'stdin was not drained');
        }
        assert.deepEqual(events(h), []);
      }
    },
  );

  /**
   * Wall time on a shared machine measures the machine as much as the script:
   * inside the repo gate (every workspace at once, load ~20) the same hook
   * measured a 20 ms median against 4 ms on a quiet machine. So the claim is
   * made on the **fastest** of many interleaved runs — the script's own cost
   * with the least scheduling noise — over up to three rounds: ≤ 5 ms, or on a
   * machine so loaded that the bare interpreter alone is slow, no more than
   * twice the bare interpreter (measured at load ~18: 5.6 ms against 3.5 ms).
   * A regression that matters (a `node` call is ~40 ms, a `git` one ~10 ms)
   * fails either way. That the path forks nothing is proven above, without
   * timing at all.
   */
  void test('≤ 5 ms per prompt (fastest of 41; or ≤ 2× the bare interpreter)', () => {
    const h = home();
    const empty = join(dir('laika-empty-'), 'empty.sh');
    writeFileSync(empty, 'exit 0\n');
    const [cmd, ...flags] = shell;
    const time = (script: string, args: readonly string[]): number => {
      const t0 = process.hrtime.bigint();
      spawnSync(cmd ?? '/bin/sh', [...flags, script, ...args], {
        input: '{"prompt":"hello"}',
        env: { PATH: process.env.PATH ?? '', HOME: h },
      });
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
    const rounds: string[] = [];
    let ok = false;
    for (let round = 0; round < 3 && !ok; round += 1) {
      const hook: number[] = [];
      const bare: number[] = [];
      for (let i = 0; i < 41; i += 1) {
        hook.push(time(HOOK, ['prompt', 'claude-code']));
        bare.push(time(empty, []));
      }
      const [fast = 0] = sorted(hook);
      const [fastBare = 0] = sorted(bare);
      const median = sorted(hook)[20] ?? 0;
      const medianBare = sorted(bare)[20] ?? 0;
      rounds.push(
        `fastest ${fast.toFixed(2)} ms (bare ${fastBare.toFixed(2)}), ` +
          `median ${median.toFixed(2)} ms (bare ${medianBare.toFixed(2)})`,
      );
      ok = fast <= 5 || fast <= 2 * fastBare;
    }
    console.log(`prompt hook (${shell.join(' ')}): ${rounds.join(' | ')}`);
    assert.equal(events(h).length % 41, 0);
    assert.ok(ok, rounds.join(' | '));
  });
});
