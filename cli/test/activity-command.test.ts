/**
 * `laika activity on|off|status|sync|emails`, end to end against a stub board,
 * and the install/remove round trip for every agent's config format (LAI-752).
 *
 * The agent files are fixtures shaped like what each agent and `laika connect`
 * leave behind — other people's hooks and settings included — because what
 * must never go wrong is somebody else's file. Each is checked three ways:
 * `on` adds exactly our entries, a second `on` writes nothing, and `off` leaves
 * the file as it was before `on`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

import { activity, HOOK_SCRIPT, type ActivityIo } from '../src/activity.ts';
import { type GitRunner } from '../src/activity-census.ts';
import { codexTomlHasHandlers, MARKER } from '../src/activity-hooks.ts';
import { activityPaths, readState } from '../src/activity-store.ts';
import { sync } from '../src/activity-sync.ts';
import { closeAll, stubBoard, type StubBoard } from './support/stub-board.ts';

const TOKEN = 'lai_CommandTestTokenZq7xNeverPrinted';
const TZ = 'Africa/Johannesburg';
const SHELL = existsSync('/bin/zsh') ? '/bin/zsh -f' : '/bin/sh';
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(made);
  return made;
}

interface Harness {
  readonly home: string;
  readonly board: StubBoard;
  readonly io: ActivityIo;
  readonly out: string[];
  readonly err: string[];
  readonly spawned: (readonly string[])[];
  readonly exits: number[];
  readonly run: (...argv: string[]) => Promise<number>;
}

async function harness(): Promise<Harness> {
  const home = dir('laika-cmdhome-');
  const board = await stubBoard(TOKEN);
  const out: string[] = [];
  const err: string[] = [];
  const spawned: (readonly string[])[] = [];
  const exits: number[] = [];
  const io: ActivityIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    home,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, 'no-global-gitconfig'),
      LAIKA_URL: board.url,
      LAIKA_TOKEN: TOKEN,
    },
    nowMs: () => Date.now(),
    tz: TZ,
    hookScript: HOOK_SCRIPT,
    hookShell: SHELL,
    spawnDetached: (args) => {
      spawned.push(args);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  return {
    home,
    board,
    io,
    out,
    err,
    spawned,
    exits,
    run: (...argv) => activity(argv, io),
  };
}

const write = (path: string, content: string, mode = 0o644): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, { mode });
};
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Every agent set up for Laika the way `laika connect` (or its snippet) leaves it. */
function fixtures(home: string) {
  const claude = join(home, '.claude', 'settings.json');
  const claudeBefore = {
    env: { LAIKA_URL: 'http://x', LAIKA_TOKEN: TOKEN },
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/usr/local/bin/my-own-hook' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      // A person's own hook that mentions laika is theirs, not ours.
      SessionEnd: [{ hooks: [{ type: 'command', command: '~/bin/laika-standup-notes.sh' }] }],
    },
  };
  write(claude, `${JSON.stringify(claudeBefore, null, 2)}\n`, 0o600);
  write(join(home, '.claude.json'), JSON.stringify({ mcpServers: { laika: {} } }));

  write(join(home, '.codex', 'config.toml'), '[mcp_servers.laika]\nurl = "http://x/mcp"\n');

  const gemini = join(home, '.gemini', 'settings.json');
  const geminiBefore = {
    theme: 'dark',
    mcpServers: { laika: { type: 'http', url: 'http://x/mcp' } },
    hooks: { AfterAgent: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
  };
  write(gemini, `${JSON.stringify(geminiBefore, null, 2)}\n`);

  write(join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { laika: {} } }));
  write(join(home, '.config', 'goose', 'config.yaml'), 'extensions:\n  laika:\n    name: laika\n');
  write(join(home, '.kiro', 'settings', 'mcp.json'), JSON.stringify({ mcpServers: { laika: {} } }));
  write(
    join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json'),
    JSON.stringify({ mcpServers: { laika: {} } }),
  );
  return { claude, claudeBefore, gemini, geminiBefore };
}

interface HooksDoc {
  hooks: Record<string, { matcher?: string; hooks: { command?: string; bash?: string }[] }[]>;
}
const ours = (doc: HooksDoc, event: string): string[] =>
  (doc.hooks[event] ?? [])
    .flatMap((g) => g.hooks.map((h) => h.command ?? h.bash ?? ''))
    .filter((c) => c.includes(MARKER));

