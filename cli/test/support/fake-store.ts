import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * A fake S3-compatible file store on a real socket, for `laika attach`
 * against a real board (LAI-1351). **No test calls a real store.**
 *
 * Path-style, `/<bucket>/<key>`, as the board's client speaks it (D-150):
 * a `PUT` keeps the bytes and its headers, and is `400` when its
 * `content-length` is not the body it sent; `HEAD` answers the size or `404`;
 * a ranged `GET` answers `206` with those bytes; `DELETE` answers `204`.
 * Signatures are not checked — the board's own tests do that against the
 * measured store — so every request is recorded instead, and a test asserts
 * on what was sent. `failPut` makes the n-th `PUT` answer `500`.
 */

export interface StoredObject {
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

export interface StoreRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface FakeStore {
  readonly endpoint: string;
  readonly objects: Map<string, StoredObject>;
  readonly requests: StoreRequest[];
  /** 1-based: the PUT that answers 500. */
  failPut: number | null;
  /** The env that points a board at this store. */
  readonly env: Readonly<Record<string, string>>;
  stop(): Promise<void>;
}

function headersOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

export async function startFakeStore(): Promise<FakeStore> {
  const objects = new Map<string, StoredObject>();
  const requests: StoreRequest[] = [];
  let puts = 0;
  const state: { failPut: number | null } = { failPut: null };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://store').pathname);
      const headers = headersOf(req);
      requests.push({ method: req.method ?? '', path, headers });
      const body = Buffer.concat(chunks);
      if (req.method === 'PUT') {
        puts += 1;
        if (state.failPut === puts) {
          res.writeHead(500).end('STORE-SECRET-WORDS');
          return;
        }
        if (headers['content-length'] !== String(body.length)) {
          res.writeHead(400).end();
          return;
        }
        objects.set(path, { body, headers });
        res.writeHead(200, { ETag: '"fake"' }).end();
        return;
      }
      const found = objects.get(path);
      if (req.method === 'DELETE') {
        objects.delete(path);
        res.writeHead(204).end();
        return;
      }
      if (found === undefined) {
        res.writeHead(404).end();
        return;
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(found.body.length) }).end();
        return;
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.range ?? '');
      if (range !== null) {
        const slice = found.body.subarray(Number(range[1]), Number(range[2]) + 1);
        res.writeHead(206, { 'Content-Length': String(slice.length) }).end(slice);
        return;
      }
      res.writeHead(200, { 'Content-Length': String(found.body.length) }).end(found.body);
    });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
  const endpoint = `http://127.0.0.1:${String(port)}`;

  return {
    endpoint,
    objects,
    requests,
    get failPut() {
      return state.failPut;
    },
    set failPut(n: number | null) {
      state.failPut = n;
      puts = 0;
    },
    env: {
      LAIKA_S3_ENDPOINT: endpoint,
      LAIKA_S3_REGION: 'garage',
      LAIKA_S3_BUCKET: 'laika-attachments',
      LAIKA_S3_ACCESS_KEY_ID: 'GKfixture0123456789abcdef',
      // A fixture string, never a real credential.
      LAIKA_S3_SECRET_ACCESS_KEY: 'fixture-store-secret-never-real-0123456789',
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
