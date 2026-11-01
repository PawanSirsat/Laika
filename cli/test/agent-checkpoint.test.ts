/**
 * The checkpoint helper's rules on their own (LAI-547): what counts as a
 * secret, which names are refused, when a hook starts a save, what the
 * verification wording is, and which tag segment the server will build. The
 * end-to-end behaviour against a real board and remote is
 * `agent-checkpoint-e2e.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type Activity,
  branchIsTasks,
  parseNote,
  PENDING,
  PENDING_LONG,
  REDELIVER_HINT,
  segmentOf,
  shouldTrigger,
  TRIGGER_MS,
  verificationLines,
} from '../src/agent-checkpoint.ts';
import {
  assertWorkBranch,
  deniedName,
  gitEnv,
  Refusal,
  repoFromUrl,
  secretIn,
  ulid,
} from '../src/checkpoint-git.ts';
import * as checkpointCli from '../src/agent-checkpoint-cli.ts';
import * as checkpoint from '../src/agent-checkpoint.ts';
import { agentHookGroups } from '../src/agent-hooks.ts';
import * as agentCli from '../src/agent.ts';

void describe('secret patterns (D-115 item 5)', () => {
  // Every sample is assembled at run time, so this file never holds the shape.
  const samples: [string, string][] = [
    ['a private key', `${'-----BEGIN '}OPENSSH PRIVATE KEY-----`],
    ['a private key', `${'-----BEGIN '}PRIVATE KEY-----`],
    ['an AWS access key id', `key=${'AKIA'}ABCDEFGHIJKLMNOP`],
    ['a GitHub token', `ghp_${'x'.repeat(36)}`],
    ['a GitHub token', `github_pat_${'A'.repeat(30)}`],
    ['a Slack token', `${'xoxb'}-1234567890-abc`],
    ['an API secret key', `sk-ant-${'a'.repeat(40)}`],
    ['a Stripe live key', `sk_live_${'a'.repeat(24)}`],
    ['a Google API key', `AIza${'b'.repeat(35)}`],
    ['a bearer credential', `Authorization: Bearer ${'t'.repeat(30)}`],
    ['a URL with a password', 'https://ada:hunter22@example.test/repo'],
  ];
  for (const [what, text] of samples) {
    void test(`finds ${what}`, () => assert.equal(secretIn(text), what));
  }
  void test('leaves ordinary text alone', () => {
    for (const text of [
      'export const key = process.env.API_KEY;',
      'the PRIVATE KEY header is checked',
      'https://example.test/path',
      'sk-short',
    ]) {
      assert.equal(secretIn(text), undefined, text);
    }
  });
});

void describe('secret-shaped names', () => {
  void test('are refused', () => {
    for (const path of [
      '.env',
      'app/.env.production',
      'certs/server.pem',
      'tls.key',
      'id_rsa',
      'id_ed25519',
      '.npmrc',
      '.netrc',
      'credentials.json',
      'secrets.yaml',
      'service-account-prod.json',
      'home/.aws/credentials',
      'x/.laika/env',
      'terraform.tfstate',
    ]) {
      assert.equal(deniedName(path), true, path);
    }
  });
  void test('are not confused with ordinary files', () => {
    for (const path of [
      '.env.example',
      '.env.sample',
      'id_rsa.pub',
      'src/keys.ts',
      'env.ts',
      'fixture.pem.txt',
    ]) {
      assert.equal(deniedName(path), false, path);
    }
  });
});

void describe('protected branches', () => {
  void test('master, main and the remote default are refused; a task branch is not', () => {
    for (const [branch, def] of [
      ['master', undefined],
      ['main', undefined],
      ['trunk', 'trunk'],
    ] as const) {
      assert.throws(
        () => assertWorkBranch(branch, def),
        (e: unknown) => e instanceof Refusal && e.code === 'protected_branch',
      );
    }
    assert.doesNotThrow(() => assertWorkBranch('LAI-547-checkpoint-helper', 'master'));
  });
});

void describe('the trigger', () => {
  const now = 10_000_000;
  const at = (a: Partial<Activity>): Activity => ({ mutations: 0, ...a });
  void test('nothing unsaved: never', () => {
    assert.equal(shouldTrigger(at({}), now, false), false);
    assert.equal(shouldTrigger(at({}), now, true), false);
  });
  void test('ten mutating calls, or two minutes after the first', () => {
    assert.equal(
      shouldTrigger(at({ mutations: 9, first_mutation_at: now - 1000 }), now, false),
      false,
    );
    assert.equal(
      shouldTrigger(at({ mutations: 10, first_mutation_at: now - 1000 }), now, false),
      true,
    );
    assert.equal(
      shouldTrigger(at({ mutations: 1, first_mutation_at: now - TRIGGER_MS }), now, false),
      true,
    );
    assert.equal(
      shouldTrigger(at({ mutations: 1, first_mutation_at: now - TRIGGER_MS + 1 }), now, false),
      false,
    );
  });
  void test('not again within two minutes of the last attempt, except at Stop', () => {
    const busy = at({
      mutations: 20,
      first_mutation_at: now - 5 * TRIGGER_MS,
      last_attempt_at: now - 1000,
    });
    assert.equal(shouldTrigger(busy, now, false), false);
    assert.equal(shouldTrigger(busy, now, true), true);
  });
});

void describe('verification wording (SPEC §4.70)', () => {
  const notice = 10 * 60_000;
  void test('pending, then the longer wording with the Redeliver hint after ten minutes', () => {
    assert.deepEqual(verificationLines('pending', 0, notice), [PENDING]);
    assert.deepEqual(verificationLines('pending', notice - 1, notice), [PENDING]);
    assert.deepEqual(verificationLines('pending', notice, notice), [PENDING_LONG, REDELIVER_HINT]);
    assert.match(REDELIVER_HINT, /Recent Deliveries and use Redeliver/);
  });
  void test('the other states', () => {
    assert.deepEqual(verificationLines('verified', undefined, notice), ['Verified']);
    assert.match(
      verificationLines('uncertain', undefined, notice)[0] ?? '',
      /^Save needs attention/,
    );
    assert.deepEqual(verificationLines('ref_deleted', undefined, notice), [
      'Save removed from GitHub',
    ]);
  });
});

void describe('the note', () => {
  void test('takes the five fields and nothing else', () => {
    assert.deepEqual(parseNote({ work_done: 'a', failing: 'b' }), { work_done: 'a', failing: 'b' });
    assert.throws(() => parseNote({ diff: 'x' }), /no field "diff"/);
    assert.throws(() => parseNote({ work_done: 1 }), /must be text/);
    assert.throws(() => parseNote({ work_done: 'x'.repeat(4001) }), /over 4000/);
  });
  void test('refuses a secret, naming the field', () => {
    assert.throws(
      () => parseNote({ next_step: `use ${'AKIA'}ABCDEFGHIJKLMNOP` }),
      (e: unknown) =>
        e instanceof Refusal && e.code === 'secret_in_note' && e.paths[0] === 'note.next_step',
    );
  });
});

void describe('names and ids', () => {
  void test('the tag segment is the outside id when it is one, else the key — as the server builds it', () => {
    assert.equal(segmentOf('LAIKA-799', 'LAI-547'), 'LAI-547');
    assert.equal(segmentOf('LAIKA-799', null), 'LAIKA-799');
    assert.equal(segmentOf('LAIKA-799', 'owner/repo#12'), 'LAIKA-799');
  });
  void test('a branch is the task’s when it is named after it', () => {
    const task = {
      id: 'x',
      key: 'LAIKA-799',
      externalRef: 'LAI-547',
      segment: 'LAI-547',
      branch: null,
    };
    assert.equal(branchIsTasks('LAI-547-checkpoint-helper', task), true);
    assert.equal(branchIsTasks('lai-547-lower', task), true);
    assert.equal(branchIsTasks('LAI-5470-other', task), false);
    assert.equal(branchIsTasks('feature/x', task), false);
  });
  void test('repo from a remote URL', () => {
    assert.equal(
      repoFromUrl('https://PawanSirsat@github.com/PawanSirsat/Laika.git'),
      'pawansirsat/laika',
    );
    assert.equal(repoFromUrl('git@github.com:acme/widgets.git'), 'acme/widgets');
    assert.equal(repoFromUrl('ssh://git@github.com/acme/widgets'), 'acme/widgets');
    assert.equal(repoFromUrl('/tmp/remote.git'), undefined);
  });
  void test('a minted id is a ULID', () => {
    assert.match(ulid(Date.now()), /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  void test('git never sees a Laika token or a GIT_ override', () => {
    const env = gitEnv({
      LAIKA_AGENT_TOKEN: 's',
      LAIKA_TOKEN: 's',
      GIT_DIR: '/x',
      PATH: '/bin',
      SSH_AUTH_SOCK: '/s',
    });
    assert.equal(env.LAIKA_AGENT_TOKEN, undefined);
    assert.equal(env.LAIKA_TOKEN, undefined);
    assert.equal(env.GIT_DIR, undefined);
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.SSH_AUTH_SOCK, '/s');
  });
});

void describe('review fixes, unit (LAI-547, #154)', () => {
  void test("P1-4: Laika's token shape, lai_ and 40 base62", () => {
    const token = `${'lai'}_${'Zz09'.repeat(10)}`;
    assert.equal(secretIn(`const t = '${token}';`), 'a Laika token');
    assert.equal(secretIn(`${'lai'}_short`), undefined);
  });

  void test("P1-6: git's environment is an allowlist", () => {
    const env = gitEnv({
      PATH: '/bin',
      HOME: '/h',
      LANG: 'en_GB.UTF-8',
      LC_CTYPE: 'UTF-8',
      TMPDIR: '/t',
      SSH_AUTH_SOCK: '/s',
      GIT_SSH_COMMAND: 'ssh -i k',
      AWS_SECRET_ACCESS_KEY: 'a',
      GH_TOKEN: 'g',
      GITHUB_TOKEN: 'g',
      NPM_TOKEN: 'n',
      LAIKA_AGENT_TOKEN: 'l',
      GIT_DIR: '/x',
      GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/evil'",
    });
    assert.deepEqual(Object.keys(env).sort(), [
      'GIT_SSH_COMMAND',
      'GIT_TERMINAL_PROMPT',
      'HOME',
      'LANG',
      'LC_ALL',
      'PATH',
      'SSH_AUTH_SOCK',
      'TMPDIR',
    ]);
  });

  void test("the owner's password is zeroed after the sign-in, in the request body too", async () => {
    const password = Buffer.from('correct-horse-battery');
    let sent = '';
    let body: Uint8Array | undefined;
    const cookie = await checkpointCli.signInWithPassword(
      'http://board.test',
      'ada@example.test',
      password,
      (_url: string, init: RequestInit) => {
        body = init.body as Uint8Array;
        sent = Buffer.from(body).toString('utf8');
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'set-cookie': 'session=1; Path=/' } }),
        );
      },
    );
    assert.equal(cookie, 'session=1; Path=/');
    assert.match(sent, /"password":"correct-horse-battery"/, 'it was sent');
    assert.ok(
      password.every((byte) => byte === 0),
      'the password buffer is zeroed',
    );
    assert.ok(
      body?.every((byte) => byte === 0),
      'the request body is zeroed',
    );
  });

  void test('a password with quotes, backslashes, control characters and non-ASCII arrives intact', async () => {
    const original = 'p"a\\s\tw\u0001ö€';
    let sent = '';
    await checkpointCli.signInWithPassword(
      'http://board.test',
      'ada@example.test',
      Buffer.from(original, 'utf8'),
      (_url: string, init: RequestInit) => {
        sent = Buffer.from(init.body as Uint8Array).toString('utf8');
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'set-cookie': 's=1' } }),
        );
      },
    );
    assert.deepEqual(JSON.parse(sent), { email: 'ada@example.test', password: original });
  });
});

void describe('the interlock time bounds (LAI-547, #154 round 2)', () => {
  void test('a save’s budget and grace end before PreToolUse stops waiting, which ends before the harness kills the hook', () => {
    assert.ok(
      checkpoint.SAVE_BUDGET_MS + checkpoint.INTERLOCK_GRACE_MS < checkpoint.PRE_TOOL_WAIT_MS,
      'a save that keeps to its budget is always waited for, never denied',
    );
    for (const harness of ['claude-code', 'codex'] as const) {
      const groups = agentHookGroups('/x/laika-agent-hook', harness);
      const pre = (groups.PreToolUse as { hooks: { timeout: number }[] }).hooks[0]?.timeout ?? 0;
      assert.ok(
        agentCli.HOOK_READ_MS + checkpoint.PRE_TOOL_WAIT_MS + 2000 <= pre * 1000,
        `${harness}: PreToolUse's ${String(pre)} s timeout leaves room for the read, the wait and node's start`,
      );
    }
  });
});

void describe('the installed checkpoint hooks (LAI-547, #154 round 2)', () => {
  void test('PostToolUseFailure is installed for Claude Code, which documents it, and not for Codex, which does not', () => {
    const cc = agentHookGroups('/x/laika-agent-hook', 'claude-code');
    const codex = agentHookGroups('/x/laika-agent-hook', 'codex');
    assert.match(
      String(
        (cc.PostToolUseFailure as { hooks: { command: string }[] } | undefined)?.hooks[0]?.command,
      ),
      /laika-agent-hook' tool-failed claude-code$/,
    );
    assert.equal(codex.PostToolUseFailure, undefined);
    for (const groups of [cc, codex]) {
      for (const event of ['PreToolUse', 'PostToolUse', 'Stop']) assert.ok(groups[event], event);
    }
  });
});
