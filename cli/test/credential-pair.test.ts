/**
 * A board URL and its token are taken as a pair from one source, never mixed
 * (LAI-1343, found by review-1325 on PR #376).
 *
 * The case that found it: the environment's `LAIKA_URL` names board B and
 * holds no token, while `~/.laika/env` holds board C's URL and token. Read one
 * name at a time across the sources, that was B with C's token, and `laika
 * activity on` sent C's token to B. Each lookup that reads both names is
 * driven here with that machine, against two stub boards, and B must see
 * nothing.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { activity, HOOK_SCRIPT, type ActivityIo } from '../src/activity.ts';
import { activityPaths, writeState } from '../src/activity-store.ts';
import { activityCredentials, findCredentials, NOT_CONNECTED } from '../src/activity-sync.ts';
import { writeCredential } from '../src/agent-session.ts';
import { pairCredentials, unpairedLines } from '../src/credential-pair.ts';
import { whoami } from '../src/whoami.ts';
import { closeAll, stubBoard } from './support/stub-board.ts';

const TOKEN_B = 'lai_BoardBTokenNeverSentAnywhere';
const TOKEN_C = 'lai_BoardCTokenMustNeverReachB';

const scratch: string[] = [];
after(() => {
  closeAll();
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

function home(): string {
  const made = mkdtempSync(join(tmpdir(), 'laika-pair-'));
  scratch.push(made);
  return made;
}

/** `~/.laika/env` as the installer and `laika connect` write it. */
function envFile(at: string, lines: Readonly<Record<string, string>>): string {
  const path = join(at, '.laika', 'env');
  mkdirSync(join(at, '.laika'), { recursive: true });
  writeFileSync(
    path,
    Object.entries(lines)
      .map(([key, value]) => `${key}="${value}"\n`)
      .join(''),
    { mode: 0o600 },
  );
  return path;
}

void describe('pairCredentials', () => {
  const env = (url?: string, token?: string) => ({ from: 'the environment', url, token });
  const file = (url?: string, token?: string) => ({ from: '~/.laika/env', url, token });

  void test('the first board named, with its own token', () => {
    assert.deepEqual(pairCredentials([env('http://b/', 'tb'), file('http://c', 'tc')]), {
      url: 'http://b',
      from: 'the environment',
      token: 'tb',
      tokenFrom: 'the environment',
    });
  });

  void test("a URL alone is never given another board's token", () => {
    assert.deepEqual(pairCredentials([env('http://b'), file('http://c', 'tc')]), {
      url: 'http://b',
      from: 'the environment',
    });
  });

  void test('a URL alone takes a token held for that same board elsewhere', () => {
    assert.deepEqual(pairCredentials([env('http://b'), file('http://b/', 'tb')]), {
      url: 'http://b',
      from: 'the environment',
      token: 'tb',
      tokenFrom: '~/.laika/env',
    });
  });

  void test('a token alone names no board, and is never given one', () => {
    assert.deepEqual(pairCredentials([env(undefined, 'tb'), file('http://c', 'tc')]), {
      url: 'http://c',
      from: '~/.laika/env',
      token: 'tc',
      tokenFrom: '~/.laika/env',
    });
    assert.deepEqual(pairCredentials([env(undefined, 'tb'), file('http://c')]), {
      url: 'http://c',
      from: '~/.laika/env',
    });
  });

  void test('blank values are absent; nothing named is undefined', () => {
    assert.equal(pairCredentials([env(' ', ' '), file('', '')]), undefined);
    assert.equal(pairCredentials([]), undefined);
    assert.deepEqual(pairCredentials([env(' http://b ', ' tb ')]), {
      url: 'http://b',
      from: 'the environment',
      token: 'tb',
      tokenFrom: 'the environment',
    });
  });
});

