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
 * **Not re-homed:** a helper inside an `includeIf` block (it is read only
 * where its condition holds; outside a matching repo it is not seen here),
 * and a `~/…` path inside your own config, which git expands with the HOME it
 * runs under, so through this file it names `<dir>/…`, not your home. Use
 * absolute paths there.
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

/**
 * Your global config files, in the order git reads them: the XDG file, then
 * `~/.gitconfig`. The written file includes both, for everything that is not a
 * credential helper.
 */
export function globalFiles(realHome: string, xdgConfigHome?: string): string[] {
  const xdg =
    xdgConfigHome !== undefined && isAbsolute(xdgConfigHome)
      ? xdgConfigHome
      : join(realHome, '.config');
  return [join(xdg, 'git', 'config'), join(realHome, '.gitconfig')];
}

/**
 * Every helper entry git reads before your repo's own config, resets
 * included, **in the order git reads them**: the system file, a file built
 * into git itself (Apple's git ships one naming `osxkeychain`), then the
 * global ones, includes followed. Read as you, from `/`, so no repo's local
 * config is in it and git itself gives the order.
 */
export function globalHelpers(
  realHome: string,
  path: string | undefined,
  xdgConfigHome?: string,
): Helper[] {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['config', '--show-scope', '--includes', '-z', '--get-regexp', '^credential\\..*helper$'],
      {
        cwd: '/',
        env: {
          PATH: path ?? '/usr/bin:/bin',
          HOME: realHome,
          LC_ALL: 'C',
          ...(xdgConfigHome !== undefined && isAbsolute(xdgConfigHome)
            ? { XDG_CONFIG_HOME: xdgConfigHome }
            : {}),
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    return []; // exit 1: no helper anywhere
  }
  const helpers: Helper[] = [];
  const fields = out.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i] ?? '';
    const record = fields[i + 1] ?? '';
    if (!['system', 'unknown', 'global'].includes(scope)) continue;
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
 * The entries still alive. An empty `helper =` clears every helper read
 * before it, so an entry above its own section's last reset never runs, and
 * is dropped rather than written again: a helper you switched off stays off
 * (LAI-1034 review B1). What is left keeps git's order, the last resets
 * included, so a reset in one section still clears what another set before it.
 */
export function liveHelpers(helpers: readonly Helper[]): Helper[] {
  const lastReset = new Map<string | undefined, number>();
  helpers.forEach((helper, i) => {
    if (helper.value === '') lastReset.set(helper.url, i);
  });
  return helpers.filter((helper, i) => i >= (lastReset.get(helper.url) ?? -1));
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

/** A value as git-config text: always quoted, so `;`, `#` and spaces survive. */
export function configValue(value: string): string {
  const body = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${body}"`;
}

/** A section header; a URL subsection escapes `\` and `"` as git requires. */
function header(url: string | undefined): string {
  if (url === undefined) return '[credential]';
  return `[credential "${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/**
 * The file's whole text. Written here rather than through `git config --add`,
 * which appends each entry to its section's existing block: two sections that
 * alternate would come out grouped, and git, which keeps one helper list across
 * every matching section, would run a different list (LAI-1034 review B2). So
 * every live entry, resets included, goes out in the order git read it, with a
 * fresh header for each run of one section.
 */
export function gitHomeConfig(
  realHome: string,
  helpers: readonly Helper[],
  files: readonly string[] = globalFiles(realHome),
): string {
  const lines = [
    GIT_HOME_MARKER,
    `# Your git config, and each credential helper run with HOME=${realHome}.`,
    '[include]',
    ...files.map((file) => `\tpath = ${configValue(file)}`),
  ];
  const live = liveHelpers(helpers);
  // Clear what the includes just listed, so this HOME starts from nothing.
  for (const url of [...new Set(live.map((helper) => helper.url))]) {
    lines.push(header(url), `\thelper = ""`);
  }
  let open: string | null = null;
  for (const helper of live) {
    const at = header(helper.url);
    if (at !== open) lines.push(at);
    open = at;
    const value = helper.value === '' ? '' : asYou(helper.value, realHome);
    lines.push(`\thelper = ${configValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function writeGitHome(
  dir: string,
  realHome: string,
  path: string | undefined,
  xdgConfigHome?: string,
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
  const files = globalFiles(realHome, xdgConfigHome);
  const helpers = globalHelpers(realHome, path, xdgConfigHome);
  const scratch = `${file}.laika-${process.pid}`;
  try {
    const next = gitHomeConfig(realHome, helpers, files);
    const count = liveHelpers(helpers).filter((h) => h.value !== '').length;
    if (next === current) return { outcome: 'unchanged', file, helpers: count };
    writeFileSync(scratch, next, { mode: 0o600 });
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
      [
        'Usage: laika agent git-home <dir>   make git under HOME=<dir> use your git config and credential helpers',
        '',
        'Writes <dir>/.gitconfig: an include of your $XDG_CONFIG_HOME/git/config (default ~/.config) and ~/.gitconfig, then each',
        'credential helper still switched on there, in the order git reads them, run with HOME set to yours.',
        'Not re-homed: a helper',
        'inside an includeIf block, and ~/ paths in your config (git expands them with HOME=<dir>).',
      ].join('\n'),
    );
    return 1;
  }
  const result = writeGitHome(dir, realHome, io.env.PATH, io.env.XDG_CONFIG_HOME);
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
