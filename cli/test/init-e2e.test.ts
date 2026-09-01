/**
 * `init` end to end, against a stub board (LAI-422).
 *
 * **The interactive flow is where the real defects were**, and neither showed
 * up in a unit test of any single function:
 *
 * 1. Each question created its own `readline` and closed it, which ended stdin
 *    for the next one. Every call was correct alone; the **sequence** failed.
 * 2. A piped `readline` closes at EOF — which arrives while `init` is awaiting
 *    a network call — so `laika init < answers` died after the first question.
 *
 * So this drives the built CLI as a subprocess with piped answers and a fake
 * home, and asserts on what it wrote. It is the closest the suite can get to
 * the pty run recorded on the task without adding a dependency.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

/** A board that answers the three calls `init` makes, and nothing else. */
function stubBoard(
  behaviour: { signIn?: number; mint?: number } = {},
): Promise<{ url: string; server: Server; minted: () => number }> {
  let minted = 0;
  const server = createServer((req, res) => {
    const path = req.url ?? '';

    if (path.startsWith('/api/v1/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (path.startsWith('/api/v1/auth/sign-in')) {
      const status = behaviour.signIn ?? 200;
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'laika=abc; Path=/' });
      res.end(JSON.stringify({ token: 'session' }));
      return;
    }
    if (path.startsWith('/api/v1/tokens')) {
      const status = behaviour.mint ?? 201;
      if (status !== 201) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'forbidden', message: 'not allowed' } }));
        return;
      }
      minted += 1;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          token: { name: 'laika-cli', prefix: 'lai_TEST' },
          secret: 'lai_TESTsecretvalue',
        }),
      );
      return;
    }
    res.writeHead(404).end('{}');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${String(port)}`, server, minted: () => minted });
    });
  });
}

const scratch: string[] = [];
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'laika-home-'));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the CLI and wait for it.
 *
 * **Asynchronous, and that is not a style choice.** `execFileSync` blocks the
 * event loop, so the stub board — which lives in this same process — could
 * never answer the child's request, and the whole file deadlocked until the
 * test runner killed it. The symptom was a timeout with no failing assertion,
 * which reads like a hung CLI rather than a hung test.
 */
function runInit(
  url: string,
  dir: string,
  answers: readonly string[],
): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [ENTRY, 'init'],
      { env: { ...process.env, HOME: dir }, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : ((error as { code?: number }).code ?? -1);
        resolve({ out: `${stdout}${stderr}`, code });
      },
    );
    child.stdin?.end(`${[url, ...answers].join('\n')}\n`);
  });
}

const settingsOf = (dir: string): { env?: Record<string, string> } =>
  JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
    env?: Record<string, string>;
  };

void describe('init, end to end', () => {
  void test('a fresh machine ends with a working URL and token', async () => {
    const board = await stubBoard();
    const dir = home();
    try {
      const { out, code } = await runInit(board.url, dir, ['ada@example.com', 'hunter2']);
      assert.equal(code, 0, out);

      const env = settingsOf(dir).env ?? {};
      assert.equal(env.LAIKA_URL, board.url);
      assert.equal(env.LAIKA_TOKEN, 'lai_TESTsecretvalue');
      assert.equal(board.minted(), 1, 'exactly one token should be created');
    } finally {
      board.server.close();
    }
  });

  void test('**the sequence completes** — every question is answered, not just the first', async () => {
    // The regression. Both prompt defects showed as `init` stopping after one
    // or two questions with the settings file never written.
    const board = await stubBoard();
    const dir = home();
    try {
      const { out } = await runInit(board.url, dir, ['ada@example.com', 'hunter2']);
      assert.match(out, /Board URL/);
      assert.match(out, /Email/);
      assert.match(out, /Password/);
      assert.match(out, /Connected/, 'the flow did not reach the end');
      assert.ok(existsSync(join(dir, '.claude', 'settings.json')));
    } finally {
      board.server.close();
    }
  });

  void test('a second run does not silently mint a second token', async () => {
    // AC5. Answering the replace prompt with the default (no).
    const board = await stubBoard();
    const dir = home();
    try {
      await runInit(board.url, dir, ['ada@example.com', 'hunter2']);
      const first = settingsOf(dir).env?.LAIKA_TOKEN;
      assert.equal(board.minted(), 1);

      const { out, code } = await runInit(board.url, dir, ['']);
      assert.equal(code, 0, out);
      assert.match(out, /already connected/i);
      assert.equal(board.minted(), 1, 'a second token was created behind the user');
      assert.equal(settingsOf(dir).env?.LAIKA_TOKEN, first, 'the existing token was replaced');
    } finally {
      board.server.close();
    }
  });

  void test('refused credentials say so, and write nothing', async () => {
    const board = await stubBoard({ signIn: 401 });
    const dir = home();
    try {
      const { out, code } = await runInit(board.url, dir, ['ada@example.com', 'wrong']);
      assert.equal(code, 1);
      assert.match(out, /refused/i);
      assert.ok(!existsSync(join(dir, '.claude', 'settings.json')), 'a failed run wrote settings');
    } finally {
      board.server.close();
    }
  });

  void test('no permission to mint is not the same message as a bad password', async () => {
    // AC6, and the defect LAI-224 and LAI-090 both were.
    const board = await stubBoard({ mint: 403 });
    const dir = home();
    try {
      const { out, code } = await runInit(board.url, dir, ['ada@example.com', 'hunter2']);
      assert.equal(code, 1);
      assert.match(out, /may not create a token/i);
      assert.ok(
        !/password were refused/i.test(out),
        'a permission problem was reported as a bad password',
      );
    } finally {
      board.server.close();
    }
  });

  void test('an unreachable board names the URL, not a stack trace', async () => {
    const dir = home();
    const { out, code } = await runInit('http://127.0.0.1:1', dir, ['a@b.c', 'x']);
    assert.equal(code, 1);
    assert.match(out, /Could not reach that board/);
    assert.ok(!/at Object\.|at async/.test(out), 'a stack trace reached the user');
  });
});
