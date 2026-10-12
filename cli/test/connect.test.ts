/**
 * `laika connect <agent>` (LAI-737).
 *
 * **What must never go wrong here is somebody else's file and the token.** The
 * command edits configuration that belongs to other tools — a Cursor or Gemini
 * settings file can hold a dozen other servers — so most of what follows is
 * about what it leaves alone: unrelated keys, an unparseable file, a `.bak` that
 * already holds the original, a Codex table that already exists.
 *
 * The token is asserted against with a distinctive fake value, by searching
 * every byte the command printed and every file it wrote. Antigravity is the one
 * client with no env-var expansion, so it is the one file allowed to carry it.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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
import { afterEach, describe, test } from 'node:test';

import { AGENTS, resolveAgent } from '../src/agents.ts';
import { connect, planConnect, rcFileFor, type ConnectIo } from '../src/connect.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const URL_ = 'http://board.test:3000';
const TOKEN = 'lai_FakeTokenZq7xThatMustNeverLeak';

/** The slugs the task names. Asserted against the module's list from both sides. */
const REQUIRED = [
  'claude-code',
  'codex',
  'cursor',
  'antigravity',
  'opencode',
  'gemini-cli',
  'vscode',
  'windsurf',
  'omnigent',
  'hermes',
  'zed',
  'cline',
  'roo',
  'continue',
  'kiro',
  'goose',
  'amp',
  'junie',
  'warp',
  'claude-desktop',
  'other',
] as const;

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  readonly io: ConnectIo;
  readonly home: string;
  readonly cwd: string;
  readonly lines: string[];
  readonly printed: () => string;
}

/**
 * A fake HOME and project directory, with credentials in the environment by
 * default. The prompt functions throw: a test that reaches them without
 * meaning to has found a bug, not a hang.
 */
function harness(
  env: Readonly<Record<string, string | undefined>> = {
    SHELL: '/bin/zsh',
    LAIKA_URL: URL_,
    LAIKA_TOKEN: TOKEN,
  },
  answers?: { url: string; token: string; asked: string[] },
): Harness {
  const root = mkdtempSync(join(tmpdir(), 'laika-connect-'));
  scratch.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });

  const lines: string[] = [];
  const io: ConnectIo = {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    home,
    cwd,
    env,
    ask: (question) => {
      if (answers === undefined) throw new Error(`unexpected prompt: ${question}`);
      answers.asked.push(question);
      return Promise.resolve(answers.url);
    },
    askSecret: (question) => {
      if (answers === undefined) throw new Error(`unexpected secret prompt: ${question}`);
      answers.asked.push(question);
      return Promise.resolve(answers.token);
    },
  };
  return { io, home, cwd, lines, printed: () => lines.join('\n') };
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

