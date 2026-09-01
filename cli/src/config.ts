import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Where `LAIKA_URL` and `LAIKA_TOKEN` live (SPEC §8, D-046).
 *
 * **User settings, not the repo.** §8 says they are *"never committed"*, and
 * writing them outside the repository is the only version of that which cannot
 * be undone later: a gitignored file in the working tree is one `git add -f`,
 * one careless `.gitignore` edit, or one `git stash -u` away from being
 * committed anyway.
 *
 * **One location, and the CLI owns it** (D-046). `npx laika init` has to work
 * for somebody with no plugin installed, so it cannot be the side that
 * delegates — and two doors writing two locations is what would make the
 * idempotence criterion unprovable, because "already configured" could not be
 * told from "configured somewhere else".
 */
export const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

export interface LaikaConfig {
  readonly url: string;
  readonly token: string;
}

/** Claude Code's settings file, as much of it as this cares about. */
export interface Settings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Read the existing settings, or `{}` when there are none.
 *
 * **A malformed file is not "no settings".** Overwriting one because it failed
 * to parse would destroy whatever else the reader keeps in there, so this
 * throws and `init` stops rather than guessing.
 */
export function readSettings(path: string = SETTINGS_PATH): Settings {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `${path} is not valid JSON, so init stopped rather than overwrite it.\n` +
        `Fix or move it and run init again. (${String(cause)})`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${path} does not contain a JSON object, so init stopped rather than replace it.`,
    );
  }
  return parsed as Settings;
}

/** What is configured today, if anything. **Both halves or neither.** */
export function existingConfig(settings: Settings): LaikaConfig | undefined {
  const url = settings.env?.LAIKA_URL;
  const token = settings.env?.LAIKA_TOKEN;
  if (typeof url !== 'string' || url === '') return undefined;
  if (typeof token !== 'string' || token === '') return undefined;
  return { url, token };
}

/**
 * Merge the two variables in, leaving everything else alone.
 *
 * Pure, so the merge is testable without touching a real settings file — and
 * what must never go wrong here is *what else is in there*.
 */
export function withLaikaConfig(settings: Settings, config: LaikaConfig): Settings {
  return {
    ...settings,
    env: { ...settings.env, LAIKA_URL: config.url, LAIKA_TOKEN: config.token },
  };
}

export function writeSettings(settings: Settings, path: string = SETTINGS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  // `0600`: the file now holds a credential. Trailing newline because it is
  // hand-edited, and a permanent "no newline at end of file" marker is noise
  // somebody else has to ignore.
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}
