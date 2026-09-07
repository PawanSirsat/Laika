/**
 * The four `/laika:` slash commands (SPEC §8, LAI-420).
 *
 * In `cli/` because `plugin/` has no workspace entry (LAI-230).
 *
 * The scripts are driven as subprocesses against a stub board. Everything worth
 * asserting here is a **failure** path — unconfigured, refused, unreachable —
 * and each of those is a message a person reads at the moment something has
 * already gone wrong.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const PLUGIN = fileURLToPath(new URL('../../plugin/', import.meta.url));
const SCRIPTS = `${PLUGIN}scripts/`;
const COMMANDS = `${PLUGIN}commands/`;

const servers: Server[] = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
});

/** A board that answers the two calls the commands make. */
function stubBoard(behaviour: { status?: number } = {}): Promise<string> {
  const server = createServer((req, res) => {
    const status = behaviour.status ?? 200;
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }));
      return;
    }
    const path = req.url ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    if (path.startsWith('/api/v1/me')) {
      res.end(JSON.stringify({ id: 'u1', name: 'Ada Lovelace', org_role: 'owner' }));
    } else if (path.startsWith('/api/v1/capacity')) {
      res.end(
        JSON.stringify({
          enabled: true,
          people: [
            {
              user_id: 'u1',
              name: 'Ada Lovelace',
              active_sessions: 2,
              in_progress_tasks: ['t1'],
              oldest_in_progress_ms: 1,
              tasks_in_review: [],
              last_seen: 1,
              unlisted: [],
            },
          ],
        }),
      );
    } else {
      res.end(JSON.stringify({ data: [], next_cursor: null }));
    }
  });
  servers.push(server);
  server.unref();
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

interface Run {
  readonly code: number;
  readonly out: string;
}

function run(script: string, env: Record<string, string>): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      [`${SCRIPTS}${script}`],
      {
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, out: stdout + stderr });
      },
    );
  });
}

void describe('every command exits 0, whatever went wrong', () => {
  // A slash command that fails hands the agent an error to interpret. Being
  // unconfigured or refused is a normal state and gets a sentence instead.
  for (const script of ['laika-status.sh', 'laika-standup.sh', 'laika-setup.sh']) {
    void test(`${script}: unconfigured`, async () => {
      const result = await run(script, {});
      assert.equal(result.code, 0, result.out);
      assert.ok(result.out.length > 0, 'said nothing at all');
    });

    void test(`${script}: board unreachable`, async () => {
      const result = await run(script, { LAIKA_URL: 'http://127.0.0.1:1', LAIKA_TOKEN: 'lai_x' });
      assert.equal(result.code, 0, result.out);
    });
  }
});

void describe('the three failures are told apart', () => {
  void test('a missing variable is named, not "not configured"', async () => {
    const onlyUrl = await run('laika-standup.sh', { LAIKA_URL: 'http://127.0.0.1:1' });
    assert.match(onlyUrl.out, /LAIKA_TOKEN is not set/, 'does not name the missing variable');

    const onlyToken = await run('laika-standup.sh', { LAIKA_TOKEN: 'lai_x' });
    assert.match(onlyToken.out, /LAIKA_URL is not set/);
  });

  void test('refused is not unreachable — LAI-224, in the plugin', async () => {
    const url = await stubBoard({ status: 401 });
    const refused = await run('laika-standup.sh', { LAIKA_URL: url, LAIKA_TOKEN: 'lai_x' });
    assert.match(refused.out, /token was refused/i);
    assert.doesNotMatch(refused.out, /could not reach/i, 'a refusal reads as an outage');

    const down = await run('laika-standup.sh', {
      LAIKA_URL: 'http://127.0.0.1:1',
      LAIKA_TOKEN: 'lai_x',
    });
    assert.match(down.out, /could not reach/i);
    assert.doesNotMatch(down.out, /refused/i, 'an outage reads as a bad token');
  });

  void test('no failure path is a stack trace', async () => {
    for (const env of [{}, { LAIKA_URL: 'http://127.0.0.1:1', LAIKA_TOKEN: 'lai_x' }]) {
      const result = await run('laika-standup.sh', env);
      assert.doesNotMatch(result.out, /Traceback|line \d+, in |\bat \/|SyntaxError/, result.out);
    }
  });
});

