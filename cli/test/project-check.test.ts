/**
 * `laika project check` (LAI-1066; plan LAI-1042 §F.7, §K "Prompt").
 *
 * Every repository here is a real git repository in a temp folder, and every
 * board is a `fetch` that records what it was sent. What matters most is
 * asserted on every run: no file is written, no file content and no local
 * path leaves the machine, the token is never printed, and the person's own
 * `LAIKA_TOKEN` is never used.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import {
  BLOCK_END,
  cleanLabel,
  type CheckIo,
  detectBlock,
  INSTRUCTIONS_FILE,
  LABEL_PATTERN,
  NEUTRAL_LABEL,
  normaliseRemote,
  PROJECT_BLOCK_REVISION,
  projectCheck,
  USAGE,
} from '../src/project-check.ts';

const AGENT_TOKEN = 'lai_AGENTPLANTEDSECRET0123456789abcdef';
const PERSONAL_TOKEN = 'lai_PERSONALPLANTEDSECRET0123456789';
/** An agent token from the environment, told apart from the saved files' one. */
const ENV_TOKEN = 'lai_ENVAGENTPLANTEDSECRET0123456789ab';
/** A sentence in every fixture file that must never be printed or sent. */
const PRIVATE = 'PRIVATE-NOTE-do-not-leak-7f3a';
const BOARD = 'http://board.test';

const marked = (revision: number, slug: string, prefix: string) =>
  `# Notes\n\n${PRIVATE}\n\n<!-- laika:begin revision=${String(revision)} project=${slug} -->\n## Laika\n\nThis project is tracked on a Laika board. Mirror work onto it.\n\nTask keys look like \`${prefix}-42\`.\n${BLOCK_END}\n\n## After\n\nmore\n`;

/** A current marked block whose begin marker names no project: nothing needs action, no slug. */
const unnamed = `# Notes\n\n${PRIVATE}\n\n<!-- laika:begin revision=2 -->\n## Laika\n\nThis project is tracked on a Laika board.\n${BLOCK_END}\n`;

const legacy = (prefix: string) =>
  `# Notes\n\n${PRIVATE}\n\n## Laika\n\nThis project is tracked on a Laika board. Mirror work onto it as you go.\n\nTask keys look like \`${prefix}-42\`.\n\n## After\n\nmore\n`;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

/** A repository with `files`, and a remote unless `remote` is null. */
function repo(
  files: Record<string, string>,
  remote: string | null = 'git@github.com:Example/onroute-app.git',
): string {
  const dir = tempDir('laika-pc-repo-');
  git(dir, 'init', '-q');
  if (remote !== null) git(dir, 'remote', 'add', 'origin', remote);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** Every file under `dir`, `.git` included, with its bytes and mtime. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
      } else {
        out[relative(dir, full)] =
          `${createHash('sha256').update(readFileSync(full)).digest('hex')}:${String(s.mtimeMs)}`;
      }
    }
  };
  walk(dir);
  return out;
}

interface Sent {
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}

interface Run {
  code: number;
  out: string;
  err: string;
  /** The records posted. */
  sent: Sent[];
  /** The manifest reads the gate made. */
  asked: string[];
}

type Board = (body: Record<string, unknown>) => { status: number; body: unknown } | 'down';

/** The board's `GET /developer/compatibility`, as #216 serves it. */
type Manifest = { status: number; body: unknown } | 'down';

const manifest = (
  over: { project_setups?: boolean; need?: number } = {},
): { status: number; body: unknown } => ({
  status: 200,
  body: {
    server: { version: '0.1.0', build_commit: null },
    protocol: { current: 2, min_client: 1 },
    features: {
      developer_access: 'v3',
      device_pairing: true,
      tool_setup_exchange: true,
      client_reports: true,
      project_setups: over.project_setups ?? true,
    },
    cli: {
      min_protocol_for: {
        device_pairing: 2,
        tool_setup_exchange: 2,
        client_reports: 2,
        project_setups: over.need ?? 2,
      },
      source: { url: 'https://example.test/laika.git', commit: null },
    },
  },
});

const recording: Board = (body) => ({
  status: 201,
  body: {
    id: '01S',
    project_match: body.block_project === null ? null : body.block_project === body.project_slug,
    prefix_match: body.block_prefix === null ? null : body.block_prefix === 'ONR',
  },
});

