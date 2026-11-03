/**
 * What the owner sees of a launcher run (LAI-1113): the notification's words
 * and argv, the Terminal viewer's command line and its quoting, the config keys
 * that turn them on, the permissions mode and how the daemon calls all of it.
 * Nothing here shows a notification or opens a window: the runner is a fake,
 * and the one osascript call below only returns its argument.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  configPath,
  launcherCommand,
  exitReason,
  loadConfig,
  permissionsLine,
  permissionsProblem,
  skipsChecks,
  startLauncher,
} from '../src/agent-launcher.ts';
import {
  CLAUDE_ALLOWED,
  CLAUDE_DENIED,
  claudeArgv,
  SKIP_PERMISSIONS_DOCS,
  SKIP_PERMISSIONS_FINDING,
} from '../src/agent-launcher-service.ts';
import {
  claudeProjectDir,
  type Command,
  commandEnv,
  type CommandRunner,
  duration,
  failure,
  laikaPathProblem,
  notice,
  NOTIFY_SCRIPT,
  notifyCommand,
  onPath,
  openViewer,
  OSASCRIPT,
  realRunner,
  runEnding,
  scriptArgs,
  TERMINAL_SCRIPT,
  terminalCommand,
  viewerLine,
} from '../src/agent-launcher-visible.ts';
import {
  audits,
  launchConfig,
  launchRig,
  OWNER,
  PROJECT,
  RUN,
  untilEvent,
} from './support/launch-rig.ts';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'laika-1113-')));
  temps.push(dir);
  return dir;
}

/** An executable only its owner writes, at `path`, that records its argv to `<path>.argv`. */
function recorder(path: string): string {
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.argv"\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

void describe('the notification', () => {
  void test('a start and an exit, in the owner’s words, from checked values only', () => {
    assert.deepEqual(notice({ kind: 'start', taskKey: 'LAIKA-970', harness: 'claude-code' }), {
      title: 'Laika',
      body: 'started LAIKA-970 (Claude Code)',
    });
    assert.deepEqual(
      notice({
        kind: 'exit',
        taskKey: 'LAIKA-970',
        harness: 'claude-code',
        ending: 'finished',
        code: 0,
        signal: null,
        runtimeMs: 18_200,
      }),
      { title: 'Laika', body: 'LAIKA-970 (Claude Code) finished → exit 0, 18 s' },
    );
    assert.equal(
      notice({
        kind: 'exit',
        taskKey: 'LAI-7',
        harness: 'omnigent',
        ending: 'timed out',
        code: null,
        signal: 'SIGKILL',
        runtimeMs: 7_200_000,
      })?.body,
      'LAI-7 (Omnigent) timed out → signal SIGKILL, 2 h 0 min',
    );
    assert.equal(duration(185_000), '3 min 5 s');
  });

  void test('a hostile task key is left out, never escaped into the text', () => {
    for (const key of [
      'LAIKA-970"; do shell script "touch /tmp/x',
      'LAIKA-970\nsecond line',
      'laika-970',
      'LAIKA-970\u202E',
      '-970',
      'LAIKA-',
      `${'A'.repeat(30)}-1`,
      'Fix the login page',
    ]) {
      const n = notice({ kind: 'start', taskKey: key, harness: 'claude-code' });
      assert.deepEqual(n, { title: 'Laika', body: 'started a run (Claude Code)' }, key);
    }
  });

  void test('a harness off the known list, or a number that is not one, shows nothing', () => {
    assert.equal(notice({ kind: 'start', taskKey: 'LAI-1', harness: 'Belka"; rm' }), undefined);
    assert.equal(notice({ kind: 'start', taskKey: 'LAI-1', harness: '__proto__' }), undefined);
    const exit = {
      kind: 'exit' as const,
      taskKey: 'LAI-1',
      harness: 'claude-code',
      ending: 'finished' as const,
      code: 0,
      signal: null,
      runtimeMs: 1000,
    };
    assert.equal(notice({ ...exit, code: 1.5 }), undefined);
    assert.equal(notice({ ...exit, runtimeMs: Number.NaN }), undefined);
    assert.equal(notice({ ...exit, code: null, signal: 'SIGTERM; rm -rf ~' }), undefined);
    assert.equal(notice({ ...exit, ending: 'exploded' as never }), undefined);
  });

  void test('macOS: osascript by its absolute path, an argv array, the values after --', () => {
    const n = { title: 'Laika', body: 'started LAIKA-970 (Claude Code)' };
    const c = notifyCommand('darwin', n, undefined);
    assert.deepEqual(c, {
      file: '/usr/bin/osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 2 of argv) with title (item 1 of argv)',
        '-e',
        'end run',
        '--',
        'Laika',
        'started LAIKA-970 (Claude Code)',
      ],
    });
    // No value is ever in the script lines themselves.
    for (const line of NOTIFY_SCRIPT) assert.ok(!line.includes('LAIKA'), line);
  });

  void test('Linux: notify-send when there is one, nothing — silently — when there is not', () => {
    const n = { title: 'Laika', body: 'LAIKA-1 (Codex) finished → exit 0, 1 s' };
    assert.deepEqual(notifyCommand('linux', n, '/usr/bin/notify-send'), {
      file: '/usr/bin/notify-send',
      args: ['--app-name=Laika', 'Laika', 'LAIKA-1 (Codex) finished → exit 0, 1 s'],
    });
    assert.equal(notifyCommand('linux', n, undefined), undefined);
    assert.equal(notifyCommand('win32', n, undefined), undefined);
    const dir = scratch();
    assert.equal(onPath('notify-send', dir), undefined);
    recorder(join(dir, 'notify-send'));
    assert.equal(onPath('notify-send', `relative:${dir}`), join(dir, 'notify-send'));
  });

  void test('osascript and notify-send get PATH, HOME, LANG and the session bus, nothing else', async () => {
    const env = {
      PATH: '/usr/local/bin:/usr/bin',
      LANG: 'en_ZA.UTF-8',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
      XDG_RUNTIME_DIR: '/run/user/1000',
      SSH_AUTH_SOCK: '/tmp/ssh-agent',
      LAIKA_AGENT_TOKEN: 'lai_ENV_TOKEN_SENTINEL',
      DISPLAY: ':0',
    };
    const want = {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/p',
      LANG: 'en_ZA.UTF-8',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
      XDG_RUNTIME_DIR: '/run/user/1000',
    };
    assert.deepEqual(commandEnv(env, '/home/p'), want);
    assert.deepEqual(commandEnv({}, '/h'), { PATH: '/usr/bin:/bin', HOME: '/h', LANG: 'C' });
    // And the runner really starts the program with exactly that environment.
    const dir = scratch();
    const probe = join(dir, 'probe');
    writeFileSync(probe, '#!/bin/sh\nenv > "$0.env"\n', { mode: 0o755 });
    chmodSync(probe, 0o755);
    const failed = await new Promise<string | undefined>((resolve) => {
      realRunner(commandEnv(env, '/home/p'))({ file: probe, args: [] }, resolve);
    });
    assert.equal(failed, undefined);
    const seen = Object.fromEntries(
      readFileSync(`${probe}.env`, 'utf8')
        .trim()
        .split('\n')
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    for (const [k, v] of Object.entries(want)) assert.equal(seen[k], v, k);
    for (const k of ['SSH_AUTH_SOCK', 'LAIKA_AGENT_TOKEN', 'DISPLAY']) {
      assert.equal(seen[k], undefined, `${k} reached the program`);
    }
  });

  void test('an exit is worded from the audit line’s reason, with the same precedence', () => {
    const cases: [Parameters<typeof exitReason>[0], string, string][] = [
      [{ stopping: false, timedOut: false }, 'exited', 'finished'],
      [{ stopping: false, timedOut: true }, 'timeout', 'timed out'],
      [{ stopping: true, timedOut: false }, 'launcher_stopped', 'was stopped'],
      [{ stopping: true, stopReason: 'deselected', timedOut: false }, 'deselected', 'was stopped'],
      // Timed out, then the launcher was stopped before the run had exited: a stop, as audited.
      [{ stopping: true, timedOut: true }, 'launcher_stopped', 'was stopped'],
    ];
    for (const [run, reason, ending] of cases) {
      assert.equal(exitReason(run), reason, JSON.stringify(run));
      assert.equal(runEnding(exitReason(run)), ending, JSON.stringify(run));
    }
  });

  void test('a title or body with a control character is refused whoever built it', () => {
    for (const body of ['a\nb', 'a\u202Eb', 'a\u0007b', 'a\u2028b']) {
      assert.equal(notifyCommand('darwin', { title: 'Laika', body }, undefined), undefined, body);
    }
  });

  void test(
    'osascript takes the values as data: a hostile one comes back verbatim and runs nothing',
    { skip: process.platform !== 'darwin' && 'osascript is macOS only' },
    () => {
      const dir = scratch();
      const marker = join(dir, 'pwned');
      const hostile = `x" & (do shell script "touch ${marker}") & "y`;
      // The same `on run argv` wrapper and `--` as both scripts, with `return` in place of
      // the line that would show a notification or open a window.
      const echoed = execFileSync(
        OSASCRIPT,
        scriptArgs(['on run argv', 'return item 1 of argv', 'end run'], [hostile]),
        { encoding: 'utf8' },
      );
      assert.equal(echoed.replace(/\n$/, ''), hostile);
      assert.equal(existsSync(marker), false, 'nothing ran');
    },
  );
});

void describe('the Terminal viewer', () => {
  void test('its line is the quoted laika path and a ULID, and nothing else', () => {
    assert.equal(
      viewerLine('/Users/p/.local/bin/laika', RUN),
      `'/Users/p/.local/bin/laika' agent launcher watch --run ${RUN}`,
    );
    const c = terminalCommand('/Users/p/.local/bin/laika', RUN);
    assert.equal(c?.file, '/usr/bin/osascript');
    assert.deepEqual(c?.args.slice(0, -1), [
      '-e',
      'on run argv',
      '-e',
      'tell application "Terminal" to do script (item 1 of argv)',
      '-e',
      'end run',
      '--',
    ]);
    for (const line of TERMINAL_SCRIPT) assert.ok(!line.includes(RUN));
  });

  void test('a run id that is not a ULID, or a laika path that is not absolute and clean, is refused', () => {
    for (const id of [
      `${RUN}; rm -rf ~`,
      RUN.toLowerCase(),
      '$(touch x)',
      '',
      `${RUN} --once`,
      'ILOU0000000000000000000000',
    ]) {
      assert.equal(viewerLine('/usr/local/bin/laika', id), undefined, id);
    }
    for (const laika of [
      'laika',
      './laika',
      '/opt/la\nika',
      '/opt/la\u202Eika',
      '/opt/\u0000x',
      '/opt/la\\ika',
    ]) {
      assert.equal(viewerLine(laika, RUN), undefined, JSON.stringify(laika));
      assert.notEqual(laikaPathProblem(laika), undefined);
    }
    // fish reads `\\` and `\'` inside single quotes as escapes: a backslash would not stay quoted there.
    assert.match(laikaPathProblem('/opt/la\\ika') ?? '', /backslash/);
  });

  void test('a hostile laika path stays one word in sh and zsh: no command runs but laika', () => {
    const root = scratch();
    // Every character a shell would act on outside single quotes, in one folder name.
    // (Not a backslash: that is refused outright, above.)
    const folder = join(root, `it's $(touch PWNED1) \`touch PWNED2\` "q" ; touch PWNED3 & !x *`);
    mkdirSync(folder);
    const laika = recorder(join(folder, 'laika'));
    const line = viewerLine(laika, RUN);
    assert.ok(line !== undefined);
    for (const shell of ['/bin/sh', '/bin/zsh', '/bin/bash']) {
      if (!existsSync(shell)) continue;
      rmSync(`${laika}.argv`, { force: true });
      execFileSync(shell, ['-c', line], { cwd: root, env: { PATH: '/usr/bin:/bin', HOME: root } });
      assert.deepEqual(
        readFileSync(`${laika}.argv`, 'utf8').split('\n').slice(0, -1),
        ['agent', 'launcher', 'watch', '--run', RUN],
        shell,
      );
      for (const p of ['PWNED1', 'PWNED2', 'PWNED3']) {
        assert.equal(existsSync(join(root, p)), false, `${shell} ran ${p}`);
      }
    }
  });

  void test('not macOS, or a window that cannot open: one line, and the run goes on', () => {
    const lines: string[] = [];
    const ran: Command[] = [];
    const failing: CommandRunner = (c, done) => {
      ran.push(c);
      done(
        failure(null, 'execution error: Not authorized to send Apple events to Terminal. (-1743)'),
      );
    };
    openViewer(failing, 'linux', '/usr/bin/laika', RUN, (l) => lines.push(l));
    assert.equal(ran.length, 0, 'nothing is run off macOS');
    openViewer(failing, 'darwin', '/usr/bin/laika', RUN, (l) => lines.push(l));
    assert.equal(ran.length, 1);
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /no Terminal viewer for run .*opens only on macOS.*the run goes on/);
    assert.match(lines[1]!, /-1743: this Mac has not allowed the launcher to control Terminal/);
    const ok: CommandRunner = (_c, done) => done(undefined);
    openViewer(ok, 'darwin', '/usr/bin/laika', RUN, (l) => lines.push(l));
    assert.equal(lines.length, 2, 'nothing logged when it opened');
    openViewer(ok, 'darwin', '/usr/bin/laika', 'not-an-id', (l) => lines.push(l));
    assert.match(lines[2]!, /run \(not an id\) \(its command could not be built/);
    assert.equal(failure({ code: 1 }, ''), 'exit 1');
    assert.equal(failure({ code: 'ENOENT' }, ''), 'ENOENT');
    assert.equal(failure({ code: 'x; rm' }, 'no number'), 'it could not be run');
  });
});

void describe('permissions', () => {
  const at = (argv: string[], flag: string): string | undefined => argv[argv.indexOf(flag) + 1];
  const denied = (argv: string[]): string[] =>
    argv.slice(argv.indexOf('--disallowedTools') + 1, argv.indexOf('--max-turns'));

  void test('both modes keep the whole deny list and the caps; skip replaces only the allowlist', () => {
    const allow = claudeArgv('/usr/local/bin/claude');
    const skip = claudeArgv('/usr/local/bin/claude', 'skip');
    for (const argv of [allow, skip]) {
      assert.deepEqual(denied(argv), [...CLAUDE_DENIED]);
      assert.equal(at(argv, '--max-turns'), '200');
      assert.equal(at(argv, '--max-budget-usd'), '5');
      assert.deepEqual(argv.slice(0, 4), [
        '/usr/local/bin/claude',
        '-p',
        '--output-format',
        'json',
      ]);
      assert.ok(argv.length <= 64);
    }
    assert.equal(at(allow, '--permission-mode'), 'dontAsk');
    assert.ok(!allow.includes('--dangerously-skip-permissions'));
    assert.deepEqual(skip.slice(4, 6), ['--dangerously-skip-permissions', '--disallowedTools']);
    for (const gone of [
      '--permission-mode',
      '--permission-prompts',
      '--allowedTools',
      ...CLAUDE_ALLOWED,
    ]) {
      assert.ok(!skip.includes(gone), gone);
    }
    assert.equal(permissionsProblem(allow, 'allowlist'), undefined);
    assert.equal(permissionsProblem(skip, 'skip'), undefined);
  });

  void test('the argv must agree with the config: skipping is never by accident', () => {
    const skip = claudeArgv('/c', 'skip');
    assert.match(permissionsProblem(skip, 'allowlist') ?? '', /needs "permissions": "skip"/);
    assert.match(
      permissionsProblem(['/c', '-p', '--permission-mode', 'bypassPermissions'], 'allowlist') ?? '',
      /skips permission checks/,
    );
    assert.match(
      permissionsProblem(['/c', '--allow-dangerously-skip-permissions'], 'allowlist') ?? '',
      /skips/,
    );
    assert.match(permissionsProblem(claudeArgv('/c'), 'skip') ?? '', /needs --dangerously-skip/);
    assert.match(
      permissionsProblem(['/c', '-p', '--dangerously-skip-permissions'], 'skip') ?? '',
      /keeps the deny list/,
    );
  });

  void test('skip is the shape enable writes: the two review argvs are refused', () => {
    // Review of 3d8662ab: both loaded, and `check` said the deny list and caps were kept.
    const bare = ['/c', '-p', '--dangerously-skip-permissions', '--disallowedTools'];
    const mixed = [
      '/c',
      '-p',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Nothing',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'Bash',
    ];
    assert.match(
      permissionsProblem(bare, 'skip') ?? '',
      new RegExp(`${String(CLAUDE_DENIED.length)} of its rules are not after --disallowedTools`),
    );
    assert.match(
      permissionsProblem(mixed, 'skip') ?? '',
      /replaces the allowlist: remove --permission-mode, --allowedTools/,
    );
    const ok = claudeArgv('/c', 'skip');
    assert.equal(permissionsProblem(ok, 'skip'), undefined, 'what enable writes is accepted');
    // More deny rules than the launcher's is stricter, and fine.
    const more = [...ok];
    more.splice(more.indexOf('--disallowedTools') + 1, 0, 'Bash(rm *)');
    assert.equal(permissionsProblem(more, 'skip'), undefined);
    const without = (word: string): string[] => ok.filter((w) => w !== word);
    const replaced = (from: string, to: string): string[] => ok.map((w) => (w === from ? to : w));
    const joined = (flag: string): string[] => {
      const i = ok.indexOf(flag);
      return [...ok.slice(0, i), `${flag}=${ok[i + 1]!}`, ...ok.slice(i + 2)];
    };
    const cases: [string[], RegExp][] = [
      [without(CLAUDE_DENIED[3]!), /1 of its rules are not after --disallowedTools/],
      [[...ok, '--permission-prompts', 'none'], /remove --permission-prompts/],
      [[...ok, '--allowedTools=Bash'], /remove --allowedTools/],
      [[...ok, '--disallowedTools', 'Read'], /one --disallowedTools/],
      [
        ok.filter((w, i) => w !== '--max-turns' && ok[i - 1] !== '--max-turns'),
        /needs one --max-turns/,
      ],
      [[...ok, '--max-turns', '9999'], /needs one --max-turns/],
      // Round 2: a second value in the `--flag=value` spelling, or the deny list's alias.
      [[...ok, '--max-turns=999999'], /needs one --max-turns/],
      [[...ok, '--max-budget-usd=99999'], /needs one --max-budget-usd/],
      [[...ok, '--disallowedTools=Read'], /one --disallowedTools, written so/],
      [[...ok, '--disallowed-tools', 'Nothing'], /one --disallowedTools, written so/],
      [[...ok, '--disallowed-tools=Nothing'], /one --disallowedTools, written so/],
      // …or the only one, written as `--flag=value`: the launcher reads two words only.
      [joined('--max-turns'), /needs one --max-turns/],
      [joined('--max-budget-usd'), /needs one --max-budget-usd/],
      [replaced('200', 'lots'), /needs one --max-turns/],
      [replaced('5', '0'), /needs one --max-budget-usd/],
      [
        ok.filter((w, i) => w !== '--max-budget-usd' && ok[i - 1] !== '--max-budget-usd'),
        /needs one --max-budget-usd/,
      ],
    ];
    for (const [argv, why] of cases) {
      assert.match(permissionsProblem(argv, 'skip') ?? '', why, JSON.stringify(argv));
    }
  });

  void test('only the exact flags and values skip checks, not a word that mentions one', () => {
    for (const argv of [
      ['/c', '--dangerously-skip-permissions'],
      ['/c', '--allow-dangerously-skip-permissions'],
      ['/c', '--permission-mode', 'bypassPermissions'],
      ['/c', '--permission-mode=bypassPermissions'],
      // An inline settings JSON can set permissions.defaultMode (round 2).
      ['/c', '--settings', '{"permissions":{"defaultMode":"bypassPermissions"}}'],
      ['/c', '--settings={"permissions":{"defaultMode":"bypassPermissions"}}'],
      ['/c', '--settings', ' {"permissions": {"defaultMode": "bypassPermissions"}}'],
    ]) {
      assert.equal(skipsChecks(argv), true, argv.join(' '));
    }
    for (const argv of [
      [...claudeArgv('/c'), 'Bash(echo bypassPermissions)'],
      ['/c', '--disallowedTools', 'Bash(claude --dangerously-skip-permissions *)'],
      ['/c', '--permission-mode', 'dontAsk', 'bypassPermissions'],
      ['/c', '--settings', '{"model":"opus"}'],
      // A settings file is a path: the launcher cannot read what it will say (README).
      ['/c', '--settings', '/Users/p/bypassPermissions.json'],
    ]) {
      assert.equal(skipsChecks(argv), false, argv.join(' '));
      assert.equal(permissionsProblem(argv, 'allowlist'), undefined);
    }
  });

  void test('check’s line says what the argv says, not what it should', () => {
    const n = String(CLAUDE_DENIED.length);
    assert.equal(
      permissionsLine(claudeArgv('/c', 'skip'), 'skip'),
      `  Claude Code permissions: skip (--dangerously-skip-permissions); deny list of ${n} rules, every one of the launcher’s among them; --max-turns 200; --max-budget-usd 5`,
    );
    const custom = claudeArgv('/c', 'skip').map((w) => (w === '200' ? '50' : w));
    custom.splice(custom.indexOf('--disallowedTools') + 1, 0, 'Bash(rm *)');
    assert.equal(
      permissionsLine(custom, 'skip'),
      `  Claude Code permissions: skip (--dangerously-skip-permissions); deny list of ${String(CLAUDE_DENIED.length + 1)} rules, every one of the launcher’s among them; --max-turns 50; --max-budget-usd 5`,
    );
    assert.equal(
      permissionsLine(['/c', '-e', '0'], 'allowlist'),
      '  Claude Code permissions: allowlist (permission checks on); no deny list; --max-turns not set; --max-budget-usd not set',
    );
    assert.equal(
      permissionsLine(['/c', '--disallowedTools', 'Nothing', '--max-turns', '-1'], 'allowlist'),
      `  Claude Code permissions: allowlist (permission checks on); deny list of 1 rule, ${n} of the launcher’s missing; --max-turns not readable (it must be one --max-turns, written so, followed by its number); --max-budget-usd not set`,
    );
    // A cap raised with a second, `=` spelling is never shown as the first one.
    const raised = [...claudeArgv('/c', 'skip'), '--max-turns=999999', '--max-budget-usd=99999'];
    const line = permissionsLine(raised, 'skip');
    assert.ok(!line.includes('--max-turns 200') && !line.includes('--max-budget-usd 5'), line);
    assert.match(line, /--max-turns not readable .*; --max-budget-usd not readable/);
    assert.match(
      permissionsLine([...claudeArgv('/c', 'skip'), '--disallowed-tools', 'Nothing'], 'skip'),
      /deny list not readable \(it must be one --disallowedTools, written so, followed by its rules\)/,
    );
  });

  void test('the finding enable prints names the docs, the deny rules and the real guard', () => {
    const text = SKIP_PERMISSIONS_FINDING.join('\n');
    assert.ok(text.includes(SKIP_PERMISSIONS_DOCS));
    assert.equal(SKIP_PERMISSIONS_DOCS, 'https://code.claude.com/docs/en/permission-modes.md');
    assert.match(text, /any command with your local credentials/);
    assert.match(text, /deny rules still\s+block/);
    assert.match(text, /matches only\s+the command as written/);
    assert.match(text, /require a pull request AND/);
    assert.match(text, /Do not allow bypassing the above settings/);
  });
});

/* -------------------------------------------------------------------------- */

function writeConfig(home: string, value: Record<string, unknown>): void {
  mkdirSync(join(home, '.laika'), { recursive: true, mode: 0o700 });
  chmodSync(join(home, '.laika'), 0o700);
  writeFileSync(configPath(home), JSON.stringify(value), { mode: 0o600 });
  chmodSync(configPath(home), 0o600);
}

function validConfig(home: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const repo = join(home, 'repo');
  mkdirSync(repo, { recursive: true });
  const claude = recorder(join(home, 'claude'));
  return {
    version: 2,
    enabled: true,
    owner_user_id: OWNER,
    device: 'Belka',
    projects: [{ project_id: PROJECT, repo }],
    harnesses: { 'claude-code': claudeArgv(claude) },
    max_concurrent: 1,
    max_runtime_seconds: 3600,
    ...over,
  };
}

void describe('the config keys', () => {
  void test('unset is off, as before: no notification, no window, the allowlist', () => {
    const home = scratch();
    writeConfig(home, validConfig(home));
    const r = loadConfig(home);
    assert.equal(r.kind, 'enabled', JSON.stringify(r));
    if (r.kind !== 'enabled') return;
    assert.equal(r.config.notify, false);
    assert.equal(r.config.open_terminal, false);
    assert.equal(r.config.laika, undefined);
    assert.equal(r.config.permissions, 'allowlist');
  });

  void test('all three on, as enable writes them, load', () => {
    const home = scratch();
    const laika = recorder(join(home, 'laika'));
    const claude = recorder(join(home, 'claude'));
    writeConfig(
      home,
      validConfig(home, {
        notify: true,
        open_terminal: true,
        laika,
        permissions: 'skip',
        harnesses: { 'claude-code': claudeArgv(claude, 'skip') },
      }),
    );
    const r = loadConfig(home);
    assert.equal(r.kind, 'enabled', JSON.stringify(r));
    if (r.kind !== 'enabled') return;
    assert.equal(r.config.notify, true);
    assert.equal(r.config.open_terminal, true);
    assert.equal(r.config.laika, laika);
    assert.equal(r.config.permissions, 'skip');
  });

  void test('each wrong value is refused with its reason', () => {
    const home = scratch();
    const laika = recorder(join(home, 'laika'));
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ notify: 'yes' }, /notify must be true or false/],
      [{ open_terminal: 1 }, /open_terminal must be true or false/],
      [{ open_terminal: true }, /open_terminal needs "laika"/],
      [{ laika: 'laika' }, /laika: laika must be the absolute path/],
      [{ laika: join(home, 'missing') }, /laika: .* is not an executable file/],
      [{ laika: `${laika}\n` }, /laika holds a control character/],
      [{ permissions: 'yes' }, /permissions must be "allowlist" or "skip"/],
      [
        { permissions: 'skip' },
        /harnesses\.claude-code: "permissions": "skip" needs --dangerously/,
      ],
      [
        { harnesses: { 'claude-code': claudeArgv(recorder(join(home, 'c2')), 'skip') } },
        /harnesses\.claude-code: it skips permission checks, which needs "permissions": "skip"/,
      ],
      [
        { permissions: 'skip', harnesses: { codex: [recorder(join(home, 'codex')), 'exec'] } },
        /permissions "skip" is for harnesses\.claude-code/,
      ],
      [{ version: 1, notify: true }, /notify needs "version": 2/],
      [
        {
          permissions: 'skip',
          harnesses: {
            'claude-code': [
              recorder(join(home, 'c3')),
              '-p',
              '--dangerously-skip-permissions',
              '--disallowedTools',
            ],
          },
        },
        /harnesses\.claude-code: "permissions": "skip" keeps the launcher's whole deny list/,
      ],
      [
        {
          permissions: 'skip',
          harnesses: {
            'claude-code': [
              recorder(join(home, 'c4')),
              '-p',
              '--dangerously-skip-permissions',
              '--disallowedTools',
              'Nothing',
              '--permission-mode',
              'dontAsk',
              '--allowedTools',
              'Bash',
            ],
          },
        },
        /harnesses\.claude-code: "permissions": "skip" replaces the allowlist/,
      ],
      // Round 2's repro: enable's argv with a raised cap appended, in the `=` spelling.
      [
        {
          permissions: 'skip',
          harnesses: {
            'claude-code': [
              ...claudeArgv(recorder(join(home, 'c5')), 'skip'),
              '--max-budget-usd=99999',
            ],
          },
        },
        /harnesses\.claude-code: "permissions": "skip" needs one --max-budget-usd/,
      ],
      [
        {
          permissions: 'skip',
          harnesses: {
            'claude-code': [
              ...claudeArgv(recorder(join(home, 'c6')), 'skip'),
              '--max-turns=999999',
            ],
          },
        },
        /harnesses\.claude-code: "permissions": "skip" needs one --max-turns/,
      ],
      [
        {
          harnesses: {
            'claude-code': [
              ...claudeArgv(recorder(join(home, 'c7'))),
              '--settings',
              '{"permissions":{"defaultMode":"bypassPermissions"}}',
            ],
          },
        },
        /harnesses\.claude-code: it skips permission checks, which needs "permissions": "skip"/,
      ],
    ];
    for (const [over, why] of cases) {
      writeConfig(home, validConfig(home, over));
      const r = loadConfig(home);
      assert.equal(r.kind, 'invalid', JSON.stringify(over));
      if (r.kind === 'invalid') assert.match(r.errors.join('\n'), why, JSON.stringify(over));
    }
  });

  void test('upgrading: a skip argv written before LAI-1113 is refused until the key says skip', async () => {
    const home = scratch();
    const claude = recorder(join(home, 'claude'));
    const old = [claude, '-p', '--dangerously-skip-permissions', '--max-turns', '200'];
    writeConfig(home, validConfig(home, { harnesses: { 'claude-code': old } }));
    const out: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(l), home, env: {} };
    // The login service: one refused line, exit 0 (no restart loop), nothing started.
    assert.equal(await launcherCommand(io, ['run', '--service']), 0);
    assert.deepEqual(
      audits(home).map((l) => [l.event, l.reason, l.detail]),
      [['refused', 'config_invalid', 'service']],
    );
    assert.equal(await launcherCommand(io, ['check']), 1);
    assert.match(
      out.join('\n'),
      /harnesses\.claude-code: it skips permission checks, which needs "permissions": "skip"/,
    );
    // Enable's argv and the key: it loads.
    writeConfig(
      home,
      validConfig(home, {
        permissions: 'skip',
        harnesses: { 'claude-code': claudeArgv(claude, 'skip') },
      }),
    );
    assert.equal(loadConfig(home).kind, 'enabled');
  });

  void test('check and status show the three settings', async () => {
    const home = scratch();
    const laika = recorder(join(home, 'laika'));
    const claude = recorder(join(home, 'claude'));
    const out: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(l), home, env: {} };
    writeConfig(home, validConfig(home));
    await launcherCommand(io, ['check']);
    assert.ok(out.includes('  notifications: off'), out.join('\n'));
    assert.ok(out.includes('  a Terminal window per run: off'));
    assert.ok(
      out.includes(
        `  Claude Code permissions: allowlist (permission checks on); deny list of ${String(CLAUDE_DENIED.length)} rules, every one of the launcher’s among them; --max-turns 200; --max-budget-usd 5`,
      ),
      out.join('\n'),
    );
    out.length = 0;
    writeConfig(
      home,
      validConfig(home, {
        notify: true,
        open_terminal: true,
        laika,
        permissions: 'skip',
        harnesses: { 'claude-code': claudeArgv(claude, 'skip') },
      }),
    );
    for (const sub of ['check', 'status']) {
      out.length = 0;
      await launcherCommand(io, [sub]);
      const text = out.join('\n');
      assert.match(text, /^ {2}notifications: on$/m, sub);
      assert.ok(
        out.includes(`  a Terminal window per run: on (${laika} agent launcher watch --run <id>)`),
        text,
      );
      assert.ok(
        out.includes(
          `  Claude Code permissions: skip (--dangerously-skip-permissions); deny list of ${String(CLAUDE_DENIED.length)} rules, every one of the launcher’s among them; --max-turns 200; --max-budget-usd 5`,
        ),
        text,
      );
    }
    // The review's two argvs: refused, so no "kept" line is ever printed for them.
    writeConfig(
      home,
      validConfig(home, {
        permissions: 'skip',
        harnesses: {
          'claude-code': [claude, '-p', '--dangerously-skip-permissions', '--disallowedTools'],
        },
      }),
    );
    out.length = 0;
    await launcherCommand(io, ['check']);
    assert.match(out.join('\n'), /config invalid, refusing to run/);
    assert.ok(!out.some((l) => l.includes('Claude Code permissions:')), out.join('\n'));
  });
});

