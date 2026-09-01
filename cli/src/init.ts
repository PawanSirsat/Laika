import { hostname } from 'node:os';
import { checkReachable, mintToken, normaliseUrl, signIn } from './api.ts';
import {
  SETTINGS_PATH,
  existingConfig,
  readSettings,
  withLaikaConfig,
  writeSettings,
} from './config.ts';
import { ask, askSecret, confirm } from './prompt.ts';

/**
 * `npx laika init` — M4's exit criterion.
 *
 * *"A new repo goes from nothing to an agent working the board in one
 * command."* Reachability, sign-in, mint, write — and it must work for somebody
 * with **no plugin installed**, which is why the CLI owns configuration rather
 * than delegating to `/laika:setup` (D-046).
 */

export interface InitIo {
  readonly out: (line: string) => void;
  readonly settingsPath: string;
}

const defaultIo: InitIo = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  settingsPath: SETTINGS_PATH,
};

/** A token name a person can recognise in a list a year later. */
export function tokenName(host: string = hostname()): string {
  return `laika-cli on ${host}`;
}

export async function init(io: InitIo = defaultIo): Promise<number> {
  const { out } = io;

  out('Laika — connect this machine to your board.');
  out('');

  // Idempotence first, before anything is asked. Minting a second token and
  // *then* discovering one exists would leave a stray credential on the board
  // that nobody asked for and nobody will revoke.
  const settings = readSettings(io.settingsPath);
  const already = existingConfig(settings);
  if (already !== undefined) {
    out(`This machine is already connected to ${already.url}.`);
    out(`Its token is in ${io.settingsPath}.`);
    out('');
    if (!(await confirm('Replace it with a new one?'))) {
      out('Left as it is. Nothing was changed and no token was created.');
      return 0;
    }
    out('');
  }

  const url = normaliseUrl(await ask('Board URL', already?.url ?? 'http://localhost:3000'));
  if (url === '') {
    out('No URL given, so there is nothing to connect to.');
    return 1;
  }

  const reachable = await checkReachable(url);
  if (!reachable.ok) {
    out(reachable.error.message);
    return 1;
  }
  out(`Found a Laika at ${url}.`);
  out('');

  const email = await ask('Email');
  // Never a flag, never an argument — see `prompt.ts`.
  const password = await askSecret('Password');

  const session = await signIn(url, email, password);
  if (!session.ok) {
    out(session.error.message);
    return 1;
  }

  const minted = await mintToken(url, session.value, tokenName());
  if (!minted.ok) {
    out(minted.error.message);
    return 1;
  }

  writeSettings(withLaikaConfig(settings, { url, token: minted.value.secret }), io.settingsPath);

  out('');
  out(`Connected. Token "${minted.value.name}" (${minted.value.prefix}…) was created and saved to`);
  out(`  ${io.settingsPath}`);
  out('');
  // §4.9: the plaintext is not recoverable. Saying so here is the difference
  // between someone storing it deliberately and discovering later that they
  // cannot.
  out('That file is outside your repository, so the token cannot be committed by');
  out('accident. Laika keeps only a hash — if you lose it, revoke the token and');
  out('run this again.');
  out('');
  out('Next: open this repo in Claude Code and ask it to list your ready tasks.');

  return 0;
}