void describe('on, when sharing is off', () => {
  void test('the organisation switch off: says who can turn it on, installs nothing', async () => {
    const h = await harness();
    const { claude } = fixtures(h.home);
    const before = readFileSync(claude, 'utf8');
    h.board.sharing = { ...h.board.sharing, org_enabled: false, enabled: false };
    assert.equal(await h.run('on'), 1);
    const text = h.out.join('\n');
    assert.match(text, /Developer insights/);
    assert.match(text, /owner or admin/);
    assert.match(text, /Share my local activity/);
    assert.match(text, /never with\s+a token/);
    assert.equal(readFileSync(claude, 'utf8'), before);
    assert.ok(!existsSync(join(h.home, '.laika', 'activity')));
  });

  void test('only the developer switch off: no organisation line', async () => {
    const h = await harness();
    h.board.sharing = { ...h.board.sharing, enabled: false };
    assert.equal(await h.run('on'), 1);
    assert.doesNotMatch(h.out.join('\n'), /Developer insights/);
    assert.ok(!existsSync(join(h.home, '.claude', 'settings.json')));
  });

  void test('a refused token, or no board at all, stops before anything is written', async () => {
    const h = await harness();
    const refused = { ...h.io, env: { ...h.io.env, LAIKA_TOKEN: 'lai_wrong' } };
    assert.equal(await activity(['on'], refused), 1);
    assert.match(h.err.join('\n'), /refused the token/);
    const none = { ...h.io, env: { PATH: process.env.PATH ?? '' } };
    assert.equal(await activity(['on'], none), 1);
    assert.match(h.err.join('\n'), /not connected to a board/);
    assert.ok(!existsSync(join(h.home, '.laika', 'activity')));
  });
});

