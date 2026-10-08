#!/usr/bin/env node
import { init } from './init.ts';
import { whoami } from './whoami.ts';

/**
 * `laika` — the CLI entry point.
 *
 * The dispatch exists so `laika something-else` says what it does not know
 * rather than silently running `init`, which is the failure mode of a
 * single-command binary that grows a second command later — and it did:
 * `whoami` arrived in LAI-623, having been printed by the Tokens screen since
 * LAI-410 while not existing.
 */

const USAGE = [
  'laika — connect this machine to a Laika board.',
  '',
  'Usage:',
  '  laika init       authenticate, create a token, and save it',
  '  laika whoami     who this machine is, and to which board',
  '',
  'Configuration is written to your Claude Code user settings, outside any',
  'repository, so a token cannot be committed by accident.',
  '',
  '`laika` is installed by plugin/scripts/install.sh from a Laika checkout.',
].join('\n');

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return command === undefined ? 1 : 0;
  }

  if (command === 'init') return init();
  if (command === 'whoami') return whoami();

  process.stderr.write(`laika: unknown command "${command}"\n\n${USAGE}\n`);
  return 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause: unknown) => {
    // A thrown error here is a bug, not a user mistake — but it still must not
    // be a bare stack trace at somebody trying to set up a board.
    process.stderr.write(`laika: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
