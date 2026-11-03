/**
 * `laika agent launcher watch` (LAI-1113): it finds a run's Claude Code
 * transcript where Claude Code writes it, prints only the assistant's text and
 * tool calls — made safe and capped — follows the audit log and the
 * transcript as they grow, and is read-only: it writes nothing and closing it
 * reaches no run.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import { auditPath, launcherDir, runDir } from '../src/agent-launcher.ts';
import {
  type AuditLine,
  findTranscript,
  Follow,
  oneLine,
  parseAudit,
  renderAudit,
  renderTranscript,
  textLines,
  toolSummary,
  transcriptDir,
  watchCommand,
} from '../src/agent-launcher-watch.ts';
import { claudeProjectDir } from '../src/agent-launcher-visible.ts';

const RUN = '01M6H3V14WKG0HKSF5Y8SY6CSR';
const OTHER = '01M6H3V14WKG0HKSF5Y8SY6CSS';
const SAMPLE = fileURLToPath(new URL('./support/claude-transcript-sample.jsonl', import.meta.url));

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'laika-1113-watch-')));
  temps.push(dir);
  return dir;
}

const assistant = (block: Record<string, unknown>, side = false): string =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: side,
    message: { role: 'assistant', content: [block] },
  });

void describe('the transcript folder', () => {
  void test('every character but a letter or digit is -, as Claude Code names it (measured on Belka)', () => {
    const cases: [string, string][] = [
      [
        '/Users/p/Documents/GitHub/KvellDynamics/Laika-LAIKA-968-auto-sy6csr',
        '-Users-p-Documents-GitHub-KvellDynamics-Laika-LAIKA-968-auto-sy6csr',
      ],
      ['/Users/p/Laika/.polly/wt-1001', '-Users-p-Laika--polly-wt-1001'],
      ['/private/tmp/claude-501/-Users-p-x', '-private-tmp-claude-501--Users-p-x'],
      ['/home/a b/Laika_x', '-home-a-b-Laika-x'],
    ];
    for (const [worktree, name] of cases) {
      assert.equal(claudeProjectDir('/h', worktree), join('/h', '.claude', 'projects', name));
    }
  });

  void test('the start’s transcript_dir, else its worktree, else the run’s workspace.json; nothing outside ~/.claude/projects', () => {
    const home = scratch();
    const base: AuditLine = { at: 0, event: 'start', offer_id: RUN, harness: 'claude-code' };
    const dir = claudeProjectDir(home, '/w/one');
    assert.equal(transcriptDir(home, { ...base, transcript_dir: dir }), dir);
    assert.equal(
      transcriptDir(home, { ...base, worktree: '/w/two' }),
      claudeProjectDir(home, '/w/two'),
    );
    assert.equal(transcriptDir(home, base), undefined, 'nothing recorded: nothing guessed');
    mkdirSync(runDir(home, RUN), { recursive: true });
    writeFileSync(
      join(runDir(home, RUN), 'workspace.json'),
      JSON.stringify({ worktree: '/w/three' }),
    );
    assert.equal(transcriptDir(home, base), claudeProjectDir(home, '/w/three'));
    // A recorded folder that is not one of Claude Code's is not read.
    for (const elsewhere of [
      '/etc',
      join(home, '.claude', 'projects'),
      join(home, '.claude', 'projects', 'a', 'b'),
      join(home, '.claude', 'projects', '..', 'x'),
    ]) {
      assert.equal(
        transcriptDir(home, { ...base, transcript_dir: elsewhere, worktree: '/w/four' }),
        claudeProjectDir(home, '/w/four'),
        elsewhere,
      );
    }
    assert.equal(transcriptDir(home, { ...base, harness: 'omnigent', worktree: '/w' }), undefined);
  });

  void test('the transcript is the .jsonl written to last since the run started', () => {
    const dir = scratch();
    const start = Date.now();
    const at = (name: string, ms: number): void => {
      writeFileSync(join(dir, name), '{}\n');
      utimesSync(join(dir, name), new Date(ms), new Date(ms));
    };
    at('old.jsonl', start - 60_000);
    assert.equal(findTranscript(dir, start), undefined, 'one from before the run is not its');
    at('a.jsonl', start + 1000);
    at('b.jsonl', start + 2000);
    at('c.txt', start + 3000);
    assert.equal(findTranscript(dir, start), join(dir, 'b.jsonl'));
    assert.equal(findTranscript(join(dir, 'missing'), start), undefined);
  });
});

void describe('rendering a transcript', () => {
  void test('the real-format sample: text and tool calls only, in order', () => {
    const lines = readFileSync(SAMPLE, 'utf8')
      .split('\n')
      .filter((l) => l !== '');
    const out = lines.flatMap(renderTranscript);
    assert.deepEqual(out, [
      '🔧 ToolSearch  select:mcp__laika__get_task_context',
      '🔧 mcp__laika__get_task_context  LAIKA-970',
      '🔧 Bash  pnpm --filter laika test \\ && git status --short',
      '🔧 mcp__laika__start_working  branch=LAIKA-970-auto-abc123 session_id=01M6H3VH871VCK5Z6RGB4RQ4QS',
      '    ↳ 💬 Explored the repo.',
      '💬 LAIKA-970 is in **Review**.',
      '   ',
      '   - Claimed on branch `LAIKA-970-auto-abc123`.',
      '   - Tests: exit 0. evil[31m red',
    ]);
    const text = out.join('\n');
    for (const never of [
      'THINKING_SENTINEL',
      'TOOL_RESULT_SENTINEL',
      'SessionStart',
      'stop_hook',
    ]) {
      assert.ok(!text.includes(never), never);
    }
  });

  void test('control and bidi characters are stripped, lines capped, a tool input is one line', () => {
    assert.equal(oneLine('a\u202Eb\u2066c\u200Bd\u0007e\u001bf', 80), 'abcdef');
    assert.equal(oneLine('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
    const long = textLines(Array.from({ length: 60 }, (_, i) => `line ${String(i)}`).join('\n'));
    assert.equal(long.length, 41);
    assert.equal(long.at(-1), '… (20 more lines)');
    assert.equal(
      textLines('a\u2028b').length,
      2,
      'a line separator is a line break, not a character',
    );
    assert.equal(
      toolSummary({ command: 'rm -rf build\n\n&& echo done' }),
      'rm -rf build && echo done',
    );
    assert.equal(toolSummary({ file_path: '/x/y.ts', content: 'z'.repeat(5000) }), '/x/y.ts');
    assert.equal(
      toolSummary({ a: 1, b: true, c: { deep: 1 }, d: 'x', e: 'never' }),
      'a=1 b=true d=x',
    );
    assert.ok(toolSummary({ command: 'y'.repeat(500) }).length <= 120);
    assert.deepEqual(
      renderTranscript(assistant({ type: 'tool_use', name: 'Evil\u202Ename\nsecond', input: {} })),
      ['🔧 Evilname second'],
    );
    for (const junk of [
      'not json',
      '[]',
      '{"type":"assistant"}',
      '{"type":"user","message":{"content":"x"}}',
    ]) {
      assert.deepEqual(renderTranscript(junk), [], junk);
    }
  });
});

void describe('the audit log', () => {
  void test('each event as one line, every field checked first', () => {
    const at = '2026-11-03T16:28:35.637Z';
    const start = parseAudit(
      JSON.stringify({
        at,
        event: 'start',
        offer_id: RUN,
        task_key: 'LAIKA-968',
        harness: 'claude-code',
      }),
    );
    assert.match(
      renderAudit(start!) ?? '',
      /^\d\d:\d\d:\d\d ▶ started LAIKA-968 \(Claude Code\) · run 01M6H3V14WKG0HKSF5Y8SY6CSR$/,
    );
    const exit = parseAudit(
      JSON.stringify({
        at,
        event: 'exit',
        offer_id: RUN,
        task_key: 'LAIKA-968',
        harness: 'claude-code',
        code: 0,
        signal: null,
        runtime_ms: 50_632,
        reason: 'exited',
        subtype: 'success',
        num_turns: 7,
        total_cost_usd: 0.6299,
      }),
    );
    assert.match(
      renderAudit(exit!) ?? '',
      /■ LAIKA-968 finished → exit 0, 51 s \(success, 7 turns, \$0\.63\)/,
    );
    const refused = parseAudit(
      JSON.stringify({
        at,
        event: 'refused',
        reason: 'not_addressed_to_an_agent',
        task_key: 'LAIKA-875',
      }),
    );
    assert.match(renderAudit(refused!) ?? '', /✖ refused LAIKA-875: not_addressed_to_an_agent$/);
    const hostile = parseAudit(
      JSON.stringify({
        at,
        event: 'refused',
        reason: 'bad reason\u202E',
        task_key: 'LAIKA-1\nx',
        harness: 'evil',
        offer_id: 'nope',
        worktree: 'relative',
        transcript_dir: '/x\u0007',
      }),
    );
    assert.deepEqual(hostile, { at: Date.parse(at), event: 'refused' });
    assert.equal(renderAudit(parseAudit(JSON.stringify({ at, event: 'deferred' }))!), undefined);
    assert.equal(parseAudit('not json'), undefined);
    assert.equal(parseAudit(JSON.stringify({ event: 'start' })), undefined, 'no time, no line');
  });

  void test('a growing file is read by whole lines, a split character kept whole, a replaced file read again', () => {
    const file = join(scratch(), 'grow.jsonl');
    writeFileSync(file, '');
    const f = new Follow(file, 'start');
    const euro = Buffer.from('€');
    appendFileSync(file, Buffer.concat([Buffer.from('one\ntw'), euro.subarray(0, 1)]));
    assert.deepEqual(f.lines(), ['one']);
    appendFileSync(file, Buffer.concat([euro.subarray(1), Buffer.from('o\n')]));
    assert.deepEqual(f.lines(), ['tw€o']);
    writeFileSync(file, 'new\n');
    assert.deepEqual(f.lines(), ['new'], 'shorter than what was read: read again from the start');
    const mid = new Follow(file, 2);
    appendFileSync(file, 'next\n');
    assert.deepEqual(mid.lines(), ['next'], 'started mid-line: that part is dropped');
    assert.deepEqual(new Follow(join(file, 'missing'), 'start').lines(), []);
  });
});

/* -------------------------------------------------------------------------- */