void describe('/laika:status reports capacity it was given', () => {
  void test('it prints the signed-in person and their counts', async () => {
    const url = await stubBoard();
    const result = await run('laika-status.sh', { LAIKA_URL: url, LAIKA_TOKEN: 'lai_realish' });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Ada Lovelace \(owner\)/);
    assert.match(result.out, /Sessions\s+2/);
    assert.match(result.out, /In progress\s+1/);
  });

  void test('the token is never printed', async () => {
    const url = await stubBoard();
    const secret = 'lai_supersecretvalue';
    const result = await run('laika-status.sh', { LAIKA_URL: url, LAIKA_TOKEN: secret });
    assert.ok(!result.out.includes(secret), 'the token appeared in the output');
  });
});

void describe('the command files themselves', () => {
  const files = readdirSync(COMMANDS).filter((f) => f.endsWith('.md'));

  void test('all four of §8 are present, and README is not a command', () => {
    assert.deepEqual(files.sort(), ['setup.md', 'standup.md', 'status.md', 'tasks.md']);
  });

  void test('/laika:setup implements nothing (D-046)', () => {
    const setup = readFileSync(`${COMMANDS}setup.md`, 'utf8');
    const script = readFileSync(`${SCRIPTS}laika-setup.sh`, 'utf8');
    assert.match(setup, /npx laika init/, 'it does not point at the one mechanism');
    // A second minting path is what would make LAI-422's idempotence criterion
    // unprovable — "already configured" would mean "configured somewhere I
    // happen to look".
    assert.ok(!script.includes('/api/v1/tokens'), 'the command mints tokens itself');

    // **It must not read input**, which is the property. My first version here
    // forbade the *word* `password` — and the script says the word four times,
    // explaining that `npx laika init` will ask for one and that a password
    // typed into a chat is a password in a transcript. **An assertion that
    // cannot tell explaining from doing is not a guard**; it fails on the text
    // that makes the command safe to read.
    assert.ok(!/^\s*read\s/m.test(script), 'the command prompts for input');
    assert.ok(!/\bstty\b|setRawMode/.test(script), 'the command takes over the terminal');
    // And it writes nothing: one config location is what makes LAI-422's
    // idempotence criterion provable rather than merely unmet.
    assert.ok(!/>\s*"?\$?\{?(HOME|SETTINGS)/.test(script), 'the command writes a config file');
  });

  void test('/laika:tasks names the tool by its real, measured name', () => {
    const tasks = readFileSync(`${COMMANDS}tasks.md`, 'utf8');
    // `mcp__plugin_<plugin>_<server>__<tool>`. `mcp__laika__…` is the shape a
    // plugin author guesses; it pre-approves nothing and fails as an
    // unexplained permission prompt rather than as an error.
    assert.match(tasks, /allowed-tools: mcp__plugin_laika_laika__list_ready_tasks/);
    assert.ok(!tasks.includes('allowed-tools: mcp__laika__'));
  });

  void test('/laika:tasks forbids printing ids, whichever payload arrives', () => {
    const tasks = readFileSync(`${COMMANDS}tasks.md`, 'utf8');
    // `[\s\S]` and not a literal space: the phrase wraps across a line in the
    // file, and the first version of this assertion failed on the line break
    // rather than on anything about the instruction.
    assert.match(tasks, /never[\s\S]{0,4}an `id`/i, '§7 says an agent works in display keys');
    assert.match(tasks, /display keys/i);
    assert.match(tasks, /structuredContent/, 'the second payload is not mentioned at all');
  });
});
