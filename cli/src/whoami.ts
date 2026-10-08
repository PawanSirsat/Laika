import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normaliseUrl, whoAmI } from './api.ts';
import { readSettings, SETTINGS_PATH } from './config.ts';

/**
 * `laika whoami` — who this machine is, to which board (LAI-623).
 *
 * ## Why it exists
 *
 * The Tokens screen has told people to run it since LAI-410, and until now it
 * printed `unknown command`. That is the first command a new developer is
 * offered, so it failing is the product's first impression.
 *
 * ## What it prints, and what it never prints
 *
 * The board and the token's *state* come from local settings alone, so they
 * print on every path including the failures — they are the half that
 * diagnoses a bad paste. **The token itself is never printed**, in any state:
 * the wording here is lifted from `plugin/scripts/laika-status.sh` so the two
 * tools cannot describe the same token differently.
 *
 * ## Why it reads two files
 *
 * There are two config locations and D-046 says there should be one. Until
 * that is settled, **whoami must read both or it is wrong for half the people
 * who run it**: `laika init` writes `~/.claude/settings.json`, and
 * `plugin/scripts/install.sh` — the path the Connect screen hands every new
 * joiner — writes `~/.laika/env` and nothing else.
 *
 * Measured before this was added: a clean sandbox, a successful install.sh,
 * then `laika whoami` → *"This machine is not connected to a board."* The
 * installer's own closing line promises the opposite, so the first command a
 * new developer runs called their working setup broken.
 *
 * It also **prints which file the answer came from**. Two locations is a
 * problem to be fixed by CHIEF, not hidden here; naming the source turns it
 * from an invisible ambiguity into something a person can diagnose in one line.
 *
 * Exits non-zero when it cannot answer. `laika-common.sh`'s "every command
 * exits 0" rule is about slash commands *inside* a session, where a non-zero
 * exit hands the agent an error to interpret; a terminal command that could
 * not answer the question should say so with its status.
 */

export interface WhoamiIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly settingsPath: string;
  /** `~/.laika/env`, written by `plugin/scripts/install.sh`. */
  readonly envPath: string;
}

export const ENV_PATH = join(homedir(), '.laika', 'env');

/**
 * `~/.laika/env` is sourced by `sh`, so it is `KEY="value"` lines and comments.
 * Parsed rather than executed: this file holds a token, and running it to read
 * it would make anything that lands in there executable by a command whose
 * whole job is to *report*.
 *
 * Anything unparseable is skipped rather than thrown — a malformed line should
 * not stop whoami reporting the half it could read.
 */
function readEnvFile(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }

  const found: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = /^\s*(?:export\s+)?(LAIKA_[A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, rest] = match;
    if (key === undefined || rest === undefined) continue;
    const value = rest.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value !== '') found[key] = value;
  }
  return found;
}

const CONSOLE: WhoamiIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  settingsPath: SETTINGS_PATH,
  envPath: ENV_PATH,
};

/** The token's shape, never its value — the `laika-status.sh` wording. */
function tokenState(token: string | undefined): string {
  if (token === undefined || token === '') return 'not set';
  return token.startsWith('lai_')
    ? `present (lai_ prefix, ${String(token.length)} chars)`
    : `present but malformed (${String(token.length)} chars, expected a lai_ prefix)`;
}

export async function whoami(io: WhoamiIo = CONSOLE): Promise<number> {
  /*
   * The two halves are read separately rather than through `existingConfig`,
   * which returns `undefined` unless both are present. That is right for
   * `init`'s "already connected?" question and wrong here: a machine with a
   * board and no token should be told *which half* is missing, not that it has
   * never been connected.
   */
  let stored: Record<string, string> | undefined;
  try {
    stored = readSettings(io.settingsPath).env;
  } catch (cause) {
    io.err(`laika: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }

  const installed = readEnvFile(io.envPath);

  /*
   * The environment wins, so this reports what a session would actually use —
   * `laika-claude` sources ~/.laika/env and exports both values, so inside a
   * session this branch is the one that answers. Then `laika init`'s file,
   * then the installer's.
   */
  const pick = (key: string): { value?: string; from: string } => {
    const live = process.env[key];
    if (live !== undefined && live !== '') return { value: live, from: 'the environment' };
    const fromSettings = stored?.[key];
    if (fromSettings !== undefined && fromSettings !== '') {
      return { value: fromSettings, from: io.settingsPath };
    }
    const fromInstaller = installed[key];
    if (fromInstaller !== undefined) return { value: fromInstaller, from: io.envPath };
    return { from: 'nowhere' };
  };

  const board = pick('LAIKA_URL');
  const url = board.value;
  const token = pick('LAIKA_TOKEN').value;

  if (url === undefined || url === '') {
    io.err('This machine is not connected to a board.');
    io.err('');
    io.err(`Run: laika init   (or ${io.envPath} from the plugin installer)`);
    return 1;
  }

  const base = normaliseUrl(url);
  io.out(`Board   ${base}`);
  io.out(`Token   ${tokenState(token)}`);
  io.out(`Config  ${board.from}`);

  if (token === undefined || token === '') {
    io.err('');
    io.err(`LAIKA_TOKEN is not set, so ${base} will refuse every request.`);
    io.err('Run: laika init');
    return 1;
  }

  const answer = await whoAmI(base, token);
  if (!answer.ok) {
    io.err('');
    io.err(answer.error.message);
    return 1;
  }

  const { name, email, org_role, memberships } = answer.value;
  io.out('');
  io.out(`  Signed in   ${name} <${email}> (${org_role})`);
  io.out(`  Projects    ${String(memberships.length)}`);
  return 0;
}
