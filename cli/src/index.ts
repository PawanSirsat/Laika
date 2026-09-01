#!/usr/bin/env node
import { init } from './init.ts';

/**
 * `laika` — the CLI entry point.
 *
 * One command today. The dispatch exists so `laika something-else` says what it
 * does not know rather than silently running `init`, which is the failure mode
 * of a single-command binary that grows a second command later.
 */

const USAGE = [
  'laika — connect this machine to a Laika board.',
  '',
  'Usage:',
  '  npx laika init     authenticate, create a token, and save it',
  '',
  'Configuration is written to your Claude Code user settings, outside any',
  'repository, so a token cannot be committed by accident.',
].join('\n');

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return command === undefined ? 1 : 0;
  }

  if (command === 'init') return init();

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
