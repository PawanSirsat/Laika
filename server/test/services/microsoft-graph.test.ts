/**
 * The Graph client the directory and meetings syncs share (LAI-1311): one
 * token per run, paging only on Graph's origin, a timeout on every request,
 * one bounded retry after `429`/`503`, and failures said as codes.
 */
import { describe, expect, it } from 'vitest';
import {
  GRAPH,
  GRAPH_RETRY_AFTER_MAX_MS,
  GraphError,
  graphClient,
  graphUrl,
} from '../../src/services/microsoft-graph.ts';
import { MEETINGS_SSO as SSO } from '../helpers/fake-graph.ts';

const FORBIDDEN = { forbidden: 'graph_forbidden_grant_calendars_read' };

/** A fetch answering the token, then `answer` for everything else; records URLs. */
function graph(answer: (url: string, n: number) => Response | Promise<Response>) {
  const calls: string[] = [];
  let n = 0;
  const fetchImpl = ((input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/oauth2/v2.0/token')) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: 't' }), { status: 200 }));
    }
    return Promise.resolve(answer(url, n++));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GraphError);
    return (err as GraphError).code;
  }
  throw new Error('expected a GraphError');
}

describe('the Graph client', () => {
  it('asks for one token and sends it on every request', async () => {
    const { fetchImpl, calls } = graph(() => new Response('{"value":[]}', { status: 200 }));
    const seen: string[] = [];
    const recording = ((input: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (!String(input).includes('/token')) seen.push(headers.Authorization ?? '');
      return fetchImpl(input, init);
    }) as typeof fetch;
    const client = await graphClient(SSO, { fetch: recording });
    await client.list('/users/a@x.test/calendarView', FORBIDDEN);
    await client.get('/users/a@x.test', FORBIDDEN);
    expect(calls.filter((u) => u.includes('/token'))).toHaveLength(1);
    expect(seen).toEqual(['Bearer t', 'Bearer t']);
  });

  it('follows nextLink on Graph’s origin, and stops at one anywhere else', async () => {
    const { fetchImpl, calls } = graph((_url, n) => {
      const pages = [
        { value: [1], '@odata.nextLink': `${GRAPH}/users?$skiptoken=2` },
        // A link off Graph's origin would carry the token away: not followed.
        { value: [2], '@odata.nextLink': 'https://evil.example/steal' },
      ];
      return new Response(JSON.stringify(pages[n]), { status: 200 });
    });
    const client = await graphClient(SSO, { fetch: fetchImpl });
    expect(await client.list('/users', FORBIDDEN)).toEqual([1, 2]);
    expect(calls.some((u) => u.includes('evil.example'))).toBe(false);
  });

  it('a 403 is the grant the operator must give; another failure is its status', async () => {
    const forbidden = graph(
      () => new Response('{"error":{"message":"secret text"}}', { status: 403 }),
    );
    const c1 = await graphClient(SSO, { fetch: forbidden.fetchImpl });
    expect(await codeOf(c1.get('/users/x', FORBIDDEN))).toBe(
      'graph_forbidden_grant_calendars_read',
    );

    const broken = graph(() => new Response('{}', { status: 500 }));
    const c2 = await graphClient(SSO, { fetch: broken.fetchImpl });
    const err = await c2.get('/users/x', FORBIDDEN).catch((e: unknown) => e);
    expect((err as GraphError).code).toBe('graph_500');
    // Graph's own words never reach the message.
    expect((err as Error).message).toBe('microsoft graph: graph_500');
  });

  it('a 404 is “not there”, not a failure', async () => {
    const { fetchImpl } = graph(() => new Response('{}', { status: 404 }));
    const client = await graphClient(SSO, { fetch: fetchImpl });
    expect(await client.get('/users/nobody', FORBIDDEN)).toBeNull();
    expect(await client.list('/users/nobody/calendarView', FORBIDDEN)).toEqual([]);
    expect(await client.text('/x/content', FORBIDDEN)).toBeNull();
  });

  it('waits out one 429 for its Retry-After, then answers', async () => {
    const waits: number[] = [];
    const { fetchImpl, calls } = graph((_url, n) =>
      n === 0
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '3' } })
        : new Response('{"value":[7]}', { status: 200 }),
    );
    const client = await graphClient(SSO, {
      fetch: fetchImpl,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(await client.list('/users', FORBIDDEN)).toEqual([7]);
    expect(waits).toEqual([3000]);
    expect(calls.filter((u) => !u.includes('/token'))).toHaveLength(2);
  });

  it('gives up on a Retry-After longer than it waits, and on a second 429', async () => {
    const tooLong = graph(
      () =>
        new Response('{}', {
          status: 429,
          headers: { 'Retry-After': String(GRAPH_RETRY_AFTER_MAX_MS / 1000 + 1) },
        }),
    );
    const c1 = await graphClient(SSO, { fetch: tooLong.fetchImpl, sleep: () => Promise.resolve() });
    expect(await codeOf(c1.get('/users', FORBIDDEN))).toBe('graph_throttled');
    expect(tooLong.calls.filter((u) => !u.includes('/token'))).toHaveLength(1);

    const twice = graph(() => new Response('{}', { status: 503 }));
    const c2 = await graphClient(SSO, { fetch: twice.fetchImpl, sleep: () => Promise.resolve() });
    expect(await codeOf(c2.get('/users', FORBIDDEN))).toBe('graph_throttled');
    expect(twice.calls.filter((u) => !u.includes('/token'))).toHaveLength(2);
  });

  it('times out a Graph that never answers, as a code', async () => {
    const hanging = ((input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/token')) {
        return Promise.resolve(new Response('{"access_token":"t"}', { status: 200 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;
    const client = await graphClient(SSO, { fetch: hanging, timeoutMs: 20 });
    expect(await codeOf(client.get('/users', FORBIDDEN))).toBe('graph_timeout');
  });

  it('a refused or unreachable token endpoint is a code, never the secret', async () => {
    const refused = (() =>
      Promise.resolve(new Response('{"error":"invalid_client"}', { status: 401 }))) as typeof fetch;
    const err = await graphClient(SSO, { fetch: refused }).catch((e: unknown) => e);
    expect((err as GraphError).code).toBe('token_401');
    expect((err as Error).message).not.toContain(SSO.clientSecret);

    const down = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    expect(await codeOf(graphClient(SSO, { fetch: down }))).toBe('token_unreachable');
  });

  it('never sends the token off Graph’s origin', () => {
    expect(graphUrl('/users')).toBe(`${GRAPH}/users`);
    expect(graphUrl(`${GRAPH}/users?x=1`)).toBe(`${GRAPH}/users?x=1`);
    expect(() => graphUrl('https://evil.example/users')).toThrow('graph_bad_url');
  });
});
