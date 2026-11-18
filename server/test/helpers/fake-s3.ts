import { type AttachmentStoreEnv, type AttachmentsEnv } from '../../src/env.ts';
import { createHash } from 'node:crypto';
import { presignQuery, signedHeaders } from '../../src/services/s3-client.ts';

/**
 * A fake S3-compatible store (D-150, LAI-1300), served through an injected
 * `fetch` — **no test calls a real store**.
 *
 * It behaves as the store D-150 runs was measured to on 2026-11-17 (Garage
 * v2.5.0, LAI-1300's task file), path-style, `<endpoint>/<bucket>/<key>`:
 *
 * - a presigned `PUT` whose `content-length`, `content-type` or
 *   `content-disposition` differs from what was signed is `403` — the
 *   signature is recomputed from the request **as sent**, so a browser that
 *   uploads a bigger or different file is refused here as there;
 * - an exact one is `200` with an `ETag`, and keeps the bytes;
 * - `HEAD` answers the stored size, or `404`;
 * - a presigned `GET` honours `response-content-type` and
 *   `response-content-disposition`;
 * - a header-signed ranged `GET` answers `206` with those bytes;
 * - `DELETE` answers `204`, and `HEAD` is `404` after it;
 * - a header-signed `PUT` (Laika's own, for an inbound mail's attachment —
 *   LAI-1315) is `403` unless its signature, over every header it names, and
 *   its `x-amz-content-sha256`, the body's digest, both agree.
 *
 * Every refusal carries `STORE-SECRET-WORDS` in its body, which Laika must
 * never pass on. `intercept` answers a request before the fake does — a
 * `500`, or a hang until the client gives up.
 */

export const FAKE_STORE: AttachmentStoreEnv = {
  endpoint: 'https://files.example.test',
  region: 'garage',
  bucket: 'laika-attachments',
  accessKeyId: 'GKfixture0123456789abcdef',
  /** A fixture string, never a real credential. */
  secretAccessKey: 'fixture-store-secret-never-real-0123456789',
};

/** The attachments setting a test turns the feature on with. */
export function fakeAttachments(maxBytes = 26_214_400): AttachmentsEnv {
  return { store: FAKE_STORE, maxBytes };
}

export interface StoredFake {
  body: Uint8Array;
  contentType: string;
  contentDisposition: string;
}

export interface FakeS3Request {
  method: string;
  /** `/<bucket>/<key>`, decoded. */
  path: string;
  query: URLSearchParams;
  headers: Headers;
}

export type S3Intercepted = Response | 'hang' | undefined;

export interface FakeS3 {
  fetchImpl: typeof fetch;
  requests: FakeS3Request[];
  /** By key — the part after the bucket. */
  objects: Map<string, StoredFake>;
  intercept: ((req: FakeS3Request) => S3Intercepted) | null;
  /** The key a URL or path names. */
  keyOf(urlOrPath: string): string;
  /** The requests of one method, in order. */
  of(method: string): FakeS3Request[];
}

function refuse(status: number, code: string): Response {
  return new Response(
    `<?xml version="1.0"?><Error><Code>${code}</Code><Message>STORE-SECRET-WORDS</Message></Error>`,
    { status, headers: { 'content-type': 'application/xml' } },
  );
}

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

/** `20130524T000000Z` back to unix ms. */
function parseAmzDate(value: string | null): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? '');
  if (m === null) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

function bodyBytes(body: RequestInit['body']): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new TypeError('the fake store reads a string, Uint8Array or ArrayBuffer body');
}