void describe('on, then off: every agent’s file', () => {
  void test('installs for every configured agent, skips Cline, and leaves others’ entries alone', async () => {
    const h = await harness();
    const f = fixtures(h.home);
    assert.equal(await h.run('on'), 0, h.err.join('\n'));
    const text = h.out.join('\n');
    assert.ok(!text.includes(TOKEN), 'the token was printed');

    // Claude Code: merged, the person's own hooks kept, 0600 kept, original backed up.
    const claude = json(f.claude) as HooksDoc & typeof f.claudeBefore;
    assert.equal(ours(claude, 'UserPromptSubmit').length, 1);
    assert.equal(ours(claude, 'SessionStart').length, 1);
    assert.equal(ours(claude, 'SessionEnd').length, 1);
    assert.equal(claude.hooks.SessionStart?.[0]?.matcher, 'startup|clear');
    // LAI-776: every turn's end, the throttled trigger — `Stop` takes no matcher.
    assert.deepEqual(
      ours(claude, 'Stop').map((c) => c.split(' ').slice(-2).join(' ')),
      ['turn-end claude-code'],
    );
    assert.equal(claude.hooks.Stop?.[0]?.matcher, undefined);
    assert.deepEqual(claude.hooks.PreToolUse, f.claudeBefore.hooks.PreToolUse);
    assert.ok(
      claude.hooks.UserPromptSubmit?.some(
        (g) => g.hooks[0]?.command === '/usr/local/bin/my-own-hook',
      ),
    );
    assert.deepEqual(claude.env, f.claudeBefore.env);
    assert.equal(statSync(f.claude).mode & 0o777, 0o600, 'a file holding the token was widened');
    assert.deepEqual(json(`${f.claude}.bak`), f.claudeBefore);
    assert.equal(statSync(`${f.claude}.bak`).mode & 0o777, 0o600);

    // Codex: its hooks file, created.
    const codex = json(join(h.home, '.codex', 'hooks.json')) as HooksDoc;
    assert.deepEqual(Object.keys(codex.hooks).sort(), [
      'SessionEnd',
      'SessionStart',
      'UserPromptSubmit',
    ]);
    assert.equal(codex.hooks.SessionStart?.[0]?.matcher, 'startup');
    assert.match(text, /\/hooks/, 'Codex skips untrusted hooks — the person must be told');

    // Gemini: BeforeAgent, beside its other settings.
    const gemini = json(f.gemini) as HooksDoc & typeof f.geminiBefore;
    assert.equal(ours(gemini, 'BeforeAgent').length, 1);
    assert.equal(gemini.theme, 'dark');
    assert.deepEqual(gemini.hooks.AfterAgent, f.geminiBefore.hooks.AfterAgent);

    // Copilot, Goose, Kiro: files of our own.
    const copilot = json(join(h.home, '.copilot', 'hooks', 'laika-activity.json')) as {
      version: number;
    } & HooksDoc;
    assert.equal(copilot.version, 1);
    assert.deepEqual(Object.keys(copilot.hooks).sort(), [
      'sessionEnd',
      'sessionStart',
      'userPromptSubmitted',
    ]);
    const plugin = join(h.home, '.agents', 'plugins', 'laika-activity');
    assert.deepEqual(json(join(plugin, 'plugin.json')), {
      name: 'laika-activity',
      version: '0.1.0',
      description: (json(join(plugin, 'plugin.json')) as { description: string }).description,
    });
    const goose = json(join(plugin, 'hooks', 'hooks.json')) as HooksDoc;
    assert.deepEqual(Object.keys(goose.hooks).sort(), [
      'SessionEnd',
      'SessionStart',
      'UserPromptSubmit',
    ]);
    assert.ok(!JSON.stringify(goose).includes('"matcher"'), 'a matcher of "*" is skipped by Goose');
    const kiro = json(join(h.home, '.kiro', 'hooks', 'laika-activity.json')) as {
      version: string;
      hooks: { trigger: string; action: { type: string; command: string } }[];
    };
    assert.equal(kiro.version, 'v1');
    assert.deepEqual(
      kiro.hooks.map((x) => x.trigger),
      ['UserPromptSubmit', 'SessionStart', 'SessionEnd'],
    );

    assert.match(text, /Cline: skipped/);
    assert.ok(!existsSync(join(h.home, 'Documents')), 'nothing may be written under ~/Documents');

    // On again: nothing changes.
    const snapshot = (): string[] =>
      [f.claude, f.gemini, join(h.home, '.codex', 'hooks.json')].map((p) =>
        readFileSync(p, 'utf8'),
      );
    const first = snapshot();
    assert.equal(await h.run('on'), 0);
    assert.deepEqual(snapshot(), first);
    assert.match(h.out.join('\n'), /already installed/);

    // Off: back to how it was.
    assert.equal(await h.run('off'), 0, h.out.join('\n'));
    const claudeAfter = json(f.claude) as typeof f.claudeBefore;
    assert.deepEqual(
      claudeAfter.hooks.SessionEnd,
      f.claudeBefore.hooks.SessionEnd,
      'a person’s own hook that mentions laika was removed',
    );
    assert.deepEqual(claudeAfter, f.claudeBefore);
    assert.deepEqual(json(f.gemini), f.geminiBefore);
    assert.ok(
      !existsSync(join(h.home, '.codex', 'hooks.json')),
      'a file only we wrote was left behind',
    );
    assert.ok(!existsSync(join(h.home, '.copilot', 'hooks', 'laika-activity.json')));
    assert.ok(!existsSync(plugin));
    assert.ok(!existsSync(join(h.home, '.kiro', 'hooks', 'laika-activity.json')));
    assert.ok(!existsSync(join(h.home, '.laika', 'activity')));
    assert.equal(statSync(f.claude).mode & 0o777, 0o600);
  });

  void test('an agent not set up for Laika is not touched, unless named with --agent', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    assert.ok(!existsSync(join(h.home, '.copilot')));
    assert.match(
      h.out.join('\n'),
      /not set up for Laika here: codex, gemini-cli, copilot, goose, kiro/,
    );
    assert.equal(await h.run('on', '--agent', 'copilot'), 0);
    assert.ok(existsSync(join(h.home, '.copilot', 'hooks', 'laika-activity.json')));
    assert.equal(await h.run('on', '--agent', 'nonsense'), 1);
  });

  void test('a file that does not parse is refused, untouched, and the entry is printed', async () => {
    const h = await harness();
    const gemini = join(h.home, '.gemini', 'settings.json');
    const jsonc = '{\n  // my settings\n  "mcpServers": { "laika": {} }\n}\n';
    write(gemini, jsonc);
    write(join(h.home, '.claude', 'settings.json'), '{ "hooks": [] }\n');
    await h.run('on', '--agent', 'gemini-cli');
    assert.equal(readFileSync(gemini, 'utf8'), jsonc);
    assert.equal(
      readFileSync(join(h.home, '.claude', 'settings.json'), 'utf8'),
      '{ "hooks": [] }\n',
    );
    const text = h.out.join('\n');
    assert.match(text, /not valid JSON/);
    assert.match(text, /"BeforeAgent"/, 'the manual steps were not printed');
    assert.match(text, /"hooks" that is not an object/);
  });

  void test('Codex: hooks already in config.toml means hooks.json is left alone', async () => {
    const h = await harness();
    write(
      join(h.home, '.codex', 'config.toml'),
      '[mcp_servers.laika]\nurl = "x"\n\n[[hooks.UserPromptSubmit]]\ncommand = "mine"\n',
    );
    await h.run('on');
    assert.ok(!existsSync(join(h.home, '.codex', 'hooks.json')));
    assert.match(h.out.join('\n'), /already defines hooks/);
  });

  void test('Codex: where it records trust (hooks.state) is not a handler', () => {
    assert.equal(codexTomlHasHandlers('[hooks.state."abc"]\ntrusted_hash = "x"\n'), false);
    assert.equal(codexTomlHasHandlers('[hooks]\nUserPromptSubmit = []\n'), true);
    assert.equal(codexTomlHasHandlers('[[hooks.SessionStart]]\n'), true);
    assert.equal(codexTomlHasHandlers('[mcp_servers.laika]\nurl = "x"\n'), false);
  });

  void test('a file of ours that someone else owns is not overwritten or deleted', async () => {
    const h = await harness();
    const foreign = join(h.home, '.kiro', 'hooks', 'laika-activity.json');
    write(foreign, '{"version":"v1","hooks":[]}\n');
    await h.run('on', '--agent', 'kiro');
    assert.equal(readFileSync(foreign, 'utf8'), '{"version":"v1","hooks":[]}\n');
    assert.equal(await h.run('off'), 1);
    assert.ok(existsSync(foreign));
  });
});

