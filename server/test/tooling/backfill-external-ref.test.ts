import { describe, expect, it } from 'vitest';
import { backfill, planBackfill, type Card } from '../../scripts/backfill-external-ref.ts';

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

/** A board that serves one project's cards over two pages and takes PATCHes. */
function fakeBoard(cards: Card[]) {
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
      const page = cards.slice(from, from + 2);
      const next = from + 2 < cards.length ? String(from + 2) : null;
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

describe('a run', () => {
  const options = (fetcher: typeof fetch, lines: string[], apply: boolean) => ({
    url: 'http://board.test/',
    token: 'lai_BackfillTestTokenNeverPrinted',
    project: 'laika',
    apply,
    fetch: fetcher,
    print: (line: string) => lines.push(line),
  });

  it('is a dry run by default: it reads every page, prints what it would set, and writes nothing', async () => {
    const board = fakeBoard([
      card({ id: '1', title: 'LAI-1 · One' }),
      card({ id: '2', title: 'Two' }),
      card({ id: '3', title: 'LAI-3 · Three' }),
    ]);
    const lines: string[] = [];
    const result = await backfill(options(board.fetcher, lines, false));

    expect(result).toEqual({ planned: 2, written: 0, failed: 0 });
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
      failed: 1,
    });
    expect(lines.some((l) => l.startsWith('failed LAIKA-gone → LAI-1: 403'))).toBe(true);
  });
});
