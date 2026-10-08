import { gunzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiCompression } from '../../../src/http/middleware/compression.ts';
import { COMPRESS_MIN_BYTES } from '../../../src/http/static-cache.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * gzip for API JSON (LAI-722), through the real app.
 *
 * A task page of 200 is about 550 KB of JSON and went out raw over a 215 ms
 * round trip. What must **not** be compressed matters as much as what must:
 * the SSE stream (a gzip stream buffers frames until a block fills, so a live
 * board would go quiet) and `/mcp`, whose transport is the SDK's to shape.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

beforeEach(async () => {
  h = authHarness();
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status).toBe(201);
  cookie = cookieFrom(setup);

  for (let i = 0; i < 12; i++) {
    const res = await h.app.request('/api/v1/projects/laika/tasks', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ title: `Task ${String(i)}`, description_md: 'words '.repeat(60) }),
    });
    expect(res.status).toBe(201);
  }
});
afterEach(() => {
  h.close();
});

async function get(path: string, acceptEncoding?: string): Promise<Response> {
  return await h.app.request(path, {
    headers: jsonHeaders({
      Cookie: cookie,
      ...(acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding }),
    }),
  });
}

describe('API JSON is gzipped above the threshold', () => {
  it('compresses a task page and the bytes decode to the same JSON', async () => {
    const plain = await get('/api/v1/projects/laika/tasks?limit=200');
    const plainText = await plain.text();
    const gz = await get('/api/v1/projects/laika/tasks?limit=200', 'br, gzip');

    expect(plainText.length).toBeGreaterThan(COMPRESS_MIN_BYTES);
    expect(gz.status).toBe(200);
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(gz.headers.get('vary')).toMatch(/\bAccept-Encoding\b/);

    const bytes = Buffer.from(await gz.arrayBuffer());
    expect(bytes.length).toBeLessThan(plainText.length);
    expect(gunzipSync(bytes).toString()).toBe(plainText);
  });

  it('sends identity to a client that does not accept gzip', async () => {
    const res = await get('/api/v1/projects/laika/tasks?limit=200', 'identity');

    expect(res.headers.get('content-encoding')).toBeNull();
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(12);
  });

  it('leaves a response under the threshold alone, and says how long it is', async () => {
    const res = await get('/api/v1/health', 'gzip');
    const text = await res.text();

    expect(text.length).toBeLessThan(COMPRESS_MIN_BYTES);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
  });

  it('does not compress HEAD', async () => {
    const res = await h.app.request('/api/v1/projects/laika/tasks?limit=200', {
      method: 'HEAD',
      headers: jsonHeaders({ Cookie: cookie, 'Accept-Encoding': 'gzip' }),
    });

    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('keeps Set-Cookie intact on a compressed auth response', async () => {
    // Sign-in answers through better-auth; a cookie lost or doubled on the way
    // through the compressor would sign nobody in.
    const res = await h.app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders({ 'Accept-Encoding': 'gzip' }),
      body: JSON.stringify({ email: 'ada@example.test', password: PASSWORD }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(new Set(res.headers.getSetCookie()).size).toBe(res.headers.getSetCookie().length);
  });
});

describe('what is never compressed', () => {
  it('the SSE stream: frames arrive as plain text', async () => {
    const res = await get('/api/v1/events', 'br, gzip');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('content-encoding')).toBeNull();

    const reader: ReadableStreamDefaultReader<Uint8Array> = res.body!.getReader();
    const first = await reader.read();
    await reader.cancel();

    // A gzip stream starts 0x1f 0x8b; an SSE frame starts with a field name.
    expect(new TextDecoder().decode(first.value)).toMatch(/^(retry|event|id|data|:)/);
  });

  it('/mcp: a large JSON-RPC answer goes out as the transport wrote it', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'agent', scope: 'full' }),
    });
    expect(minted.status).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    const res = await h.app.request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Accept-Encoding': 'gzip',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const text = await res.text();

    expect(res.status, text).toBe(200);
    // Big enough that the threshold is not why it went out plain.
    expect(text.length).toBeGreaterThan(COMPRESS_MIN_BYTES);
    expect(text).toContain('"tools"');
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('a response that already carries an encoding', async () => {
    // The static handler precompresses its own files; nothing may wrap an
    // encoded body a second time. Mounted bare, so the route is the only
    // thing that could have set the header.
    const encoded = new Uint8Array(4096).fill(7);
    const app = new Hono();
    app.use('*', apiCompression());
    app.get('/api/v1/already', (c) =>
      c.body(encoded, 200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br' }),
    );

    const res = await app.request('/api/v1/already', { headers: { 'Accept-Encoding': 'gzip' } });

    expect(res.headers.get('content-encoding')).toBe('br');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(encoded);
  });

  it('anything outside /api/, even JSON', async () => {
    const big = JSON.stringify({ rows: 'x'.repeat(4096) });
    const app = new Hono();
    app.use('*', apiCompression());
    app.get('/mcp', (c) => c.body(big, 200, { 'Content-Type': 'application/json' }));

    const res = await app.request('/mcp', { headers: { 'Accept-Encoding': 'gzip' } });

    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(big);
  });
});
