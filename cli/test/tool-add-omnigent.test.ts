import assert from 'node:assert/strict';
import {
  chmodSync,
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
import { dirname, isAbsolute, join, relative } from 'node:path';
import { after, describe, test } from 'node:test';
import { symlinkSync } from 'node:fs';

import { CLAUDE_HEADERS_HELPER, CODEX_HELPER_LINE } from '../src/mcp-headers.ts';
import {
  CODEX_RC_LINE,
  CODEX_RC_MARKER,
  followOmnigent,
  omnigentAgent,
  type ToolAddIo,
} from '../src/tool-add.ts';

/**
 * `laika tool add omnigent`'s agent step (LAI-1101, plan auto-pickup §8 D,
 * F8): a copy of polly with the stdio bridge as its Laika MCP, installed with
 * `omni agent add` only after a yes. `omni` here is a fake on `PATH` that
 * records its arguments and environment; Belka's real Omnigent is never on
 * the `PATH` these tests give, and nothing here touches `~/.omnigent`.
 */

const SECRET = 'lai_OMNIGENTsecretTOKEN42';

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

interface World {
  readonly home: string;
  readonly polly: string;
  readonly bin: string;
  readonly calls: string;
  readonly printed: string[];
  readonly io: ToolAddIo;
}

/** Every file under `dir`, relative to it, with its bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function world(
  options: {
    omni?: 'ok' | 'fails' | 'none';
    version?: string;
    confirm?: boolean;
    pollyFiles?: Record<string, string>;
  } = {},
): World {
  const root = mkdtempSync(join(tmpdir(), 'laika-1101-tooladd-'));
  roots.push(root);
  const home = join(root, 'home');
  const polly = join(root, 'site-packages', 'omnigent', 'resources', 'examples', 'polly');
  const bin = join(root, 'bin');
  const calls = join(root, 'omni-calls.txt');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const files = options.pollyFiles ?? {
    'config.yaml': 'name: polly\ndescription: >-\n  The manager.\nharness: claude-sdk\n',
    'agents/claude_code/config.yaml': 'name: claude_code\nharness: claude-native\n',
    'skills/fanout/SKILL.md': '# fanout\n',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(polly, path)), { recursive: true });
    writeFileSync(join(polly, path), content);
  }
  if ((options.omni ?? 'ok') !== 'none') {
    const fails = options.omni === 'fails';
    writeFileSync(
      join(bin, 'omni'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then',
        `  echo "omnigent ${options.version ?? '0.19.1'} (built 2026-10-21T23:37:47Z)"`,
        '  exit 0',
        'fi',
        `printf 'ARGS %s\\n' "$*" >> ${JSON.stringify(calls)}`,
        `env | sort >> ${JSON.stringify(calls)}`,
        fails ? 'echo "Error: could not reach the Omnigent server" >&2; exit 3' : 'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'omni'), 0o755);
  }
  const printed: string[] = [];
  const io: ToolAddIo = {
    out: (line) => printed.push(line),
    err: (line) => printed.push(line),
    home,
    fetch: () => Promise.reject(new Error('no network in this test')),
    sleep: () => Promise.resolve(),
    now: () => Date.UTC(2026, 10, 3, 9, 0, 0),
    shell: '/bin/zsh',
    env: {
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      LAIKA_TOKEN: SECRET,
      LAIKA_AGENT_TOKEN: SECRET,
    },
    ...(options.confirm === undefined
      ? {}
      : { confirm: () => Promise.resolve(options.confirm === true) }),
  };
  return { home, polly, bin, calls, printed, io };
}

const dest = (w: World): string => join(w.home, '.laika', 'omnigent', 'laika-polly');
const sidecarOf = (w: World): string =>
  readFileSync(join(dest(w), 'tools', 'mcp', 'laika.yaml'), 'utf8');

void describe('laika tool add omnigent — the agent', () => {
  void test('copies polly, names it laika-polly, and its Laika MCP is the bridge with no ${', async () => {
    const w = world();
    const before = snapshot(w.polly);
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'copied');

    // The installed package is never written.
    assert.deepEqual(snapshot(w.polly), before, 'the source agent folder changed');
    assert.ok(!existsSync(join(w.polly, 'tools')));

    const copy = snapshot(dest(w));
    assert.equal(
      copy['config.yaml'],
      before['config.yaml']?.replace('name: polly', 'name: laika-polly'),
    );
    assert.equal(copy['agents/claude_code/config.yaml'], before['agents/claude_code/config.yaml']);
    assert.equal(copy['skills/fanout/SKILL.md'], before['skills/fanout/SKILL.md']);

    const yaml = sidecarOf(w);
    assert.ok(!yaml.includes('${'), 'the Omnigent sidecar holds a ${VAR}');
    assert.match(yaml, /^name: laika\ntransport: stdio\ncommand: "([^"]+)"\nargs:\n/);
    const command = /^command: "([^"]+)"$/m.exec(yaml)?.[1] ?? '';
    assert.ok(isAbsolute(command), `command is not absolute: ${command}`);
    const args = [...yaml.matchAll(/^ {2}- "([^"]+)"$/gm)].map((m) => m[1]);
    assert.ok(isAbsolute(args[0] ?? ''), `the entry is not absolute: ${String(args[0])}`);
    assert.ok(existsSync(args[0] ?? ''), 'the entry the sidecar names does not exist');
    assert.deepEqual(args.slice(1), ['mcp-bridge', '--credential', 'omnigent']);
    assert.ok(!JSON.stringify(copy).includes(SECRET), 'a token was written into the agent');

    // No yes: omni was asked its version and nothing else; the command is printed.
    assert.ok(!existsSync(w.calls), 'omni agent add ran without a yes');
    assert.ok(
      w.printed.some((l) => /run it when you are ready: omni agent add .*laika-polly/.test(l)),
    );
  });

  void test('a yes runs omni agent add on the copy, with no token in its environment', async () => {
    const w = world({ confirm: true });
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'installed');
    const calls = readFileSync(w.calls, 'utf8');
    assert.match(
      calls,
      new RegExp(`^ARGS agent add ${dest(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );
    assert.ok(!calls.includes(SECRET), 'a token reached omni agent add');
    assert.doesNotMatch(calls, /^LAIKA_/m, 'a LAIKA_ variable reached omni agent add');
    assert.ok(w.printed.some((l) => l.includes('✓ omnigent: laika-polly installed')));
  });

  void test('--yes needs no question; a no is a no', async () => {
    const yes = world();
    assert.equal(
      await omnigentAgent(yes.io, ['omnigent', '--from', yes.polly, '--yes']),
      'installed',
    );
    assert.ok(existsSync(yes.calls));
    const no = world({ confirm: false });
    assert.equal(await omnigentAgent(no.io, ['omnigent', '--from', no.polly]), 'copied');
    assert.ok(!existsSync(no.calls));
  });

  void test('a copy already there is kept as .bak-<time>, byte for byte', async () => {
    const w = world();
    mkdirSync(dest(w), { recursive: true });
    writeFileSync(join(dest(w), 'config.yaml'), 'name: laika-polly\n# my edits\n');
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'copied');
    const backups = readdirSync(join(w.home, '.laika', 'omnigent')).filter((n) =>
      n.startsWith('laika-polly.bak-'),
    );
    assert.deepEqual(backups, ['laika-polly.bak-2026-11-03T09-00-00-000Z']);
    assert.equal(
      readFileSync(join(w.home, '.laika', 'omnigent', backups[0] ?? '', 'config.yaml'), 'utf8'),
      'name: laika-polly\n# my edits\n',
    );
    assert.match(readFileSync(join(dest(w), 'config.yaml'), 'utf8'), /^name: laika-polly$/m);
  });

  void test('an MCP file in the source with a ${VAR} refuses the install', async () => {
    const w = world({
      confirm: true,
      pollyFiles: {
        'config.yaml': 'name: polly\n',
        'tools/mcp/other.yaml': 'name: other\ntransport: http\nurl: ${OTHER_URL}/mcp\n',
      },
    });
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'none');
    assert.ok(!existsSync(w.calls), 'omni agent add ran on an agent that would deny every turn');
    assert.ok(w.printed.some((l) => l.includes('other.yaml holds a ${VAR}')));
  });

  void test('no omni on PATH: the copy is ready and the command is printed', async () => {
    const w = world({ omni: 'none', confirm: true });
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'copied');
    assert.ok(existsSync(join(dest(w), 'tools', 'mcp', 'laika.yaml')));
    assert.ok(w.printed.some((l) => l.includes('`omni` is not on PATH')));
  });

  void test('omni agent add failing is said, with the step that remains', async () => {
    const w = world({ omni: 'fails', confirm: true });
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'copied');
    assert.ok(
      w.printed.some((l) =>
        l.includes('omni agent add failed (exit 3): Error: could not reach the Omnigent server'),
      ),
      w.printed.join('\n'),
    );
  });

  void test('another Omnigent version is warned about, not refused', async () => {
    const w = world({ version: '0.21.0', confirm: true });
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'installed');
    assert.ok(
      w.printed.some((l) =>
        l.includes('this is Omnigent 0.21.0; laika-polly was checked on 0.19.x'),
      ),
    );
  });

  void test('a folder that is not an agent, or no polly found, sets nothing up', async () => {
    const w = world({ omni: 'none' });
    const empty = join(w.home, 'empty');
    mkdirSync(empty);
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', empty]), 'none');
    assert.equal(await omnigentAgent(w.io, ['omnigent']), 'none');
    assert.ok(!existsSync(join(w.home, '.laika', 'omnigent')), 'something was written');
  });
});

void describe('laika tool add omnigent — its own symlinks are never written through (review #3)', () => {
  void test('a symlink anywhere in the agent folder refuses the copy; nothing written, the target untouched', async () => {
    const w = world({ confirm: true });
    const outside = join(w.home, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'mine\n');
    // A link the copy would carry: writing tools/mcp/laika.yaml through it
    // would land in `outside`.
    symlinkSync(outside, join(w.polly, 'tools'));
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', w.polly]), 'none');
    assert.ok(
      w.printed.some((l) => l.includes('is a symlink — nothing copied')),
      w.printed.join('\n'),
    );
    assert.deepEqual(readdirSync(outside), ['keep.txt']);
    assert.ok(!existsSync(join(w.home, '.laika', 'omnigent', 'laika-polly')));
    assert.ok(!existsSync(w.calls), 'omni agent add ran');
  });

  void test('a --from that is itself a link is followed to the real folder, and copied', async () => {
    const w = world();
    const link = join(w.home, 'polly-link');
    symlinkSync(w.polly, link);
    assert.equal(await omnigentAgent(w.io, ['omnigent', '--from', link]), 'copied');
    assert.ok(!existsSync(join(w.polly, 'tools')), 'the source was written through the link');
    assert.ok(
      existsSync(join(w.home, '.laika', 'omnigent', 'laika-polly', 'tools', 'mcp', 'laika.yaml')),
    );
  });
});

/** The Claude Code helper an older `tool add` wrote (LAI-1072/1074), verbatim from `master`. */
const OLD_CLAUDE_HELPER =
  `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/claude-code.json")" && ` +
  `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`;

void describe('laika tool add omnigent — entries tool add wrote follow Omnigent runs (review B1 (a))', () => {
  const claudeDoc = (laika: unknown) =>
    `${JSON.stringify({ numStartups: 3, mcpServers: { other: { type: 'http', url: 'https://x/mcp' }, laika } }, null, 2)}\n`;

  void test('B1: the older tool-add helper in ~/.claude.json becomes the switching one, backed up, the rest kept', () => {
    const w = world();
    const before = claudeDoc({
      type: 'http',
      url: 'http://board.test/mcp',
      headersHelper: OLD_CLAUDE_HELPER,
    });
    writeFileSync(join(w.home, '.claude.json'), before);
    followOmnigent(w.io);
    const after = JSON.parse(readFileSync(join(w.home, '.claude.json'), 'utf8')) as {
      numStartups: number;
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(after.mcpServers.laika, {
      type: 'http',
      url: 'http://board.test/mcp',
      headersHelper: CLAUDE_HEADERS_HELPER,
    });
    assert.deepEqual(after.mcpServers.other, { type: 'http', url: 'https://x/mcp' });
    assert.equal(after.numStartups, 3);
    assert.equal(readFileSync(join(w.home, '.claude.json.bak'), 'utf8'), before);
    assert.ok(
      w.printed.some((l) => l.includes('now follows Omnigent runs')),
      w.printed.join('\n'),
    );
    // Run again: already the switching helper, nothing written.
    w.printed.length = 0;
    const once = readFileSync(join(w.home, '.claude.json'), 'utf8');
    followOmnigent(w.io);
    assert.equal(readFileSync(join(w.home, '.claude.json'), 'utf8'), once);
    assert.ok(w.printed.some((l) => l.includes('already follows Omnigent runs')));
  });

  void test('B1: a person-written laika entry in ~/.claude.json is left byte for byte, and named', () => {
    const w = world();
    const mine = claudeDoc({
      type: 'http',
      url: 'http://board.test/mcp',
      headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
    });
    writeFileSync(join(w.home, '.claude.json'), mine);
    followOmnigent(w.io);
    assert.equal(readFileSync(join(w.home, '.claude.json'), 'utf8'), mine);
    assert.ok(!existsSync(join(w.home, '.claude.json.bak')));
    const said = w.printed.join('\n');
    assert.match(
      said,
      new RegExp(
        `${join(w.home, '.claude.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} has an mcpServers\\.laika that laika tool add did not write — left alone`,
      ),
    );
    assert.match(said, /keep acting as their own agent/);
  });

  void test('B1: the older tool-add Codex table gets the helper line and its rc export goes; a person’s is named', () => {
    const w = world();
    mkdirSync(join(w.home, '.codex'));
    const older =
      'model = "o3"\n\n[mcp_servers.laika]\nurl = "http://board.test/mcp"\n' +
      'bearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"\n\n[profiles.x]\nmodel = "o4"\n';
    writeFileSync(join(w.home, '.codex', 'config.toml'), older);
    writeFileSync(
      join(w.home, '.zshrc'),
      `export EDITOR=vim\n\n${CODEX_RC_MARKER}\n${CODEX_RC_LINE}\n`,
    );
    followOmnigent(w.io);
    assert.equal(
      readFileSync(join(w.home, '.codex', 'config.toml'), 'utf8'),
      'model = "o3"\n\n[mcp_servers.laika]\nurl = "http://board.test/mcp"\n' +
        `${CODEX_HELPER_LINE}\n\n[profiles.x]\nmodel = "o4"\n`,
    );
    assert.equal(readFileSync(join(w.home, '.codex', 'config.toml.bak'), 'utf8'), older);
    assert.equal(readFileSync(join(w.home, '.zshrc'), 'utf8'), 'export EDITOR=vim\n');

    const person = world();
    mkdirSync(join(person.home, '.codex'));
    const mine =
      '[mcp_servers.laika]\nurl = "http://board.test/mcp"\nbearer_token_env_var = "LAIKA_TOKEN"\n';
    writeFileSync(join(person.home, '.codex', 'config.toml'), mine);
    followOmnigent(person.io);
    assert.equal(readFileSync(join(person.home, '.codex', 'config.toml'), 'utf8'), mine);
    assert.ok(!existsSync(join(person.home, '.codex', 'config.toml.bak')));
    assert.ok(
      person.printed.some((l) =>
        l.includes(
          `${join(person.home, '.codex', 'config.toml')} has a [mcp_servers.laika] that laika tool add did not write`,
        ),
      ),
      person.printed.join('\n'),
    );
  });

  void test('no Claude Code or Codex Laika entry: nothing is written or said', () => {
    const w = world();
    writeFileSync(join(w.home, '.claude.json'), '{"numStartups": 1}\n');
    followOmnigent(w.io);
    assert.equal(readFileSync(join(w.home, '.claude.json'), 'utf8'), '{"numStartups": 1}\n');
    assert.deepEqual(w.printed, []);
  });
});

void describe('laika tool add omnigent — round 2 (N3, N5)', () => {
  const doc = (laika: unknown) => `${JSON.stringify({ mcpServers: { laika } }, null, 2)}\n`;

  void test('N5: a switched Claude entry keeps every other key it had', () => {
    const w = world();
    writeFileSync(
      join(w.home, '.claude.json'),
      doc({
        type: 'http',
        url: 'http://board.test/mcp',
        headersHelper: OLD_CLAUDE_HELPER,
        timeout: 30000,
        alwaysAllow: ['laika_whoami'],
      }),
    );
    followOmnigent(w.io);
    const after = JSON.parse(readFileSync(join(w.home, '.claude.json'), 'utf8')) as {
      mcpServers: { laika: unknown };
    };
    assert.deepEqual(after.mcpServers.laika, {
      type: 'http',
      url: 'http://board.test/mcp',
      headersHelper: CLAUDE_HEADERS_HELPER,
      timeout: 30000,
      alwaysAllow: ['laika_whoami'],
    });
  });

  void test('N5: a person’s own helper that reads claude-code.json is not one tool add wrote — left alone and named', () => {
    const w = world();
    const mine = doc({
      type: 'http',
      url: 'http://board.test/mcp',
      headersHelper: `jq -r '{Authorization: ("Bearer " + .token)}' "$HOME/.laika/agents/claude-code.json"`,
    });
    writeFileSync(join(w.home, '.claude.json'), mine);
    followOmnigent(w.io);
    assert.equal(readFileSync(join(w.home, '.claude.json'), 'utf8'), mine);
    assert.ok(
      w.printed.some((l) =>
        l.includes('has an mcpServers.laika that laika tool add did not write'),
      ),
      w.printed.join('\n'),
    );
  });

  void test('N5: the Codex line says to restart Codex, and that a running Omnigent Codex conversation keeps its copy', () => {
    const w = world();
    mkdirSync(join(w.home, '.codex'));
    writeFileSync(
      join(w.home, '.codex', 'config.toml'),
      '[mcp_servers.laika]\nurl = "http://board.test/mcp"\nbearer_token_env_var = "LAIKA_AGENT_TOKEN_CODEX"\n',
    );
    followOmnigent(w.io);
    const said = w.printed.join('\n');
    assert.match(said, /codex: .* now follows Omnigent runs.*; restart Codex/);
    assert.match(said, /A Codex conversation Omnigent is running keeps its own copy of this file/);
    assert.match(said, /until that conversation is restarted/);
  });

  void test('N3: under CLAUDE_CONFIG_DIR the entry Claude Code reads there is the one switched; ~/.claude.json is untouched', () => {
    const w = world();
    const dir = join(w.home, '.claude-work');
    mkdirSync(dir);
    const home = doc({
      type: 'http',
      url: 'http://board.test/mcp',
      headersHelper: OLD_CLAUDE_HELPER,
    });
    writeFileSync(join(w.home, '.claude.json'), home);
    writeFileSync(join(dir, '.claude.json'), home);
    followOmnigent({ ...w.io, env: { ...w.io.env, CLAUDE_CONFIG_DIR: dir } });
    assert.equal(readFileSync(join(w.home, '.claude.json'), 'utf8'), home);
    const switched = JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8')) as {
      mcpServers: { laika: { headersHelper: string } };
    };
    assert.equal(switched.mcpServers.laika.headersHelper, CLAUDE_HEADERS_HELPER);
  });
});
