import { createServer, type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BREVO_API_ORIGIN,
  BrevoFetchError,
  fetchInboundAttachment,
} from '../../src/services/brevo-inbound.ts';

/**
 * Brevo's attachment fetch (D-155, LAI-1315), against a fake `fetch` or a
 * local server — **no test calls Brevo**. What matters: the key goes to
 * Brevo's one origin and nowhere else, the read stops at the board's limit,
 * and Brevo's own words never come back.
 */

const KEY = 'xkeysib-fixture-never-real';

interface Seen {
  url: string;
  headers: Headers;
  redirect: RequestInit['redirect'];
}

function fakeBrevo(answer: (url: string) => Response | 'hang' | 'refuse'): {
  fetchImpl: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  return {
    seen,
    fetchImpl: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
      const a = answer(url);
      if (a === 'refuse') return Promise.reject(new TypeError('fetch failed'));
      if (a === 'hang') {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      return Promise.resolve(a);
    },
  };
}

describe('fetchInboundAttachment', () => {
  it('asks Brevo’s one origin, with the key in api-key, the token encoded, no redirects, nothing compressed', async () => {
    const brevo = fakeBrevo(() => new Response('hello'));
    const got = await fetchInboundAttachment(KEY, 'eyJ0.eyJ1.c2ln=', 100, brevo);
    expect(got).toEqual({ kind: 'bytes', bytes: new TextEncoder().encode('hello') });
    expect(brevo.seen).toHaveLength(1);
    const [only] = brevo.seen;
    expect(only?.url).toBe(`${BREVO_API_ORIGIN}/v3/inbound/attachments/eyJ0.eyJ1.c2ln%3D`);
    expect(new URL(only!.url).origin).toBe('https://api.brevo.com');
    expect(only?.headers.get('api-key')).toBe(KEY);
    expect(only?.headers.get('accept-encoding')).toBe('identity');
    expect(only?.redirect).toBe('error');
  });

  it('sends the key with no token that is not one path segment — asked again here, not only by the parser', async () => {
    const brevo = fakeBrevo(() => new Response('hello'));
    for (const token of ['..', '.', 'tok/../evil?x=1', '%2e%2e', '']) {
      await expect(fetchInboundAttachment(KEY, token, 100, brevo)).rejects.toMatchObject({
        why: 'not a download token',
        status: null,
      });
    }
    expect(brevo.seen).toHaveLength(0);
  });

  it('stops reading at the board’s limit: one byte over is too_large', async () => {
    const ten = new Uint8Array(10).fill(7);
    expect(
      await fetchInboundAttachment(
        KEY,
        't',
        10,
        fakeBrevo(() => new Response(ten)),
      ),
    ).toEqual({
      kind: 'bytes',
      bytes: ten,
    });
    expect(
      await fetchInboundAttachment(
        KEY,
        't',
        9,
        fakeBrevo(() => new Response(ten)),
      ),
    ).toEqual({
      kind: 'too_large',
    });
  });

  it('refuses a declared length over the limit before reading a byte (F2)', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(10));
        },
      },
      // No read on construction: a pull here is one the fetch asked for.
      { highWaterMark: 0 },
    );
    const got = await fetchInboundAttachment(
      KEY,
      't',
      100,
      fakeBrevo(() => new Response(body, { headers: { 'content-length': '101' } })),
    );
    expect(got).toEqual({ kind: 'too_large' });
    expect(pulls).toBe(0);
  });

  it('reads a body whole into one buffer: grown past its first size, or sized as declared', async () => {
    const chunk = new Uint8Array(50_000).map((_, i) => i % 251);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i += 1) controller.enqueue(chunk.slice());
        controller.close();
      },
    });
    const grown = await fetchInboundAttachment(
      KEY,
      't',
      1_000_000,
      fakeBrevo(() => new Response(body)),
    );
    expect(grown.kind === 'bytes' && Buffer.from(grown.bytes)).toEqual(
      Buffer.concat([chunk, chunk, chunk]),
    );

    const declared = await fetchInboundAttachment(
      KEY,
      't',
      1_000_000,
      fakeBrevo(() => new Response(chunk, { headers: { 'content-length': '50000' } })),
    );
    expect(declared.kind === 'bytes' && Buffer.from(declared.bytes)).toEqual(Buffer.from(chunk));
  });

  it('a body longer than it declared is a refusal, not a file', async () => {
    await expect(
      fetchInboundAttachment(
        KEY,
        't',
        100,
        fakeBrevo(() => new Response(new Uint8Array(20), { headers: { 'content-length': '10' } })),
      ),
    ).rejects.toMatchObject({ why: 'sent more than it declared' });
  });

  it('a compressed body is read by what arrives, never its compressed length; a gzip bomb stops at the limit', async () => {
    // A real server and Node's real `fetch`, which inflates a gzip body and
    // keeps the compressed `Content-Length` — the case a fake cannot show.
    // The server compresses whatever it is asked for, as a server may.
    const plain = Buffer.from('id,name,notes\n1,Ada,first\n'.repeat(20_000));
    const bomb = Buffer.alloc(8 * 1024 * 1024);
    let asked: IncomingHttpHeaders = {};
    const server = createServer((req, res) => {
      asked = req.headers;
      const body = gzipSync(req.url?.endsWith('/bomb') === true ? bomb : plain);
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(body.length) });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const viaLocal: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return fetch(url.replace(BREVO_API_ORIGIN, local), init);
    };
    try {
      const got = await fetchInboundAttachment(KEY, 'csv', 1_000_000, { fetchImpl: viaLocal });
      expect(asked['accept-encoding']).toBe('identity');
      expect(got.kind === 'bytes' && Buffer.from(got.bytes).equals(plain)).toBe(true);

      expect(
        await fetchInboundAttachment(KEY, 'bomb', 1024 * 1024, { fetchImpl: viaLocal }),
      ).toEqual({ kind: 'too_large' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('refuses with Brevo’s status and never its words', async () => {
    const brevo = fakeBrevo(
      () =>
        new Response('{"code":"document_not_found","message":"BREVO-SECRET-WORDS"}', {
          status: 404,
        }),
    );
    const err = await fetchInboundAttachment(KEY, 't', 100, brevo).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrevoFetchError);
    expect(err).toMatchObject({ status: 404, why: 'answered 404' });
    expect(String((err as Error).message)).not.toContain('BREVO-SECRET-WORDS');
  });

  it('says could not connect, or timed out, and nothing else', async () => {
    await expect(
      fetchInboundAttachment(
        KEY,
        't',
        100,
        fakeBrevo(() => 'refuse'),
      ),
    ).rejects.toMatchObject({ why: 'could not connect', status: null });
    await expect(
      fetchInboundAttachment(KEY, 't', 100, { ...fakeBrevo(() => 'hang'), timeoutMs: 20 }),
    ).rejects.toMatchObject({ why: 'timed out', status: null });
  });
});
