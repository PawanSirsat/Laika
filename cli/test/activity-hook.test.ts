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
      const marker = `MARKER-${String(process.pid)}-q7Zx`;
      const repoDir = gitRepo();
      // D-090: on an Omnigent turn the start of the prompt is looked at, so the
      // Omnigent paths are here too — a person's prompt and a runtime notice.
      for (const [agent, env] of [
        ['kiro', {}],
        ['claude-code', OMNI_PRIMARY],
        ['claude-code', OMNI_ORCHESTRATOR],
      ] as const) {
        const h = home();
        for (const prompt of [`please ${marker} now`, `[System: ${marker} finished]`]) {
          for (const mode of ['prompt', 'session-start', 'session-end', 'turn-end']) {
            const r = run(shell, [mode, agent], {
              home: h,
              cwd: repoDir,
              input: promptPayload(prompt),
              env: { ...env, USER_PROMPT: prompt },
            });
            assert.equal(r.code, 0);
          }
        }
        const files = filesUnder(h);
        assert.ok(files.length >= 2, `${agent}: nothing was written — this proves nothing`);
        assert.ok(events(h).length >= 2, `${agent}: no event — this proves nothing`);
        for (const file of files) {
          assert.ok(!readFileSync(file, 'utf8').includes(marker), `${file} holds the prompt`);
        }
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

    /**
     * LAI-776: Claude Code's `Stop` fires at the end of every turn, and its
     * payload carries the turn's last reply (`last_assistant_message`,
     * code.claude.com/docs/en/hooks). The hook is only a trigger there: it
     * counts nothing, keeps nothing of the payload and prints nothing — and
     * exit 2 on `Stop` would keep Claude from stopping.
     */
    void test('a turn’s end counts nothing, keeps nothing of its payload, prints nothing, exits 0', () => {
      const h = home();
      const marker = `REPLY-${String(process.pid)}-k3Wq`;
      const repoDir = gitRepo();
      for (const env of [{}, ...AUTOMATED]) {
        const r = run(shell, ['turn-end', 'claude-code'], {
          home: h,
          cwd: repoDir,
          env,
          // Larger than any pipe buffer: a hook that exits unread leaves EPIPE.
          input: JSON.stringify({
            session_id: 'turn-5f3c',
            hook_event_name: 'Stop',
            last_assistant_message: `${marker} ${'x'.repeat(512 * 1024)}`,
          }),
        });
        assert.equal(r.code, 0);
        assert.equal(r.stdout + r.stderr, '', 'Stop output is parsed by Claude Code');
        assert.equal(r.error, undefined, 'stdin was not drained');
      }
      assert.deepEqual(events(h), [], 'a turn’s end is not a prompt or a session');
      assert.deepEqual(skipped(h), [], 'a turn’s end payload was read');
      assert.deepEqual(started(h), []);
      for (const file of filesUnder(h)) {
        assert.ok(!readFileSync(file, 'utf8').includes(marker), `${file} holds the reply`);
      }
      assert.ok(!existsSync(join(h, '.laika', 'activity', 'repos')), 'a turn recorded a repo');
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
 * LAI-770: a person's session start keeps its id and its branch, locally, so
 * the token reader can tie the tokens of an agent whose own files name no
 * branch (Gemini CLI, Codex without git metadata) to the key in it. Never
 * sent; only the key in the branch ever leaves, and only as a usage row's
 * task.
 */
const STARTS = (h: string): string => join(h, '.laika', 'activity', 'sessions');
/** `<session id> <branch or ->` for each start line. */
const started = (h: string): string[] =>
  existsSync(STARTS(h))
    ? readFileSync(STARTS(h), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [, id, branch] = line.split(' ');
          return `${id ?? ''} ${branch === undefined || branch === '' ? '-' : branch}`;
        })
    : [];

function repoOn(branch: string): string {
  const path = gitRepo();
  execFileSync('git', ['-C', path, 'commit', '-q', '--allow-empty', '-m', 'x'], {
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.test',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.test',
    },
  });
  execFileSync('git', ['-C', path, 'checkout', '-q', '-b', branch], { stdio: 'pipe' });
  return path;
}

for (const shell of SHELLS) {
  void describe(`a person’s session start is kept, locally, under ${shell.join(' ')} (LAI-770)`, () => {
    void test('its id and branch, 0600, beside the event and the repo as before', () => {
      const h = home();
      const repo = repoOn('LAI-7-fix-login');
      const r = run(shell, ['session-start', 'gemini-cli'], {
        home: h,
        cwd: repo,
        input: payload('gem-5f3c2a1e'),
      });
      assert.equal(r.code, 0);
      assert.equal(r.stdout + r.stderr, '');
      assert.deepEqual(started(h), ['gem-5f3c2a1e LAI-7-fix-login']);
      assert.match(readFileSync(STARTS(h), 'utf8'), /^\d{10} gem-5f3c2a1e LAI-7-fix-login\n$/);
      assert.equal((statSync(STARTS(h)).mode & 0o777).toString(8), '600');
      assert.deepEqual(
        events(h).map((l) => l.split(' ').slice(0, 2).join(' ')),
        ['s gemini-cli'],
      );
      const repos = readFileSync(join(h, '.laika', 'activity', 'repos'), 'utf8');
      assert.ok(repos.includes(`\t${repo}`), 'the repo was not recorded');
    });

    void test('outside a repo, on no branch, or on an odd one: the id alone', () => {
      const h = home();
      run(shell, ['session-start', 'codex'], {
        home: h,
        cwd: dir('laika-norepo-'),
        input: payload('s-1'),
      });
      // A repo with no commit yet has no branch to name.
      run(shell, ['session-start', 'codex'], { home: h, cwd: gitRepo(), input: payload('s-2') });
      run(shell, ['session-start', 'codex'], {
        home: h,
        cwd: repoOn('odd$(touch${IFS}pwned)'),
        input: payload('s-3'),
      });
      assert.deepEqual(started(h), ['s-1 -', 's-2 -', 's-3 -']);
      assert.ok(!existsSync(join(h, 'pwned')) && !existsSync('pwned'));
    });

    void test('never from a prompt, a session end, an agent whose tokens are not read, or with collection off', () => {
      const h = home();
      const repo = repoOn('LAI-8-x');
      run(shell, ['prompt', 'claude-code'], {
        home: h,
        cwd: repo,
        input: JSON.stringify({ session_id: 'p-1', prompt: 'hello' }),
      });
      run(shell, ['session-end', 'claude-code'], { home: h, cwd: repo, input: payload('e-1') });
      run(shell, ['session-start', 'copilot-cli'], { home: h, cwd: repo, input: payload('c-1') });
      assert.deepEqual(started(h), []);
      const off = home(`${JSON.stringify({ collect: false, next_sync_at: 9_999_999_999 })}\n`);
      run(shell, ['session-start', 'claude-code'], { home: off, cwd: repo, input: payload('o-1') });
      assert.deepEqual(started(off), []);
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
/**
 * LAI-775, the owner's decision: an Omnigent-launched (or CI, or skipped)
 * session's tokens are not the developer's. Such a session counts nothing, as
 * before — and its id is now kept in `~/.laika/activity/skip-sessions`, never
 * sent, so the token reader can leave its session files out. Only the session
 * start and end payloads are read for it: they carry no prompt.
 */
const SKIP_FILE = (h: string): string => join(h, '.laika', 'activity', 'skip-sessions');
const skipped = (h: string): string[] =>
  existsSync(SKIP_FILE(h))
    ? readFileSync(SKIP_FILE(h), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ')[1] ?? '')
    : [];
const payload = (sessionId: unknown): string =>
  JSON.stringify({
    session_id: sessionId,
    transcript_path: '/Users/dev/.claude/projects/-work/x.jsonl',
    cwd: '/Users/dev/work',
    hook_event_name: 'SessionStart',
    source: 'startup',
  });

/**
 * D-090: Omnigent starts a turn itself when a sub-agent finishes, a timer fires
 * or a terminal goes idle, and each such prompt begins `[System: `. These are
 * Omnigent 0.17.0's own templates, quoted from its source, so a later Omnigent
 * that renames the marker turns these tests red instead of padding a timesheet.
 */
const RUNTIME_NOTICES: readonly string[] = [
  // runner/subagent_work.py, _format_subagent_wake_notice
  '[System: sub-agent claude_code/x finished (completed) — 1 result waiting in inbox. Call sys_read_inbox to collect.]',
  // runner/tool_dispatch.py, a timer firing
  '[System: timer t1 fired]',
  // runner/tool_dispatch.py, a terminal going idle
  '[System: inbox item terminal_idle — terminal shell:main is idle]',
];
/** A `UserPromptSubmit` payload: compact (`"prompt":"`), or spaced (`"prompt": "`). */
const promptPayload = (prompt: string, spaced = false): string => {
  const head = {
    session_id: 's',
    transcript_path: '/Users/dev/.claude/projects/-work/x.jsonl',
    cwd: '/Users/dev/work',
    permission_mode: 'default',
    hook_event_name: 'UserPromptSubmit',
  };
  return spaced
    ? `${JSON.stringify(head, null, 1).replace(/\n/g, '').slice(0, -1)}, "prompt": ${JSON.stringify(prompt)}}`
    : JSON.stringify({ ...head, prompt });
};
const kindOf = (line: string): string => line.split(' ')[0] ?? '';

for (const shell of SHELLS) {
  void describe(`automated sessions are remembered, locally, under ${shell.join(' ')} (LAI-775)`, () => {
    void test('session start and end keep the session id, and count nothing', () => {
      for (const env of AUTOMATED) {
        const h = home();
        for (const mode of ['session-start', 'session-end']) {
          const r = run(shell, [mode, 'claude-code'], {
            home: h,
            env,
            input: payload('5f3c2a1e-9d8b-4c7a-b6e5-0f1e2d3c4b5a'),
          });
          assert.equal(r.code, 0);
          assert.equal(r.stdout + r.stderr, '');
        }
        assert.deepEqual(skipped(h), [
          '5f3c2a1e-9d8b-4c7a-b6e5-0f1e2d3c4b5a',
          '5f3c2a1e-9d8b-4c7a-b6e5-0f1e2d3c4b5a',
        ]);
        assert.match(readFileSync(SKIP_FILE(h), 'utf8'), /^\d{10} 5f3c2a1e-/);
        assert.equal((statSync(SKIP_FILE(h)).mode & 0o777).toString(8), '600');
        assert.deepEqual(events(h), []);
      }
    });

    void test('a prompt is never read for it, and a person’s session is not marked automated', () => {
      for (const env of AUTOMATED) {
        const h = home();
        run(shell, ['prompt', 'claude-code'], {
          home: h,
          env,
          input: JSON.stringify({ session_id: 'abc', prompt: 'hello' }),
        });
        assert.deepEqual(skipped(h), [], 'a prompt payload was read');
      }
      const person = home();
      run(shell, ['session-start', 'claude-code'], { home: person, input: payload('abc-123') });
      assert.deepEqual(skipped(person), [], 'a person’s session was marked automated');
      assert.deepEqual(started(person), ['abc-123 -'], 'an automated session’s start was kept');
    });

    void test('anything that is not a plain id is kept out', () => {
      const h = home();
      for (const bad of [null, 42, 'a b', 'x$(touch pwned)', 'a\nb', '', 'é', 'x'.repeat(200)]) {
        run(shell, ['session-start', 'claude-code'], {
          home: h,
          env: { OMNIGENT: '1' },
          input: payload(bad),
        });
      }
      // And a key that only looks like it, inside a string value.
      run(shell, ['session-start', 'claude-code'], {
        home: h,
        env: { OMNIGENT: '1' },
        input: JSON.stringify({ cwd: '/x/"session_id":"evil"', session_id: null }),
      });
      assert.deepEqual(skipped(h), []);
      assert.ok(!existsSync(join(h, 'pwned')) && !existsSync('pwned'));
    });

    void test('an automated session keeps no start line', () => {
      const h = home();
      run(shell, ['session-start', 'claude-code'], {
        home: h,
        env: { OMNIGENT: '1' },
        input: payload('abc-123'),
      });
      assert.deepEqual(started(h), []);
    });

    void test('with activity off on this machine, nothing is written at all', () => {
      const h = dir('laika-nohome-');
      run(shell, ['session-start', 'claude-code'], {
        home: h,
        env: { OMNIGENT: '1' },
        input: payload('abc-123'),
      });
      assert.ok(!existsSync(join(h, '.laika')));
    });
  });
}

/**
 * D-088 item 9: Omnigent stamps `OMNIGENT=1` on every process it runs, the
 * session the person types to included — so the hook used to skip the one
 * session where the person actually works. The primary is the session whose
 * terminal Omnigent launched for the runner's own session: its
 * `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` equals `OMNIGENT_RUNNER_PRIMARY_SESSION_ID`.
 * A dispatched sub-agent's two ids differ.
 */
const PRIMARY_FILE = (h: string): string => join(h, '.laika', 'activity', 'primary-sessions');
const primaries = (h: string): string[] =>
  existsSync(PRIMARY_FILE(h))
    ? readFileSync(PRIMARY_FILE(h), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ')[1] ?? '')
    : [];
// Omnigent's ids are 32 hex characters; these are made up, and look it.
const FAKE_PRIMARY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_SUBAGENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OMNI_PRIMARY = {
  OMNIGENT: '1',
  OMNIGENT_RUNNER_PRIMARY_SESSION_ID: FAKE_PRIMARY,
  OMNIGENT_TERMINAL_LAUNCH_SESSION_ID: FAKE_PRIMARY,
};
const OMNI_SUBAGENT = {
  OMNIGENT: '1',
  OMNIGENT_RUNNER_PRIMARY_SESSION_ID: FAKE_PRIMARY,
  OMNIGENT_TERMINAL_LAUNCH_SESSION_ID: FAKE_SUBAGENT,
};

for (const shell of SHELLS) {
  void describe(`the orchestrator’s primary session is the person’s, under ${shell.join(' ')} (D-088 item 9)`, () => {
    void test('the primary counts: its prompt, its start, its id kept as a primary, never skipped', () => {
      const h = home();
      const p = run(shell, ['prompt', 'claude-code'], { home: h, env: OMNI_PRIMARY });
      assert.equal(p.code, 0);
      assert.equal(p.stdout + p.stderr, '');
      const s = run(shell, ['session-start', 'claude-code'], {
        home: h,
        env: OMNI_PRIMARY,
        input: payload('9a1b2c3d-0000-4000-8000-000000000001'),
      });
      assert.equal(s.code, 0);
      assert.equal(s.stdout + s.stderr, '');
      assert.deepEqual(
        events(h).map((line) => line.split(' ').slice(0, 2).join(' ')),
        ['p claude-code', 's claude-code'],
      );
      assert.deepEqual(started(h), ['9a1b2c3d-0000-4000-8000-000000000001 -']);
      assert.deepEqual(primaries(h), ['9a1b2c3d-0000-4000-8000-000000000001']);
      assert.equal((statSync(PRIMARY_FILE(h)).mode & 0o777).toString(8), '600');
      assert.deepEqual(skipped(h), []);
    });

    void test('a dispatched sub-agent (the two ids differ) is skipped as before', () => {
      const h = home();
      run(shell, ['prompt', 'claude-code'], { home: h, env: OMNI_SUBAGENT });
      run(shell, ['session-start', 'claude-code'], {
        home: h,
        env: OMNI_SUBAGENT,
        input: payload('9a1b2c3d-0000-4000-8000-000000000002'),
      });
      assert.deepEqual(events(h), []);
      assert.deepEqual(started(h), []);
      assert.deepEqual(primaries(h), []);
      assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000002']);
    });

    void test('OMNIGENT=1 with no primary id, or an empty one on both sides, is skipped', () => {
      for (const env of [
        { OMNIGENT: '1', OMNIGENT_TERMINAL_LAUNCH_SESSION_ID: 'abc' },
        {
          OMNIGENT: '1',
          OMNIGENT_RUNNER_PRIMARY_SESSION_ID: '',
          OMNIGENT_TERMINAL_LAUNCH_SESSION_ID: '',
        },
        { OMNIGENT: '1', OMNIGENT_RUNNER_PRIMARY_SESSION_ID: 'abc' },
      ]) {
        const h = home();
        run(shell, ['prompt', 'claude-code'], { home: h, env });
        run(shell, ['session-start', 'claude-code'], {
          home: h,
          env,
          input: payload('9a1b2c3d-0000-4000-8000-000000000003'),
        });
        assert.deepEqual(events(h), [], JSON.stringify(env));
        assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000003'], JSON.stringify(env));
      }
    });

    void test('CI or LAIKA_ACTIVITY_SKIP skips a primary all the same', () => {
      for (const extra of [{ CI: 'true' }, { LAIKA_ACTIVITY_SKIP: '1' }]) {
        const h = home();
        const env = { ...OMNI_PRIMARY, ...extra };
        run(shell, ['prompt', 'claude-code'], { home: h, env });
        run(shell, ['session-start', 'claude-code'], {
          home: h,
          env,
          input: payload('9a1b2c3d-0000-4000-8000-000000000004'),
        });
        assert.deepEqual(events(h), [], JSON.stringify(extra));
        assert.deepEqual(primaries(h), []);
        assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000004']);
      }
    });

    void test('a runtime notice typed into the primary is no typed prompt; everyone else is unchanged (D-090)', () => {
      const h = home();
      for (const notice of RUNTIME_NOTICES) {
        for (const spaced of [false, true]) {
          const r = run(shell, ['prompt', 'claude-code'], {
            home: h,
            env: OMNI_PRIMARY,
            input: promptPayload(notice, spaced),
          });
          assert.equal(r.code, 0);
          assert.equal(r.stdout + r.stderr, '');
          assert.equal(r.error, undefined, 'stdin was not drained');
        }
      }
      assert.deepEqual(events(h), [], 'a notice was counted as a typed prompt');
      run(shell, ['prompt', 'claude-code'], {
        home: h,
        env: OMNI_PRIMARY,
        input: promptPayload('please fix the build'),
      });
      assert.deepEqual(
        events(h).map((line) => line.split(' ').slice(0, 2).join(' ')),
        ['p claude-code'],
      );
      // No Omnigent, or another agent: the prompt is not looked at, and counts.
      const plain = home();
      const notice = promptPayload(RUNTIME_NOTICES[0] ?? '');
      run(shell, ['prompt', 'claude-code'], { home: plain, input: notice });
      run(shell, ['prompt', 'codex'], { home: plain, env: OMNI_PRIMARY, input: notice });
      assert.deepEqual(
        events(plain).map((line) => line.split(' ').slice(0, 2).join(' ')),
        ['p claude-code', 'p codex'],
      );
    });

    void test('a person’s plain session (no Omnigent) is kept as before and is no primary', () => {
      const h = home();
      run(shell, ['session-start', 'claude-code'], {
        home: h,
        input: payload('9a1b2c3d-0000-4000-8000-000000000005'),
      });
      assert.deepEqual(started(h), ['9a1b2c3d-0000-4000-8000-000000000005 -']);
      assert.deepEqual(primaries(h), []);
    });
  });
}

/**
 * LAI-792: an Omnigent-native orchestrator — polly — thinks with Claude Code
 * under the Claude Agent SDK (Omnigent's `claude-sdk` harness), and the SDK
 * loads `~/.claude/settings.json`, so this hook runs at every one of its turns:
 * `UserPromptSubmit` as a turn starts, `Stop` as it ends. It runs in the runner
 * Omnigent launched for that session (`OMNIGENT_RUNNER_LAUNCH_HARNESS`), with
 * the SDK's `CLAUDE_CODE_ENTRYPOINT=sdk-py`, and in no terminal. A turn the
 * person started is `t omnigent <epoch> <session>`; one Omnigent started itself
 * — its prompt begins `[System: ` (D-090) — is `w`; every turn's end is `r`,
 * and the drafter drops the `r` that ends a `w`. None is a typed prompt.
 */
const FAKE_ORCHESTRATOR = 'cccccccccccccccccccccccccccccccc';
const OMNI_ORCHESTRATOR = {
  OMNIGENT: '1',
  OMNIGENT_RUNNER_PRIMARY_SESSION_ID: FAKE_ORCHESTRATOR,
  OMNIGENT_RUNNER_LAUNCH_HARNESS: 'claude-sdk',
  CLAUDE_CODE_ENTRYPOINT: 'sdk-py',
};
const withoutKey = (env: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));

for (const shell of SHELLS) {
  void describe(`an Omnigent-native orchestrator’s turns are the person’s, under ${shell.join(' ')} (LAI-792)`, () => {
    void test('a turn’s start and end are kept as `t`/`r omnigent <epoch> <session>`, never as a typed prompt', () => {
      const h = home();
      const before = Math.floor(Date.now() / 1000);
      const p = run(shell, ['prompt', 'claude-code'], {
        home: h,
        env: { ...OMNI_ORCHESTRATOR, USER_PROMPT: 'SECRET-TYPED-zq' },
        input: '{"prompt":"SECRET-TYPED-zq"}',
      });
      assert.equal(p.code, 0);
      assert.equal(p.stdout + p.stderr, '');
      assert.equal(p.error, undefined, 'stdin was not drained');
      const e = run(shell, ['turn-end', 'claude-code'], {
        home: h,
        env: OMNI_ORCHESTRATOR,
        input: '{"last_assistant_message":"SECRET-REPLY-zq"}',
      });
      assert.equal(e.code, 0);
      assert.equal(e.stdout + e.stderr, '');
      const lines = events(h);
      assert.deepEqual(
        lines.map((line) =>
          line
            .split(' ')
            .filter((_, i) => i !== 2)
            .join(' '),
        ),
        [`t omnigent ${FAKE_ORCHESTRATOR}`, `r omnigent ${FAKE_ORCHESTRATOR}`],
      );
      for (const line of lines) assert.ok(Number(line.split(' ')[2]) >= before, line);
      for (const file of filesUnder(join(h, '.laika'))) {
        const text = readFileSync(file, 'utf8');
        assert.ok(!text.includes('SECRET-'), `${file} kept what was said`);
      }
      assert.deepEqual(skipped(h), []);
    });

    void test('a turn Omnigent started is `w`, never `t`: compact or spaced, alone or on the first line (D-090)', () => {
      const h = home();
      const notice = RUNTIME_NOTICES[0] ?? '';
      const inputs = [
        ...RUNTIME_NOTICES.map((n) => promptPayload(n)),
        ...RUNTIME_NOTICES.map((n) => promptPayload(n, true)),
        promptPayload(`${notice}\n\nThe owner's words, joined after it.`),
      ];
      for (const input of inputs) {
        const r = run(shell, ['prompt', 'claude-code'], { home: h, env: OMNI_ORCHESTRATOR, input });
        assert.equal(r.code, 0);
        assert.equal(r.stdout + r.stderr, '');
        assert.equal(r.error, undefined, 'stdin was not drained');
      }
      run(shell, ['turn-end', 'claude-code'], { home: h, env: OMNI_ORCHESTRATOR });
      assert.deepEqual(events(h).map(kindOf), [...inputs.map(() => 'w'), 'r']);
      assert.ok(events(h).every((line) => line.endsWith(` ${FAKE_ORCHESTRATOR}`)));
    });

    void test('a person’s prompt is `t` — the marker anywhere but at the very start included', () => {
      const h = home();
      const prompts = [
        'please fix the build',
        ' [System: sub-agent x/y finished (completed)]',
        'look at this: [System: timer t1 fired]',
        '[system: lower case is not the marker]',
        '[System:no space]',
        '',
      ];
      for (const prompt of prompts) {
        for (const spaced of [false, true]) {
          const r = run(shell, ['prompt', 'claude-code'], {
            home: h,
            env: OMNI_ORCHESTRATOR,
            input: promptPayload(prompt, spaced),
          });
          assert.equal(r.code, 0);
        }
      }
      assert.deepEqual(
        events(h).map(kindOf),
        prompts.flatMap(() => ['t', 't']),
      );
    });

    void test('only the start is looked at: a long prompt drains, and a notice heading one is still a notice', () => {
      const h = home();
      const long = 'x'.repeat(512 * 1024);
      for (const prompt of [long, `${RUNTIME_NOTICES[1] ?? ''}${long}`]) {
        const r = run(shell, ['prompt', 'claude-code'], {
          home: h,
          env: OMNI_ORCHESTRATOR,
          input: promptPayload(prompt),
        });
        assert.equal(r.code, 0);
        assert.equal(r.error, undefined, 'stdin was not drained');
      }
      assert.deepEqual(events(h).map(kindOf), ['t', 'w']);
    });

    void test('its start keeps its Omnigent session id as a primary — not the payload’s — and no session start, repo or skip', () => {
      const h = home();
      const repoDir = gitRepo();
      for (const mode of ['session-start', 'session-end']) {
        const r = run(shell, [mode, 'claude-code'], {
          home: h,
          cwd: repoDir,
          env: OMNI_ORCHESTRATOR,
          input: payload('9a1b2c3d-0000-4000-8000-000000000006'),
        });
        assert.equal(r.code, 0);
        assert.equal(r.stdout + r.stderr, '');
      }
      assert.deepEqual(primaries(h), [FAKE_ORCHESTRATOR]);
      assert.equal((statSync(PRIMARY_FILE(h)).mode & 0o777).toString(8), '600');
      assert.deepEqual(events(h), []);
      assert.deepEqual(started(h), []);
      assert.deepEqual(skipped(h), []);
      assert.ok(!existsSync(join(h, '.laika', 'activity', 'repos')), 'a repo was recorded');
    });

    void test('a dispatched sub-agent stays skipped: in a terminal, from the CLI, another agent, another runner', () => {
      for (const env of [
        { ...OMNI_ORCHESTRATOR, OMNIGENT_TERMINAL_LAUNCH_SESSION_ID: FAKE_SUBAGENT },
        { ...OMNI_ORCHESTRATOR, CLAUDE_CODE_ENTRYPOINT: 'cli' },
        // `claude -p` (sdk-cli) and the TypeScript SDK are not Omnigent's brain.
        { ...OMNI_ORCHESTRATOR, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' },
        { ...OMNI_ORCHESTRATOR, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' },
        withoutKey(OMNI_ORCHESTRATOR, 'CLAUDE_CODE_ENTRYPOINT'),
        { ...OMNI_ORCHESTRATOR, OMNIGENT_RUNNER_LAUNCH_HARNESS: 'claude-native' },
        withoutKey(OMNI_ORCHESTRATOR, 'OMNIGENT_RUNNER_LAUNCH_HARNESS'),
        withoutKey(OMNI_ORCHESTRATOR, 'OMNIGENT_RUNNER_PRIMARY_SESSION_ID'),
      ]) {
        const h = home();
        run(shell, ['prompt', 'claude-code'], { home: h, env });
        run(shell, ['turn-end', 'claude-code'], { home: h, env });
        run(shell, ['session-start', 'claude-code'], {
          home: h,
          env,
          input: payload('9a1b2c3d-0000-4000-8000-000000000007'),
        });
        assert.deepEqual(events(h), [], JSON.stringify(env));
        assert.deepEqual(primaries(h), [], JSON.stringify(env));
        assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000007'], JSON.stringify(env));
      }
      // Another agent's hook under the same runner: not Claude Code, not the brain.
      const h = home();
      run(shell, ['prompt', 'codex'], { home: h, env: OMNI_ORCHESTRATOR });
      run(shell, ['session-start', 'codex'], {
        home: h,
        env: OMNI_ORCHESTRATOR,
        input: payload('9a1b2c3d-0000-4000-8000-000000000008'),
      });
      assert.deepEqual(events(h), []);
      assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000008']);
    });

    void test('a session id that is not a plain id counts nothing', () => {
      for (const id of ['a b', '../etc', 'x;rm', 'é', 'a'.repeat(129)]) {
        const env = { ...OMNI_ORCHESTRATOR, OMNIGENT_RUNNER_PRIMARY_SESSION_ID: id };
        const h = home();
        run(shell, ['prompt', 'claude-code'], { home: h, env });
        run(shell, ['turn-end', 'claude-code'], { home: h, env });
        run(shell, ['session-start', 'claude-code'], {
          home: h,
          env,
          input: payload('9a1b2c3d-0000-4000-8000-000000000009'),
        });
        assert.deepEqual(events(h), [], id);
        assert.deepEqual(primaries(h), [], id);
        assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000009'], id);
      }
    });

    void test('CI or LAIKA_ACTIVITY_SKIP skip it all the same; collection off writes nothing', () => {
      for (const extra of [{ CI: 'true' }, { LAIKA_ACTIVITY_SKIP: '1' }]) {
        const h = home();
        const env = { ...OMNI_ORCHESTRATOR, ...extra };
        run(shell, ['prompt', 'claude-code'], { home: h, env });
        run(shell, ['turn-end', 'claude-code'], { home: h, env });
        run(shell, ['session-start', 'claude-code'], {
          home: h,
          env,
          input: payload('9a1b2c3d-0000-4000-8000-000000000010'),
        });
        assert.deepEqual(events(h), [], JSON.stringify(extra));
        assert.deepEqual(primaries(h), [], JSON.stringify(extra));
        assert.deepEqual(skipped(h), ['9a1b2c3d-0000-4000-8000-000000000010']);
      }
      for (const state of [null, `${JSON.stringify({ collect: false, next_sync_at: 0 })}\n`]) {
        const h = home(state);
        for (const mode of ['prompt', 'turn-end', 'session-start', 'session-end']) {
          const r = run(shell, [mode, 'claude-code'], { home: h, env: OMNI_ORCHESTRATOR });
          assert.equal(r.code, 0);
          assert.equal(r.stdout + r.stderr, '');
        }
        assert.deepEqual(events(h), [], String(state));
        assert.deepEqual(primaries(h), [], String(state));
      }
    });
  });
}

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

  /**
   * LAI-776: tokens from a running session reach the board within one sync
   * interval. `Stop` fires every turn; the hook launches the sync only once
   * `next_sync_at` has passed, and only while collection is on — the
   * once-a-day recheck while off stays with the session events.
   */
  void test('a turn’s end launches the sync once due — not before, not while off, never for an automated session', async () => {
    const { script, calls } = layout();
    const notDue = home(ON(9_999_999_999));
    const off = home(`${JSON.stringify({ collect: false, next_sync_at: 0 })}\n`);
    const none = home(null);
    const automated = AUTOMATED.map(() => home(ON(0)));
    run(shell, ['turn-end', 'claude-code'], { home: notDue, script });
    run(shell, ['turn-end', 'claude-code'], { home: off, script });
    run(shell, ['turn-end', 'claude-code'], { home: none, script });
    AUTOMATED.forEach((env, i) => {
      run(shell, ['turn-end', 'claude-code'], { home: automated[i] ?? '', script, env });
    });
    const due = home(ON(0));
    const started = Date.now();
    const r = run(shell, ['turn-end', 'claude-code'], { home: due, script });
    assert.equal(r.code, 0);
    assert.ok(Date.now() - started < 1000, 'the turn waited for the sync');
    await until(() => {
      const dump = textOf(`${calls}.env`);
      return dump.includes(`HOME=${due}`) && dump.includes('__END__');
    });
    await new Promise((res) => setTimeout(res, 500));
    const homes = readFileSync(`${calls}.env`, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('HOME='));
    assert.deepEqual(
      homes,
      [`HOME=${due}`],
      'a turn started a sync early, while off, or automated',
    );
    assert.equal(readFileSync(calls, 'utf8').trim(), 'activity sync --background');
  });

  /** LAI-792: a person who only ever talks to an Omnigent orchestrator still gets their days sent. */
  void test('an Omnigent orchestrator’s turn end launches the sync once due', async () => {
    const { script, calls } = layout();
    const due = home(ON(0));
    const r = run(shell, ['turn-end', 'claude-code'], {
      home: due,
      script,
      env: OMNI_ORCHESTRATOR,
    });
    assert.equal(r.code, 0);
    await until(() => {
      const dump = textOf(`${calls}.env`);
      return dump.includes(`HOME=${due}`) && dump.includes('__END__');
    });
    assert.equal(readFileSync(calls, 'utf8').trim(), 'activity sync --background');
    assert.equal(events(due).length, 1);
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
 * The budget: ≤ 5 ms for the prompt path, so under zsh it forks nothing and
 * opens no socket. That is proven structurally, with fork() refused and the loaded
 * modules listed, which no amount of load can disturb (LAI-774). Wall time,
 * run the way an agent does (a fresh process per prompt), is the coarse check
 * last.
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
    'under zsh a skipped session keeps its id with builtins alone: an empty PATH still records it',
    { skip: ZSH === undefined },
    () => {
      const h = home();
      const r = run(shell, ['session-start', 'codex'], {
        home: h,
        env: { OMNIGENT: '1', PATH: '' },
        input: payload('019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'),
      });
      assert.equal(r.code, 0);
      assert.deepEqual(skipped(h), ['019a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8']);
    },
  );

  void test(
    'under zsh a skipped session drains stdin with builtins: with an empty PATH it is still drained',
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
   * What an empty PATH cannot show: a command the skip path tried to run and
   * failed to find changes nothing visible there. So every command the hook
   * calls by name is a stub on PATH that logs its own name, and a skipped
   * session must log none. The positive control — the same probe, no marker —
   * must log git. (A command run by absolute path would not be seen by this.)
   */
  void test(
    'under zsh a skipped session runs no external command: stubs for every one it can call stay silent',
    { skip: ZSH === undefined },
    () => {
      const stubs = dir('laika-stubs-');
      const calls = join(stubs, 'calls.log');
      for (const name of ['date', 'cat', 'git', 'awk', 'mv', 'rm', 'nohup', 'dirname']) {
        writeFileSync(join(stubs, name), `#!/bin/sh\necho ${name} >> '${calls}'\n`);
        chmodSync(join(stubs, name), 0o755);
      }
      const repoDir = gitRepo();
      const probe = (env: Record<string, string>): string => {
        rmSync(calls, { force: true });
        const h = home(ON(0));
        for (const mode of ['prompt', 'session-start', 'session-end']) {
          const r = run(shell, [mode, 'codex'], {
            home: h,
            cwd: repoDir,
            env: { ...env, PATH: stubs },
          });
          assert.equal(r.code, 0);
          assert.equal(r.stdout + r.stderr, '');
        }
        return textOf(calls);
      };
      assert.match(
        probe({}),
        /\bgit\b/,
        'the probe saw nothing even unskipped — it proves nothing',
      );
      for (const env of AUTOMATED) {
        assert.equal(probe(env), '', `${JSON.stringify(env)} ran a command`);
      }
    },
  );

  /**
   * `shell` running `args` with fork() refused: `ulimit -u 1` lets this user
   * own no further process, and `exec` is not a fork. zsh abandons a script
   * whose fork fails and exits 1. As root the limit is ignored, which is why
   * each test below first shows it refusing a fork.
   */
  const forkless = (
    args: readonly string[],
    h: string,
    env: Record<string, string> = {},
    input = '{"prompt":"hello"}',
  ): Run => {
    const result = spawnSync(
      '/bin/sh',
      ['-c', 'ulimit -u 1 && exec "$@"', 'sh', ...shell, ...args],
      {
        input,
        env: { PATH: process.env.PATH ?? '', HOME: h, ...env },
        encoding: 'utf8',
      },
    );
    return {
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: (result.error as NodeJS.ErrnoException | undefined)?.code,
    };
  };
  const script = (body: string): string => {
    const path = join(dir('laika-forkless-'), 'probe.sh');
    writeFileSync(path, body);
    return path;
  };

  /**
   * What the stubs above cannot see: a command run by absolute path, a `$(…)`,
   * a subshell, a pipe. Each is a fork, so the prompt path runs as installed
   * with fork() refused, and must still exit 0 having written its line. git,
   * node, curl — anything that is not a builtin — needs a fork first, so this
   * fails for all of them, before the write (no line) or after it (exit 1),
   * on any machine, however loaded.
   */
  void test(
    'under zsh the prompt path forks nothing: with fork() refused it still records and exits 0',
    { skip: ZSH === undefined },
    () => {
      const control = forkless([script('/usr/bin/true\nexit 0\n')], home());
      assert.notEqual(control.code, 0, 'fork() was not refused here — this test proves nothing');
      const h = home();
      const r = forkless([HOOK, 'prompt', 'claude-code'], h);
      assert.equal(r.code, 0, 'the prompt path forked');
      assert.equal(events(h).length, 1, 'the prompt path forked before it wrote');
    },
  );

  /** LAI-792: an Omnigent orchestrator's turns take the prompt path's budget. */
  void test(
    'under zsh an Omnigent orchestrator’s turn forks nothing: with fork() refused both ends still record',
    { skip: ZSH === undefined },
    () => {
      const control = forkless([script('/usr/bin/true\nexit 0\n')], home());
      assert.notEqual(control.code, 0, 'fork() was not refused here — this test proves nothing');
      const h = home();
      const p = forkless([HOOK, 'prompt', 'claude-code'], h, OMNI_ORCHESTRATOR);
      assert.equal(p.code, 0, 'the turn’s start forked');
      const e = forkless([HOOK, 'turn-end', 'claude-code'], h, OMNI_ORCHESTRATOR);
      assert.equal(e.code, 0, 'the turn’s end forked');
      assert.deepEqual(
        events(h).map((line) => line.split(' ')[0]),
        ['t', 'r'],
        'a turn forked before it wrote',
      );
    },
  );

  /** D-090: looking for the marker is builtins too — on both Omnigent paths. */
  void test(
    'under zsh the marker check forks nothing: with fork() refused a notice still records `w`, a person `t`',
    { skip: ZSH === undefined },
    () => {
      const control = forkless([script('/usr/bin/true\nexit 0\n')], home());
      assert.notEqual(control.code, 0, 'fork() was not refused here — this test proves nothing');
      const h = home();
      for (const prompt of [RUNTIME_NOTICES[0] ?? '', 'please fix the build']) {
        const r = forkless(
          [HOOK, 'prompt', 'claude-code'],
          h,
          OMNI_ORCHESTRATOR,
          promptPayload(prompt),
        );
        assert.equal(r.code, 0, 'the marker check forked');
      }
      assert.deepEqual(
        events(h).map(kindOf),
        ['w', 't'],
        'the marker check forked before it wrote',
      );
      const primary = home();
      for (const prompt of [RUNTIME_NOTICES[0] ?? '', 'please fix the build']) {
        const r = forkless(
          [HOOK, 'prompt', 'claude-code'],
          primary,
          OMNI_PRIMARY,
          promptPayload(prompt),
        );
        assert.equal(r.code, 0, 'the primary’s marker check forked');
      }
      assert.deepEqual(events(primary).map(kindOf), ['p']);
    },
  );

  /**
   * LAI-776: `Stop` fires at the end of every turn, so a turn's end that is
   * not due must cost what a prompt costs — no fork. The positive control is
   * the same hook once due: it must fork to launch the sync, and with fork()
   * refused that run fails, so this harness sees this path's forks.
   */
  void test(
    'under zsh a turn’s end that is not due forks nothing: with fork() refused it still exits 0',
    { skip: ZSH === undefined },
    () => {
      const control = forkless([HOOK, 'turn-end', 'claude-code'], home(ON(0)));
      assert.notEqual(control.code, 0, 'a due turn’s end did not fork — this test proves nothing');
      for (const state of [
        ON(9_999_999_999),
        `${JSON.stringify({ collect: false, next_sync_at: 0 })}\n`,
      ]) {
        const r = forkless([HOOK, 'turn-end', 'claude-code'], home(state));
        assert.equal(r.code, 0, `a turn’s end that is not due forked (${state.trim()})`);
        assert.equal(r.stdout + r.stderr, '');
      }
    },
  );

  /**
   * What a refused fork cannot see: zsh opens a socket itself with zsh/net/tcp
   * (`ztcp`) or zsh/net/socket, no process needed, and only a loaded module
   * brings either. So the hook is sourced into a zsh that lists its modules on
   * the way out, fork() still refused, and the prompt path may add datetime
   * and system — nothing else — to what an empty script has.
   */
  void test(
    'under zsh the prompt path opens no socket: it loads no zsh module beyond datetime and system',
    { skip: ZSH === undefined },
    () => {
      const loaded = (path: string, args: readonly string[]): string[] => {
        const h = home();
        const r = forkless(
          ['-c', 'exec 3>&1; trap "zmodload >&3" EXIT; . "$0" "$@"', path, ...args],
          h,
        );
        assert.equal(r.code, 0, `${path} failed: ${r.stderr}`);
        return r.stdout.split('\n').filter(Boolean);
      };
      const bare = loaded(script('exit 0\n'), []);
      assert.ok(bare.includes('zsh/main'), `no module list came back: ${JSON.stringify(bare)}`);
      assert.ok(
        loaded(script('zmodload zsh/net/tcp\nexit 0\n'), []).includes('zsh/net/tcp'),
        'a loaded zsh/net/tcp was not seen — this test proves nothing',
      );
      const extra = loaded(HOOK, ['prompt', 'claude-code']).filter((m) => !bare.includes(m));
      assert.deepEqual(extra.sort(), ['zsh/datetime', 'zsh/system']);
    },
  );

  /**
   * The coarse check; the precise one is above. A fork — git, node, curl — or
   * a socket fails there without timing anything, on any machine. Wall time
   * cannot be that exact on a shared one: inside the repo gate the fastest of
   * 41 runs of this hook came out at 7–12 ms, against 2.8 ms quiet, while a
   * bare `exit 0` only went from 2.1 to 3.5–4.5 ms (LAI-774). Load slows the
   * hook far more than it slows an empty script, so the bare interpreter is the
   * wrong yardstick; the floor below, which does the hook's file and module
   * work, kept within 0.85–0.93× of it at load ~20.
   *
   * So each run is paired with the **floor**: a script doing only what the
   * prompt path cannot avoid — drain stdin, take the time, read state.json,
   * append one line — run beside it, in alternating order, so both meet the
   * same moment's load. The claim: ≤ 5 ms fastest of 41, or, on a machine too
   * loaded for that, a median pair within 2× the floor. Up to three rounds.
   */
  void test('≤ 5 ms per prompt (fastest of 41), or ≤ 2× its own floor run beside it', () => {
    const h = home();
    const floor = join(dir('laika-floor-'), 'floor.sh');
    writeFileSync(
      floor,
      [
        'exec >/dev/null 2>&1',
        'if [ -n "${ZSH_VERSION:-}" ] && zmodload zsh/datetime zsh/system; then',
        '  [ -t 0 ] || while sysread -o 1 -s 65536; do :; done',
        '  NOW="$EPOCHSECONDS"',
        'else',
        '  [ -t 0 ] || cat >/dev/null',
        '  NOW="$(date +%s)"',
        'fi',
        'IFS= read -r STATE <"$HOME/.laika/activity/state.json"',
        'printf \'f %s\\n\' "$NOW" >>"$HOME/.laika/activity/floor.log"',
        'exit 0',
        '',
      ].join('\n'),
    );
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
      const base: number[] = [];
      const ratio: number[] = [];
      for (let i = 0; i < 41; i += 1) {
        const first = i % 2 === 0;
        const b0 = first ? time(floor, []) : 0;
        const t = time(HOOK, ['prompt', 'claude-code']);
        const b = first ? b0 : time(floor, []);
        hook.push(t);
        base.push(b);
        ratio.push(t / b);
      }
      const [fast = 0] = sorted(hook);
      const [fastFloor = 0] = sorted(base);
      const median = sorted(hook)[20] ?? 0;
      const medianFloor = sorted(base)[20] ?? 0;
      const pair = sorted(ratio)[20] ?? 0;
      rounds.push(
        `fastest ${fast.toFixed(2)} ms (floor ${fastFloor.toFixed(2)}), ` +
          `median ${median.toFixed(2)} ms (floor ${medianFloor.toFixed(2)}), ` +
          `median pair ${pair.toFixed(2)}×`,
      );
      ok = fast <= 5 || pair <= 2;
    }
    console.log(`prompt hook (${shell.join(' ')}): ${rounds.join(' | ')}`);
    assert.equal(events(h).length, 41 * rounds.length, 'the hook did not run every time');
    assert.equal(
      textOf(join(h, '.laika', 'activity', 'floor.log'))
        .split('\n')
        .filter(Boolean).length,
      41 * rounds.length,
      'the floor did not run every time — the ratio compares nothing',
    );
    assert.ok(ok, rounds.join(' | '));
  });
});
