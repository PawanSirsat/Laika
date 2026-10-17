import { describe, expect, it } from 'vitest';
import { backfill, planBackfill, type Card } from '../../scripts/backfill-external-ref.ts';
import { LIMITS, RateLimiter } from '../../src/http/rate-limit.ts';

/**
 * `scripts/backfill-external-ref.ts` (LAI-780): the cards imported from the
 * repo's task files are titled `LAI-NNN · …`, and this gives each the
 * `external_ref` its title names, so `get_task_context LAI-NNN` finds it.
 *
 * Run by a person after the deploy, never by the server. What it must never
 * do: write over an `external_ref` a card already holds, write one id onto
 * two cards (every lookup by it would then be refused as ambiguous), or
 * write anything at all without `--apply`.
 */

const card = (over: Partial<Card> & { id: string }): Card => ({
  key: `LAIKA-${over.id}`,
  title: 'Untitled',
  external_ref: null,
  ...over,
});

describe('the plan', () => {
  it('sets the repo id a title names, only where external_ref is empty', () => {
    const plan = planBackfill([
      card({ id: '1', title: 'LAI-739 · Fix the board' }),
      card({ id: '2', title: 'LAI-740 · Already done', external_ref: 'LAI-740' }),
      card({ id: '3', title: 'LAI-741 · Merged', external_ref: 'kvell/laika#12' }),
      card({ id: '4', title: 'A card of its own' }),
      card({ id: '5', title: 'LAIKA-9 · Not the repo’s prefix' }),
      card({ id: '6', title: 'lai-742 · lower case' }),
    ]);
    expect(plan.set).toEqual([
      { id: '1', key: 'LAIKA-1', ref: 'LAI-739' },
      { id: '6', key: 'LAIKA-6', ref: 'LAI-742' },
    ]);
    expect(plan.done).toBe(1);
    expect(plan.skipped).toEqual([
      { key: 'LAIKA-3', ref: 'LAI-741', reason: 'holds kvell/laika#12 already' },
    ]);
  });

  it('never writes one id onto two cards: a title two cards share, or an id another card holds', () => {
    const plan = planBackfill([
      card({ id: '1', title: 'LAI-100 · Imported' }),
      card({ id: '2', title: 'LAI-100 · Imported again' }),
      card({ id: '3', title: 'LAI-200 · Free' }),
      card({ id: '4', title: 'Someone tagged it by hand', external_ref: 'LAI-200' }),
    ]);
    expect(plan.set).toEqual([]);
    expect(plan.skipped).toEqual([
      { key: 'LAIKA-1', ref: 'LAI-100', reason: 'LAI-100 is the title of 2 cards' },
      { key: 'LAIKA-2', ref: 'LAI-100', reason: 'LAI-100 is the title of 2 cards' },
      { key: 'LAIKA-3', ref: 'LAI-200', reason: 'LAIKA-4 holds LAI-200 already' },
    ]);
  });

  it('takes another prefix when asked', () => {
    expect(planBackfill([card({ id: '1', title: 'ONR-5 · Theirs' })], 'ONR').set).toEqual([
      { id: '1', key: 'LAIKA-1', ref: 'ONR-5' },
    ]);
  });
});

const hrefOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** A board that serves one project's cards, `pageSize` a page, and takes PATCHes. */
function fakeBoard(cards: Card[], pageSize = 2) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(hrefOf(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({
      method,
      url: url.pathname + url.search,
      body,
      auth: headers.get('authorization'),
    });
    if (method === 'GET' && url.pathname === '/api/v1/projects/laika/tasks') {
      const from = Number(url.searchParams.get('cursor') ?? '0');
      const page = cards.slice(from, from + pageSize);
      const next = from + pageSize < cards.length ? String(from + pageSize) : null;
      return Promise.resolve(Response.json({ data: page, next_cursor: next }));
    }
    const patched = /^\/api\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
    if (method === 'PATCH' && patched !== null) {
      const target = cards.find((c) => c.id === patched[1]);
      if (target === undefined) return Promise.resolve(new Response('{}', { status: 404 }));
      target.external_ref = (body as { external_ref: string }).external_ref;
      return Promise.resolve(Response.json(target));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  };
  return { calls, fetcher };
}

/**
 * Every run gets a sleep that only records what it was asked for: pacing and
 * `Retry-After` are asserted by count and length, and nothing here waits.
 */
const options = (
  fetcher: typeof fetch,
  lines: string[],
  apply: boolean,
  sleeps: number[] = [],
  extra: Record<string, unknown> = {},
) => ({
  url: 'http://board.test/',
  token: 'lai_BackfillTestTokenNeverPrinted',
  project: 'laika',
  apply,
  fetch: fetcher,
  print: (line: string) => lines.push(line),
  sleep: (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  },
  ...extra,
});

describe('a run', () => {
  it('is a dry run by default: it reads every page, prints what it would set, and writes nothing', async () => {
    const board = fakeBoard([
      card({ id: '1', title: 'LAI-1 · One' }),
      card({ id: '2', title: 'Two' }),
      card({ id: '3', title: 'LAI-3 · Three' }),
    ]);
    const lines: string[] = [];
    const result = await backfill(options(board.fetcher, lines, false));

    expect(result).toEqual({ planned: 2, written: 0, skipped: 0, failed: 0 });
    expect(board.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(board.calls.map((c) => c.url)).toEqual([
      '/api/v1/projects/laika/tasks?limit=200',
      '/api/v1/projects/laika/tasks?limit=200&cursor=2',
    ]);
    expect(board.calls.every((c) => c.auth === 'Bearer lai_BackfillTestTokenNeverPrinted')).toBe(
      true,
    );
    expect(lines).toContain('would set LAIKA-1 → LAI-1');
    expect(lines).toContain('would set LAIKA-3 → LAI-3');
    expect(lines.join('\n')).not.toContain('lai_BackfillTestTokenNeverPrinted');
  });

  it('with apply, PATCHes external_ref alone on each card; run again, it has nothing to do', async () => {
    const board = fakeBoard([
      card({ id: '1', title: 'LAI-1 · One' }),
      card({ id: '3', title: 'LAI-3 · Three' }),
    ]);
    const lines: string[] = [];
    expect(await backfill(options(board.fetcher, lines, true))).toEqual({
      planned: 2,
      written: 2,
      skipped: 0,
      failed: 0,
    });
    expect(board.calls.filter((c) => c.method === 'PATCH')).toEqual([
      expect.objectContaining({ url: '/api/v1/tasks/1', body: { external_ref: 'LAI-1' } }),
      expect.objectContaining({ url: '/api/v1/tasks/3', body: { external_ref: 'LAI-3' } }),
    ]);

    const again = fakeBoard([
      card({ id: '1', title: 'LAI-1 · One', external_ref: 'LAI-1' }),
      card({ id: '3', title: 'LAI-3 · Three', external_ref: 'LAI-3' }),
    ]);
    expect(await backfill(options(again.fetcher, [], true))).toEqual({
      planned: 0,
      written: 0,
      skipped: 0,
      failed: 0,
    });
    expect(again.calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('counts a refused write as failed and carries on', async () => {
    const board = fakeBoard([
      card({ id: 'gone', title: 'LAI-1 · One' }),
      card({ id: '3', title: 'LAI-3 · Three' }),
    ]);
    const fetcher: typeof fetch = (input, init) =>
      hrefOf(input).endsWith('/tasks/gone')
        ? Promise.resolve(new Response('{"error":{"code":"forbidden"}}', { status: 403 }))
        : board.fetcher(input, init);
    const lines: string[] = [];
    expect(await backfill(options(fetcher, lines, true))).toEqual({
      planned: 2,
      written: 1,
      skipped: 0,
      failed: 1,
    });
    expect(lines.some((l) => l.startsWith('failed LAIKA-gone → LAI-1: 403'))).toBe(true);
  });
});

/** A 429 as the board's rate limiter answers it (§6.3): `Retry-After` in seconds. */
const tooMany = (seconds: string | null) =>
  new Response('{"error":{"code":"rate_limited","message":"Too many requests"}}', {
    status: 429,
    headers: seconds === null ? {} : { 'retry-after': seconds },
  });

describe('a run the board rate-limits (review B1)', () => {
  const four = () =>
    fakeBoard([
      card({ id: '1', title: 'LAI-1 · One' }),
      card({ id: '2', title: 'LAI-2 · Two' }),
      card({ id: '3', title: 'LAI-3 · Three' }),
      card({ id: '4', title: 'LAI-4 · Four' }),
    ]);
  const patches = (calls: { method: string; url: string }[]) =>
    calls.filter((c) => c.method === 'PATCH').map((c) => c.url);

  it('paces its writes, two a second by default: a sleep of 500 ms between each, none before the first', async () => {
    const board = four();
    const sleeps: number[] = [];
    await backfill(options(board.fetcher, [], true, sleeps));
    expect(patches(board.calls)).toHaveLength(4);
    expect(sleeps).toEqual([500, 500, 500]);
  });

  it('takes another pace when asked, and a dry run sleeps not at all', async () => {
    const paced: number[] = [];
    await backfill(options(four().fetcher, [], true, paced, { writesPerSecond: 4 }));
    expect(paced).toEqual([250, 250, 250]);

    const dry: number[] = [];
    await backfill(options(four().fetcher, [], false, dry));
    expect(dry).toEqual([]);
  });

  it('on a 429 waits Retry-After seconds and writes the same card again: everything planned is written', async () => {
    const board = four();
    let refused = 0;
    const fetcher: typeof fetch = (input, init) => {
      if (init?.method === 'PATCH' && hrefOf(input).endsWith('/tasks/2') && refused === 0) {
        refused += 1;
        return Promise.resolve(tooMany('1'));
      }
      return board.fetcher(input, init);
    };
    const sleeps: number[] = [];
    const lines: string[] = [];
    const result = await backfill(options(fetcher, lines, true, sleeps));

    expect(result).toEqual({ planned: 4, written: 4, skipped: 0, failed: 0 });
    expect(result.written).toBe(result.planned);
    // The board saw each card once; the refused attempt at card 2 never
    // reached it, and `refused` counts that one.
    expect(patches(board.calls)).toEqual([
      '/api/v1/tasks/1',
      '/api/v1/tasks/2',
      '/api/v1/tasks/3',
      '/api/v1/tasks/4',
    ]);
    expect(refused).toBe(1);
    // The pace between cards, and Retry-After's second before the retry.
    expect(sleeps).toEqual([500, 1_000, 500, 500]);
    expect(lines.some((l) => l.includes('429') && l.includes('LAIKA-2'))).toBe(true);
  });

  it('gives a card up after 5 retries, counts it failed, and carries on with the next', async () => {
    const board = four();
    let asked = 0;
    const fetcher: typeof fetch = (input, init) => {
      if (init?.method === 'PATCH' && hrefOf(input).endsWith('/tasks/1')) {
        asked += 1;
        return Promise.resolve(tooMany('3'));
      }
      return board.fetcher(input, init);
    };
    const lines: string[] = [];
    const result = await backfill(options(fetcher, lines, true));
    expect(asked).toBe(6);
    expect(result).toEqual({ planned: 4, written: 3, skipped: 0, failed: 1 });
    expect(lines.some((l) => l.startsWith('failed LAIKA-1 → LAI-1: 429'))).toBe(true);
  });

  it('a 429 without Retry-After waits a second, never nothing', async () => {
    const board = four();
    let refused = false;
    const fetcher: typeof fetch = (input, init) => {
      if (init?.method === 'PATCH' && !refused) {
        refused = true;
        return Promise.resolve(tooMany(null));
      }
      return board.fetcher(input, init);
    };
    const sleeps: number[] = [];
    expect((await backfill(options(fetcher, [], true, sleeps))).failed).toBe(0);
    expect(sleeps[0]).toBe(1_000);
  });

  it('reading the project waits out a 429 too', async () => {
    const board = four();
    let refused = false;
    const fetcher: typeof fetch = (input, init) => {
      if ((init?.method ?? 'GET') === 'GET' && !refused) {
        refused = true;
        return Promise.resolve(tooMany('2'));
      }
      return board.fetcher(input, init);
    };
    const sleeps: number[] = [];
    expect(await backfill(options(fetcher, [], false, sleeps))).toEqual({
      planned: 4,
      written: 0,
      skipped: 0,
      failed: 0,
    });
    expect(sleeps).toEqual([2_000]);
  });
});

describe('a card another card in the project already names (review: per-project uniqueness)', () => {
  it('is skipped and said when the board refuses it as taken — not counted as failed', async () => {
    const board = fakeBoard([
      card({ id: '1', title: 'LAI-1 · One' }),
      card({ id: '2', title: 'LAI-2 · Two' }),
    ]);
    // The listing showed no holder; another card took LAI-1 before the write.
    const fetcher: typeof fetch = (input, init) =>
      init?.method === 'PATCH' && hrefOf(input).endsWith('/tasks/1')
        ? Promise.resolve(
            Response.json(
              {
                error: {
                  code: 'unprocessable',
                  message: 'LAI-1 is already the outside id of LAIKA-9 in this project',
                  details: {
                    field: 'external_ref',
                    reason: 'taken',
                    external_ref: 'LAI-1',
                    task: 'LAIKA-9',
                  },
                },
              },
              { status: 422 },
            ),
          )
        : board.fetcher(input, init);
    const lines: string[] = [];
    expect(await backfill(options(fetcher, lines, true))).toEqual({
      planned: 2,
      written: 1,
      skipped: 1,
      failed: 0,
    });
    expect(lines).toContain('skip LAIKA-1 (LAI-1): LAIKA-9 holds LAI-1 already');
  });

  it('counts the plan’s own skips in skipped', async () => {
    const board = fakeBoard([
      card({ id: '1', title: 'LAI-1 · One' }),
      card({ id: '2', title: 'Held', external_ref: 'LAI-1' }),
      card({ id: '3', title: 'LAI-3 · Three' }),
    ]);
    expect(await backfill(options(board.fetcher, [], true))).toEqual({
      planned: 1,
      written: 1,
      skipped: 1,
      failed: 0,
    });
  });
});

describe('the reviewer’s 480 cards, against the board’s own rate limiter (review B1)', () => {
  /**
   * The real `RateLimiter` under a token's policy, on a clock that moves only
   * when the script sleeps or a request takes its 100 ms — the reviewer's
   * measurement, with no real time passing.
   */
  function limitedBoard(count: number) {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const board = fakeBoard(
      Array.from({ length: count }, (_, i) =>
        card({ id: String(i + 1), title: `LAI-${String(i + 1)} · Card` }),
      ),
      200,
    );
    let refusals = 0;
    const fetcher: typeof fetch = (input, init) => {
      now += 100;
      const decision = limiter.take('tok', LIMITS.token);
      if (!decision.allowed) {
        refusals += 1;
        return Promise.resolve(tooMany(String(decision.retryAfterSeconds)));
      }
      return board.fetcher(input, init);
    };
    const sleep = (ms: number) => {
      now += ms;
      return Promise.resolve();
    };
    return { fetcher, sleep, refusals: () => refusals };
  }

  it('writes every one, none failed, at the default pace', async () => {
    const run = limitedBoard(480);
    const result = await backfill({
      ...options(run.fetcher, [], true),
      sleep: run.sleep,
    });
    expect(result).toEqual({ planned: 480, written: 480, skipped: 0, failed: 0 });
  });

  it('control: unpaced and never retried, the same board refuses most of them', async () => {
    const run = limitedBoard(480);
    const result = await backfill({
      ...options(run.fetcher, [], true),
      sleep: run.sleep,
      writesPerSecond: Number.POSITIVE_INFINITY,
      retries: 0,
    });
    expect(result.failed).toBeGreaterThan(200);
    expect(result.written + result.failed).toBe(480);
    expect(run.refusals()).toBe(result.failed);
  });
});