interface Home {
  readonly home: string;
  readonly worktree: string;
  readonly dir: string;
}

function launcherHome(): Home {
  const home = scratch();
  const worktree = join(home, 'Laika-LAIKA-970-auto-abc123');
  mkdirSync(worktree);
  mkdirSync(launcherDir(home), { recursive: true });
  const dir = claudeProjectDir(home, worktree);
  mkdirSync(dir, { recursive: true });
  return { home, worktree, dir };
}

const iso = (ms: number): string => new Date(ms).toISOString();

function auditStart(h: Home, at: number, harness = 'claude-code', offer = RUN): void {
  appendFileSync(
    auditPath(h.home),
    `${JSON.stringify({ at: iso(at), event: 'start', offer_id: offer, task_key: 'LAIKA-970', harness, worktree: h.worktree, ...(harness === 'claude-code' ? { transcript_dir: h.dir } : {}) })}\n`,
  );
}

function auditExit(h: Home, at: number, offer = RUN): void {
  appendFileSync(
    auditPath(h.home),
    `${JSON.stringify({ at: iso(at), event: 'exit', offer_id: offer, task_key: 'LAIKA-970', harness: 'claude-code', code: 0, signal: null, runtime_ms: 18_000, reason: 'exited' })}\n`,
  );
}

