import { type AgentIo, eventDeps } from './agent.ts';
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  noticeLine,
  readStore,
  runEventStream,
  storePath,
  syncOnce,
} from './agent-events.ts';
import { HARNESSES, isHarness, readCredential } from './agent-session.ts';

/**
 * `laika agent events` (LAI-554): what the event helper holds, a catch-up on
 * demand, and the stream in the foreground. **Listing is not presenting**:
 * nothing here records `presented` — only a hook that printed a notice does.
 */

const USAGE = [
  'laika agent events [--harness H]          list the notices held here and their states',
  'laika agent events sync [--harness H]     fetch undelivered events now and acknowledge them received',
  'laika agent events listen [--harness H]   hold the event stream open in the foreground (Ctrl-C stops)',
  '',
  'States: available (on the board) → received (acknowledged by this helper) →',
  'presented (a hook printed the notice to the harness) → accepted (the offer’s',
  'own state on the board). None of them means the model read the notice.',
].join('\n');

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** The harness to act for, or why there is none (a harness name is itself a string). */
function pick(io: AgentIo, argv: readonly string[]): string {
  const named = option(argv, '--harness');
  if (named !== undefined) {
    return isHarness(named) ? named : `--harness must be one of ${HARNESSES.join(', ')}`;
  }
  const have = HARNESSES.filter((h) => readCredential(io.home, h, io.env) !== undefined);
  if (have.length === 1) return have[0]!;
  return have.length === 0
    ? 'no agent token: run `laika agent login <harness>` first'
    : `more than one agent token here: pass --harness (${have.join(', ')})`;
}

export async function eventsCommand(io: AgentIo, argv: readonly string[]): Promise<number> {
  const sub = argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : 'list';
  if (sub === 'help' || argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE);
    return 0;
  }
  const harness = pick(io, argv);
  if (!isHarness(harness)) {
    io.err(`laika agent events: ${harness}`);
    return 1;
  }
  const credential = readCredential(io.home, harness, io.env);
  if (credential === undefined) {
    io.err(`laika agent events: no agent token for ${harness}`);
    return 1;
  }

  if (sub === 'sync') {
    const outcome = await syncOnce(eventDeps(io), harness, credential, undefined);
    const held = readStore(io.home, harness).records;
    if (outcome === 'refused') {
      io.err('laika agent events: the board refused this agent’s token (revoked or expired)');
      return 1;
    }
    io.out(
      `sync ${outcome}: ${String(held.filter((r) => r.state === 'received').length)} received, not yet shown`,
    );
    return outcome === 'ok' ? 0 : 1;
  }

  if (sub === 'listen') {
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    io.out(`listening for ${harness} events; Ctrl-C stops`);
    const outcome = await runEventStream(eventDeps(io), harness, credential, {
      signal: stop.signal,
    });
    if (outcome === 'refused') {
      io.err('laika agent events: the board refused this agent’s token (revoked or expired)');
      return 1;
    }
    return 0;
  }

  if (sub !== 'list') {
    io.err(`laika agent events: unknown subcommand "${sub}"\n\n${USAGE}`);
    return 1;
  }
  const store = readStore(io.home, harness);
  if (store.refused_at !== undefined) {
    io.out(
      `The board refused this agent’s token at ${new Date(store.refused_at).toISOString()}; nothing is received until it is replaced.`,
    );
  }
  if (store.records.length === 0) {
    io.out(`No events held for ${harness}. (${storePath(io.home, harness)})`);
    return 0;
  }
  io.out(BLOCK_OPEN);
  for (const r of store.records.slice(-50)) {
    const board = r.board_state === undefined ? '' : `, board: ${r.board_state}`;
    io.out(
      `[${r.state}${r.presented_unacked === true ? ' (ack owed)' : ''}${board}] ${noticeLine(r)}`,
    );
  }
  io.out(BLOCK_CLOSE);
  return 0;
}
