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
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { LOCAL_ROOT_ENV } from '../src/agent-handoff.ts';
import { AGENT_MARKER, hookFile } from '../src/agent-hooks.ts';
import {
  BRANCH_PROTECTION_NOTE,
  CLAUDE_ALLOWED,
  CLAUDE_DENIED,
  claudeArgv,
  codexArgv,
  disable,
  enable,
  launchAgentPlist,
  omnigentArgv,
  plistPath,
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
    assert.match(
      BRANCH_PROTECTION_NOTE,
      /branch protection for the default branch \(require a pull request\)/,
    );
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

/** A device with Claude Code ready, a checkout of the project's repo, and a scripted owner. */
function device(
  answers: string[],
  extra: { codex?: boolean; hooks?: boolean } = {},
): Rig & { home: string; repo: string } {
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
          headersHelper: `node -e "x" ${join(home, '.laika/agents/claude-code.json')}`,
        },
      },
    }),
  );
  if (extra.hooks !== false) {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      hookFile(home, 'claude-code'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ command: `laika ${AGENT_MARKER}` }] }] },
      }),
    );
  }
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
  const script = [...answers].map((a) => a.replace('$REPO', repo));
  const io: ServiceIo = {
    out: (l) => out.push(l),
    err: (l) => out.push(l),
    home,
    env: { PATH: process.env.PATH ?? '', HOME: home, [LOCAL_ROOT_ENV]: join(home, 'remotes') },
    ask: (q) => {
      asked.push(q);
      return Promise.resolve(script.shift() ?? '');
    },
    run: (file, args): RunResult => {
      runs.push([file, ...args]);
      if (file === program) return { code: 0, stdout: '2.1.280 (Claude Code)\n', stderr: '' };
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
  return { io, out, runs, asked, home, repo };
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
    const off = device(['$REPO', 'no', 'yes', 'enable'], { codex: true });
    assert.equal(await enable(off.io, []), 0, off.out.join('\n'));
    const a = loadConfig(off.home);
    assert.equal(a.kind === 'enabled' && a.config.harnesses.codex, undefined);

    const on = device(['$REPO', 'no', 'danger-full-access', 'enable'], { codex: true });
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

  void test('a checkout whose remote is not the project’s repository is left out', async () => {
    const d = device(['$REPO', 'yes', 'enable']);
    execFileSync('git', [
      '-C',
      d.repo,
      'remote',
      'set-url',
      'origin',
      'https://github.com/someone/else.git',
    ]);
    assert.equal(await enable(d.io, []), 1);
    assert.match(d.out.join('\n'), /laika: no remote of .* is kvell\/laika; left out/);
  });

  void test('--dry-run shows everything and writes nothing', async () => {
    const d = device(['$REPO', 'yes']);
    assert.equal(await enable(d.io, ['--dry-run']), 0);
    assert.equal(existsSync(configPath(d.home)), false);
    assert.match(d.out.join('\n'), /--dry-run: nothing was written/);
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