void describe('the installed command really works', () => {
  void test('Claude Code’s entry, run the way Claude Code runs it (sh -c), counts a prompt silently', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    const settings = json(join(h.home, '.claude', 'settings.json')) as HooksDoc;
    const command = ours(settings, 'UserPromptSubmit')[0] ?? '';
    const out = execFileSync('sh', ['-c', command], {
      input: JSON.stringify({ session_id: 'x', prompt: 'SECRET-PROMPT-qq' }),
      env: { PATH: process.env.PATH ?? '', HOME: h.home },
      encoding: 'utf8',
    });
    assert.equal(out, '');
    const events = readFileSync(join(h.home, '.laika', 'activity', 'events.log'), 'utf8');
    assert.match(events, /^p claude-code \d+\n$/);
  });
});

void describe('status, sync, emails', () => {
  void test('status prints exactly the body the next sync sends', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    writeFileSync(
      join(h.home, '.laika', 'activity', 'events.log'),
      `p claude-code ${String(Math.floor(Date.now() / 1000))}\n`,
    );
    h.out.length = 0;
    assert.equal(await h.run('status'), 0);
    const text = h.out.join('\n');
    const start = text.indexOf('{');
    const shown = JSON.parse(text.slice(start)) as { days: { prompts: Record<string, number> }[] };
    assert.equal(shown.days.at(-1)?.prompts['claude-code'], 1, 'the counted prompt is not in it');

    await sync({ home: h.home, env: h.io.env, nowMs: () => Date.now(), tz: TZ });
    const put = h.board.requests.find((r) => r.method === 'PUT');
    assert.ok(put !== undefined, 'the sync sent nothing');
    assert.deepEqual(JSON.parse(put.body), shown);
    assert.deepEqual(h.board.violations, []);

    h.out.length = 0;
    await h.run('status');
    assert.match(h.out.join('\n'), /Last sync\s+.* — sent, 14 days accepted/);
  });

  void test('`on` and `status` each name the skip rules, in one line', async () => {
    const h = await harness();
    const rule = /OMNIGENT=1.*\bCI\b.*LAIKA_ACTIVITY_SKIP/;
    assert.equal(await h.run('on'), 0);
    assert.equal(h.out.filter((line) => rule.test(line)).length, 1, h.out.join('\n'));
    h.out.length = 0;
    assert.equal(await h.run('status'), 0);
    assert.equal(h.out.filter((line) => rule.test(line)).length, 1, h.out.join('\n'));
  });

  /**
   * LAI-773 (design.md §3): the OpenTelemetry fallback is the developer's to
   * set, so `otel` prints the variables — this machine's board filled in, the
   * token left as a reference — on stdout alone, for `eval "$(laika activity
   * otel)"`. Nothing it prints holds the token.
   */
  void test('otel prints the exact variables for this board, the token a reference, and status points at it', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    h.out.length = 0;
    h.err.length = 0;
    assert.equal(await h.run('otel'), 0);
    assert.deepEqual(h.out, [
      'export CLAUDE_CODE_ENABLE_TELEMETRY=1',
      'export OTEL_METRICS_EXPORTER=otlp',
      'export OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
      `export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="${h.board.url}/api/v1/otlp/v1/metrics"`,
      'export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"',
      'export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative',
      'export OTEL_LOGS_EXPORTER=none',
    ]);
    assert.match(h.err.join('\n'), /LAIKA_TOKEN/);
    assert.ok(![...h.out, ...h.err].join('\n').includes(TOKEN), 'the token was printed');

    h.out.length = 0;
    assert.equal(await h.run('status'), 0);
    assert.equal(
      h.out.filter((line) => line.includes('laika activity otel')).length,
      1,
      h.out.join('\n'),
    );
  });

  void test('otel with no board to name says so, and prints no variable', async () => {
    const h = await harness();
    const none = { ...h.io, env: { PATH: process.env.PATH ?? '', HOME: h.home } };
    assert.equal(await activity(['otel'], none), 1);
    assert.deepEqual(h.out, []);
    assert.match(h.err.join('\n'), /not connected to a board/);
  });

  void test('status when off says so', async () => {
    const h = await harness();
    assert.equal(await h.run('status'), 0);
    assert.match(h.out.join('\n'), /off on this machine/);
  });

  void test('sync --background hands off to a detached process and prints nothing', async () => {
    const h = await harness();
    assert.equal(await h.run('sync', '--background'), 0);
    assert.deepEqual(h.spawned, [['activity', 'sync', '--quiet']]);
    assert.deepEqual([...h.out, ...h.err], []);
  });

  void test(
    'a sync that reaches its deadline ends the process rather than wait on a hung call',
    { timeout: 10_000 },
    async () => {
      const h = await harness();
      assert.equal(await h.run('on'), 0);
      writeFileSync(
        join(h.home, '.laika', 'activity', 'repos'),
        `${String(Math.floor(Date.now() / 1000))}\t${h.home}\n`,
      );
      const hung: GitRunner = () => new Promise<string | undefined>(() => undefined);
      const io: ActivityIo = { ...h.io, git: hung, deadlineMs: 200 };
      assert.equal(await activity(['sync'], io), 1);
      assert.deepEqual(h.exits, [1]);
      assert.match(h.err.join('\n'), /did not finish within/);
      assert.equal(await activity(['sync', '--quiet'], io), 0, 'not due yet: the start claimed it');
      assert.deepEqual(h.exits, [1]);
    },
  );

  void test('sync --quiet prints nothing even when it fails', async () => {
    const h = await harness();
    assert.equal(await h.run('sync', '--quiet'), 0);
    assert.deepEqual([...h.out, ...h.err], []);
  });

  void test('emails: set, list, clear — kept 0600, and never sent', async () => {
    const h = await harness();
    assert.equal(await h.run('on'), 0);
    assert.equal(await h.run('emails', 'Second@Example.test', 'third@example.test'), 0);
    const file = activityPaths(h.home).emails;
    assert.equal(readFileSync(file, 'utf8'), 'second@example.test\nthird@example.test\n');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    h.out.length = 0;
    await h.run('emails');
    assert.match(h.out.join('\n'), /second@example\.test/);
    assert.equal(await h.run('emails', 'not-an-email'), 1);
    await sync({ home: h.home, env: h.io.env, nowMs: () => Date.now(), tz: TZ });
    assert.ok(!h.board.requests.some((r) => r.body.includes('example.test')));
    assert.equal(await h.run('emails', '--clear'), 0);
    assert.equal(readFileSync(file, 'utf8'), '');
  });

  void test('`on` starts counting from now, and keeps the schedule on a re-run', async () => {
    const h = await harness();
    await h.run('on');
    const first = readState(activityPaths(h.home));
    assert.equal(first?.collect, true);
    assert.equal(first?.next_sync_at, 0);
    await h.run('on');
    assert.equal(readState(activityPaths(h.home))?.since, first?.since);
  });

  void test('`laika activity` is reachable from the CLI entry point', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [ENTRY, 'activity'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (cause) {
      const e = cause as { status: number; stderr: string };
      code = e.status;
      stderr = e.stderr;
    }
    assert.equal(code, 1);
    assert.match(stderr, /laika activity on/);
  });
});
