/**
 * `laika agent launcher enable | disable` and the service files (LAI-1039,
 * D-117a item 9). Nothing here touches launchd or systemd: `run` is recorded,
 * the board is a stub, and the owner's answers are scripted.
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
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { LOCAL_ROOT_ENV } from '../src/agent-handoff.ts';
import { AGENT_MARKER, agentHookGroups, agentHooksProblems, hookFile } from '../src/agent-hooks.ts';
import {
  BRANCH_PROTECTION_NOTE,
  CHECKOUT_TRIES,
  checkoutPath,
  checkRepo,
  CLAUDE_ALLOWED,
  CLAUDE_DENIED,
  claudeArgv,
  claudeMcpProblem,
  codexArgv,
  disable,
  enable,
  launchAgentPlist,
  omnigentArgv,
  plistPath,
  programProblem,
  type RunResult,
  SERVICE_LABEL,
  serviceLines,
  type ServiceIo,
  systemdUnit,
  unitPath,
  unitWord,
} from '../src/agent-launcher-service.ts';
import { argvProblem, configPath, loadConfig } from '../src/agent-launcher.ts';
import { writeCredential } from '../src/agent-session.ts';
import { readClaudeLaika } from '../src/claude-mcp.ts';
import { CLAUDE_HEADERS_HELPER } from '../src/mcp-headers.ts';

const OWNER = '01M2ZHT4HVYDPS7GE8S24CF4HH';
const PROJECT = '01M50CDWK51GKGJ3JQEDM0S507';
const TOKEN = 'lai_SERVICE_TOKEN_SENTINEL';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'laika-1039-svc-')));
  temps.push(dir);
  return dir;
}

const spec = {
  node: '/opt/node/bin/node',
  entry: '/Users/kvelld/laika/cli/dist/index.js',
  path: '/usr/bin:/bin:/opt/homebrew/bin',
  home: '/Users/kvelld',
};

void describe('the service files', () => {
  void test('the LaunchAgent restarts only after an unsuccessful exit, and runs at login', () => {
    const plist = launchAgentPlist(spec);
    assert.ok(plist.includes(`<string>${SERVICE_LABEL}</string>`));
    // KeepAlive is a dict with SuccessfulExit false — never a bare <true/>, which
    // would bring the launcher back after `laika agent launcher stop`.
    assert.match(
      plist,
      /<key>KeepAlive<\/key>\n\s*<dict>\n\s*<key>SuccessfulExit<\/key>\n\s*<false\/>\n\s*<\/dict>/,
    );
    assert.doesNotMatch(plist, /<key>KeepAlive<\/key>\n\s*<true\/>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\n\s*<true\/>/);
    assert.ok(
      plist.includes(
        [
          '<string>/opt/node/bin/node</string>',
          '<string>/Users/kvelld/laika/cli/dist/index.js</string>',
          '<string>agent</string>',
          '<string>launcher</string>',
          '<string>run</string>',
        ].join('\n    '),
      ),
    );
    assert.ok(plist.includes('<string>run</string>\n    <string>--service</string>'));
    assert.ok(plist.includes('<string>/Users/kvelld/.laika/launcher/daemon.log</string>'));
    if (process.platform === 'darwin') {
      const dir = scratch();
      writeFileSync(join(dir, 'p.plist'), plist);
      execFileSync('/usr/bin/plutil', ['-lint', join(dir, 'p.plist')]);
    }
  });

  void test('an odd path is escaped, never markup', () => {
    const plist = launchAgentPlist({ ...spec, home: '/Users/a&b <c>' });
    assert.ok(plist.includes('/Users/a&amp;b &lt;c&gt;'));
  });

  void test('N5: a HOME with spaces, % and $ reaches the unit as itself', () => {
    const unit = systemdUnit({
      node: '/opt/node 22/bin/node',
      entry: '/home/a b/%x$y/laika/cli/dist/index.js',
      path: '/usr/bin:/home/a b/%x$y/bin',
      home: '/home/a b/%x$y',
    });
    assert.match(
      unit,
      /^ExecStart="\/opt\/node 22\/bin\/node" "\/home\/a b\/%%x\$\$y\/laika\/cli\/dist\/index\.js" agent launcher run --service$/m,
    );
    assert.match(unit, /^Environment="HOME=\/home\/a b\/%%x\$y"$/m);
    assert.match(unit, /^Environment="PATH=\/usr\/bin:\/home\/a b\/%%x\$y\/bin"$/m);
    assert.doesNotMatch(unit, /^WorkingDirectory=|^StandardOutput=|^StandardError=/m);
    assert.equal(unitWord('plain/path'), 'plain/path');
    assert.equal(unitWord('say "hi"'), '"say \\"hi\\""');
  });

  void test('the systemd unit restarts on failure only', () => {
    const unit = systemdUnit(spec);
    assert.match(unit, /^Restart=on-failure$/m);
    assert.doesNotMatch(unit, /^Restart=always$/m);
    assert.match(
      unit,
      /^ExecStart=\/opt\/node\/bin\/node \/Users\/kvelld\/laika\/cli\/dist\/index\.js agent launcher run --service$/m,
    );
    assert.match(unit, /^WantedBy=default\.target$/m);
  });
});

void describe('the harness argv', () => {
  void test('Omnigent: `omni run <laika-polly> -p`, never the bundled `omni polly`', () => {
    assert.deepEqual(omnigentArgv('/opt/bin/omni', '/Users/kvelld'), [
      '/opt/bin/omni',
      'run',
      '/Users/kvelld/.laika/omnigent/laika-polly',
      '-p',
    ]);
  });

  void test('Claude Code: headless, dontAsk with an allowlist, no prompts, the denies, caps', () => {
    const argv = claudeArgv('/usr/local/bin/claude');
    const at = (flag: string): string | undefined => argv[argv.indexOf(flag) + 1];
    assert.equal(argv[1], '-p');
    assert.equal(at('--output-format'), 'json');
    assert.equal(at('--permission-mode'), 'dontAsk');
    assert.equal(at('--permission-prompts'), 'none');
    assert.equal(at('--max-turns'), '200');
    assert.equal(at('--max-budget-usd'), '5');
    const allowed = argv.slice(
      argv.indexOf('--allowedTools') + 1,
      argv.indexOf('--disallowedTools'),
    );
    assert.deepEqual(allowed, [...CLAUDE_ALLOWED]);
    assert.ok(allowed.includes('Bash(laika agent *)'), 'the hand-off accept and session helpers');
    assert.ok(allowed.includes('mcp__laika__*'));
    for (const deny of [
      'Bash(git push --force *)',
      'Bash(git push * master*)',
      'Bash(git push * main*)',
    ]) {
      assert.ok(CLAUDE_DENIED.includes(deny), deny);
    }
    assert.ok(argv.length <= 64, 'within the launcher’s argv limit');
    assert.ok(!argv.some((a) => /TOKEN|Bearer/.test(a)));
  });

  void test('B2: gh may only create and read pull requests; merge, api, repo and the push bypasses are denied', () => {
    const argv = claudeArgv('/usr/local/bin/claude');
    const allowed = argv.slice(
      argv.indexOf('--allowedTools') + 1,
      argv.indexOf('--disallowedTools'),
    );
    const denied = argv.slice(argv.indexOf('--disallowedTools') + 1, argv.indexOf('--max-turns'));
    const gh = allowed.filter((a) => a.startsWith('Bash(gh'));
    assert.deepEqual(gh, [
      'Bash(gh pr create *)',
      'Bash(gh pr view *)',
      'Bash(gh pr checks *)',
      'Bash(gh pr list *)',
    ]);
    assert.ok(
      !allowed.includes('Bash(gh pr *)'),
      'no broad gh pr allow: it covers `gh pr merge --admin`',
    );
    for (const deny of [
      'Bash(gh pr merge *)',
      'Bash(gh api *)',
      'Bash(gh repo *)',
      'Bash(git push * main*)',
      'Bash(git push * master*)',
      'Bash(git push * --force*)',
      'Bash(git push * -f*)',
      'Bash(git -c *)',
      'Bash(git -C * push*)',
      'Bash(pnpm exec *)',
      'Bash(pnpm dlx *)',
      'Bash(npx *)',
    ]) {
      assert.ok(denied.includes(deny), deny);
    }
    // An owner-only program, not process.execPath: a CI runner's node is group-writable,
    // which the launcher rightly refuses.
    const program = join(scratch(), 'claude');
    writeFileSync(program, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(program, 0o755);
    assert.equal(argvProblem(claudeArgv(program)), undefined, 'the whole argv passes the launcher');
  });

  void test('B2: enable prints that deny rules are not a boundary and branch protection is', async () => {
    const d = device(['$REPO', 'yes'], {});
    assert.equal(await enable(d.io, ['--dry-run']), 0, d.out.join('\n'));
    assert.ok(d.out.includes(BRANCH_PROTECTION_NOTE), d.out.join('\n'));
    assert.ok(BRANCH_PROTECTION_NOTE.includes('require a pull request AND turn on'));
    assert.ok(BRANCH_PROTECTION_NOTE.includes('"Do not allow bypassing the above settings"'));
  });

  void test('Codex: full access only as written, MCP through the headers helper, no token', () => {
    const argv = codexArgv(
      '/usr/local/bin/codex',
      '/usr/local/bin/laika',
      'https://board.example/',
    );
    assert.deepEqual(argv.slice(0, 5), [
      '/usr/local/bin/codex',
      'exec',
      '--json',
      '--sandbox',
      'danger-full-access',
    ]);
    assert.ok(argv.includes('mcp_servers.laika.url="https://board.example/mcp"'));
    assert.ok(
      argv.includes(
        'mcp_servers.laika.http_headers_helper="/usr/local/bin/laika agent launcher headers codex"',
      ),
    );
    assert.ok(argv.includes('mcp_servers.laika.default_tools_approval_mode="approve"'));
    assert.equal(argv.at(-1), '-', 'the prompt on stdin');
    assert.ok(!argv.some((a) => /TOKEN|Bearer|bearer_token_env_var/.test(a)));
  });
});

/* -------------------------------------------------------------------------- */

