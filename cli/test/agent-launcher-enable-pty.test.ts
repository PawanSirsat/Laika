/**
 * `laika agent launcher enable --dry-run` through a **real terminal**
 * (LAI-1111): the real `cli/bin/laika`, a real pty, real git, a stub board on
 * loopback, and a scripted owner who answers the way a person does.
 *
 * The `enable` unit tests inject `ask`, so the question the owner really
 * answers had never been asked of a terminal. Driven with `expect` on Belka at
 * `23f0267f`, answers pasted at the first prompt were swallowed: each question
 * made its own readline, the first one read every pasted line and kept one,
 * and the next question then waited for ever. End of input said "enable needs
 * a terminal to answer in", on a terminal.
 *
 * The driver is `expect` where it is installed (macOS ships `/usr/bin/expect`)
 * and, on Linux, util-linux's `script`, written to and read from here, with
 * its input kept open until the CLI exits: `script` sends end-of-file when its
 * input ends, which reads as the owner pressing ^D (see the LAI-1109 log).
 * macOS's `script` cannot be the fallback: it refuses an input that is not a
 * terminal itself (`tcgetattr/ioctl: Operation not supported on socket`).
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import { LOCAL_ROOT_ENV } from '../src/agent-handoff.ts';
import { agentHookGroups } from '../src/agent-hooks.ts';
import { configPath } from '../src/agent-launcher.ts';
import { writeCredential } from '../src/agent-session.ts';
import { CLAUDE_HEADERS_HELPER } from '../src/mcp-headers.ts';

const BIN = fileURLToPath(new URL('../bin/laika', import.meta.url));
const OWNER = '01M2ZHT4HVYDPS7GE8S24CF4HH';
const PROJECT = '01M50CDWK51GKGJ3JQEDM0S507';
const TOKEN = 'lai_PTY_TOKEN_SENTINEL';
const CHECKOUT = /Checkout of kvell\/laika for project laika[^\n]*: /;
const WORK_REQUESTS = /Start a work request selected for an agent in laika by itself\?[^\n]*: /;
/** Long enough for a loaded laptop to start node twice; a hang fails well before the test's own limit. */
const WAIT_SECONDS = 25;

function onPath(name: string): string | undefined {
  try {
    const found = execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    return found.trim() === '' ? undefined : found.trim();
  } catch {
    return undefined;
  }
}

type Driver = 'expect' | 'script';

const linuxScript = process.platform === 'linux' && onPath('script') !== undefined;

/** `LAIKA_PTY_DRIVER=script` runs the Linux fallback where `expect` is installed too. */
const driver: Driver | undefined = (() => {
  if (process.env.LAIKA_PTY_DRIVER === 'script') return linuxScript ? 'script' : undefined;
  if (onPath('expect') !== undefined) return 'expect';
  return linuxScript ? 'script' : undefined;
})();
const skip =
  driver === undefined
    ? 'needs a pty driver: expect is not installed, and util-linux script is Linux only, so enable cannot be driven through a terminal here'
    : false;

/** One step of the owner: wait for `prompt`, then type `send` (`\r` is Enter, `\x04` is ^D). */
interface Step {
  readonly prompt: RegExp;
  readonly send: string;
}

interface Session {
  readonly code: number;
  readonly out: string;
}

const tcl = (text: string): string =>
  `"${[...text]
    .map((c) =>
      c === '\r' ? '\\r' : c === '\x04' ? '\\004' : /[\\"$[\]{}]/.test(c) ? `\\${c}` : c,
    )
    .join('')}"`;