/** Every file under `dir` with its size and mtime: what a read-only command must leave as it was. */
function tree(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const st = statSync(join(dir, name));
    out.push(`${name} ${String(st.size)} ${String(st.mtimeMs)} ${(st.mode & 0o777).toString(8)}`);
  }
  return out.sort();
}

void describe('watch', () => {
  void test('--run on a finished run: its start, its transcript, its end, and nothing written', async () => {
    const h = launcherHome();
    const t = Date.now() - 60_000;
    auditStart(h, t);
    writeFileSync(join(h.dir, '794d9c6f-376f-473b-99c7-104c5b3bc29c.jsonl'), readFileSync(SAMPLE));
    auditExit(h, t + 18_000);
    appendFileSync(
      auditPath(h.home),
      `${JSON.stringify({ at: iso(t), event: 'start', offer_id: OTHER, task_key: 'LAIKA-1', harness: 'codex' })}\n`,
    );
    const before = tree(h.home);
    const out: string[] = [];
    const io = {
      out: (l: string) => out.push(l),
      err: (l: string) => out.push(l),
      home: h.home,
      env: {},
      stopped: () => true,
    };
    assert.equal(await watchCommand(io, ['--run', RUN]), 0, out.join('\n'));
    const text = out.join('\n');
    const at = (s: string): number => {
      const i = text.indexOf(s);
      assert.notEqual(i, -1, `${s} in\n${text}`);
      return i;
    };
    assert.ok(
      at('▶ started LAIKA-970 (Claude Code)') < at('🔧 mcp__laika__get_task_context  LAIKA-970'),
    );
    assert.ok(at('💬 LAIKA-970 is in **Review**.') < at('■ LAIKA-970 finished → exit 0, 18 s'));
    assert.ok(text.endsWith('The run has ended.'));
    assert.ok(!text.includes('LAIKA-1 '), 'only the chosen run');
    assert.deepEqual(tree(h.home), before, 'read-only');
  });

  void test('live: the transcript as it is written, then the end, then it stops by itself', async () => {
    const h = launcherHome();
    const t = Date.now();
    auditStart(h, t);
    const file = join(h.dir, 'live.jsonl');
    const steps = [
      () =>
        writeFileSync(
          file,
          `${assistant({ type: 'text', text: 'first' })}\n${assistant({ type: 'tool_use', name: 'Read', input: { file_path: '/a' } }).slice(0, 30)}`,
        ),
      () =>
        appendFileSync(
          file,
          `${assistant({ type: 'tool_use', name: 'Read', input: { file_path: '/a' } }).slice(30)}\n`,
        ),
      () => appendFileSync(file, `${assistant({ type: 'text', text: 'last' })}\n`),
      () => auditExit(h, t + 18_000),
    ];
    const out: string[] = [];
    let ticks = 0;
    const code = await watchCommand(
      {
        out: (l) => out.push(l),
        err: (l) => out.push(l),
        home: h.home,
        env: {},
        sleep: () => {
          steps[ticks]?.();
          ticks += 1;
          return Promise.resolve();
        },
        stopped: () => ticks > 20,
      },
      ['--run', RUN],
    );
    assert.equal(code, 0);
    assert.ok(ticks <= steps.length, `it stopped when the run ended, after ${String(ticks)} ticks`);
    const text = out.join('\n');
    assert.match(
      text,
      /\(waiting for its transcript in .*\)\n {3}transcript: .*live\.jsonl\n💬 first\n🔧 Read {2}\/a\n💬 last\n.*■ LAIKA-970 finished → exit 0, 18 s/,
    );
    assert.ok(text.endsWith('The run has ended. This window can be closed.'));
  });

  void test('with no --run: the recent events and the run still going, until stopped', async () => {
    const h = launcherHome();
    const t = Date.now() - 5000;
    auditExit(h, t - 100_000, OTHER);
    auditStart(h, t);
    writeFileSync(join(h.dir, 's.jsonl'), `${assistant({ type: 'text', text: 'working' })}\n`);
    const out: string[] = [];
    const io = {
      out: (l: string) => out.push(l),
      err: (l: string) => out.push(l),
      home: h.home,
      env: {},
    };
    assert.equal(await watchCommand({ ...io, stopped: () => true }, ['--once']), 0);
    const text = out.join('\n');
    assert.match(text, /■ LAIKA-970 finished[\s\S]*▶ started LAIKA-970[\s\S]*💬 working/);
  });

  void test('an Omnigent run shows the launcher’s events and says where its transcript is', async () => {
    const h = launcherHome();
    auditStart(h, Date.now(), 'omnigent');
    const out: string[] = [];
    const io = {
      out: (l: string) => out.push(l),
      err: (l: string) => out.push(l),
      home: h.home,
      env: {},
      stopped: () => true,
    };
    assert.equal(await watchCommand(io, ['--run', RUN, '--once']), 0);
    assert.match(
      out.join('\n'),
      /▶ started LAIKA-970 \(Omnigent\)[^\n]*\n.*transcript lives in Omnigent/,
    );
  });

  void test('a bad --run is refused; a run not in the log is said so', async () => {
    const h = launcherHome();
    const out: string[] = [];
    const io = {
      out: (l: string) => out.push(l),
      err: (l: string) => out.push(l),
      home: h.home,
      env: {},
      stopped: () => true,
    };
    assert.equal(await watchCommand(io, ['--run', 'x; rm -rf ~']), 2);
    assert.equal(await watchCommand(io, ['--bogus']), 2);
    assert.equal(await watchCommand(io, ['--run', RUN, '--once']), 1);
    assert.match(
      out.join('\n'),
      /Run 01M6H3V14WKG0HKSF5Y8SY6CSR is not in the launcher’s audit log yet/,
    );
  });

  void test('closing it — a hang-up to its whole process group, as closing a Terminal window does — leaves the run alone', async () => {
    const h = launcherHome();
    // The run: detached into its own process group, as the launcher spawns it.
    const run = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true,
      stdio: 'ignore',
    });
    auditStart(h, Date.now());
    const entry = fileURLToPath(new URL('../src/agent-main.ts', import.meta.url));
    // The viewer: in a process group of its own, as a Terminal window's shell is.
    const viewer = spawn(process.execPath, [entry, 'launcher', 'watch', '--run', RUN], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: h.home },
    });
    let seen = '';
    viewer.stdout.on('data', (c: Buffer) => (seen += c.toString()));
    const end = Date.now() + 15_000;
    while (!seen.includes('started LAIKA-970')) {
      if (Date.now() > end) throw new Error(`the viewer never started:\n${seen}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const closed = new Promise((r) => viewer.on('exit', r));
    process.kill(-viewer.pid!, 'SIGHUP');
    await closed;
    try {
      assert.doesNotThrow(() => process.kill(run.pid!, 0), 'the run is still alive');
    } finally {
      process.kill(-run.pid!, 'SIGKILL');
    }
  });
});