export function fakeS3(store: AttachmentStoreEnv = FAKE_STORE): FakeS3 {
  const origin = new URL(store.endpoint);
  const credentials = {
    accessKeyId: store.accessKeyId,
    secretAccessKey: store.secretAccessKey,
    region: store.region,
  };
  const prefix = `/${store.bucket}/`;

  /** The presigned query as Laika would sign it for the headers this request carries. */
  function presignedAgrees(req: FakeS3Request, method: 'GET' | 'PUT'): boolean {
    const now = parseAmzDate(req.query.get('X-Amz-Date'));
    const expires = Number(req.query.get('X-Amz-Expires'));
    const signedNames = (req.query.get('X-Amz-SignedHeaders') ?? '').split(';');
    if (now === null || !Number.isFinite(expires)) return false;
    const headers: Record<string, string> = {};
    for (const name of signedNames) {
      if (name === 'host') continue;
      const value = req.headers.get(name);
      if (value === null) return false;
      headers[name] = value;
    }
    const extra = [...req.query.entries()].filter(([name]) => !name.startsWith('X-Amz-'));
    const expected = presignQuery(credentials, {
      method,
      host: origin.host,
      path: req.path,
      headers,
      query: extra,
      now,
      expiresSeconds: expires,
    });
    return (
      new URLSearchParams(expected).get('X-Amz-Signature') === req.query.get('X-Amz-Signature')
    );
  }

  /** A header-signed request's `Authorization`, recomputed from what it carries. */
  function headerSignatureAgrees(req: FakeS3Request): boolean {
    const now = parseAmzDate(req.headers.get('x-amz-date'));
    const sent = req.headers.get('authorization');
    if (now === null || sent === null) return false;
    // Every header the signature names, besides the three the signer adds itself.
    const named = (/SignedHeaders=([^,]+)/.exec(sent)?.[1] ?? '').split(';');
    const headers: Record<string, string> = {};
    for (const name of named) {
      if (['host', 'x-amz-date', 'x-amz-content-sha256'].includes(name)) continue;
      const value = req.headers.get(name);
      if (value === null) return false;
      headers[name] = value;
    }
    const expected = signedHeaders(credentials, {
      method: req.method,
      host: origin.host,
      path: req.path,
      headers,
      payloadHash: req.headers.get('x-amz-content-sha256') ?? '',
      now,
    });
    return expected.authorization === sent;
  }

  const fake: FakeS3 = {
    requests: [],
    objects: new Map(),
    intercept: null,
    keyOf(urlOrPath) {
      const path = decodeURIComponent(new URL(urlOrPath, origin).pathname);
      return path.startsWith(prefix) ? path.slice(prefix.length) : path;
    },
    of(method) {
      return fake.requests.filter((r) => r.method === method);
    },
    fetchImpl: async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.origin !== origin.origin) {
        throw new TypeError(`fetch failed: the fake store has no ${url.origin}`);
      }
      const req: FakeS3Request = {
        method: init?.method ?? 'GET',
        path: decodeURIComponent(url.pathname),
        query: url.searchParams,
        headers: new Headers(init?.headers),
      };
      fake.requests.push(req);

      const early = fake.intercept?.(req);
      if (early === 'hang') return hang(init?.signal);
      if (early !== undefined) return early;

      if (!req.path.startsWith(prefix)) return refuse(404, 'NoSuchBucket');
      const key = req.path.slice(prefix.length);
      const presigned = req.query.has('X-Amz-Signature');

      if (req.method === 'PUT' && !presigned) {
        const body = bodyBytes(init?.body);
        const digest = createHash('sha256').update(body).digest('hex');
        if (!headerSignatureAgrees(req) || req.headers.get('x-amz-content-sha256') !== digest) {
          return refuse(403, 'SignatureDoesNotMatch');
        }
        fake.objects.set(key, {
          body,
          contentType: req.headers.get('content-type') ?? 'binary/octet-stream',
          contentDisposition: req.headers.get('content-disposition') ?? '',
        });
        return new Response(null, { status: 200, headers: { etag: '"fixture-etag"' } });
      }

      if (req.method === 'PUT') {
        if (!presignedAgrees(req, 'PUT')) return refuse(403, 'SignatureDoesNotMatch');
        const body = bodyBytes(init?.body);
        // The browser's `content-length` is the body's; a lie is refused too.
        if (String(body.length) !== req.headers.get('content-length')) {
          return refuse(403, 'SignatureDoesNotMatch');
        }
        fake.objects.set(key, {
          body,
          contentType: req.headers.get('content-type') ?? 'binary/octet-stream',
          contentDisposition: req.headers.get('content-disposition') ?? '',
        });
        return new Response(null, { status: 200, headers: { etag: '"fixture-etag"' } });
      }

      if (req.method === 'GET' && presigned) {
        if (!presignedAgrees(req, 'GET')) return refuse(403, 'SignatureDoesNotMatch');
        const object = fake.objects.get(key);
        if (object === undefined) return refuse(404, 'NoSuchKey');
        return new Response(object.body, {
          status: 200,
          headers: {
            'content-type': req.query.get('response-content-type') ?? object.contentType,
            'content-disposition':
              req.query.get('response-content-disposition') ?? object.contentDisposition,
          },
        });
      }

      if (!headerSignatureAgrees(req)) return refuse(403, 'SignatureDoesNotMatch');
      const object = fake.objects.get(key);

      if (req.method === 'HEAD') {
        if (object === undefined) return new Response(null, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: {
            'content-length': String(object.body.length),
            'content-type': object.contentType,
            'content-disposition': object.contentDisposition,
          },
        });
      }

      if (req.method === 'GET') {
        if (object === undefined) return refuse(404, 'NoSuchKey');
        const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') ?? '');
        if (range === null) return new Response(object.body, { status: 200 });
        const from = Number(range[1]);
        const to = Math.min(Number(range[2]), object.body.length - 1);
        return new Response(object.body.slice(from, to + 1), { status: 206 });
      }

      if (req.method === 'DELETE') {
        fake.objects.delete(key);
        return new Response(null, { status: 204 });
      }

      return refuse(405, 'MethodNotAllowed');
    },
  };
  return fake;
}

/**
 * Upload as a browser would: `PUT` the bytes to the presigned URL with the
 * headers the answer gave, and the length the browser sets from the body.
 */
export function browserPut(
  fake: FakeS3,
  upload: { url: string; headers: Record<string, string> },
  body: Uint8Array | string,
  overrides: Record<string, string> = {},
): Promise<Response> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return fake.fetchImpl(upload.url, {
    method: 'PUT',
    headers: { ...upload.headers, 'content-length': String(bytes.length), ...overrides },
    body: bytes,
  });
}