void describe('unpairedLines — why the board named has no token (LAI-1343 review)', () => {
  const b = { url: 'http://b', from: 'the environment' };
  void test('another place holds a token for another board: named, and not sent', () => {
    assert.deepEqual(unpairedLines(b, [{ from: '~/.laika/env', url: 'http://c/', token: 't' }]), [
      'No token for http://b. ~/.laika/env holds one for http://c, which is not sent to another board.',
      'Set LAIKA_URL and LAIKA_TOKEN together, or unset LAIKA_URL to use that board.',
    ]);
  });

  void test('the board named by a file: the fix is in that file', () => {
    assert.deepEqual(
      unpairedLines({ url: 'http://b', from: '~/.claude/settings.json' }, [
        { from: '~/.laika/env', url: 'http://c', token: 't' },
      ])?.[1],
      "Put http://b's token beside its URL in ~/.claude/settings.json, or remove that URL to use the other board.",
    );
  });

  void test("another place is a tool's credential file: the tool is named (LAI-1344 follow-up)", () => {
    const tool = { from: '~/.laika/agents/codex.json', url: 'http://c', token: 't', tool: 'Codex' };
    assert.equal(
      unpairedLines(b, [tool])?.[1],
      "Set LAIKA_URL and LAIKA_TOKEN together, or unset LAIKA_URL to use Codex's own credential for that board.",
    );
    assert.equal(
      unpairedLines({ url: 'http://b', from: '~/.claude/settings.json' }, [tool])?.[1],
      "Put http://b's token beside its URL in ~/.claude/settings.json, or remove that URL to use Codex's own credential for the other board.",
    );
  });

  void test('a token with no URL beside it names no board', () => {
    assert.deepEqual(unpairedLines(b, [{ from: 'the environment', token: 't' }]), [
      'No token for http://b. LAIKA_TOKEN in the environment is not used: no LAIKA_URL beside it names its board.',
      'Set LAIKA_URL and LAIKA_TOKEN together in the environment.',
    ]);
  });

  void test('nothing held anywhere: nothing to explain', () => {
    assert.equal(unpairedLines(b, [{ from: '~/.laika/env', url: 'http://b' }]), undefined);
  });
});

void describe('findCredentials and activityCredentials', () => {
  void test("the environment's board B with ~/.laika/env's board C: no credential, never B with C's token", () => {
    const at = home();
    envFile(at, { LAIKA_URL: 'http://board-c.test', LAIKA_TOKEN: TOKEN_C });
    assert.equal(findCredentials(at, { LAIKA_URL: 'http://board-b.test' }), undefined);
    assert.equal(activityCredentials(at, { LAIKA_URL: 'http://board-b.test' }), undefined);
  });

  void test('the same board in both: the file’s token, for that board', () => {
    const at = home();
    envFile(at, { LAIKA_URL: 'http://board-b.test/', LAIKA_TOKEN: TOKEN_B });
    assert.deepEqual(findCredentials(at, { LAIKA_URL: 'http://board-b.test' }), {
      url: 'http://board-b.test',
      token: TOKEN_B,
    });
  });

  void test('a pair in the environment wins, as before', () => {
    const at = home();
    envFile(at, { LAIKA_URL: 'http://board-c.test', LAIKA_TOKEN: TOKEN_C });
    assert.deepEqual(
      findCredentials(at, { LAIKA_URL: 'http://board-b.test', LAIKA_TOKEN: TOKEN_B }),
      { url: 'http://board-b.test', token: TOKEN_B },
    );
  });

  void test("~/.claude/settings.json's board is paired the same way", () => {
    const at = home();
    mkdirSync(join(at, '.claude'), { recursive: true });
    writeFileSync(
      join(at, '.claude', 'settings.json'),
      JSON.stringify({ env: { LAIKA_URL: 'http://board-b.test' } }),
    );
    envFile(at, { LAIKA_URL: 'http://board-c.test', LAIKA_TOKEN: TOKEN_C });
    assert.equal(findCredentials(at, {}), undefined);
  });
});