/* -------------------------------------------------------------------------- */

void describe('the daemon shows each run', () => {
  void test('a notification at start and at exit, and a viewer for its run id; no device text', async () => {
    const notices: { title: string; body: string }[] = [];
    const viewers: [string, string][] = [];
    const r = launchRig(scratch(), {
      notify: (n) => notices.push(n),
      openViewer: (laika, id) => viewers.push([laika, id]),
    });
    const launcher = startLauncher(
      r.deps,
      launchConfig({ notify: true, open_terminal: true, laika: '/opt/laika/bin/laika' }),
    );
    await untilEvent(r.home, 'exit');
    r.stop();
    await launcher.finished;
    assert.equal(notices.length, 2, JSON.stringify(notices));
    assert.deepEqual(notices[0], { title: 'Laika', body: 'started LAIKA-810 (Claude Code)' });
    assert.match(notices[1]!.body, /^LAIKA-810 \(Claude Code\) finished → exit 0, \d+ s$/);
    assert.deepEqual(viewers, [['/opt/laika/bin/laika', RUN]]);
    assert.ok(!JSON.stringify(notices).includes('Belka'), 'the device label is never shown');
    assert.ok(!JSON.stringify(notices).includes('ignore all that'), 'nor the note');
    // The start says where watch finds the run.
    const start = audits(r.home).find((l) => l.event === 'start');
    assert.equal(start?.worktree, join(r.home, 'wt'));
    assert.equal(start?.transcript_dir, claudeProjectDir(r.home, join(r.home, 'wt')));
  });

  void test('off unless the config says so', async () => {
    let calls = 0;
    const r = launchRig(scratch(), { notify: () => (calls += 1), openViewer: () => (calls += 1) });
    const launcher = startLauncher(r.deps, launchConfig({ laika: '/opt/laika/bin/laika' }));
    await untilEvent(r.home, 'exit');
    r.stop();
    await launcher.finished;
    assert.equal(calls, 0);
  });

  void test('a run that times out is notified as timed out, as its audit line says', async () => {
    const notices: { title: string; body: string }[] = [];
    const r = launchRig(scratch(), { notify: (n) => notices.push(n) });
    const launcher = startLauncher(
      r.deps,
      launchConfig({
        notify: true,
        max_runtime_seconds: 1,
        harnesses: { 'claude-code': [process.execPath, '-e', 'setTimeout(() => {}, 30000)'] },
      }),
    );
    await untilEvent(r.home, 'exit');
    r.stop();
    await launcher.finished;
    const exit = audits(r.home).find((l) => l.event === 'exit');
    assert.equal(exit?.reason, 'timeout');
    assert.match(
      notices[1]?.body ?? '',
      /^LAIKA-810 \(Claude Code\) timed out → signal SIGTERM, \d+ s$/,
    );
  });

  void test('a notifier or viewer that throws changes nothing about the run', async () => {
    const r = launchRig(scratch(), {
      notify: () => {
        throw new Error('no GUI');
      },
      openViewer: () => {
        throw new Error('no Terminal');
      },
    });
    const launcher = startLauncher(
      r.deps,
      launchConfig({ notify: true, open_terminal: true, laika: '/opt/laika/bin/laika' }),
    );
    await untilEvent(r.home, 'exit');
    r.stop();
    await launcher.finished;
    const exit = audits(r.home).find((l) => l.event === 'exit');
    assert.equal(exit?.code, 0);
    assert.equal(exit?.reason, 'exited');
  });
});
