import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * LAI-026. `pnpm format:fix` used to run Prettier with `--write` over the whole
 * repo, so from any worktree it rewrote files in every area — it reformatted
 * SHELL's `plugin/.claude-plugin/plugin.json` from CORE's worktree.
 *
 * These tests run the **real command**, read out of the root `package.json`, in a
 * throwaway git repo. Reading it rather than restating it is the point: a test
 * with its own copy of the pipeline would keep passing after someone edited the
 * script.
 */

const REPO_ROOT = resolve(SERVER_ROOT, '..');
const PRETTIER_BIN_DIR = join(REPO_ROOT, 'node_modules', '.bin');

function formatFixCommand(): string {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const command = pkg.scripts['format:fix'];
  if (command === undefined) throw new Error('root package.json has no format:fix script');
  return command;
}

let repo: string;

function write(relativePath: string, contents: string): void {
  const full = join(repo, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

function read(relativePath: string): string {
  return readFileSync(join(repo, relativePath), 'utf8');
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

/** Run the real `format:fix` pipeline in the temp repo. */
function runFormatFix(): string {
  return execFileSync('sh', ['-c', formatFixCommand()], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${PRETTIER_BIN_DIR}:${process.env.PATH ?? ''}` },
  });
}

/** Prettier would reformat this: two-space indent, single quotes, semicolon. */
const UNFORMATTED_TS = 'export const a   =    {b:1,c:2}\n';
const UNFORMATTED_JSON = '{\n  "keywords": [\n    "a",\n    "b"\n  ]\n}\n';

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'laika-fmt-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'Test');
  write('.gitignore', 'node_modules/\ndist/\n');
  write('.prettierrc', readFileSync(join(REPO_ROOT, '.prettierrc'), 'utf8'));
  write('.prettierignore', readFileSync(join(REPO_ROOT, '.prettierignore'), 'utf8'));
  // Committed, already unformatted, and owned by "another session".
  write('plugin/plugin.json', UNFORMATTED_JSON);
  write('server/src/keep.ts', UNFORMATTED_TS);
  git('add', '-A');
  git('commit', '-qm', 'initial');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('format:fix scopes to this worktree (LAI-026)', () => {
  it('leaves an unformatted file this worktree did not change alone', () => {
    const before = read('plugin/plugin.json');

    write('server/src/mine.ts', UNFORMATTED_TS);
    runFormatFix();

    // The exact regression that produced this task.
    expect(read('plugin/plugin.json')).toBe(before);
  });

  it('formats a tracked file this worktree modified', () => {
    write('server/src/keep.ts', 'export const changed   =    {b:1}\n');

    runFormatFix();

    expect(read('server/src/keep.ts')).toBe('export const changed = { b: 1 };\n');
  });

  it('formats an untracked new file', () => {
    // The most likely thing to be unformatted, and `git diff` alone misses it.
    write('server/src/brand-new.ts', UNFORMATTED_TS);

    runFormatFix();

    expect(read('server/src/brand-new.ts')).toBe('export const a = { b: 1, c: 2 };\n');
  });

  it('formats a changed file in another area only when this worktree changed it', () => {
    // Ownership is not encoded anywhere — "what I changed" is the rule. A builder
    // legitimately editing another directory still gets their own edit formatted.
    write('plugin/plugin.json', '{\n  "keywords": [\n    "x",\n     "y"\n  ]\n}\n');

    runFormatFix();

    // Prettier keeps the object expanded (the source had a newline after `{`)
    // but collapses the array — enough to prove it wrote the file.
    expect(read('plugin/plugin.json')).toBe('{\n  "keywords": ["x", "y"]\n}\n');
  });

  it('does nothing, and succeeds, on a clean worktree', () => {
    expect(() => runFormatFix()).not.toThrow();
    expect(read('plugin/plugin.json')).toBe(UNFORMATTED_JSON);
  });

  it('never touches the lockfile, which pnpm owns', () => {
    const lock = 'lockfileVersion:   "9.0"\n\nsettings:\n  autoInstallPeers:   true\n';
    write('pnpm-lock.yaml', lock);

    runFormatFix();

    expect(read('pnpm-lock.yaml')).toBe(lock);
  });

  it('skips gitignored build output even when it is unformatted', () => {
    write('dist/bundle.js', UNFORMATTED_TS);

    runFormatFix();

    expect(read('dist/bundle.js')).toBe(UNFORMATTED_TS);
  });

  it('survives a deleted file without failing the run', () => {
    // `git diff --name-only HEAD` lists deletions; Prettier cannot open them.
    git('rm', '-q', 'server/src/keep.ts');
    write('server/src/replacement.ts', UNFORMATTED_TS);

    expect(() => runFormatFix()).not.toThrow();
    expect(read('server/src/replacement.ts')).toBe('export const a = { b: 1, c: 2 };\n');
  });

  it('handles filenames containing spaces', () => {
    // `docs/design/Laika 01 - Kanban Board.dc.html` is a real file in this repo,
    // so whitespace-splitting the file list is not a hypothetical bug.
    write('docs/a file with spaces.json', '{"a":   1}\n');

    runFormatFix();

    expect(read('docs/a file with spaces.json')).toBe('{ "a": 1 }\n');
  });

  it('leaves files Prettier has no parser for untouched', () => {
    write('server/src/notes.bin', 'not   parseable   by   prettier');

    expect(() => runFormatFix()).not.toThrow();
    expect(read('server/src/notes.bin')).toBe('not   parseable   by   prettier');
  });
});

describe('format:fix respects the repo formatting policy (LAI-001)', () => {
  it('never touches Markdown, which `format` deliberately does not check', () => {
    // The repo hand-wraps prose to 80 columns; Prettier repaginates every table
    // in CLAUDE.md and docs/. Caught by doing it — an earlier draft of this
    // script rewrote 22 lines of CLAUDE.md as a side effect of a five-line edit.
    const prose = '# Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    write('CLAUDE.md', prose);

    runFormatFix();

    expect(read('CLAUDE.md')).toBe(prose);
  });

  it('formats the file types `format` checks', () => {
    write('server/src/a.ts', UNFORMATTED_TS);
    write('server/web/b.css', 'a{color:red}\n');
    write('server/c.yaml', 'a:    1\n');

    runFormatFix();

    expect(read('server/src/a.ts')).toBe('export const a = { b: 1, c: 2 };\n');
    expect(read('server/web/b.css')).toBe('a {\n  color: red;\n}\n');
    expect(read('server/c.yaml')).toBe('a: 1\n');
  });
});

describe('third-party artefacts are never formatted (LAI-026, CHIEF addition)', () => {
  it('leaves an ignored directory alone even when this worktree changed it', () => {
    // `docs/design/` holds imported mockups and a vendored runtime. They are a
    // visual reference — reformatting corrupts the comparison they exist for.
    const mockup = '<sc-if value="{{ p.hasDiff }}">\n<div>   unformatted   </div>\n';
    write('docs/design/mockup.dc.html', mockup);
    write('docs/design/support.js', 'var x   =   1\n');

    runFormatFix();

    expect(read('docs/design/mockup.dc.html')).toBe(mockup);
    expect(read('docs/design/support.js')).toBe('var x   =   1\n');
  });

  it('does not fail the run on a file Prettier cannot parse', () => {
    // Before the ignore entry this exited 2 and took the whole check down.
    write('docs/design/broken.dc.html', '<sc-if value="{{ x }}">\n');

    expect(() => runFormatFix()).not.toThrow();
  });
});

/**
 * The window reaches work this branch has already committed (LAI-101).
 *
 * LAI-026 scoped `format:fix` to `git diff HEAD`, which is right for "fix what I
 * am working on" and empty the moment you commit — so `pnpm format` could be red
 * with no command that fixed it. The window is now the branch's **merge-base
 * with `master`**, which still cannot reach a file this worktree never touched.
 */
describe('format:fix reaches committed work on this branch (LAI-101)', () => {
  /** A `master` to fork from, so `merge-base` has something to find. */
  function branchFromMaster(): void {
    git('branch', '-M', 'master');
    git('checkout', '-qb', 'work');
  }

  it('formats a file this branch committed, which `git diff HEAD` cannot see', () => {
    branchFromMaster();
    write('server/src/mine.ts', UNFORMATTED_TS);
    git('add', '-A');
    git('commit', '-qm', 'my work');

    // The whole gap: with the file committed, `git diff HEAD` is empty and the
    // old script had nothing to hand Prettier.
    expect(read('server/src/mine.ts')).toBe(UNFORMATTED_TS);
    runFormatFix();
    expect(read('server/src/mine.ts')).not.toBe(UNFORMATTED_TS);
  });

  it('still leaves a file only `master` touched alone', () => {
    branchFromMaster();
    write('server/src/mine.ts', UNFORMATTED_TS);
    git('add', '-A');
    git('commit', '-qm', 'my work');

    runFormatFix();

    // LAI-026's property, unchanged: `keep.ts` was committed before the fork, so
    // it is not this branch's work and the formatter must not reach it. Widening
    // the window must not widen the ownership.
    expect(read('server/src/keep.ts')).toBe(UNFORMATTED_TS);
    expect(read('plugin/plugin.json')).toBe(UNFORMATTED_JSON);
  });

  it('on a freshly branched worktree, behaves exactly as before', () => {
    branchFromMaster();

    // No commits of its own, so the merge-base *is* `HEAD` and the diff is
    // empty — today's behaviour, and the uncommitted half still works.
    write('server/src/uncommitted.ts', UNFORMATTED_TS);
    runFormatFix();

    expect(read('server/src/uncommitted.ts')).not.toBe(UNFORMATTED_TS);
    expect(read('server/src/keep.ts')).toBe(UNFORMATTED_TS);
  });

  it('on `master` itself, formats nothing already committed', () => {
    git('branch', '-M', 'master');
    write('server/src/late.ts', UNFORMATTED_TS);
    git('add', '-A');
    git('commit', '-qm', 'committed on master');

    runFormatFix();

    // `merge-base master HEAD` is `HEAD` here, so the diff is empty — which is
    // the safe outcome and the one AC4 asks to be confirmed rather than assumed.
    // A `master` that formatted its own history would rewrite the whole repo.
    expect(read('server/src/late.ts')).toBe(UNFORMATTED_TS);
  });

  it('falls back to HEAD when there is no `master` at all', () => {
    // Every test above this block runs in exactly this state — `git init` with
    // no `master` — so the fallback is what has kept LAI-026's suite passing.
    // Asserted directly rather than relied on.
    write('server/src/uncommitted.ts', UNFORMATTED_TS);
    runFormatFix();

    expect(read('server/src/uncommitted.ts')).not.toBe(UNFORMATTED_TS);
    expect(read('server/src/keep.ts')).toBe(UNFORMATTED_TS);
  });
});