/** Every file under `dir`, recursively — a census, not a sample. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

const mode = (path: string): number => statSync(path).mode & 0o777;

void describe('the agent list', () => {
  void test('every slug the task names resolves, and the module lists no slug it does not', () => {
    const listed = AGENTS.map((a) => a.slug);
    for (const slug of REQUIRED) {
      assert.equal(resolveAgent(slug)?.slug, slug, `${slug} does not resolve`);
    }
    for (const slug of listed) {
      assert.ok((REQUIRED as readonly string[]).includes(slug), `${slug} is listed but not named`);
    }
  });

  void test('the obvious aliases resolve to their agents', () => {
    assert.equal(resolveAgent('claude')?.slug, 'claude-code');
    assert.equal(resolveAgent('gemini')?.slug, 'gemini-cli');
    assert.equal(resolveAgent('copilot')?.slug, 'vscode');
    assert.equal(resolveAgent('code')?.slug, 'vscode');
    assert.equal(resolveAgent('agy')?.slug, 'antigravity');
    assert.equal(resolveAgent('not-an-agent'), undefined);
  });

  void test('an unknown agent fails and names the valid ones', async () => {
    const h = harness();
    const code = await connect(['notepad'], h.io);
    assert.equal(code, 1);
    assert.match(h.printed(), /unknown agent "notepad"/);
    for (const slug of REQUIRED) assert.ok(h.printed().includes(slug), `${slug} not offered`);
    assert.deepEqual(filesUnder(h.home), [], 'an unknown agent wrote something');
  });
});

void describe('each written format has the shape its client reads', () => {
  void test('cursor — url is the literal board, header uses ${env:LAIKA_TOKEN}', async () => {
    const h = harness();
    assert.equal(await connect(['cursor'], h.io), 0, h.printed());
    const file = readJson(join(h.home, '.cursor', 'mcp.json'));
    assert.deepEqual(file, {
      mcpServers: {
        laika: {
          url: `${URL_}/mcp`,
          headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
        },
      },
    });
    assert.match(h.printed(), /cursor-agent mcp enable laika/);
  });

  void test('cursor --project writes .cursor/mcp.json in the working directory', async () => {
    const h = harness();
    assert.equal(await connect(['cursor', '--project'], h.io), 0, h.printed());
    assert.ok(existsSync(join(h.cwd, '.cursor', 'mcp.json')));
    assert.ok(!existsSync(join(h.home, '.cursor', 'mcp.json')), 'user scope written too');
  });

  void test('codex — bearer_token_env_var names the variable, url is literal', async () => {
    const h = harness();
    assert.equal(await connect(['codex'], h.io), 0, h.printed());
    const text = readFileSync(join(h.home, '.codex', 'config.toml'), 'utf8');
    assert.equal(
      text,
      `[mcp_servers.laika]\nurl = "${URL_}/mcp"\nbearer_token_env_var = "LAIKA_TOKEN"\n`,
    );
    assert.match(h.printed(), /codex mcp add laika --url "\$LAIKA_URL\/mcp"/);
  });

  void test('gemini-cli — type http and ${LAIKA_TOKEN}', async () => {
    const h = harness();
    assert.equal(await connect(['gemini-cli'], h.io), 0, h.printed());
    assert.deepEqual(readJson(join(h.home, '.gemini', 'settings.json')), {
      mcpServers: {
        laika: {
          type: 'http',
          url: `${URL_}/mcp`,
          headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
        },
      },
    });
  });

  void test('opencode — type remote, oauth false, {env:LAIKA_TOKEN}, $schema on create', async () => {
    const h = harness();
    assert.equal(await connect(['opencode'], h.io), 0, h.printed());
    assert.deepEqual(readJson(join(h.home, '.config', 'opencode', 'opencode.json')), {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        laika: {
          type: 'remote',
          url: `${URL_}/mcp`,
          enabled: true,
          oauth: false,
          headers: { Authorization: 'Bearer {env:LAIKA_TOKEN}' },
        },
      },
    });
  });

  void test('opencode — $schema is not added to a file that already exists', async () => {
    const h = harness();
    const path = join(h.home, '.config', 'opencode', 'opencode.json');
    mkdirSync(join(h.home, '.config', 'opencode'), { recursive: true });
    writeFileSync(path, '{"theme":"dark"}');
    assert.equal(await connect(['opencode'], h.io), 0, h.printed());
    const after = readJson(path);
    assert.equal(after.$schema, undefined, '$schema was added to an existing file');
    assert.equal(after.theme, 'dark');
  });

  void test('claude-code — user scope edits nothing and points at the plugin', async () => {
    const h = harness();
    assert.equal(await connect(['claude-code'], h.io), 0, h.printed());
    assert.ok(!existsSync(join(h.home, '.claude.json')), '~/.claude.json was written');
    assert.match(h.printed(), /laika-claude/);
    assert.match(
      h.printed(),
      /claude mcp add --transport http --scope user laika "\$LAIKA_URL\/mcp" --header "Authorization: Bearer \$LAIKA_TOKEN"/,
    );
  });

  void test('claude-code --project — .mcp.json references both variables', async () => {
    const h = harness();
    assert.equal(await connect(['claude-code', '--project'], h.io), 0, h.printed());
    assert.deepEqual(readJson(join(h.cwd, '.mcp.json')), {
      mcpServers: {
        laika: {
          type: 'http',
          url: '${LAIKA_URL}/mcp',
          headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
        },
      },
    });
  });

  void test('vscode — user scope prints code --add-mcp; --project writes servers.laika', async () => {
    const user = harness();
    assert.equal(await connect(['vscode'], user.io), 0, user.printed());
    assert.ok(
      user.printed().includes(`code --add-mcp '{"name":"laika","type":"http","url":"${URL_}/mcp"`),
    );
    assert.match(user.printed(), /inferred/i, 'the HTTP shape is not marked as inferred');

    const project = harness();
    assert.equal(await connect(['vscode', '--project'], project.io), 0, project.printed());
    assert.deepEqual(readJson(join(project.cwd, '.vscode', 'mcp.json')), {
      servers: {
        laika: {
          type: 'http',
          url: `${URL_}/mcp`,
          headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
        },
      },
    });
  });

  void test('antigravity — serverUrl, the token inline, the file 0600, and a warning', async () => {
    const h = harness();
    assert.equal(await connect(['antigravity'], h.io), 0, h.printed());
    const path = join(h.home, '.gemini', 'config', 'mcp_config.json');
    assert.deepEqual(readJson(path), {
      mcpServers: {
        laika: { serverUrl: `${URL_}/mcp`, headers: { Authorization: `Bearer ${TOKEN}` } },
      },
    });
    assert.equal(mode(path), 0o600, `expected 0600, got ${mode(path).toString(8)}`);
    assert.match(h.printed(), /inline/i);
    assert.match(h.printed(), /server\/discover/);
    assert.ok(!h.printed().includes(TOKEN), 'the token was printed');
  });

  void test('antigravity — an existing world-readable file, and its .bak, end up 0600', async () => {
    // `writeFileSync`'s mode applies only on create, so this is the case the
    // explicit chmod exists for.
    const h = harness();
    const path = join(h.home, '.gemini', 'config', 'mcp_config.json');
    mkdirSync(join(h.home, '.gemini', 'config'), { recursive: true });
    writeFileSync(path, '{"mcpServers":{}}', { mode: 0o644 });
    assert.equal(mode(path), 0o644, 'the fixture is not world-readable');

    assert.equal(await connect(['antigravity'], h.io), 0, h.printed());
    assert.equal(mode(path), 0o600, `expected 0600, got ${mode(path).toString(8)}`);
    assert.equal(mode(`${path}.bak`), 0o600, 'the backup is wider than the file');
  });

  void test('antigravity --project is refused and writes nothing', async () => {
    const h = harness();
    assert.equal(await connect(['antigravity', '--project'], h.io), 1);
    assert.match(h.printed(), /commit/i, 'the refusal does not say why');
    assert.deepEqual(filesUnder(h.cwd), [], 'something was written in the project');
    assert.deepEqual(filesUnder(h.home), [], 'something was written in HOME');
  });

  void test('omnigent --dir writes the sidecar exactly; a second run is a no-op', async () => {
    const h = harness();
    const agentDir = join(h.cwd, 'my-agent');
    mkdirSync(agentDir);
    assert.equal(await connect(['omnigent', '--dir', agentDir], h.io), 0, h.printed());
    const path = join(agentDir, 'tools', 'mcp', 'laika.yaml');
    const expected =
      'name: laika\ntransport: http\nurl: ${LAIKA_URL}/mcp\nheaders:\n' +
      '  Authorization: "Bearer ${LAIKA_TOKEN}"\n';
    assert.equal(readFileSync(path, 'utf8'), expected);

    const again = harness(h.io.env);
    const second = { ...again.io, home: h.home, cwd: h.cwd };
    assert.equal(await connect(['omnigent', '--dir', agentDir], second), 0);
    assert.match(again.printed(), /already configured/i);
    assert.ok(!existsSync(`${path}.bak`), 'an identical file was backed up');
  });

  void test('omnigent — a different sidecar is backed up before it is replaced', async () => {
    const h = harness();
    const dir = join(h.cwd, 'tools', 'mcp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'laika.yaml'), 'name: laika\nold: true\n');
    assert.equal(await connect(['omnigent', '--project'], h.io), 0, h.printed());
    // Review round 1: a project-side file is backed up under ~/.laika/backups,
    // never beside itself — a .bak in a repository is one `git add .` from a commit.
    assert.ok(!existsSync(join(dir, 'laika.yaml.bak')), 'a .bak was left in the agent folder');
    const backups = filesUnder(join(h.home, '.laika', 'backups'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(backups[0] ?? '', 'utf8'), 'name: laika\nold: true\n');
    assert.match(readFileSync(join(dir, 'laika.yaml'), 'utf8'), /^transport: http$/m);
  });

  void test('omnigent with neither --dir nor --project prints both snippets and writes none', async () => {
    const h = harness();
    assert.equal(await connect(['omnigent'], h.io), 0, h.printed());
    assert.ok(!existsSync(join(h.cwd, 'tools')), 'a sidecar was written');
    assert.match(h.printed(), /type: mcp/);
    assert.match(h.printed(), /transport: http/);
    assert.match(h.printed(), /no user-level/i);
  });

  void test('bridge clients get mcp-remote with --allow-http and a token placeholder', async () => {
    for (const slug of ['kiro', 'claude-desktop', 'zed', 'junie', 'other']) {
      const h = harness();
      assert.equal(await connect([slug], h.io), 0, `${slug}: ${h.printed()}`);
      assert.match(h.printed(), /mcp-remote@0\.14\.3/, `${slug} has no bridge`);
      assert.match(h.printed(), /--allow-http/, `${slug} bridge lacks --allow-http`);
      assert.match(h.printed(), /Bearer lai_\.\.\./, `${slug} has no placeholder`);
      assert.match(h.printed(), /~\/\.laika\/env/, `${slug} does not say where the token is`);
    }
  });
});

void describe('never clobber', () => {
  void test('a merge keeps every unrelated key and server', async () => {
    const h = harness();
    const path = join(h.home, '.cursor', 'mcp.json');
    mkdirSync(join(h.home, '.cursor'));
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { url: 'x' } }, keep: [1, 2] }));
    assert.equal(await connect(['cursor'], h.io), 0, h.printed());
    const after = readJson(path) as { mcpServers: Record<string, unknown>; keep: unknown };
    assert.deepEqual(after.mcpServers.other, { url: 'x' }, 'another server was lost');
    assert.deepEqual(after.keep, [1, 2], 'an unrelated key was lost');
    assert.ok(after.mcpServers.laika !== undefined);
    assert.ok(readFileSync(path, 'utf8').endsWith('}\n'), 'no trailing newline');
    assert.match(readFileSync(path, 'utf8'), /^ {2}"mcpServers"/m, 'not two-space indented');
  });

  void test('.bak holds the ORIGINAL bytes and is not overwritten by a later change', async () => {
    const h = harness();
    const path = join(h.home, '.gemini', 'settings.json');
    mkdirSync(join(h.home, '.gemini'));
    const original = '{ "theme":   "dark" }';
    writeFileSync(path, original);

    assert.equal(await connect(['gemini-cli'], h.io), 0, h.printed());
    assert.equal(readFileSync(`${path}.bak`, 'utf8'), original);

    // A different board makes the entry differ, so the second run modifies.
    const moved = { ...h.io, env: { ...h.io.env, LAIKA_URL: 'http://moved.test' } };
    rmSync(join(h.home, '.laika'), { recursive: true });
    assert.equal(await connect(['gemini-cli'], moved), 0, h.printed());
    assert.match(h.printed(), /replaced/i, 'a changed entry was not reported');
    assert.equal(readFileSync(`${path}.bak`, 'utf8'), original, 'the .bak was overwritten');
    const after = readJson(path) as { mcpServers: { laika: { url: string } } };
    assert.equal(after.mcpServers.laika.url, 'http://moved.test/mcp');
  });

  void test('a second run with the same config writes nothing', async () => {
    const h = harness();
    assert.equal(await connect(['cursor'], h.io), 0);
    const path = join(h.home, '.cursor', 'mcp.json');
    const before = readFileSync(path, 'utf8');
    const mtime = statSync(path).mtimeMs;

    const again = harness(h.io.env);
    assert.equal(await connect(['cursor'], { ...again.io, home: h.home, cwd: h.cwd }), 0);
    assert.match(again.printed(), /already configured/i);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(statSync(path).mtimeMs, mtime, 'the file was rewritten');
    assert.ok(!existsSync(`${path}.bak`), 'a file this command created was backed up');
  });

  for (const [label, content] of [
    ['invalid JSON', '{ not json'],
    ['JSONC with a comment', '{\n  // mine\n  "mcpServers": {}\n}\n'],
    ['a JSON array', '[1, 2]'],
  ] as const) {
    void test(`${label} is refused, left byte-identical, and nothing else is written`, async () => {
      const h = harness();
      const path = join(h.home, '.cursor', 'mcp.json');
      mkdirSync(join(h.home, '.cursor'));
      writeFileSync(path, content);

      assert.equal(await connect(['cursor'], h.io), 1, 'a refusal exited 0');
      assert.equal(readFileSync(path, 'utf8'), content, 'the file was modified');
      assert.ok(h.printed().includes(path), 'the refusal does not name the file');
      assert.ok(!existsSync(`${path}.bak`), 'a refusal still wrote a backup');
      assert.ok(!existsSync(join(h.home, '.laika', 'env')), 'credentials were written anyway');
      assert.ok(!existsSync(join(h.home, '.zshrc')), 'the rc was edited anyway');
    });
  }

  void test('codex — appending is idempotent and keeps what was there', async () => {
    const h = harness();
    const path = join(h.home, '.codex', 'config.toml');
    mkdirSync(join(h.home, '.codex'));
    const original = 'model = "o4"\n\n[mcp_servers.other]\nurl = "http://x"';
    writeFileSync(path, original);

    assert.equal(await connect(['codex'], h.io), 0, h.printed());
    const once = readFileSync(path, 'utf8');
    assert.equal(
      once,
      `${original}\n\n[mcp_servers.laika]\nurl = "${URL_}/mcp"\nbearer_token_env_var = "LAIKA_TOKEN"\n`,
    );
    assert.equal(readFileSync(`${path}.bak`, 'utf8'), original);

    assert.equal(await connect(['codex'], h.io), 0, h.printed());
    assert.equal(readFileSync(path, 'utf8'), once, 'a second run appended again');
  });

  void test('codex — an existing [mcp_servers.laika] is left untouched', async () => {
    const h = harness();
    const path = join(h.home, '.codex', 'config.toml');
    mkdirSync(join(h.home, '.codex'));
    const original = '[mcp_servers.laika]\nurl = "http://somewhere-else/mcp"\n';
    writeFileSync(path, original);

    assert.equal(await connect(['codex'], h.io), 0, h.printed());
    assert.equal(readFileSync(path, 'utf8'), original);
    assert.ok(!existsSync(`${path}.bak`));
    assert.match(h.printed(), /already has a \[mcp_servers\.laika\]/);
  });
});

void describe('the token goes only where it must', () => {
  void test('no agent prints it, and only antigravity and ~/.laika/env store it', async () => {
    for (const slug of REQUIRED) {
      const h = harness();
      const args = slug === 'omnigent' ? [slug, '--project'] : [slug];
      assert.equal(await connect(args, h.io), 0, `${slug}: ${h.printed()}`);
      assert.ok(!h.printed().includes(TOKEN), `${slug} printed the token`);

      const allowed = new Set([
        join(h.home, '.laika', 'env'),
        join(h.home, '.gemini', 'config', 'mcp_config.json'),
      ]);
      for (const file of [...filesUnder(h.home), ...filesUnder(h.cwd)]) {
        if (allowed.has(file)) continue;
        assert.ok(
          !readFileSync(file, 'utf8').includes(TOKEN),
          `${slug} wrote the token to ${file}`,
        );
      }
    }
  });

  void test('--project variants store no token either', async () => {
    for (const slug of ['claude-code', 'codex', 'cursor', 'gemini-cli', 'opencode', 'vscode']) {
      const h = harness();
      assert.equal(await connect([slug, '--project'], h.io), 0, `${slug}: ${h.printed()}`);
      for (const file of filesUnder(h.cwd)) {
        assert.ok(
          !readFileSync(file, 'utf8').includes(TOKEN),
          `${slug} wrote the token to ${file}`,
        );
      }
      assert.ok(!h.printed().includes(TOKEN), `${slug} printed the token`);
    }
  });
});

void describe('credentials and the shell', () => {
  void test('~/.laika/env is written 0600 in install.sh format, in a 0700 directory', async () => {
    const h = harness();
    assert.equal(await connect(['cursor'], h.io), 0);
    const path = join(h.home, '.laika', 'env');
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^# Laika settings .*do not share or commit\.$/m);
    assert.match(text, new RegExp(`^LAIKA_URL="${URL_}"$`, 'm'));
    assert.match(text, new RegExp(`^LAIKA_TOKEN="${TOKEN}"$`, 'm'));
    assert.equal(mode(path), 0o600);
    assert.equal(mode(join(h.home, '.laika')), 0o700);
  });

  void test('a second run reuses ~/.laika/env without asking or needing the environment', async () => {
    const h = harness();
    assert.equal(await connect(['cursor'], h.io), 0);

    const bare = harness({ SHELL: '/bin/zsh' });
    const io = { ...bare.io, home: h.home, cwd: h.cwd };
    assert.equal(await connect(['gemini-cli'], io), 0, bare.printed());
    assert.match(bare.printed(), /~\/\.laika\/env/);
    const gemini = readJson(join(h.home, '.gemini', 'settings.json')) as {
      mcpServers: { laika: { url: string } };
    };
    assert.equal(gemini.mcpServers.laika.url, `${URL_}/mcp`);
  });

  void test('with neither file nor environment it asks for the URL, then the token', async () => {
    const answers = { url: 'http://asked.test/', token: TOKEN, asked: [] as string[] };
    const h = harness({ SHELL: '/bin/zsh' }, answers);
    assert.equal(await connect(['cursor'], h.io), 0, h.printed());
    assert.equal(answers.asked.length, 2);
    assert.match(answers.asked[0] ?? '', /URL/);
    assert.match(answers.asked[1] ?? '', /[Tt]oken/);
    assert.match(
      readFileSync(join(h.home, '.laika', 'env'), 'utf8'),
      /LAIKA_URL="http:\/\/asked\.test"/,
    );
  });

  void test('an empty token writes nothing and fails', async () => {
    const answers = { url: 'http://asked.test', token: '', asked: [] as string[] };
    const h = harness({ SHELL: '/bin/zsh' }, answers);
    assert.equal(await connect(['cursor'], h.io), 1);
    assert.deepEqual(filesUnder(h.home), []);
  });

  void test('the rc is chosen from $SHELL exactly as install.sh chooses it', () => {
    assert.equal(rcFileFor('/bin/zsh', '/h'), join('/h', '.zshrc'));
    assert.equal(rcFileFor('/usr/local/bin/bash', '/h'), join('/h', '.bashrc'));
    assert.equal(rcFileFor('/usr/bin/fish', '/h'), join('/h', '.profile'));
    assert.equal(rcFileFor(undefined, '/h'), join('/h', '.profile'));
  });

  void test('the export block is appended exactly once, and names the GUI caveat', async () => {
    const h = harness({ SHELL: '/bin/bash', LAIKA_URL: URL_, LAIKA_TOKEN: TOKEN });
    const rc = join(h.home, '.bashrc');
    writeFileSync(rc, 'alias ll="ls -l"\n');
    assert.equal(await connect(['cursor'], h.io), 0);
    assert.equal(await connect(['codex'], h.io), 0);

    const text = readFileSync(rc, 'utf8');
    assert.ok(text.startsWith('alias ll="ls -l"\n'), 'the existing rc was disturbed');
    const marker = '# Laika — export LAIKA_URL and LAIKA_TOKEN for coding agents (laika connect)';
    assert.equal(text.split(marker).length - 1, 1, 'the block was appended more than once');
    assert.ok(
      text.includes(
        `${marker}\n[ -r "$HOME/.laika/env" ] && { set -a; . "$HOME/.laika/env"; set +a; }\n`,
      ),
      'the block is not the one specified',
    );
    assert.match(h.printed(), /new terminal/i);
    assert.match(h.printed(), /cursor \./);
  });

  void test('an agent with the token inline does not touch the rc', async () => {
    const h = harness();
    assert.equal(await connect(['antigravity'], h.io), 0);
    assert.ok(!existsSync(join(h.home, '.zshrc')));
  });
});

void describe('the real entry point', () => {
  const run = (
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
    input = '',
  ): { out: string; code: number } => {
    try {
      const out = execFileSync('node', [ENTRY, ...args], {
        env,
        cwd,
        input,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return { out, code: 0 };
    } catch (cause) {
      const e = cause as { status?: number; stdout?: string; stderr?: string };
      return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? -1 };
    }
  };

  /** A child environment with no LAIKA_* leaking in from whoever runs the suite. */
  const childEnv = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    HOME: home,
    SHELL: '/bin/zsh',
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...extra,
  });

  void test('connect cursor writes the user file and prints no token', () => {
    const h = harness();
    const result = run(
      ['connect', 'cursor'],
      childEnv(h.home, { LAIKA_URL: URL_, LAIKA_TOKEN: TOKEN }),
      h.cwd,
    );
    assert.equal(result.code, 0, result.out);
    assert.ok(!result.out.includes(TOKEN), 'the token was printed');
    const file = readJson(join(h.home, '.cursor', 'mcp.json')) as {
      mcpServers: { laika: { url: string } };
    };
    assert.equal(file.mcpServers.laika.url, `${URL_}/mcp`);
  });

  void test('connect works from piped answers, URL then token, like install.sh', () => {
    const h = harness();
    const result = run(['connect', 'gemini'], childEnv(h.home), h.cwd, `${URL_}\n${TOKEN}\n`);
    assert.equal(result.code, 0, result.out);
    assert.ok(!result.out.includes(TOKEN), 'the token was echoed');
    assert.match(readFileSync(join(h.home, '.laika', 'env'), 'utf8'), /LAIKA_TOKEN="lai_/);
  });

  void test('connect --list names every agent, from both sides', () => {
    const h = harness();
    const result = run(['connect', '--list'], childEnv(h.home), h.cwd);
    assert.equal(result.code, 0, result.out);
    for (const slug of REQUIRED) assert.match(result.out, new RegExp(`^\\s*${slug}\\s`, 'm'), slug);
    for (const agent of AGENTS) assert.ok(result.out.includes(agent.name), agent.name);
    assert.deepEqual(filesUnder(h.home), [], '--list wrote something');
  });

  void test('usage mentions connect, and still mentions init', () => {
    const h = harness();
    const result = run(['--help'], childEnv(h.home), h.cwd);
    assert.match(result.out, /laika connect <agent>/);
    assert.match(result.out, /laika connect --list/);
    assert.match(result.out, /laika init/);
  });

  void test('whoami names an agent once connect has configured it', () => {
    const h = harness();
    // Port 1 refuses at once, so whoami fails after the local half it prints.
    const env = childEnv(h.home, { LAIKA_URL: 'http://127.0.0.1:1', LAIKA_TOKEN: TOKEN });
    const before = run(['whoami'], env, h.cwd);
    assert.doesNotMatch(before.out, /Agents .*cursor/, `cursor before connect: ${before.out}`);

    assert.equal(run(['connect', 'cursor'], env, h.cwd).code, 0);
    assert.equal(run(['connect', 'codex'], env, h.cwd).code, 0);
    const after = run(['whoami'], env, h.cwd);
    assert.match(after.out, /^Agents {2}.*cursor/m, after.out);
    assert.match(after.out, /^Agents {2}.*codex/m, after.out);
    assert.ok(!after.out.includes(TOKEN), 'whoami printed the token');
  });
});