function expectScript(steps: readonly Step[]): string {
  const lines = [
    `set timeout ${String(WAIT_SECONDS)}`,
    'spawn -noecho $env(LAIKA_PTY_BIN) agent launcher enable --dry-run',
  ];
  for (const step of steps) {
    lines.push(
      'expect {',
      `  -re {${step.prompt.source}} { send -- ${tcl(step.send)} }`,
      '  timeout { puts "\\nPTY_TIMEOUT"; exit 124 }',
      '  eof { puts "\\nPTY_EOF_BEFORE_PROMPT"; exit 125 }',
      '}',
    );
  }
  lines.push(
    'expect {',
    '  timeout { puts "\\nPTY_TIMEOUT"; exit 124 }',
    '  eof',
    '}',
    'lassign [wait] pid spawnid os_error value',
    'exit $value',
  );
  return `${lines.join('\n')}\n`;
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function drive(home: string, env: NodeJS.ProcessEnv, steps: readonly Step[]): Promise<Session> {
  return new Promise((resolve) => {
    const args = ['agent', 'launcher', 'enable', '--dry-run'];
    let file: string;
    let argv: string[];
    if (driver === 'expect') {
      const script = join(home, 'enable.exp');
      writeFileSync(script, expectScript(steps));
      file = 'expect';
      argv = [script];
    } else {
      file = 'script';
      argv = ['-qec', [BIN, ...args].map(shQuote).join(' '), '/dev/null'];
    }
    const child = spawn(file, argv, {
      env: { ...env, LAIKA_PTY_BIN: BIN },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let next = 0;
    let from = 0;
    const timer = setTimeout(() => {
      out += '\nPTY_TIMEOUT';
      child.kill('SIGKILL');
    }, WAIT_SECONDS * 1000);
    const read = (chunk: Buffer): void => {
      out += chunk.toString('utf8');
      if (driver === 'expect') return;
      // The script driver plays expect's part: each prompt, then its answer.
      for (;;) {
        const step = steps[next];
        if (step === undefined) return;
        const m = step.prompt.exec(out.slice(from));
        if (m === null) return;
        from += m.index + m[0].length;
        next += 1;
        child.stdin.write(step.send);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('close', (code) => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve({ code: code ?? 1, out });
    });
  });
}

let board: Server;
let boardUrl = '';
const temps: string[] = [];

before(async () => {
  board = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const ok = req.headers.authorization === `Bearer ${TOKEN}`;
    res.setHeader('content-type', 'application/json');
    if (!ok) {
      res.statusCode = 401;
      res.end('{}');
    } else if (path === '/api/v1/me') {
      res.end(JSON.stringify({ id: OWNER }));
    } else if (path === '/api/v1/projects') {
      res.end(
        JSON.stringify({
          data: [{ id: PROJECT, slug: 'laika', repo: 'kvell/laika' }],
          next_cursor: null,
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => board.listen(0, '127.0.0.1', resolve));
  boardUrl = `http://127.0.0.1:${String((board.address() as AddressInfo).port)}`;
});
after(() => {
  board.close();
});
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=S', '-c', 'user.email=s@x', ...args], {
    cwd,
    stdio: 'ignore',
    env: { PATH: process.env.PATH ?? '', HOME: cwd },
  });
}

/**
 * A laptop where Claude Code is ready for the launcher — its MCP entry is
 * `tool add`'s, its hooks are `hooks on`'s and their script exists, `claude`
 * is new enough in a folder only its owner writes — with a checkout of the
 * project's repository. Only what is named is in the environment.
 */
function laptop(): { home: string; repo: string; env: NodeJS.ProcessEnv } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'laika-1111-pty-')));
  temps.push(home);
  writeCredential(home, 'claude-code', { url: boardUrl, token: TOKEN });
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        laika: { type: 'http', url: `${boardUrl}/mcp`, headersHelper: CLAUDE_HEADERS_HELPER },
      },
    }),
  );
  const script = join(home, 'laika-agent-hook');
  writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: Object.fromEntries(
        Object.entries(agentHookGroups(script, 'claude-code')).map(([event, group]) => [
          event,
          [group],
        ]),
      ),
    }),
  );
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  chmodSync(bin, 0o755);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "2.1.280 (Claude Code)"\n', { mode: 0o755 });
  const bare = join(home, 'remotes', 'kvell', 'laika.git');
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const repo = join(home, 'src', 'laika');
  mkdirSync(join(home, 'src'), { recursive: true });
  execFileSync('git', ['clone', '-q', bare, repo], { stdio: 'ignore' });
  const env: NodeJS.ProcessEnv = {
    PATH: [bin, '/usr/bin', '/bin', dirname(process.execPath)].join(':'),
    HOME: home,
    LANG: 'C',
    TERM: 'dumb',
    [LOCAL_ROOT_ENV]: join(home, 'remotes'),
  };
  return { home, repo, env };
}

void describe('enable --dry-run on a real terminal', { skip }, () => {
  void test('one answer at a time, each typed after its question', async () => {
    const l = laptop();
    const s = await drive(l.home, l.env, [
      { prompt: CHECKOUT, send: `${l.repo}\r` },
      { prompt: WORK_REQUESTS, send: 'yes\r' },
    ]);
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /--dry-run: nothing was written/);
    assert.match(s.out, /"work_requests": true/);
    assert.ok(s.out.includes(`"repo": "${l.repo}"`), s.out);
    assert.ok(!s.out.includes(TOKEN), 'the token is never printed');
    assert.equal(existsSync(configPath(l.home)), false);
  });

  void test('every answer pasted at once, at the first question', async () => {
    const l = laptop();
    const s = await drive(l.home, l.env, [{ prompt: CHECKOUT, send: `${l.repo}\ryes\r` }]);
    assert.ok(
      !s.out.includes('PTY_TIMEOUT'),
      `a pasted answer was lost and enable waited:\n${s.out}`,
    );
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /"work_requests": true/);
    assert.match(s.out, /--dry-run: nothing was written/);
  });

  void test('~/ is this home, typed on a terminal', async () => {
    const l = laptop();
    const s = await drive(l.home, l.env, [
      { prompt: CHECKOUT, send: '~/src/laika\r' },
      { prompt: WORK_REQUESTS, send: '\r' },
    ]);
    assert.equal(s.code, 0, s.out);
    assert.ok(s.out.includes(`"repo": "${l.repo}"`), s.out);
    assert.match(s.out, /"work_requests": false/);
  });

  void test('^D at a question is "input ended", not "needs a terminal"', async () => {
    const l = laptop();
    const s = await drive(l.home, l.env, [{ prompt: CHECKOUT, send: '\x04' }]);
    assert.equal(s.code, 1, s.out);
    assert.match(s.out, /input ended/);
    assert.ok(!s.out.includes('needs a terminal'), s.out);
    assert.match(s.out, /Nothing was written/);
  });
});
