/**
 * Static assets and the SPA fallback (SPEC §11.4).
 *
 * Serving order for a request that is not a reserved prefix:
 *   1. a real file under `publicDir`      — hashed assets, favicon, …
 *   2. `publicDir/index.html`             — the built SPA (LAI-007)
 *   3. the committed fallback document    — clean clone, no build yet
 *
 * Step 3 is the CHIEF decision on LAI-016: `public/` is build output and stays
 * entirely gitignored, so the "no SPA yet" document lives in `src/` and is
 * committed there. Nothing is ever committed into `public/`.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { type Context } from 'hono';
import { type Logger } from '../log.ts';
import { type AppEnv } from './context.ts';
import { SETUP_PATH } from './middleware/setup-gate.ts';
import {
  cacheControlFor,
  type CachedFile,
  ifNoneMatchHits,
  negotiateEncoding,
  REVALIDATE,
  StaticFileCache,
  type Encoding,
} from './static-cache.ts';

/**
 * Prefixes the SPA fallback must never swallow (SPEC §11.4). A request to an
 * unknown `/api/…` path has to fail as JSON — answering it with an HTML document
 * turns a typo into a parse error three layers away in the client.
 */
export function isReservedPath(path: string): boolean {
  return (
    path === '/api' ||
    path.startsWith('/api/') ||
    path.startsWith('/mcp') ||
    path === '/webhooks' ||
    path.startsWith('/webhooks/')
  );
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const extension = dot === -1 ? '' : filePath.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Resolve a URL path inside `root`, or `null` if it escapes.
 *
 * `..` in a URL path is the oldest trick there is. Normalising first and then
 * checking the result is still prefixed by `root` is what makes traversal
 * impossible rather than merely unlikely.
 */
export function resolveWithinRoot(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // Malformed percent-encoding — not a path we are going to serve.
    return null;
  }

  if (decoded.includes('\0')) return null;

  const rootDir = resolve(root);
  const candidate = resolve(rootDir, `.${normalize(decoded)}`);

  if (candidate !== rootDir && !candidate.startsWith(rootDir + sep)) return null;

  return candidate;
}

async function readFileIfPresent(filePath: string): Promise<Buffer | null> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    return await readFile(filePath);
  } catch {
    return null;
  }
}

export interface StaticOptions {
  /** Built SPA output. Absent in a clean clone — that is the normal case here. */
  publicDir: string;
  /** Committed document served when the build output has no `index.html`. */
  fallbackDocument: string;
  /**
   * Answers "is this instance still waiting to be set up?" (LAI-009).
   *
   * A function rather than a boolean because the answer changes the moment setup
   * succeeds, and the app is built once at startup.
   */
  setupRequired?: (() => boolean) | undefined;
  /**
   * The read-and-compress-once store (LAI-722). Shared by the two handlers so
   * `/` and `/index.html` are one entry; each makes its own when not given one.
   */
  cache?: StaticFileCache | undefined;
}

/**
 * Answer with one representation of `file`, or `304` (LAI-722).
 *
 * The `ETag` names the representation sent, and a match against **any** of the
 * file's tags is a `304` — the bytes behind every one of them are unchanged,
 * whichever encoding the client happened to cache.
 *
 * `Range` is ignored: every answer is a whole `200`. That is a legal response
 * to a range request, and it is the safe one here — a `206` would have to count
 * bytes of the encoding actually sent, which nothing in the SPA needs.
 */
function serveFile(c: Context<AppEnv>, file: CachedFile, cacheControl: string): Response {
  const available = Object.keys(file.encoded) as Encoding[];
  const encoding = negotiateEncoding(c.req.header('Accept-Encoding'), available);
  const sent = encoding === null ? file : file.encoded[encoding]!;

  const headers: Record<string, string> = {
    'Content-Type': file.contentType,
    'Cache-Control': cacheControl,
    ETag: sent.etag,
  };
  // On every answer for a file that has encodings, identity included: a shared
  // cache that stored the plain one must not hand it to the next brotli client,
  // nor the reverse.
  if (available.length > 0) headers.Vary = 'Accept-Encoding';

  const etags = [file.etag, ...Object.values(file.encoded).map((r) => r.etag)];
  if (ifNoneMatchHits(c.req.header('If-None-Match'), etags)) {
    return c.body(null, 304, headers);
  }

  if (encoding !== null) headers['Content-Encoding'] = encoding;
  headers['Content-Length'] = String(sent.body.byteLength);

  return c.body(sent.body, 200, headers);
}

