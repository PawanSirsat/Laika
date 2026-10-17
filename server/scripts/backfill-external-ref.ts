/**
 * Give each card imported from the repo's task files its outside id (LAI-780).
 *
 * The `LAI-NNN · …` cards mirror `.tasks/` files, and every tool that takes a
 * task key takes a card's `external_ref` too — so once a card carries its
 * `LAI-NNN`, `get_task_context LAI-NNN`, `start_working {task: LAI-NNN}` and a
 * branch named `LAI-NNN-…` all find it. This sets `external_ref` from the
 * title, on one project, **only where it is empty**.
 *
 * Run by a person after the deploy, never by the server:
 *
 *     LAIKA_URL=https://board.example LAIKA_TOKEN=lai_… \
 *       pnpm --filter @laika/server exec tsx scripts/backfill-external-ref.ts \
 *       --project laika [--prefix LAI] [--per-second 2] [--apply]
 *
 * **A dry run unless `--apply`**: it prints what it would set and writes
 * nothing. Idempotent: a card that already carries its id is counted as done,
 * so a second run has nothing to do. It never writes over an `external_ref` a
 * card holds — a pull request's `owner/repo#N` included — and never writes one
 * id onto two cards: a title two cards share, or an id another card in the
 * project already holds, is skipped and said, and so is a card the board
 * refuses for that reason (`422` `taken`) because another took the id after
 * the listing. The token is read from the environment and never printed.
 *
 * **Paced, because the board rate-limits a token** (§6.3: 120 a minute, two a
 * second sustained): writes go two a second by default (`--per-second`), and
 * a `429` — a read's too — waits the `Retry-After` it names (a second when it
 * names none) and asks again, at most five times a card before it counts as
 * failed (review B1: 480 cards back to back lost 267 to `429`).
 */
import { fileURLToPath } from 'node:url';

/** What the script reads of a task. */
export interface Card {
  id: string;
  key: string;
  title: string;
  external_ref: string | null;
}

export interface Plan {
  /** The writes to make: each card's id and the outside id its title names. */
  set: { id: string; key: string; ref: string }[];
  /** Cards that already carry the id their title names. */
  done: number;
  /** Cards whose title names an id this will not write, and why. */
  skipped: { key: string; ref: string; reason: string }[];
}

/** `LAI-739 · Fix the board` → `LAI-739`. Case-insensitive, stored upper-case. */
const TITLE = /^([A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9})\s+·\s/u;

/** The writes that give each `PREFIX-NNN · …` card its id, and what is left alone. */
export function planBackfill(cards: readonly Card[], prefix = 'LAI'): Plan {
  const wanted = prefix.toUpperCase();
  const titled = new Map<Card, string>();
  const byTitle = new Map<string, number>();
  for (const c of cards) {
    const ref = TITLE.exec(c.title)?.[1]?.toUpperCase();
    if (ref === undefined) continue;
    if (ref.slice(0, ref.lastIndexOf('-')) !== wanted) continue;
    titled.set(c, ref);
    byTitle.set(ref, (byTitle.get(ref) ?? 0) + 1);
  }
  const holder = new Map<string, Card>();
  for (const c of cards) {
    if (c.external_ref !== null) holder.set(c.external_ref.toUpperCase(), c);
  }

  const plan: Plan = { set: [], done: 0, skipped: [] };
  for (const [c, ref] of titled) {
    if (c.external_ref !== null) {
      if (c.external_ref.toUpperCase() === ref) plan.done += 1;
      else plan.skipped.push({ key: c.key, ref, reason: `holds ${c.external_ref} already` });
      continue;
    }
    const shared = byTitle.get(ref) ?? 0;
    if (shared > 1) {
      plan.skipped.push({
        key: c.key,
        ref,
        reason: `${ref} is the title of ${String(shared)} cards`,
      });
      continue;
    }
    const other = holder.get(ref);
    if (other !== undefined) {
      plan.skipped.push({ key: c.key, ref, reason: `${other.key} holds ${ref} already` });
      continue;
    }
    plan.set.push({ id: c.id, key: c.key, ref });
  }
  return plan;
}

export interface BackfillOptions {
  /** The board, such as `https://board.example`. */
  url: string;
  /** A token of a person who may edit the project's tasks. Never printed. */
  token: string;
  /** The project's slug. */
  project: string;
  /** Write. Without it, nothing is written. */
  apply: boolean;
  prefix?: string;
  /** Writes a second; 2 by default, the board's sustained rate for a token. */
  writesPerSecond?: number;
  /** Retries of one request after a `429`, before it counts as failed; 5 by default. */
  retries?: number;
  fetch?: typeof fetch;
  print?: (line: string) => void;
  /** How to wait, in milliseconds — injected by the tests, which never wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface BackfillResult {
  /** Cards the plan would set. */
  planned: number;
  written: number;
  /** Cards left alone: the plan's skips, and any the board refused as taken. */
  skipped: number;
  /** Cards a write did not reach: refused, or still `429` after every retry. */
  failed: number;
}

const DEFAULT_PER_SECOND = 2;
const DEFAULT_RETRIES = 5;