function home(credentials: Partial<Record<string, string>> = {}): string {
  const dir = tempDir('laika-pc-home-');
  for (const [harness, url] of Object.entries(credentials)) {
    mkdirSync(join(dir, '.laika', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.laika', 'agents', `${harness}.json`),
      JSON.stringify({ url, token: AGENT_TOKEN }),
    );
  }
  return dir;
}

async function run(
  argv: string[],
  options: {
    cwd: string;
    home?: string;
    env?: Record<string, string>;
    board?: Board;
    manifest?: Manifest;
  },
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const sent: Sent[] = [];
  const board = options.board ?? recording;
  const compat = options.manifest ?? manifest();
  const asked: string[] = [];
  const io: CheckIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    home: options.home ?? home(),
    cwd: options.cwd,
    env: options.env ?? {},
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/api/v1/developer/compatibility')) {
        // The gate's GET: nothing of this machine's in it.
        assert.equal(init?.body, undefined);
        assert.equal(new Headers(init?.headers).get('authorization'), null);
        asked.push(url);
        if (compat === 'down') return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve(
          new Response(JSON.stringify(compat.body), {
            status: compat.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      const raw = typeof init?.body === 'string' ? init.body : '{}';
      const body = JSON.parse(raw) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      sent.push({
        url,
        auth: headers.get('authorization'),
        body,
      });
      const answer = board(body);
      if (answer === 'down') return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    git: (dir, args) => {
      try {
        return execFileSync('git', ['-C', dir, ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return undefined;
      }
    },
  };
  const before = tree(options.cwd);
  const code = await projectCheck(argv, io);
  // **Never writes.** Not a byte, not a timestamp, not a new file.
  assert.deepEqual(tree(options.cwd), before, 'laika project check changed a file');
  const result = { code, out: out.join('\n'), err: err.join('\n'), sent, asked };
  // Nothing secret or private, on any run.
  const everything = `${result.out}\n${result.err}\n${JSON.stringify(sent.map((s) => s.body))}`;
  assert.doesNotMatch(everything, new RegExp(AGENT_TOKEN), 'the token was printed or sent');
  assert.doesNotMatch(everything, new RegExp(PERSONAL_TOKEN), 'the personal token appeared');
  assert.doesNotMatch(everything, new RegExp(PRIVATE), 'file content was printed or sent');
  assert.equal(everything.includes(options.cwd), false, 'a local path was printed or sent');
  assert.equal(everything.includes(tmpdir()), false, 'a local path was printed or sent');
  return result;
}

void describe('detectBlock: every shape a repository has', () => {
  void test('a marked block: revision, project and prefix', () => {
    assert.deepEqual(detectBlock(marked(2, 'onroute', 'ONR')), {
      found: true,
      kind: 'marked',
      revision: 2,
      project: 'onroute',
      prefix: 'ONR',
    });
  });

  void test('a marked block with no project in its begin marker', () => {
    const text = `<!-- laika:begin revision=3 -->\n## Laika\n\nThis project is tracked on a Laika board.\n${BLOCK_END}\n`;
    assert.deepEqual(detectBlock(text), {
      found: true,
      kind: 'marked',
      revision: 3,
      project: null,
      prefix: null,
    });
  });

  void test('the legacy block: `## Laika` and the marker, revision 1, with its prefix', () => {
    assert.deepEqual(detectBlock(legacy('ONR')), {
      found: true,
      kind: 'legacy',
      revision: 1,
      project: null,
      prefix: 'ONR',
    });
  });

  void test('a marker-only block with no heading, adapted by hand to "the" board', () => {
    const text = `Some intro.\n\nThis project is tracked on the Laika board at work.\n`;
    assert.deepEqual(detectBlock(text), {
      found: true,
      kind: 'legacy',
      revision: 1,
      project: null,
      prefix: null,
    });
  });

  void test('a legacy prefix is read only inside its own section', () => {
    const text = `## Laika\n\nThis project is tracked on a Laika board.\n\n## Other\n\nTask keys look like \`XYZ-42\`.\n`;
    const block = detectBlock(text);
    assert.equal(block.found && block.prefix, null);
  });

  void test('a begin marker with no end is not a marked block', () => {
    const text = `<!-- laika:begin revision=2 project=onroute -->\n## Laika\n\nThis project is tracked on a Laika board.\n`;
    const block = detectBlock(text);
    assert.equal(block.found && block.kind, 'legacy');
    assert.deepEqual(detectBlock('<!-- laika:begin revision=2 project=x -->\nnothing\n'), {
      found: false,
    });
  });

  void test('no block at all', () => {
    assert.deepEqual(detectBlock(`# Notes\n\n${PRIVATE}\n`), { found: false });
    assert.deepEqual(detectBlock(''), { found: false });
  });
});

void describe('normaliseRemote: one string per repository, never a path', () => {
  void test('https, with credentials and .git, and scp and ssh forms agree', () => {
    for (const raw of [
      'https://bob:secret@GitHub.com/Example/onroute-app.git',
      'git@github.com:Example/onroute-app.git',
      'ssh://git@github.com:22/Example/onroute-app',
      'https://github.com/Example/onroute-app/',
    ]) {
      assert.equal(normaliseRemote(raw), 'github.com/Example/onroute-app', raw);
    }
  });

  void test('a Windows path is local, never a host and a path (LAI-1073)', () => {
    for (const raw of [
      'C:\\Users\\bob\\repo',
      'C:/Users/bob/repo',
      'c:repo',
      '\\\\server\\share\\bob\\repo',
      'git@github.com:bob\\repo',
    ]) {
      assert.equal(normaliseRemote(raw), undefined, raw);
    }
    // A real two-letter-or-more host still is one.
    assert.equal(normaliseRemote('gh:Example/repo'), 'gh/Example/repo');
  });

  void test('a local or file remote is not a remote: undefined, so it is never sent', () => {
    assert.equal(normaliseRemote('/Users/bob/src/onroute'), undefined);
    assert.equal(normaliseRemote('file:///Users/bob/src/onroute'), undefined);
    assert.equal(normaliseRemote('../onroute'), undefined);
    assert.equal(normaliseRemote(''), undefined);
  });
});

void describe('cleanLabel: a name the board accepts, never a path (LAI-1073)', () => {
  void test('path characters become dashes; nothing usable is the neutral label', () => {
    assert.equal(cleanLabel('onroute-app'), 'onroute-app');
    assert.equal(cleanLabel('Projekt Müller (2)'), 'Projekt Müller (2)');
    assert.equal(cleanLabel('my repo/x'), 'my repo-x');
    assert.equal(cleanLabel('~bob'), 'bob');
    assert.equal(cleanLabel('C:\\Users\\bob'), 'C--Users-bob');
    assert.equal(cleanLabel('...'), NEUTRAL_LABEL);
    assert.equal(cleanLabel(''), NEUTRAL_LABEL);
    for (const raw of ['a/b', 'x:y', '\\\\s\\t', '~', 'tab\there', 'x'.repeat(200)]) {
      const label = cleanLabel(raw);
      assert.match(label, LABEL_PATTERN, raw);
      assert.ok(label.length <= 90, raw);
    }
  });

  void test('the CLI and the board accept the same labels', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../../server/src/http/routes/project-setups.ts', import.meta.url)),
      'utf8',
    );
    assert.ok(
      route.includes(`export const REPO_LABEL_PATTERN = ${String(LABEL_PATTERN)};`),
      'REPO_LABEL_PATTERN and LABEL_PATTERN differ',
    );
  });
});

void describe('laika project check', () => {
  void test('a current block, recorded with the tool’s own credential: exit 0, a summary only', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'claude-code'], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
      env: { LAIKA_TOKEN: PERSONAL_TOKEN },
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent.length, 1);
    const [sent] = r.sent;
    assert.equal(sent?.url, `${BOARD}/api/v1/project-setups`);
    // The tool's token, never the person's.
    assert.equal(sent?.auth, `Bearer ${AGENT_TOKEN}`);
    assert.deepEqual(sent?.body, {
      project_slug: 'onroute',
      repo_key: createHash('sha256').update('github.com/Example/onroute-app').digest('hex'),
      repo_label: 'onroute-app',
      instructions_path: 'CLAUDE.md',
      block_found: true,
      template_revision: 2,
      block_project: 'onroute',
      block_prefix: 'ONR',
    });
    assert.match(r.out, /✓ CLAUDE\.md — Laika block, revision 2, project onroute, keys ONR-…/);
    assert.match(r.out, /recorded on the board for "onroute"/);
  });

  void test('works from a subfolder of the repository', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR'), 'src/x.ts': '' });
    const r = await run(['--offline', '--dir', 'src'], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /CLAUDE\.md — Laika block, revision 2/);
  });

  void test('no credential: prints and records nothing, LAIKA_TOKEN or not', async () => {
    const dir = repo({ 'AGENTS.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], { cwd: dir, env: { LAIKA_TOKEN: PERSONAL_TOKEN } });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent.length, 0);
    assert.match(r.out, /no tool credential on this machine — nothing recorded/);
  });

  void test('--offline makes no request even with a credential', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--offline'], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    assert.equal(r.code, 0);
    assert.equal(r.sent.length, 0);
  });

  void test('no block: exit 1, and the record says none was found', async () => {
    const dir = repo({ 'CLAUDE.md': `# Notes\n\n${PRIVATE}\n` });
    const r = await run(['--project', 'onroute'], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no Laika block: paste the Project setup prompt/);
    assert.deepEqual(
      {
        found: r.sent[0]?.body.block_found,
        revision: r.sent[0]?.body.template_revision,
        path: r.sent[0]?.body.instructions_path,
      },
      { found: false, revision: null, path: 'CLAUDE.md' },
    );
  });

  void test('a revision-1 block: exit 1, update available', async () => {
    const dir = repo({ 'CLAUDE.md': legacy('ONR') });
    const r = await run(['--project', 'onroute'], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /revision 1; the current template is revision 2/);
    assert.equal(r.sent[0]?.body.template_revision, 1);
    assert.equal(r.sent[0]?.body.block_project, null);
  });

  void test('a block naming another project: exit 1, without asking the board', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'other', 'OTH') });
    const r = await run(['--project', 'onroute', '--offline'], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.out, /names project "other", not "onroute"/);
  });

  void test('a prefix the board says is not the project’s: exit 1', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'OLD') });
    const r = await run([], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /task-key prefix is not this project’s/);
  });

  void test('the board does not answer: exit 2, and the local finding still printed', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
      board: () => 'down',
      manifest: 'down',
    });
    assert.equal(r.code, 2);
    assert.match(r.out, /revision 2/);
    assert.match(r.out, /could not ask http:\/\/board\.test what it supports/);
    assert.equal(r.sent.length, 0);
  });

  void test('asks the board’s manifest before it records, as device pair and tool add do', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.asked, [`${BOARD}/api/v1/developer/compatibility`]);
    assert.equal(r.sent.length, 1);
  });

  void test('a board with project setups off: nothing sent, exit 2, told to update the board', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
      manifest: manifest({ project_setups: false }),
    });
    assert.equal(r.code, 2);
    assert.equal(r.sent.length, 0);
    assert.match(r.out, /this board doesn't support project setup records yet/);
  });

  void test('a board needing a newer CLI: nothing sent, exit 2, told to laika update', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
      manifest: manifest({ need: 3 }),
    });
    assert.equal(r.code, 2);
    assert.equal(r.sent.length, 0);
    assert.match(
      r.out,
      /needs protocol 3 for project setup records and this CLI speaks 2 — run: laika update/,
    );
  });

  void test('a board too old for the manifest is tried, and its 404 said', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
      manifest: {
        status: 404,
        body: { error: { code: 'not_found', message: 'x', details: null } },
      },
      board: () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'x', details: null } },
      }),
    });
    assert.equal(r.code, 2);
    assert.equal(r.sent.length, 1);
    assert.match(r.out, /has no project "onroute", or does not record project setups yet/);
  });

  void test('offline and credential-less runs never ask the manifest either', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const offline = await run(['--offline'], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    const bare = await run([], { cwd: dir });
    assert.deepEqual([offline.asked, bare.asked], [[], []]);
  });

  void test('a project outside the tool’s grants: exit 2, said in words', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD }),
      board: () => ({
        status: 403,
        body: {
          error: { code: 'forbidden', message: 'x', details: { reason: 'agent_not_granted' } },
        },
      }),
    });
    assert.equal(r.code, 2);
    assert.match(r.out, /this tool has no access to "onroute"/);
  });

  void test('several tools here and no --harness: records nothing, says why, exit 2 (LAI-1084)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD, codex: BOARD }),
    });
    // Not 0: a script or agent following the page must not read this as recorded.
    assert.equal(r.code, 2);
    assert.equal(r.sent.length, 0);
    assert.match(r.out, /several tools are set up here \(claude-code, codex\) — pass --harness/);
  });

  void test('several tools here, no --harness and no block: needs action still wins, exit 1', async () => {
    const dir = repo({ 'CLAUDE.md': '# Notes\n' });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD, codex: BOARD }),
    });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.sent.length, 0);
  });

  void test('--harness names a tool with no credential here while others have one: exit 2, add it first (LAI-1090)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'codex'], {
      cwd: dir,
      home: home({ 'claude-code': BOARD, cursor: BOARD }),
    });
    assert.equal(r.code, 2, r.out);
    assert.equal(r.sent.length, 0);
    assert.deepEqual(r.asked, []);
    assert.match(r.out, /no credential for codex on this machine — nothing recorded/);
    // Adding the tool picked comes first; the others are named after it, as a fact.
    const add = r.out.indexOf(
      'add codex first: on the board, Developer access → Tools → Add tool gives the laika tool add codex command to run here',
    );
    const others = r.out.indexOf('(other tools set up here: claude-code, cursor)');
    assert.ok(add !== -1 && others > add, r.out);
    // Never steered to record as a tool the reader did not pick.
    assert.doesNotMatch(r.out, /pass --harness|one of those/);
    // Names only: nothing from inside a credential file.
    assert.ok(!r.out.includes(AGENT_TOKEN), 'a token was printed');
    assert.ok(!r.out.includes(BOARD), 'a credential’s board URL was printed');
  });

  void test('--harness names a tool and no tool has a credential here: exit 2, add it first (LAI-1090)', async () => {
    // CHIEF: an explicit --harness is a request to record, so this could not record.
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'codex'], { cwd: dir });
    assert.equal(r.code, 2, r.out);
    assert.equal(r.sent.length, 0);
    assert.deepEqual(r.asked, []);
    assert.match(
      r.out,
      /no credential for codex on this machine — nothing recorded; add codex first: .* laika tool add codex command to run here$/m,
    );
    assert.doesNotMatch(r.out, /other tools set up here/);
  });

  void test('--harness with no credential and no block: needs action still wins, exit 1', async () => {
    const dir = repo({ 'CLAUDE.md': '# Notes\n' });
    const r = await run(['--harness', 'codex'], { cwd: dir });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.sent.length, 0);
  });

  void test('--harness with no credential, --json: the record failed and the exit is 2', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'codex', '--json'], { cwd: dir });
    assert.equal(r.code, 2, r.out);
    const json = JSON.parse(r.out) as { record: { kind: string }; exit: number };
    assert.equal(json.record.kind, 'failed');
    assert.equal(json.exit, 2);
  });

  void test('--harness for a tool laika tool add refuses: never told to run it', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'antigravity'], { cwd: dir });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /laika tool add cannot set up antigravity/);
    assert.doesNotMatch(r.out, /laika tool add antigravity/);
  });

  void test('a refused tool is told what would record for it, word for word as the README (LAI-1091)', async () => {
    // "so this check cannot record for it" was not true: readCredential takes
    // the tool's own file, or LAIKA_AGENT_TOKEN with LAIKA_AGENT_URL.
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'antigravity'], { cwd: dir });
    assert.equal(r.code, 2, r.out);
    assert.doesNotMatch(r.out, /cannot record for it/);
    const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
    const at = readme.indexOf('For a tool `laika tool add` refuses');
    assert.ok(at !== -1, 'the README no longer documents the refused-tool wording');
    const quoted = /```\n(.+)\n```/.exec(readme.slice(at))?.[1];
    assert.ok(quoted?.startsWith('no credential for antigravity'), String(quoted));
    assert.ok(
      r.out.split('\n').includes(`  · ${quoted ?? ''}`),
      `the CLI printed:\n${r.out}\nthe README quotes:\n${quoted ?? ''}`,
    );
  });

  void test('what the refused-tool words say is true: LAIKA_AGENT_TOKEN with LAIKA_AGENT_URL records (LAI-1091)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'antigravity'], {
      cwd: dir,
      env: { LAIKA_AGENT_TOKEN: AGENT_TOKEN, LAIKA_AGENT_URL: BOARD },
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0]?.auth, `Bearer ${AGENT_TOKEN}`);
  });

  void test('--harness with no credential and no project named: exit 2, whatever the order (LAI-1091)', async () => {
    // The "no project named" check ran first and made this a 0.
    const dir = repo({ 'CLAUDE.md': unnamed });
    for (const home_ of [home(), home({ 'claude-code': BOARD })]) {
      const r = await run(['--harness', 'codex'], { cwd: dir, home: home_ });
      assert.equal(r.code, 2, r.out);
      assert.equal(r.sent.length, 0);
      assert.match(r.out, /no credential for codex on this machine — nothing recorded/);
    }
  });

  void test('several tools here, no --harness and no project named: exit 2 (LAI-1091)', async () => {
    const dir = repo({ 'CLAUDE.md': unnamed });
    const r = await run([], { cwd: dir, home: home({ 'claude-code': BOARD, codex: BOARD }) });
    assert.equal(r.code, 2, r.out);
    assert.equal(r.sent.length, 0);
    assert.match(r.out, /several tools are set up here \(claude-code, codex\) — pass --harness/);
  });

  void test('--harness with its credential but no project named: the record was asked for, exit 2 (LAI-1091)', async () => {
    const dir = repo({ 'CLAUDE.md': unnamed });
    const r = await run(['--harness', 'codex'], { cwd: dir, home: home({ codex: BOARD }) });
    assert.equal(r.code, 2, r.out);
    assert.equal(r.sent.length, 0);
    assert.match(r.out, /no project named — pass --project <slug> to record this check/);
  });

  void test('no --harness and no project named: prints only, exit 0, credential or not (LAI-1091)', async () => {
    const dir = repo({ 'CLAUDE.md': unnamed });
    for (const home_ of [home(), home({ codex: BOARD })]) {
      const r = await run([], { cwd: dir, home: home_ });
      assert.equal(r.code, 0, r.out);
      assert.equal(r.sent.length, 0);
    }
  });

  void test('--harness with no credential: --offline is 0, a block that needs action is 1 (LAI-1091)', async () => {
    const current = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    assert.equal((await run(['--harness', 'codex', '--offline'], { cwd: current })).code, 0);
    const old = repo({ 'CLAUDE.md': legacy('ONR') });
    assert.equal((await run(['--harness', 'codex'], { cwd: old })).code, 1);
    assert.equal((await run(['--harness', 'codex', '--offline'], { cwd: old })).code, 1);
  });

  void test('a wrong prefix is seen only in the board’s reply: 1 once recorded, else 0 or 2 (review B1)', async () => {
    // The exit statement once said a wrong prefix was 1 "whatever else is
    // true, --offline included"; only the board can tell this CLI the prefix.
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'OLD') });
    const one = home({ 'claude-code': BOARD });
    const recorded = await run([], { cwd: dir, home: one });
    assert.equal(recorded.code, 1, recorded.out);
    assert.match(recorded.out, /the board says the block’s task-key prefix is not this project’s/);
    assert.equal((await run(['--offline'], { cwd: dir, home: one })).code, 0);
    assert.equal((await run([], { cwd: dir })).code, 0);
    assert.equal((await run([], { cwd: dir, home: one, board: () => 'down' })).code, 2);
    const several = home({ 'claude-code': BOARD, codex: BOARD });
    assert.equal((await run([], { cwd: dir, home: several })).code, 2);
    assert.equal((await run(['--harness', 'codex'], { cwd: dir })).code, 2);
  });

  void test('LAIKA_AGENT_TOKEN with LAIKA_AGENT_URL wins over several tools: it records, exit 0 (review N2)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': BOARD, codex: BOARD }),
      env: { LAIKA_AGENT_TOKEN: ENV_TOKEN, LAIKA_AGENT_URL: BOARD },
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0]?.auth, `Bearer ${ENV_TOKEN}`);
    assert.ok(!r.out.includes(ENV_TOKEN), 'the token was printed');
  });

  void test('LAIKA_AGENT_TOKEN alone takes its board from the tool’s own file, as the README says (review N3)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'codex'], {
      cwd: dir,
      home: home({ codex: BOARD }),
      env: { LAIKA_AGENT_TOKEN: ENV_TOKEN },
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent[0]?.url, `${BOARD}/api/v1/project-setups`);
    assert.equal(r.sent[0]?.auth, `Bearer ${ENV_TOKEN}`);
    const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
      .replace(/`/g, '')
      .replace(/\s+/g, ' ');
    assert.ok(
      readme.includes(
        "That is all a credential can be here: the tool's own file (~/.laika/agents/<tool>.json); or LAIKA_AGENT_TOKEN, with its board from LAIKA_AGENT_URL or, when that is not set, from the tool's own file.",
      ),
      'the README no longer lists every credential readCredential takes',
    );
  });

  void test('several tools here and --harness names one: recorded, exit 0', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run(['--harness', 'codex'], {
      cwd: dir,
      home: home({ 'claude-code': BOARD, codex: BOARD }),
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0]?.url, `${BOARD}/api/v1/project-setups`);
  });

  void test('a credential URL carrying a secret is never fetched', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') });
    const r = await run([], {
      cwd: dir,
      home: home({ 'claude-code': 'http://bob:pw@board.test' }),
    });
    assert.equal(r.code, 2);
    assert.equal(r.sent.length, 0);
    assert.doesNotMatch(r.out, /pw@/);
  });

  void test('no remote: the key is the label’s hash, and --label names it', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') }, null);
    const r = await run(['--label', 'My repo'], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent[0]?.body.repo_label, 'My repo');
    assert.equal(
      r.sent[0]?.body.repo_key,
      createHash('sha256').update('label:My repo').digest('hex'),
    );
  });

  void test('a Windows-path remote is local: the folder’s name, no path, sent (LAI-1073)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') }, 'C:\\Users\\bob\\onroute');
    const r = await run([], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    assert.equal(r.code, 0, r.out);
    const label = String(r.sent[0]?.body.repo_label);
    assert.doesNotMatch(label, /Users|bob|\\|\//);
    assert.match(label, LABEL_PATTERN);
    assert.equal(
      r.sent[0]?.body.repo_key,
      createHash('sha256').update(`label:${label}`).digest('hex'),
    );
  });

  void test('a repository at the home directory gets the neutral label, never the username (LAI-1073)', async () => {
    const dir = repo({ 'CLAUDE.md': marked(2, 'onroute', 'ONR') }, null);
    mkdirSync(join(dir, '.laika', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.laika', 'agents', 'claude-code.json'),
      JSON.stringify({ url: BOARD, token: AGENT_TOKEN }),
    );
    const r = await run([], { cwd: dir, home: dir });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent[0]?.body.repo_label, NEUTRAL_LABEL);
    assert.equal(r.out.includes(basename(dir)), false, 'the home folder’s name was printed');
  });

  void test('--label must be a name, not a path', async () => {
    const dir = repo({});
    for (const label of ['~/src/x', 'a/b', 'C:\\x']) {
      const r = await run(['--label', label], { cwd: dir });
      assert.equal(r.code, 64, label);
    }
  });

  void test('a symlinked instructions file is read, and neither it nor its target changes', async () => {
    const elsewhere = tempDir('laika-pc-target-');
    writeFileSync(join(elsewhere, 'shared.md'), marked(2, 'onroute', 'ONR'));
    const dir = repo({});
    symlinkSync(join(elsewhere, 'shared.md'), join(dir, 'CLAUDE.md'));
    const link = lstatSync(join(dir, 'CLAUDE.md'));
    const target = tree(elsewhere);

    const r = await run([], { cwd: dir, home: home({ 'claude-code': BOARD }) });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sent[0]?.body.template_revision, 2);
    assert.equal(r.sent[0]?.body.instructions_path, 'CLAUDE.md');
    // The link is still a link, untouched, and the file it points at is too.
    const after = lstatSync(join(dir, 'CLAUDE.md'));
    assert.ok(after.isSymbolicLink());
    assert.equal(after.mtimeMs, link.mtimeMs);
    assert.deepEqual(tree(elsewhere), target);
  });

  void test('the tool’s own file wins over another file’s block', async () => {
    const dir = repo({
      'AGENTS.md': marked(1, 'onroute', 'ONR'),
      '.cursor/rules/laika.mdc': `---\nalwaysApply: true\n---\n\n${marked(2, 'onroute', 'ONR')}`,
    });
    const r = await run(['--harness', 'cursor', '--offline'], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    const json = await run(['--harness', 'cursor', '--offline', '--json'], { cwd: dir });
    const parsed = JSON.parse(json.out) as {
      instructions_path: string;
      block: { revision: number };
    };
    assert.equal(parsed.instructions_path, '.cursor/rules/laika.mdc');
    assert.equal(parsed.block.revision, 2);
  });

  void test('usage errors are 64, never a finding; --help is 0', async () => {
    const dir = repo({});
    for (const argv of [
      ['--harness', 'emacs'],
      ['--bogus'],
      ['--project'],
      ['--label', 'x'.repeat(91)],
      ['--dir', 'missing'],
    ]) {
      const r = await run(argv, { cwd: dir });
      assert.equal(r.code, 64, argv.join(' '));
    }
    const help = await run(['--help'], { cwd: dir });
    assert.equal(help.code, 0);
    assert.match(help.out, /Exit: 0 current, 1 needs action, 2 could not record, 64 usage/);
  });
});

void describe('drift: the CLI reads the block the web writes', () => {
  const copy = readFileSync(
    fileURLToPath(
      new URL('../../server/web/src/routes/screens/connect/connect-copy.ts', import.meta.url),
    ),
    'utf8',
  );
  const agents = readFileSync(
    fileURLToPath(
      new URL('../../server/web/src/routes/screens/connect/connect-agents.ts', import.meta.url),
    ),
    'utf8',
  );

  void test('the same template revision, end marker and begin-marker shape', () => {
    assert.match(
      copy,
      new RegExp(`export const PROJECT_BLOCK_REVISION = ${String(PROJECT_BLOCK_REVISION)};`),
    );
    assert.ok(copy.includes(`export const BLOCK_END = '${BLOCK_END}';`));
    assert.ok(
      copy.includes('return `<!-- laika:begin revision=${String(revision)} project=${slug} -->`;'),
    );
    assert.ok(
      copy.includes("export const BLOCK_MARKER = 'This project is tracked on a Laika board.';"),
    );
  });

  void test('every instructions file the CLI reads for a tool is one the web writes', () => {
    for (const [harness, path] of Object.entries(INSTRUCTIONS_FILE)) {
      assert.ok(agents.includes(`'${path}'`), `${harness}: ${path} is not in instructionsTarget`);
    }
  });
});

void describe('the exit codes, said the same in the comment, the usage and the README (LAI-1091)', () => {
  /** Prose with its comment stars, list dashes, backticks and line breaks taken out. */
  const plain = (text: string) =>
    text
      .replace(/^[ \t]*\* ?/gm, '')
      .replace(/^[ \t]*- /gm, '')
      .replace(/`/g, '')
      .replace(/’/g, "'")
      .replace(/\s+/g, ' ');
  /** The text from `from` to the next `to`, both required. */
  const section = (text: string, from: string, to: string) => {
    const a = text.indexOf(from);
    const b = text.indexOf(to, a + from.length);
    assert.ok(a !== -1 && b !== -1, `${from} … ${to} not found`);
    return plain(text.slice(a, b));
  };
  const source = readFileSync(
    fileURLToPath(new URL('../src/project-check.ts', import.meta.url)),
    'utf8',
  );
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  const places = {
    comment: section(source, '## Exit codes', '*/'),
    // The usage ends with them: from "Exit:" to its last line.
    usage: plain(USAGE.slice(Math.max(0, USAGE.indexOf('Exit:')))),
    readme: section(readme, 'Exit codes (LAI-1091', '\n## '),
  };
  assert.ok(USAGE.includes('Exit:'), 'the usage text no longer has its exit codes');

  // Each is behaviour the tests above pin: 64 in "usage errors are 64"; 1 in
  // the needs-action cases, and a wrong prefix only from the board in "a
  // wrong prefix is seen only in the board's reply"; 2 and 0 in the
  // --harness, several and no-project cases; the environment in "LAIKA_AGENT_
  // TOKEN with LAIKA_AGENT_URL wins over several tools".
  const ANCHOR = 'first that applies:';
  const statement = [
    ANCHOR,
    '64 the command line was wrong.',
    '1 the block needs action: missing, an older revision, or naming a project other than --project. These give 1 whatever else is true, --offline included. A wrong task-key prefix gives 1 only once the board has recorded the check and says so, as does a project the board says is wrong.',
    "2 nothing this run can see needs action, but the record was not made: --harness names a tool with no credential here, or names one but no project is named; several tools are set up here and no --harness picks one; the credential's board URL is not a plain address; or the board did not answer, refused, or is too old to take it.",
    '0 nothing this run can see needs action, and the check was recorded or only printed: --offline; or no --harness, and no credential here or no project named.',
    'So: a current block, no credential and no --harness prints and exits 0; a missing or old block exits 1 whatever else is true; --harness X with no credential for X exits 2, unless --offline (0) or the block needs action (1).',
    'LAIKA_AGENT_TOKEN with LAIKA_AGENT_URL in the environment is a credential for whichever tool is asked for, and it wins over the several-tools rule: the check records with it.',
    'Whether a record can be made is decided before whether a project is named, so the order of the checks never turns a 2 into a 0.',
  ].join(' ');

  for (const [where, text] of Object.entries(places)) {
    // The whole statement, not each clause found somewhere in it: a clause
    // added in one place, contradicting the others, fails too (review N6).
    void test(`${where} gives the whole statement and nothing else`, () => {
      const at = text.indexOf(ANCHOR);
      assert.ok(at !== -1, `${where} has no "${ANCHOR}"`);
      assert.equal(text.slice(at).trim(), statement, where);
    });
  }

  void test('and none still says the broad version it replaced', () => {
    for (const text of [source, USAGE, readme]) {
      assert.doesNotMatch(
        text,
        /With --harness and no\s+credential for that tool, it records nothing and exits 2/,
      );
      assert.doesNotMatch(text, /whether or not another tool has one\),/);
    }
  });
});