/**
 * Serves the SPA document for any non-reserved path. Registered as Hono's
 * `notFound` handler so it runs only after every real route has declined.
 */
export function createSpaHandler(options: StaticOptions) {
  const cache = options.cache ?? new StaticFileCache();

  return async (c: Context<AppEnv>): Promise<Response> => {
    // Before an org exists every route leads to setup (LAI-009 AC1). Redirecting
    // here rather than in a middleware is deliberate: this runs only for paths
    // that would serve the SPA *document*, so hashed assets keep loading and the
    // setup screen can actually render.
    if (options.setupRequired?.() === true && c.req.path !== SETUP_PATH) {
      return c.redirect(SETUP_PATH, 302);
    }

    const indexPath = join(options.publicDir, 'index.html');

    // `no-cache`, not `no-store`: the browser keeps it and asks every time, and
    // an unchanged document costs a `304`. It is the file that names the current
    // hashed bundle, so it must never be served from cache without asking.
    const built = await cache.load(indexPath, CONTENT_TYPES['.html']!);
    if (built !== null) return serveFile(c, built, REVALIDATE);

    const fallback = await readFileIfPresent(options.fallbackDocument);
    if (fallback !== null) {
      return c.body(new Uint8Array(fallback), 200, {
        'Content-Type': CONTENT_TYPES['.html']!,
        // The fallback is a placeholder; caching it would outlive the first real
        // build and leave people staring at "no SPA yet" after deploying one.
        'Cache-Control': 'no-store',
      });
    }

    // Both absent means the install is broken, not that the route is unknown.
    throw new Error(
      `No SPA document available: neither ${indexPath} nor ${options.fallbackDocument} exists`,
    );
  };
}

/**
 * Serves real files out of `publicDir`, and declines everything else so the
 * request falls through to the SPA handler.
 */
export function createStaticHandler(options: StaticOptions) {
  const cache = options.cache ?? new StaticFileCache();

  return async (c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | void> => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    if (isReservedPath(c.req.path)) return next();

    // **Source maps are not published** (LAI-722). The build writes them
    // (`sourcemap: 'hidden'`) for local debugging, and nothing links to them;
    // this makes sure that stays true of a map that is on disk anyway. A
    // `404` rather than falling through, which would answer a `.map` request
    // with the SPA document and a `200`.
    if (c.req.path.toLowerCase().endsWith('.map')) {
      return c.text('Not found', 404, { 'Cache-Control': 'no-store' });
    }

    const filePath = resolveWithinRoot(options.publicDir, c.req.path);
    if (filePath === null) return next();

    const file = await cache.load(filePath, contentTypeFor(filePath));
    if (file === null) return next();

    return serveFile(c, file, cacheControlFor(c.req.path));
  };
}

/**
 * Read and compress the build output before anybody asks for it (LAI-722).
 *
 * The cache otherwise fills on first request, and on a t4g.micro the first
 * visitor after a deploy would wait for brotli on a 711 KB bundle. Called
 * fire-and-forget from `createApp` when `warmStaticCache` is set — `index.ts`
 * sets it, nothing waits on it to listen, and a request that arrives first
 * shares the same load rather than starting a second one.
 *
 * `index.html` and every file in `assets/`, except source maps, which are
 * never served. A missing build is the normal clean-clone case and warms
 * nothing; anything else is the caller's to log. Resolves to the number of
 * files now held.
 */
export async function warmStaticCache(options: {
  publicDir: string;
  cache: StaticFileCache;
  log: Logger;
}): Promise<number> {
  const { publicDir, cache } = options;

  let assets: string[];
  try {
    assets = (await readdir(join(publicDir, 'assets'))).map((name) => join('assets', name));
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') throw error;
    assets = [];
  }

  const loaded = await Promise.all(
    ['index.html', ...assets]
      .filter((path) => !path.toLowerCase().endsWith('.map'))
      .map((path) => cache.load(join(publicDir, path), contentTypeFor(path))),
  );

  return loaded.filter((file) => file !== null).length;
}