interface Rig {
  readonly io: ServiceIo;
  readonly out: string[];
  readonly runs: string[][];
  readonly asked: string[];
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=S', '-c', 'user.email=s@x', ...args], {
    cwd,
    stdio: 'ignore',
    env: { PATH: process.env.PATH ?? '', HOME: cwd },
  });
}

/** `laika agent hooks on`'s set for Claude Code, as it writes it, running `script`. */
function hooksOn(home: string, script: string): void {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    hookFile(home, 'claude-code'),
    JSON.stringify({
      hooks: Object.fromEntries(
        Object.entries(agentHookGroups(script, 'claude-code')).map(([event, group]) => [
          event,
          [group],
        ]),
      ),
    }),
  );
}

/**
 * A device with Claude Code ready, a checkout of the project's repo, and a
 * scripted owner. An answer of `null` is the end of input.
 */
function device(
  answers: (string | null)[],
  extra: { codex?: boolean; hooks?: boolean; git?: string; claudeVersion?: string } = {},
): Rig & { home: string; repo: string; script: string } {
  const home = scratch();
  writeCredential(home, 'claude-code', { url: 'http://board.invalid', token: TOKEN });
  if (extra.codex === true)
    writeCredential(home, 'codex', { url: 'http://board.invalid', token: TOKEN });
  // Claude Code's MCP entry as `laika tool add` writes it, and the session hooks.
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        laika: {
          type: 'http',
          url: 'http://board.invalid/mcp',
          // As `laika tool add claude-code` writes it now (slice D's switching helper).
          headersHelper: CLAUDE_HEADERS_HELPER,
        },
      },
    }),
  );
  const script = join(home, 'plugin', 'scripts', AGENT_MARKER);
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  if (extra.hooks !== false) hooksOn(home, script);
  // The project's repository: a bare remote under the mirror root, and the owner's clone.
  const bare = join(home, 'remotes', 'kvell', 'laika.git');
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const repo = join(home, 'src', 'laika');
  mkdirSync(join(home, 'src'), { recursive: true });
  execFileSync('git', ['clone', '-q', bare, repo], { stdio: 'ignore' });
  const program = join(home, 'bin', 'claude');
  const codex = join(home, 'bin', 'codex');
  mkdirSync(join(home, 'bin'), { recursive: true });
  for (const p of [program, codex]) {
    writeFileSync(p, '#!/bin/sh\necho "2.1.280 (Claude Code)"\n', { mode: 0o755 });
    chmodSync(p, 0o755);
  }
  const out: string[] = [];
  const runs: string[][] = [];
  const asked: string[] = [];
  const owner = answers.map((a) => (a === null ? null : a.replace('$REPO', repo)));
  const io: ServiceIo = {
    out: (l) => out.push(l),
    err: (l) => out.push(l),
    home,
    env: { PATH: process.env.PATH ?? '', HOME: home, [LOCAL_ROOT_ENV]: join(home, 'remotes') },
    cwd: home,
    terminal: true,
    ask: (q) => {
      asked.push(q);
      const next = owner.shift();
      return Promise.resolve(next === null ? undefined : (next ?? ''));
    },
    closeAsk: () => undefined,
    run: (file, args): RunResult => {
      runs.push([file, ...args]);
      if (file === program) {
        return {
          code: 0,
          stdout: `${extra.claudeVersion ?? '2.1.280'} (Claude Code)\n`,
          stderr: '',
        };
      }
      if (file === 'git' && args[0] === 'version') {
        return { code: 0, stdout: `git version ${extra.git ?? '2.45.0'}\n`, stderr: '' };
      }
      if (file === 'git') {
        try {
          const stdout = execFileSync('git', [...args], { encoding: 'utf8', stdio: 'pipe' });
          return { code: 0, stdout, stderr: '' };
        } catch {
          return { code: 128, stdout: '', stderr: '' };
        }
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    fetch: (input) => {
      const path = new URL(input).pathname;
      if (path === '/api/v1/me') return Promise.resolve(Response.json({ id: OWNER }));
      if (path === '/api/v1/projects') {
        return Promise.resolve(
          Response.json({
            data: [
              { id: PROJECT, slug: 'laika', repo: 'kvell/laika' },
              { id: '01M50CDWK51GKGJ3JQEDM0S508', slug: 'norepo', repo: null },
            ],
            next_cursor: null,
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    },
    platform: 'darwin',
    uid: 501,
    node: process.execPath,
    entry: '/opt/laika/cli/dist/index.js',
    laika: '/opt/laika/bin/laika',
    which: (name) => (name === 'claude' ? program : name === 'codex' ? codex : undefined),
  };
  return { io, out, runs, asked, home, repo, script };
}

void describe('enable', () => {
  void test('shows the whole config and writes nothing unless the owner types enable', async () => {
    const d = device(['$REPO', 'yes', 'no thanks']);
    assert.equal(await enable(d.io, []), 1);
    assert.equal(existsSync(configPath(d.home)), false);
    assert.equal(existsSync(plistPath(d.home)), false);
    assert.equal(d.runs.filter((r) => r[0] === '/bin/launchctl').length, 0);
    const text = d.out.join('\n');
    assert.match(text, /This is the config that would be written/);
    assert.match(text, /"dontAsk"/);
    assert.match(text, /norepo: no repository is configured on the board; left out/);
    assert.ok(!text.includes(TOKEN), 'the token is never printed');
  });

  void test('typing enable writes a v2 config the launcher loads, 0600, and starts the LaunchAgent', async () => {
    const d = device(['$REPO', 'yes', 'enable']);
    assert.equal(await enable(d.io, []), 0, d.out.join('\n'));
    const result = loadConfig(d.home);
    assert.equal(result.kind, 'enabled', JSON.stringify(result));
    if (result.kind !== 'enabled') return;
    assert.equal(statSync(configPath(d.home)).mode & 0o777, 0o600);
    const c = result.config;
    assert.equal(c.owner_user_id, OWNER);
    assert.deepEqual(c.projects, [
      { project_id: PROJECT, repo: d.repo, remote: 'origin', work_requests: true },
    ]);
    assert.equal(c.max_concurrent, 1);
    assert.equal(c.max_runtime_seconds, 7200);
    assert.equal(c.max_runs_per_day, 10);
    assert.equal(c.pass_ssh_agent, false);
    assert.deepEqual(c.auto_pickup, { handoffs: true });
    assert.equal(
      c.harnesses['claude-code']?.[c.harnesses['claude-code'].indexOf('--permission-mode') + 1],
      'dontAsk',
    );
    assert.equal(c.harnesses.codex, undefined, 'Codex is off by default');
    assert.ok(existsSync(plistPath(d.home)));
    assert.deepEqual(
      d.runs.find((r) => r[1] === 'bootstrap'),
      ['/bin/launchctl', 'bootstrap', 'gui/501', plistPath(d.home)],
    );
  });

  void test('work requests stay off for a project the owner does not say yes to', async () => {
    const d = device(['$REPO', '', 'enable']);
    assert.equal(await enable(d.io, []), 0, d.out.join('\n'));
    const result = loadConfig(d.home);
    assert.equal(result.kind === 'enabled' && result.config.projects[0]?.work_requests, false);
  });

  void test('Codex is added only when the owner types danger-full-access', async () => {
    // The harness questions come first now (LAI-1111), then the project's.
    const off = device(['yes', '$REPO', 'no', 'enable'], { codex: true });
    assert.equal(await enable(off.io, []), 0, off.out.join('\n'));
    const a = loadConfig(off.home);
    assert.equal(a.kind === 'enabled' && a.config.harnesses.codex, undefined);

    const on = device(['danger-full-access', '$REPO', 'no', 'enable'], { codex: true });
    assert.equal(await enable(on.io, []), 0, on.out.join('\n'));
    const b = loadConfig(on.home);
    assert.ok(b.kind === 'enabled' && b.config.harnesses.codex?.includes('danger-full-access'));
  });

  void test('Claude Code without its session hooks is left out, with the command that fixes it', async () => {
    const d = device(['$REPO', 'yes', 'enable'], { hooks: false });
    assert.equal(await enable(d.io, []), 1);
    assert.match(d.out.join('\n'), /laika agent hooks on --harness claude-code/);
    assert.equal(existsSync(configPath(d.home)), false);
  });

  void test('a checkout whose remote is not the project’s repository says why, and what remote would do', async () => {
    const d = device(['$REPO', '', 'enable']);
    execFileSync('git', [
      '-C',
      d.repo,
      'remote',
      'set-url',
      'origin',
      'https://github.com/someone/else.git',
    ]);
    assert.equal(await enable(d.io, []), 1);
    const text = d.out.join('\n');
    assert.match(text, /laika: no remote of .* is kvell\/laika\n/);
    assert.match(
      text,
      /remote origin \(https:\/\/github\.com\/someone\/else\.git\): the path is not kvell\/laika/,
    );
    assert.match(text, /remote add laika https:\/\/github\.com\/kvell\/laika\.git/);
    assert.match(text, /laika: skipped/);
  });

  void test('--dry-run shows everything and writes nothing', async () => {
    const d = device(['$REPO', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0);
    assert.equal(existsSync(configPath(d.home)), false);
    assert.match(d.out.join('\n'), /--dry-run: nothing was written/);
  });

  void test('LAI-1111: input ending at a question is "input ended", and nothing is written', async () => {
    const d = device([null]);
    assert.equal(await enable(d.io, []), 1);
    const text = d.out.join('\n');
    assert.match(text, /input ended before every question was answered/);
    assert.ok(!text.includes('needs a terminal'), text);
    assert.equal(existsSync(configPath(d.home)), false);
  });

  void test('LAI-1111: with no terminal at all it still says it needs one', async () => {
    const d = device([null]);
    assert.equal(await enable({ ...d.io, terminal: false }, []), 1);
    assert.match(d.out.join('\n'), /enable needs a terminal to answer in/);
  });

  void test('LAI-1111: the readline is closed once, whether enable succeeds or stops', async () => {
    for (const answers of [['$REPO', 'yes'], [null]]) {
      const d = device(answers);
      let closed = 0;
      await enable({ ...d.io, closeAsk: () => (closed += 1) }, ['--dry-run']);
      assert.equal(closed, 1);
    }
  });
});

void describe('LAI-1111: every device check before any project question', () => {
  void test('every failing Claude Code check at once, each with its fix, and no project asked', async () => {
    const d = device(['$REPO', 'yes'], { hooks: false, claudeVersion: '2.1.100' });
    // An MCP entry from an older `laika init`: a token written into the file.
    writeFileSync(
      join(d.home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          laika: {
            type: 'http',
            url: 'http://board.invalid/mcp',
            headers: { Authorization: `Bearer ${TOKEN}` },
          },
        },
      }),
    );
    chmodSync(join(d.home, 'bin'), 0o775);
    assert.equal(await enable(d.io, ['--dry-run']), 1);
    const text = d.out.join('\n');
    assert.deepEqual(d.asked, [], 'no project question before the checks');
    assert.match(text, /claude-code: left out until these are fixed:/);
    assert.match(
      text,
      /Claude Code 2\.1\.100 is older than 2\.1\.259\n\s+Fix: update it: claude update/,
    );
    assert.match(text, /bin, which holds .*claude, is writable by its group \(mode 775\)/);
    assert.match(text, /chmod go-w/);
    assert.match(text, /sends a token written into the file/);
    assert.match(text, /claude mcp remove laika --scope user/);
    assert.match(
      text,
      /its session hooks are not on: .*settings\.json does not exist\n\s+Fix: run `laika agent hooks on --harness claude-code`/,
    );
    assert.match(text, /no harness here can be started unattended/);
    assert.equal((text.match(/^\s+Fix: /gm) ?? []).length, 4, text);
    assert.ok(!text.includes(TOKEN), 'the token is never printed');
  });

  void test('git older than 2.41 is refused before any project question, --dry-run too', async () => {
    const d = device(['$REPO', 'yes'], { git: '2.39.5' });
    assert.equal(await enable(d.io, ['--dry-run']), 1);
    const text = d.out.join('\n');
    assert.match(text, /git: 2\.39 is older than 2\.41, and the launcher needs 2\.41 or later/);
    assert.match(text, /the launcher needs a newer git/);
    assert.deepEqual(d.asked, []);
  });

  void test('a new enough git is said to be ok', async () => {
    const d = device(['$REPO', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0, d.out.join('\n'));
    assert.match(d.out.join('\n'), /git 2\.45: ok/);
    assert.match(d.out.join('\n'), /claude-code: ok/);
  });
});

void describe('LAI-1111: the checkout path', () => {
  void test('~, ~/ and relative paths are read; ~user is not', () => {
    assert.deepEqual(checkoutPath('~', '/Users/me', '/tmp'), { path: '/Users/me', resolved: true });
    assert.deepEqual(checkoutPath('~/src/laika', '/Users/me', '/tmp'), {
      path: '/Users/me/src/laika',
      resolved: true,
    });
    assert.deepEqual(checkoutPath('src/laika', '/Users/me', '/Users/me/work'), {
      path: '/Users/me/work/src/laika',
      resolved: true,
    });
    assert.deepEqual(checkoutPath('../laika', '/Users/me', '/Users/me/work'), {
      path: '/Users/me/laika',
      resolved: true,
    });
    assert.deepEqual(checkoutPath('/abs/laika', '/Users/me', '/tmp'), {
      path: '/abs/laika',
      resolved: false,
    });
    const tilde = checkoutPath('~bob/laika', '/Users/me', '/tmp');
    assert.ok(typeof tilde === 'string');
    assert.match(tilde, /only ~ and ~\/… are read/);
  });

  void test('a relative answer is read from where enable runs, and said', async () => {
    const d = device(['src/laika', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0, d.out.join('\n'));
    assert.ok(d.out.includes(`  (read as ${d.repo})`), d.out.join('\n'));
    assert.ok(d.out.join('\n').includes(`"repo": "${d.repo}"`));
  });

  void test('a bad answer is asked again, and the third good one is taken', async () => {
    const d = device(['/no/such/checkout', 'nowhere', '~/src/laika', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0, d.out.join('\n'));
    const text = d.out.join('\n');
    assert.match(text, /laika: \/no\/such\/checkout does not exist/);
    assert.ok(text.includes(`laika: ${join(d.home, 'nowhere')} does not exist`), text);
    assert.equal((text.match(/Try again, or press Enter to skip this project\./g) ?? []).length, 2);
    assert.ok(text.includes(`"repo": "${d.repo}"`));
  });

  void test(`after ${String(CHECKOUT_TRIES)} bad answers the project is left out`, async () => {
    const d = device(['/a', '/b', '/c', 'never asked']);
    assert.equal(await enable(d.io, ['--dry-run']), 1);
    assert.equal(d.asked.filter((q) => q.startsWith('Checkout of')).length, CHECKOUT_TRIES);
    assert.match(d.out.join('\n'), /laika: left out after 3 answers/);
    assert.match(d.out.join('\n'), /no project has a checkout here/);
  });

  void test('an SSH host alias is named as one: the launcher fetches from github.com itself', () => {
    const d = device([]);
    execFileSync('git', [
      '-C',
      d.repo,
      'remote',
      'set-url',
      'origin',
      'git@github-personal:kvell/laika.git',
    ]);
    const why = checkRepo(d.repo, 'kvell/laika', d.io.env);
    assert.ok(typeof why === 'string');
    assert.match(
      why,
      /remote origin \(git@github-personal:kvell\/laika\.git\): host github-personal is not github\.com: github-personal looks like an SSH host alias/,
    );
    assert.match(why, /git -C '.*' remote add laika https:\/\/github\.com\/kvell\/laika\.git/);
  });

  void test('a checkout with no remote says so', () => {
    const d = device([]);
    execFileSync('git', ['-C', d.repo, 'remote', 'remove', 'origin']);
    const why = checkRepo(d.repo, 'kvell/laika', d.io.env);
    assert.ok(typeof why === 'string');
    assert.match(why, /has no remote, so none is kvell\/laika/);
  });
});

void describe('LAI-1111: the launcher-safe MCP entry', () => {
  void test('tool add’s entry is ready', () => {
    const d = device([]);
    assert.equal(claudeMcpProblem(d.home, {}), undefined);
  });

  void test('an entry with a token in the file names the whole fix: quit, remove, reconnect, tool add', () => {
    const d = device([]);
    writeFileSync(
      join(d.home, '.claude.json'),
      JSON.stringify({ mcpServers: { laika: { headers: { Authorization: `Bearer ${TOKEN}` } } } }),
    );
    const p = claudeMcpProblem(d.home, {});
    assert.ok(p !== undefined);
    assert.match(
      p.what,
      /sends a token written into the file \(as an older `laika init` or `laika connect` wrote it\)/,
    );
    assert.match(
      p.fix,
      /^quit Claude Code; run `claude mcp remove laika --scope user`; then in the browser, open Developer access → Tools → your Claude Code tool → Reconnect \(new credential\)…, and run the `laika tool add claude-code --exchange <id>` it shows$/,
    );
    assert.ok(!`${p.what}${p.fix}`.includes(TOKEN));
  });

  void test('an entry from the environment is named by its variable', () => {
    const d = device([]);
    writeFileSync(
      join(d.home, '.claude.json'),
      JSON.stringify({
        mcpServers: { laika: { headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' } } },
      }),
    );
    assert.match(
      claudeMcpProblem(d.home, {})?.what ?? '',
      /sends \$\{LAIKA_TOKEN\} from the environment/,
    );
  });

  void test('no entry at all: reconnect, nothing to remove', () => {
    const d = device([]);
    writeFileSync(join(d.home, '.claude.json'), '{}');
    const p = claudeMcpProblem(d.home, {});
    assert.match(p?.what ?? '', /has no user-level `laika` MCP entry/);
    assert.match(p?.fix ?? '', /^In the browser/);
    assert.ok(!(p?.fix ?? '').includes('claude mcp remove'));
  });

  void test('CLAUDE_CONFIG_DIR is where Claude Code keeps .claude.json, so it is read there', () => {
    const d = device([]);
    const dir = join(d.home, 'claude-config');
    mkdirSync(dir);
    // tool add's entry under CLAUDE_CONFIG_DIR, an old one at ~/.claude.json.
    writeFileSync(join(dir, '.claude.json'), readFileSync(join(d.home, '.claude.json')));
    writeFileSync(
      join(d.home, '.claude.json'),
      JSON.stringify({ mcpServers: { laika: { headers: { Authorization: 'Bearer x' } } } }),
    );
    assert.equal(claudeMcpProblem(d.home, { CLAUDE_CONFIG_DIR: dir }), undefined);
    assert.notEqual(claudeMcpProblem(d.home, {}), undefined);
    assert.notEqual(readClaudeLaika(d.home, { CLAUDE_CONFIG_DIR: dir }), undefined);
    assert.match(
      claudeMcpProblem(d.home, {})?.what ?? '',
      new RegExp(`${d.home}/\\.claude\\.json`),
    );
  });
});

void describe('LAI-1111: the hooks check reads the hook commands', () => {
  void test('hooks on’s whole set, with a script that exists, is on', () => {
    const d = device([]);
    assert.deepEqual(agentHooksProblems(d.home, 'claude-code'), []);
  });

  void test('the marker somewhere in the file is not the set', () => {
    const d = device([], { hooks: false });
    mkdirSync(join(d.home, '.claude'), { recursive: true });
    writeFileSync(
      hookFile(d.home, 'claude-code'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ command: `laika ${AGENT_MARKER}` }] }] },
      }),
    );
    const [problem] = agentHooksProblems(d.home, 'claude-code');
    assert.match(
      problem ?? '',
      /has no laika-agent-hook command for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SessionEnd$/,
    );
  });

  void test('one event missing is named alone', () => {
    const d = device([]);
    const file = hookFile(d.home, 'claude-code');
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, unknown> };
    delete doc.hooks.Stop;
    writeFileSync(file, JSON.stringify(doc));
    assert.deepEqual(agentHooksProblems(d.home, 'claude-code'), [
      `${file} has no laika-agent-hook command for Stop`,
    ]);
  });

  void test('a set whose script is gone runs nothing, and says so', () => {
    const d = device([]);
    rmSync(d.script);
    assert.deepEqual(agentHooksProblems(d.home, 'claude-code'), [
      `the hook script ${d.script} does not exist (the checkout it was installed from moved or was removed)`,
    ]);
  });

  void test('Codex’s handlers in the Claude file are not Claude Code’s', () => {
    const d = device([], { hooks: false });
    mkdirSync(join(d.home, '.claude'), { recursive: true });
    writeFileSync(
      hookFile(d.home, 'claude-code'),
      JSON.stringify({
        hooks: Object.fromEntries(
          Object.entries(agentHookGroups(d.script, 'codex')).map(([e, g]) => [e, [g]]),
        ),
      }),
    );
    assert.match(
      agentHooksProblems(d.home, 'claude-code')[0] ?? '',
      /has no laika-agent-hook command for SessionStart/,
    );
  });

  void test('no settings file', () => {
    const d = device([], { hooks: false });
    assert.deepEqual(agentHooksProblems(d.home, 'claude-code'), [
      `${hookFile(d.home, 'claude-code')} does not exist`,
    ]);
  });
});

void describe('LAI-1111: a refused program location says why and what to do', () => {
  void test('a folder its group can write', () => {
    const d = device([]);
    chmodSync(join(d.home, 'bin'), 0o775);
    const p = programProblem(claudeArgv(join(d.home, 'bin', 'claude')), 'claude-code');
    assert.ok(p !== undefined);
    assert.match(
      p.what,
      /bin, which holds .*\/claude, is writable by its group \(mode 775\): anyone who can write there could replace what the launcher runs unattended/,
    );
    assert.match(p.fix, /native installer uses ~\/\.local\/bin/);
    assert.match(p.fix, /chmod go-w '.*\/bin'/);
  });

  void test('a program its group can write', () => {
    const d = device([]);
    const program = join(d.home, 'bin', 'codex');
    chmodSync(program, 0o775);
    const p = programProblem([program, 'exec'], 'codex');
    assert.match(p?.what ?? '', /codex is writable by its group \(mode 775\)/);
    assert.match(p?.fix ?? '', /^chmod go-w '.*codex'/);
  });

  void test('a program in a safe folder has no problem', () => {
    const d = device([]);
    assert.equal(
      programProblem(claudeArgv(join(d.home, 'bin', 'claude')), 'claude-code'),
      undefined,
    );
  });
});

void describe('LAI-1111: --dry-run loads the config as the launcher will, and names the checkout', () => {
  void test('a config that would not load is refused in --dry-run too', async () => {
    const d = device(['$REPO', 'yes']);
    // The checkout goes away after it was checked: the launcher would refuse this config.
    const io: ServiceIo = {
      ...d.io,
      ask: async (q) => {
        const a = await d.io.ask(q);
        if (q.startsWith('Start a work request')) rmSync(d.repo, { recursive: true, force: true });
        return a;
      },
    };
    assert.equal(await enable(io, ['--dry-run']), 1);
    const text = d.out.join('\n');
    assert.match(text, /! projects\[0\]\.repo does not exist/);
    assert.match(text, /this config would not load in the launcher/);
    assert.ok(!text.includes('--dry-run: nothing was written'));
  });

  void test('a config that loads is said to', async () => {
    const d = device(['$REPO', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0);
    assert.match(d.out.join('\n'), /It loads as the launcher will read it\./);
  });

  void test('the checkout the service runs the CLI from is named, with its branch', async () => {
    const d = device(['$REPO', 'yes']);
    const entry = join(d.repo, 'cli', 'src', 'index.ts');
    mkdirSync(dirname(entry), { recursive: true });
    assert.equal(await enable({ ...d.io, entry }, ['--dry-run']), 0);
    const text = d.out.join('\n');
    const branch = execFileSync('git', ['-C', d.repo, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    assert.ok(
      text.includes(`That is the CLI in the checkout at ${d.repo} (on ${branch} now):`),
      text,
    );
    assert.match(
      text,
      /switching branches, pulling or editing there changes the launcher’s code at its next start/,
    );
  });

  void test('an entry outside any checkout is not given one', async () => {
    const d = device(['$REPO', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0);
    assert.ok(!d.out.join('\n').includes('That is the CLI in the checkout'));
  });
});

void describe('disable and status', () => {
  void test('B3: disable unloads the LaunchAgent and removes its plist, so a login does not bring it back', async () => {
    const d = device(['$REPO', 'yes', 'enable']);
    assert.equal(await enable(d.io, []), 0);
    assert.ok(existsSync(plistPath(d.home)));
    assert.equal(await disable(d.io), 0);
    assert.deepEqual(d.runs.at(-1), ['/bin/launchctl', 'bootout', `gui/501/${SERVICE_LABEL}`]);
    assert.equal(loadConfig(d.home).kind, 'disabled');
    assert.equal(existsSync(plistPath(d.home)), false, 'no plist left with RunAtLoad');
    assert.ok(existsSync(configPath(d.home)), 'the config is kept');
    const raw = JSON.parse(readFileSync(configPath(d.home), 'utf8')) as { enabled: boolean };
    assert.equal(raw.enabled, false);
  });

  void test('B3: disable on Linux stops the unit and removes it', async () => {
    const d = device(['$REPO', 'yes', 'enable']);
    const linux = { ...d.io, platform: 'linux' as NodeJS.Platform };
    assert.equal(await enable(linux, []), 0, d.out.join('\n'));
    const unit = unitPath(d.home, linux.env);
    assert.ok(existsSync(unit));
    assert.equal(await disable(linux), 0);
    assert.equal(existsSync(unit), false, 'no unit left');
    assert.ok(
      d.runs.some((r) => r.join(' ') === 'systemctl --user disable --now laika-launcher.service'),
    );
  });

  void test('status names the service state', () => {
    const d = device([]);
    assert.deepEqual(serviceLines(d.io), ['Service: not installed']);
  });
});