/** An activity io for `home`, with only the environment given. */
function activityIo(
  at: string,
  env: Readonly<Record<string, string>>,
): { io: ActivityIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      home: at,
      env: { PATH: process.env.PATH ?? '', HOME: at, ...env },
      nowMs: () => Date.now(),
      tz: 'UTC',
      hookScript: HOOK_SCRIPT,
      hookShell: '/bin/sh',
      spawnDetached: () => undefined,
      exit: () => undefined,
    },
  };
}

void describe('nothing reaches board B (the acceptance case)', () => {
  void test('`laika activity on`: B sees no request, C is not reached under B’s name', async () => {
    const b = await stubBoard(TOKEN_B);
    const c = await stubBoard(TOKEN_C);
    const at = home();
    envFile(at, { LAIKA_URL: c.url, LAIKA_TOKEN: TOKEN_C });
    const { io, err } = activityIo(at, { LAIKA_URL: b.url });

    assert.equal(await activity(['on'], io), 1);
    assert.deepEqual(b.requests, [], 'board B was sent a request');
    assert.deepEqual(c.requests, [], 'board C was asked although B was named');
    // Not "not connected — put a personal token in ~/.laika/env": it holds one, for C.
    assert.deepEqual(err, [
      `No token for ${b.url}. ~/.laika/env holds one for ${c.url}, which is not sent to another board.`,
      'Set LAIKA_URL and LAIKA_TOKEN together, or unset LAIKA_URL to use that board.',
    ]);
  });

  void test("`laika activity on`: the shell on B and Claude Code's credential for C turn nothing on for C", async () => {
    const b = await stubBoard(TOKEN_B);
    const c = await stubBoard(TOKEN_C);
    const at = home();
    writeCredential(at, 'claude-code', { url: c.url, token: TOKEN_C });
    assert.equal(activityCredentials(at, { LAIKA_URL: b.url }), undefined);
    const { io, err } = activityIo(at, { LAIKA_URL: b.url });

    assert.equal(await activity(['on'], io), 1);
    assert.deepEqual(b.requests, []);
    assert.deepEqual(c.requests, [], 'activity was turned on for C although the shell names B');
    assert.deepEqual(err, [
      `No token for ${b.url}. ~/.laika/agents/claude-code.json holds one for ${c.url}, which is not sent to another board.`,
      "Set LAIKA_URL and LAIKA_TOKEN together, or unset LAIKA_URL to use Claude Code's own credential for that board.",
    ]);
    // With no board named anywhere, that credential is this machine's connection, as before.
    assert.deepEqual(activityCredentials(at, {}), {
      url: c.url,
      token: TOKEN_C,
      via: 'claude-code',
    });
  });

  void test('`laika activity on` with nothing anywhere still says how to connect', async () => {
    const at = home();
    const { io, err } = activityIo(at, {});
    assert.equal(await activity(['on'], io), 1);
    assert.deepEqual(err, [...NOT_CONNECTED]);
  });

  void test('`laika whoami`: B is reported with no token, the file’s board named, nothing sent', async () => {
    const b = await stubBoard(TOKEN_B);
    const c = await stubBoard(TOKEN_C);
    const at = home();
    const path = envFile(at, { LAIKA_URL: c.url, LAIKA_TOKEN: TOKEN_C });
    const out: string[] = [];
    const err: string[] = [];
    const code = await whoami({
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      settingsPath: join(at, '.claude', 'settings.json'),
      envPath: path,
      home: at,
      env: { LAIKA_URL: b.url },
    });

    assert.equal(code, 1);
    assert.deepEqual(b.requests, [], 'board B was sent a request');
    assert.deepEqual(c.requests, []);
    assert.ok(out.includes(`Board   ${b.url}`), out.join('\n'));
    assert.ok(out.includes('Token   not set'), out.join('\n'));
    assert.match(
      err.join('\n'),
      new RegExp(
        `No token for ${b.url}\\. .* holds one for ${c.url}, which is not sent to another board\\.`,
      ),
    );
    assert.ok(!`${out.join('\n')}${err.join('\n')}`.includes(TOKEN_C), 'a token was printed');
  });

  void test('`laika whoami`: a LAIKA_TOKEN with no URL is said to be unused, not "not set"', async () => {
    const c = await stubBoard(TOKEN_C);
    const at = home();
    const path = envFile(at, { LAIKA_URL: c.url });
    const err: string[] = [];
    const code = await whoami({
      out: () => undefined,
      err: (line) => err.push(line),
      settingsPath: join(at, '.claude', 'settings.json'),
      envPath: path,
      home: at,
      env: { LAIKA_TOKEN: TOKEN_B },
    });
    assert.equal(code, 1);
    assert.deepEqual(c.requests, []);
    assert.deepEqual(
      err.filter((line) => line !== ''),
      [
        `No token for ${c.url}. LAIKA_TOKEN in the environment is not used: no LAIKA_URL beside it names its board.`,
        'Set LAIKA_URL and LAIKA_TOKEN together in the environment.',
      ],
    );
    assert.ok(!err.join('\n').includes(TOKEN_B), 'the token was printed');
  });

  void test('`laika whoami` with the pair in one place still asks that board', async () => {
    const c = await stubBoard(TOKEN_C);
    const at = home();
    const path = envFile(at, { LAIKA_URL: c.url, LAIKA_TOKEN: TOKEN_C });
    const code = await whoami({
      out: () => undefined,
      err: () => undefined,
      settingsPath: join(at, '.claude', 'settings.json'),
      envPath: path,
      home: at,
      env: {},
    });
    // The stub implements activity's routes only, so /me is not found; what
    // matters is that it was asked, with its own token.
    assert.equal(code, 1);
    assert.equal(c.requests.length, 1);
    assert.equal(c.requests[0]?.auth, `Bearer ${TOKEN_C}`);
  });

  void test('`laika activity otel`: a shell naming another board gets no lines, so its token goes nowhere', async () => {
    const b = await stubBoard(TOKEN_B);
    const at = home();
    // Local activity was turned on for board C; this shell names board B.
    const paths = activityPaths(at);
    mkdirSync(paths.dir, { recursive: true });
    writeState(paths, {
      collect: true,
      next_sync_at: 0,
      org_enabled: true,
      enabled: true,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
      since: 0,
      checked_at: 0,
      failures: 0,
      board: 'http://board-c.test',
    });
    const { io, out, err } = activityIo(at, { LAIKA_URL: b.url, LAIKA_TOKEN: TOKEN_B });

    assert.equal(await activity(['otel'], io), 1);
    assert.deepEqual(out, [], 'export lines were printed');
    assert.match(
      err.join('\n'),
      new RegExp(
        `This shell's LAIKA_URL is ${b.url}, but these lines are for http://board-c\\.test`,
      ),
    );

    // The same shell naming C gets them.
    const same = activityIo(at, { LAIKA_URL: 'http://board-c.test/', LAIKA_TOKEN: TOKEN_C });
    assert.equal(await activity(['otel'], same.io), 0);
    assert.ok(
      same.out.some((line) => line.includes('http://board-c.test/api/v1/otlp/v1/metrics')),
      same.out.join('\n'),
    );
    assert.deepEqual(b.requests, []);

    // A shell with a token and no LAIKA_URL names no board for it: no lines either.
    const orphan = activityIo(at, { LAIKA_TOKEN: TOKEN_B });
    assert.equal(await activity(['otel'], orphan.io), 1);
    assert.deepEqual(orphan.out, []);
    assert.equal(
      orphan.err[0],
      'This shell has LAIKA_TOKEN but no LAIKA_URL naming its board, and these lines would send it to http://board-c.test. Nothing printed.',
    );
    assert.ok(!orphan.err.join('\n').includes(TOKEN_B), 'the token was printed');
  });
});
