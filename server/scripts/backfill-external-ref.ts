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
 *       --project laika [--prefix LAI] [--apply]
 *
 * **A dry run unless `--apply`**: it prints what it would set and writes
 * nothing. Idempotent: a card that already carries its id is counted as done,
 * so a second run has nothing to do. It never writes over an `external_ref` a
 * card holds — a pull request's `owner/repo#N` included — and never writes one
 * id onto two cards, which would make every lookup by it `422 ambiguous`: a
 * title two cards share, or an id another card already holds, is skipped and
 * said. The token is read from the environment and never printed.
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
  fetch?: typeof fetch;
  print?: (line: string) => void;
}

/** Every card of the project, page by page (`GET /projects/:slug/tasks`). */
async function allCards(options: BackfillOptions, call: typeof fetch): Promise<Card[]> {
  const cards: Card[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = new URL(
      `api/v1/projects/${encodeURIComponent(options.project)}/tasks`,
      options.url.endsWith('/') ? options.url : `${options.url}/`,
    );
    page.searchParams.set('limit', '200');
    if (cursor !== null) page.searchParams.set('cursor', cursor);
    const res = await call(page, { headers: { authorization: `Bearer ${options.token}` } });
    if (!res.ok) throw new Error(`GET ${page.pathname}: ${String(res.status)}`);
    const body = (await res.json()) as { data: Card[]; next_cursor: string | null };
    cards.push(...body.data);
    if (body.next_cursor === null) return cards;
    cursor = body.next_cursor;
  }
}

/** Read the project, print the plan, and with `apply` make its writes. */
export async function backfill(
  options: BackfillOptions,
): Promise<{ planned: number; written: number; failed: number }> {
  const call = options.fetch ?? fetch;
  const print = options.print ?? ((line: string) => console.log(line));
  const plan = planBackfill(await allCards(options, call), options.prefix);

  for (const s of plan.skipped) print(`skip ${s.key} (${s.ref}): ${s.reason}`);
  let written = 0;
  let failed = 0;
  for (const s of plan.set) {
    if (!options.apply) {
      print(`would set ${s.key} → ${s.ref}`);
      continue;
    }
    const target = new URL(
      `api/v1/tasks/${encodeURIComponent(s.id)}`,
      options.url.endsWith('/') ? options.url : `${options.url}/`,
    );
    const res = await call(target, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ external_ref: s.ref }),
    });
    if (res.ok) {
      written += 1;
      print(`set ${s.key} → ${s.ref}`);
    } else {
      failed += 1;
      print(`failed ${s.key} → ${s.ref}: ${String(res.status)} ${await res.text()}`);
    }
  }
  print(
    `${options.apply ? '' : 'dry run — '}${String(plan.set.length)} to set, ${String(written)} set, ` +
      `${String(failed)} failed, ${String(plan.done)} already carry theirs, ${String(plan.skipped.length)} skipped` +
      (options.apply ? '' : ' (add --apply to write)'),
  );
  return { planned: plan.set.length, written, failed };
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
      'usage: LAIKA_URL=… LAIKA_TOKEN=… tsx scripts/backfill-external-ref.ts --project <slug> [--prefix LAI] [--apply]',
    );
    process.exitCode = 2;
    return;
  }
  const prefix = argument(args, '--prefix');
  const result = await backfill({
    url,
    token,
    project,
    apply: args.includes('--apply'),
    ...(prefix === undefined ? {} : { prefix }),
  });
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