/** `Retry-After` in milliseconds: its seconds, or one second when it names none. */
function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 1_000;
}

interface Asker {
  call: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  retries: number;
  print: (line: string) => void;
}

/**
 * One request, asked again after each `429` — once `Retry-After` has passed —
 * until the retries run out; the last answer is returned whatever it is.
 * `what` names the request in the line said for each wait.
 */
async function ask(asker: Asker, url: URL, init: RequestInit, what: string): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const res = await asker.call(url, init);
    if (res.status !== 429 || attempt > asker.retries) return res;
    const wait = retryAfterMs(res);
    asker.print(`429 on ${what}: waiting ${String(wait / 1_000)} s, retry ${String(attempt)}`);
    await asker.sleep(wait);
  }
}

function under(options: BackfillOptions, path: string): URL {
  return new URL(path, options.url.endsWith('/') ? options.url : `${options.url}/`);
}

/** Every card of the project, page by page (`GET /projects/:slug/tasks`). */
async function allCards(options: BackfillOptions, asker: Asker): Promise<Card[]> {
  const cards: Card[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = under(options, `api/v1/projects/${encodeURIComponent(options.project)}/tasks`);
    page.searchParams.set('limit', '200');
    if (cursor !== null) page.searchParams.set('cursor', cursor);
    const res = await ask(
      asker,
      page,
      { headers: { authorization: `Bearer ${options.token}` } },
      'reading the project',
    );
    if (!res.ok) throw new Error(`GET ${page.pathname}: ${String(res.status)}`);
    const body = (await res.json()) as { data: Card[]; next_cursor: string | null };
    cards.push(...body.data);
    if (body.next_cursor === null) return cards;
    cursor = body.next_cursor;
  }
}

/** The key of the card that holds the id, when the board refused a write as taken. */
async function takenBy(res: Response): Promise<string | undefined> {
  if (res.status !== 422) return undefined;
  try {
    const body = (await res.json()) as {
      error?: { details?: { reason?: unknown; task?: unknown } };
    };
    const details = body.error?.details;
    return details?.reason === 'taken' && typeof details.task === 'string'
      ? details.task
      : undefined;
  } catch {
    return undefined;
  }
}

/** Read the project, print the plan, and with `apply` make its writes, paced. */
export async function backfill(options: BackfillOptions): Promise<BackfillResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const asker: Asker = {
    call: options.fetch ?? fetch,
    sleep,
    retries: options.retries ?? DEFAULT_RETRIES,
    print,
  };
  const pace = 1_000 / (options.writesPerSecond ?? DEFAULT_PER_SECOND);
  const plan = planBackfill(await allCards(options, asker), options.prefix);

  for (const s of plan.skipped) print(`skip ${s.key} (${s.ref}): ${s.reason}`);
  let written = 0;
  let skipped = plan.skipped.length;
  let failed = 0;
  let first = true;
  for (const s of plan.set) {
    if (!options.apply) {
      print(`would set ${s.key} → ${s.ref}`);
      continue;
    }
    // The pace between writes, none before the first.
    if (!first) await sleep(pace);
    first = false;
    const res = await ask(
      asker,
      under(options, `api/v1/tasks/${encodeURIComponent(s.id)}`),
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ external_ref: s.ref }),
      },
      `${s.key} → ${s.ref}`,
    );
    if (res.ok) {
      written += 1;
      print(`set ${s.key} → ${s.ref}`);
      continue;
    }
    const holder = await takenBy(res.clone());
    if (holder !== undefined) {
      skipped += 1;
      print(`skip ${s.key} (${s.ref}): ${holder} holds ${s.ref} already`);
      continue;
    }
    failed += 1;
    print(`failed ${s.key} → ${s.ref}: ${String(res.status)} ${await res.text()}`);
  }
  print(
    `${options.apply ? '' : 'dry run — '}${String(plan.set.length)} to set, ${String(written)} set, ` +
      `${String(skipped)} skipped, ${String(failed)} failed, ${String(plan.done)} already carry theirs` +
      (options.apply ? '' : ' (add --apply to write)'),
  );
  return { planned: plan.set.length, written, skipped, failed };
}

function argument(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = process.env.LAIKA_URL;
  const token = process.env.LAIKA_TOKEN;
  const project = argument(args, '--project');
  if (
    url === undefined ||
    url === '' ||
    token === undefined ||
    token === '' ||
    project === undefined ||
    project === ''
  ) {
    console.error(
      'usage: LAIKA_URL=… LAIKA_TOKEN=… tsx scripts/backfill-external-ref.ts --project <slug> [--prefix LAI] [--per-second 2] [--apply]',
    );
    process.exitCode = 2;
    return;
  }
  const prefix = argument(args, '--prefix');
  const perSecond = argument(args, '--per-second');
  if (perSecond !== undefined && !(Number(perSecond) > 0)) {
    console.error('--per-second takes a number above 0');
    process.exitCode = 2;
    return;
  }
  const result = await backfill({
    url,
    token,
    project,
    apply: args.includes('--apply'),
    ...(prefix === undefined ? {} : { prefix }),
    ...(perSecond === undefined ? {} : { writesPerSecond: Number(perSecond) }),
  });
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
