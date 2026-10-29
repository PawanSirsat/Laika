/**
 * One receiver in a genuinely concurrent accept race (LAI-546 review): a
 * **separate process with its own SQLite connection**, so the two accepts
 * contend for the database's write lock rather than taking turns in one
 * event loop. Started by `test/services/handoffs.test.ts`.
 *
 * argv: db path, the agent's token secret, the offer id, the commit SHA, now.
 * It prints `ready` once its connection is open, waits for one line on stdin —
 * the parent writes it to both racers at once — then accepts and prints one
 * JSON line: `{ "won": agentId }` or `{ "code", "reason" }`.
 */
import { createInterface } from 'node:readline';
import { resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import { openDb } from '../../src/db/client.ts';
import { ApiError } from '../../src/errors.ts';
import { acceptHandoff } from '../../src/services/handoffs.ts';

const [path, secret, offerId, sha, nowArg] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
];
const now = Number(nowArg);
const { db, sqlite } = openDb({ path });
const actor = resolveTokenActor(db, secret, now);

const lines = createInterface({ input: process.stdin });
process.stdout.write('ready\n');
lines.once('line', () => {
  let answer: Record<string, unknown>;
  try {
    const accepted = acceptHandoff(sqlite, db, actor, offerId, { verifiedCommitSha: sha, now });
    answer = { won: accepted.claim.agent_id };
  } catch (err) {
    answer =
      err instanceof ApiError
        ? { code: err.code, reason: (err.details as { reason?: unknown } | null)?.reason }
        : { error: String(err) };
  }
  lines.close();
  sqlite.close();
  process.stdout.write(`${JSON.stringify(answer)}\n`, () => process.exit(0));
});
