#!/usr/bin/env node
import { activity, time } from './activity.ts';
import { connect } from './connect.ts';
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
  '  laika init               authenticate, create a token, and save it',
  '  laika whoami             who this machine is, and to which board',
  '  laika connect <agent>    point a coding agent at the board (--project: this folder)',
  '  laika connect --list     the agents connect knows, and what it does for each',
  '  laika activity on|off    count local agent activity for the heatmap (opt-in)',
  '  laika activity status    what the next activity sync would send',
  '  laika activity backfill  send a year of your pushed commits once (asks first)',
  '  laika time draft         the blocks of your day this machine drafts (D-088)',
  '  laika time connect       keep your Solidtime key on this machine (never sent to Laika)',
  '  laika time push|pull     confirmed time to Solidtime, and what was logged there back',
  '',
  '`init` writes your Claude Code user settings; `connect` keeps the token in',
  '~/.laika/env. Both are outside any repository, so a token cannot be committed',
  'by accident.',
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
  if (command === 'connect') return connect(argv.slice(1));
  if (command === 'activity') return activity(argv.slice(1));
  if (command === 'time') return time(argv.slice(1));

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