/* -------------------------------------------------------------------------- */
/* Review round 1                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The fully-qualified keys a TOML document defines: table headers and the
 * dotted/inline keys under them. A *minimal* duplicate check — enough to see
 * `mcp_servers.laika` defined twice, which every TOML parser rejects — not a
 * parser. No dependency (CLAUDE.md §5).
 */
function tomlDefinitions(text: string): string[] {
  const defs: string[] = [];
  let table: string[] = [];
  const clean = (part: string): string => part.trim().replace(/^["']|["']$/g, '');
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      table = (header[1] ?? '').split('.').map(clean);
      defs.push(table.join('.'));
      continue;
    }
    const kv = /^([A-Za-z0-9_."' -]+?)\s*=\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const key = [...table, ...(kv[1] ?? '').split('.').map(clean)];
    // An inline table (`laika = { … }`) or a dotted key both define the table they name.
    if ((kv[2] ?? '').startsWith('{')) defs.push(key.join('.'));
    else if (key.length > table.length + 1) defs.push(key.slice(0, -1).join('.'));
  }
  return defs;
}

const definedTwice = (text: string, table: string): boolean =>
  new Set(tomlDefinitions(text).filter((d) => d === table)).size > 0 &&
  tomlDefinitions(text).filter((d) => d === table).length > 1;

void describe('codex never gets a second laika table (review round 1)', () => {
  void test('CONTROL: the duplicate checker sees the corruption it guards against', () => {
    assert.ok(
      definedTwice(
        '[mcp_servers]\nlaika = { url = "a" }\n\n[mcp_servers.laika]\nurl = "b"\n',
        'mcp_servers.laika',
      ),
    );
    assert.ok(!definedTwice('[mcp_servers.laika]\nurl = "b"\n', 'mcp_servers.laika'));
  });

  const forms: readonly (readonly [string, string])[] = [
    [
      'an inline table under [mcp_servers]',
      'model = "o4"\n\n[mcp_servers]\nlaika = { url = "http://elsewhere/mcp" }\n',
    ],
    ['a dotted key at the top level', 'mcp_servers.laika.url = "http://elsewhere/mcp"\n'],
    ['a dotted key under [mcp_servers]', '[mcp_servers]\nlaika.url = "http://elsewhere/mcp"\n'],
    ['a quoted dotted key', '"mcp_servers"."laika".url = "http://elsewhere/mcp"\n'],
  ];
  for (const [label, original] of forms) {
    void test(`${label} is left byte-identical, and the result still has one laika table`, async () => {
      const h = harness();
      const path = join(h.home, '.codex', 'config.toml');
      mkdirSync(join(h.home, '.codex'));
      writeFileSync(path, original);
      assert.equal(await connect(['codex'], h.io), 0, h.printed());
      const after = readFileSync(path, 'utf8');
      assert.equal(after, original, h.printed());
      assert.ok(!definedTwice(after, 'mcp_servers.laika'));
      assert.ok(!existsSync(`${path}.bak`));
    });
  }

  void test('a mention of laika it cannot place leaves the file alone and prints the block', async () => {
    const h = harness();
    const path = join(h.home, '.codex', 'config.toml');
    mkdirSync(join(h.home, '.codex'));
    const original = '[profiles.laika]\nmodel = "o4"\n';
    writeFileSync(path, original);
    assert.equal(await connect(['codex'], h.io), 0, h.printed());
    assert.equal(readFileSync(path, 'utf8'), original);
    assert.match(h.printed(), /left as it is/);
    assert.match(h.printed(), /^\s*bearer_token_env_var = "LAIKA_TOKEN"$/m);
  });

  void test('an append to a file with other servers leaves exactly one laika table', async () => {
    const h = harness();
    const path = join(h.home, '.codex', 'config.toml');
    mkdirSync(join(h.home, '.codex'));
    writeFileSync(path, '[mcp_servers]\nother = { url = "http://x" }\n');
    assert.equal(await connect(['codex'], h.io), 0, h.printed());
    const after = readFileSync(path, 'utf8');
    assert.equal(tomlDefinitions(after).filter((d) => d === 'mcp_servers.laika').length, 1, after);
  });
});

/** Run one printed shell line in bash with `npx`/`code` stubbed, returning what they saw. */
function runPrinted(line: string, env: Record<string, string>): string {
  execFileSync('bash', ['-n', '-c', line]);
  const stub =
    'npx(){ printf "ARG:%s\\n" "$@"; printf "AUTH:%s\\n" "${LAIKA_AUTH-unset}"; }; ' +
    'code(){ printf "ARG:%s\\n" "$@"; }; ';
  return execFileSync('bash', ['-c', stub + line], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

void describe('printed commands survive a real shell (review round 1)', () => {
  void test('the bridge one-liner hands mcp-remote a literal ${LAIKA_AUTH} and the bearer in its env', async () => {
    const h = harness();
    assert.equal(await connect(['kiro'], h.io), 0, h.printed());
    const line = h.lines.find(
      (l) => l.includes('npx -y mcp-remote@0.14.3') && l.includes('LAIKA_AUTH='),
    );
    assert.ok(line !== undefined, `no runnable one-liner printed:\n${h.printed()}`);
    const seen = runPrinted(line.trim(), { LAIKA_TOKEN: 'lai_shellcheck' });
    assert.match(seen, /^ARG:Authorization:\$\{LAIKA_AUTH\}$/m, seen);
    assert.match(seen, /^AUTH:Bearer lai_shellcheck$/m, seen);
    assert.match(seen, /^ARG:--allow-http$/m);
  });

  void test('code --add-mcp is quoted for any URL, and VS Code gets valid JSON', () => {
    const odd = "http://board.test:3000/it's";
    const plan = planConnect('vscode', {
      url: odd,
      token: TOKEN,
      home: '/h',
      cwd: '/c',
      project: false,
    });
    const line = plan.notes.find((n) => n.trim().startsWith('code --add-mcp'));
    assert.ok(line !== undefined);
    const seen = runPrinted(line.trim(), {});
    const json = /^ARG:(\{.*\})$/m.exec(seen)?.[1];
    assert.ok(json !== undefined, seen);
    assert.equal((JSON.parse(json) as { url: string }).url, `${odd}/mcp`);
  });
});

void describe('no project file holds a token, and no repo gets a .bak (review round 1)', () => {
  void test('kiro and junie offer user scope only', async () => {
    for (const slug of ['kiro', 'junie']) {
      const h = harness();
      assert.equal(await connect([slug], h.io), 0);
      assert.doesNotMatch(h.printed(), /\(or \.(kiro|junie)\//, `${slug} offers a project path`);
      assert.match(h.printed(), /user scope only/i, slug);
    }
  });

  void test('junie prints the same direct config the Connect page shows, plus the AI Assistant bridge', async () => {
    const h = harness();
    assert.equal(await connect(['junie'], h.io), 0);
    assert.match(h.printed(), /~\/\.junie\/mcp\/mcp\.json/);
    assert.match(h.printed(), /"url": "http:\/\/board\.test:3000\/mcp"/);
    assert.match(h.printed(), /AI Assistant/);
  });

  void test('zed does not claim the bridge keeps the token out of settings.json', async () => {
    const h = harness();
    assert.equal(await connect(['zed'], h.io), 0);
    assert.doesNotMatch(h.printed(), /keep the token out of settings\.json, use the bridge/i);
    assert.match(h.printed(), /Authorization:Bearer \$\{LAIKA_TOKEN\}/);
  });

  void test('--project backs up under ~/.laika/backups, never beside the repo file', async () => {
    const h = harness();
    const path = join(h.cwd, '.cursor', 'mcp.json');
    mkdirSync(join(h.cwd, '.cursor'));
    writeFileSync(path, '{"mcpServers":{"other":{"url":"http://x"}}}');
    assert.equal(await connect(['cursor', '--project'], h.io), 0, h.printed());
    assert.deepEqual(
      filesUnder(h.cwd).filter((f) => f.endsWith('.bak')),
      [],
      'a .bak was left in the repository',
    );
    const backups = filesUnder(join(h.home, '.laika', 'backups'));
    assert.equal(backups.length, 1, `backups: ${backups.join(', ')}`);
    assert.equal(
      readFileSync(backups[0] ?? '', 'utf8'),
      '{"mcpServers":{"other":{"url":"http://x"}}}',
    );
  });
});

void describe('credentials, again (review round 1)', () => {
  void test('LAIKA_URL and LAIKA_TOKEN in the environment win over ~/.laika/env, and update it', async () => {
    const h = harness();
    mkdirSync(join(h.home, '.laika'), { mode: 0o700 });
    writeFileSync(
      join(h.home, '.laika', 'env'),
      'LAIKA_URL="http://old.test"\nLAIKA_TOKEN="lai_OldTokenOldTokenOld"\n',
      { mode: 0o600 },
    );
    assert.equal(await connect(['cursor'], h.io), 0, h.printed());
    const saved = readFileSync(join(h.home, '.laika', 'env'), 'utf8');
    assert.match(saved, new RegExp(`LAIKA_TOKEN="${TOKEN}"`));
    assert.match(saved, new RegExp(`LAIKA_URL="${URL_}"`));
    const cursor = readJson(join(h.home, '.cursor', 'mcp.json')) as {
      mcpServers: { laika: { url: string } };
    };
    assert.equal(cursor.mcpServers.laika.url, `${URL_}/mcp`);
  });

  void test('a token-bearing file is replaced, never rewritten in place under a wider mode', async () => {
    // `writeFileSync` on an existing 0644 file writes the token first and narrows
    // the mode after. A write through a 0600 temp file and a rename never does:
    // the old inode, with its old mode, never holds the new bytes.
    const h = harness();
    const env = join(h.home, '.laika', 'env');
    mkdirSync(join(h.home, '.laika'), { mode: 0o700 });
    writeFileSync(env, 'LAIKA_URL="http://old.test"\nLAIKA_TOKEN="lai_OldTokenOldTokenOld"\n', {
      mode: 0o644,
    });
    const ag = join(h.home, '.gemini', 'config', 'mcp_config.json');
    mkdirSync(dirnameOf(ag), { recursive: true });
    writeFileSync(ag, '{"mcpServers":{}}', { mode: 0o644 });
    const before = { env: statSync(env).ino, ag: statSync(ag).ino };

    assert.equal(await connect(['antigravity'], h.io), 0, h.printed());
    assert.notEqual(statSync(env).ino, before.env, '~/.laika/env was rewritten in place');
    assert.notEqual(statSync(ag).ino, before.ag, 'mcp_config.json was rewritten in place');
    assert.equal(mode(env), 0o600);
    assert.equal(mode(ag), 0o600);
  });

  void test('the rc sources ~/.laika/env and never holds the token itself', async () => {
    const h = harness();
    assert.equal(await connect(['codex'], h.io), 0);
    const rc = readFileSync(join(h.home, '.zshrc'), 'utf8');
    assert.ok(!rc.includes(TOKEN), 'the token is in the shell rc');
    assert.match(rc, /\. "\$HOME\/\.laika\/env"/);
  });
});

function dirnameOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}
