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
} from '../src/project-check.ts';

const AGENT_TOKEN = 'lai_AGENTPLANTEDSECRET0123456789abcdef';
const PERSONAL_TOKEN = 'lai_PERSONALPLANTEDSECRET0123456789';
/** A sentence in every fixture file that must never be printed or sent. */
const PRIVATE = 'PRIVATE-NOTE-do-not-leak-7f3a';
const BOARD = 'http://board.test';

const marked = (revision: number, slug: string, prefix: string) =>
  `# Notes\n\n${PRIVATE}\n\n<!-- laika:begin revision=${String(revision)} project=${slug} -->\n## Laika\n\nThis project is tracked on a Laika board. Mirror work onto it.\n\nTask keys look like \`${prefix}-42\`.\n${BLOCK_END}\n\n## After\n\nmore\n`;

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
