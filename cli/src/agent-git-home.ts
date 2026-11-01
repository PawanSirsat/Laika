import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { AgentIo } from './agent.ts';
import { shellQuote } from './agents.ts';

/**
 * `laika agent git-home <dir>` (LAI-1034): make git under another HOME — the
 * Omnigent wrapper's `~/.laika/polly-home` (LAI-589) — find **your** git
 * configuration and credential helpers, so a checkpoint saved from that
 * session can push.
 *
 * The checkpoint helper passes git an allowlisted environment
 * (`GIT_ENV_ALLOW`, `checkpoint-git.ts`): HOME, never a token. Under a HOME
 * that is not yours, git finds no global config and so no credential helper,
 * and the push fails with prompts off. This is setup, not a code path: it
 * writes `<dir>/.gitconfig` once, and nothing about the allowlist changes.
 *
 * The file includes your own global config (`~/.config/git/config`, then
 * `~/.gitconfig`), then, for every credential helper that config names,
 * clears that list and names the helper again **with HOME set back to
 * yours**. A helper such as `gh auth git-credential` finds its login through
 * HOME — on macOS the keychain too — so it has to run as you. What it returns
 * goes to git over the credential protocol, never on a command line or into
 * the environment.
 *
 * Your home comes from the account database (`os.userInfo()`), not from
 * `$HOME`, so the command gives the same answer when run from inside the
 * other HOME. A `.gitconfig` this command did not write is never replaced.
 */

export const GIT_HOME_MARKER = '# Written by `laika agent git-home` (LAI-1034).';

export type GitHomeOutcome = 'written' | 'unchanged' | 'refused';

interface Helper {
  /** `undefined` for `credential.helper`, else the URL of `credential.<url>.helper`. */
  readonly url: string | undefined;
  readonly value: string;
}

/** Your global credential helpers, in the order git reads them, read with HOME as yours. */
export function globalHelpers(realHome: string, path: string | undefined): Helper[] {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['config', '--global', '--includes', '-z', '--get-regexp', '^credential\\..*helper$'],
      {
        env: { PATH: path ?? '/usr/bin:/bin', HOME: realHome, LC_ALL: 'C' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    return []; // exit 1: no helper is configured
  }
  const helpers: Helper[] = [];
  for (const record of out.split('\0')) {
    if (record === '') continue;
    const cut = record.indexOf('\n');
    const key = cut === -1 ? record : record.slice(0, cut);
    const value = cut === -1 ? '' : record.slice(cut + 1);
    if (key.toLowerCase() === 'credential.helper') {
      helpers.push({ url: undefined, value });
    } else {
      const url = key.slice('credential.'.length, key.length - '.helper'.length);
      helpers.push({ url, value });
    }
  }
  return helpers;
}

/**
 * The helper again, run as you. git runs a `!` helper through the shell with
 * the action appended, so `export HOME=…;` before it covers a single command
 * and a shell function alike.
 */
export function asYou(value: string, realHome: string): string {
  const home = `export HOME=${shellQuote(realHome)}; `;
  if (value.startsWith('!')) return `!${home}${value.slice(1)}`;
  if (isAbsolute(value.split(/\s/)[0] ?? '')) return `!${home}${value}`;
  return `!${home}git credential-${value}`;
}

function setConfig(file: string, key: string, value: string, path: string | undefined): void {
  execFileSync('git', ['config', '--file', file, '--add', key, value], {
    env: { PATH: path ?? '/usr/bin:/bin', LC_ALL: 'C' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/** The file's whole text, built through `git config --file` so git does the quoting. */
export function gitHomeConfig(
  realHome: string,
  helpers: readonly Helper[],
  path: string | undefined,
  scratch: string,
): string {
  writeFileSync(
    scratch,
    `${GIT_HOME_MARKER}\n# Your git config, and each credential helper run with HOME=${realHome}.\n`,
    {
      mode: 0o600,
    },
  );
  setConfig(scratch, 'include.path', join(realHome, '.config', 'git', 'config'), path);
  setConfig(scratch, 'include.path', join(realHome, '.gitconfig'), path);
  const urls: (string | undefined)[] = [];
  for (const helper of helpers) if (!urls.includes(helper.url)) urls.push(helper.url);
  for (const url of urls) {
    const key = url === undefined ? 'credential.helper' : `credential.${url}.helper`;
    setConfig(scratch, key, '', path); // clears what the include just listed
    for (const helper of helpers) {
      if (helper.url === url && helper.value !== '')
        setConfig(scratch, key, asYou(helper.value, realHome), path);
    }
  }
  return readFileSync(scratch, 'utf8');
}

export function writeGitHome(
  dir: string,
  realHome: string,
  path: string | undefined,
): { outcome: GitHomeOutcome; file: string; why?: string; helpers: number } {
  const target = resolve(dir);
  const file = join(target, '.gitconfig');
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return { outcome: 'refused', file, why: `${target} is not a directory`, helpers: 0 };
  }
  if (target === resolve(realHome)) {
    return {
      outcome: 'refused',
      file,
      why: `${target} is your own home; git already reads it`,
      helpers: 0,
    };
  }
  const current = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (current !== undefined && !current.startsWith(GIT_HOME_MARKER)) {
    return {
      outcome: 'refused',
      file,
      why: `${file} was not written by this command; it is left alone`,
      helpers: 0,
    };
  }
  const helpers = globalHelpers(realHome, path);
  const scratch = `${file}.laika-${process.pid}`;
  try {
    const next = gitHomeConfig(realHome, helpers, path, scratch);
    const count = helpers.filter((h) => h.value !== '').length;
    if (next === current) return { outcome: 'unchanged', file, helpers: count };
    chmodSync(scratch, 0o600);
    renameSync(scratch, file);
    return { outcome: 'written', file, helpers: count };
  } finally {
    rmSync(scratch, { force: true });
  }
}

export function gitHome(
  io: AgentIo,
  argv: readonly string[],
  realHome = userInfo().homedir,
): number {
  const dir = argv[0];
  if (dir === undefined || dir.startsWith('-') || argv.length > 1) {
    io.err(
      'Usage: laika agent git-home <dir>   make git under HOME=<dir> use your git config and credential helpers',
    );
    return 1;
  }
  const result = writeGitHome(dir, realHome, io.env.PATH);
  if (result.outcome === 'refused') {
    io.err(`laika agent git-home: refused: ${result.why ?? ''}`);
    return 2;
  }
  io.out(
    `${result.outcome === 'written' ? 'Wrote' : 'Unchanged:'} ${result.file} — your git config, and ${String(result.helpers)} credential helper(s) run with HOME=${realHome}.`,
  );
  if (result.helpers === 0)
    io.out('No credential helper is set in your global git config; an https push will still ask.');
  return 0;
}
