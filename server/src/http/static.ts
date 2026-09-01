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

import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { type Context } from 'hono';
import { type AppEnv } from './context.ts';
import { SETUP_PATH } from './middleware/setup-gate.ts';

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
  '.map': 'application/json; charset=utf-8',
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
}

/**
 * Serves the SPA document for any non-reserved path. Registered as Hono's
 * `notFound` handler so it runs only after every real route has declined.
 */
export function createSpaHandler(options: StaticOptions) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    // Before an org exists every route leads to setup (LAI-009 AC1). Redirecting
    // here rather than in a middleware is deliberate: this runs only for paths
    // that would serve the SPA *document*, so hashed assets keep loading and the
    // setup screen can actually render.
    if (options.setupRequired?.() === true && c.req.path !== SETUP_PATH) {
      return c.redirect(SETUP_PATH, 302);
    }

    const indexPath = join(options.publicDir, 'index.html');

    const built = await readFileIfPresent(indexPath);
    if (built !== null) {
      return c.body(new Uint8Array(built), 200, { 'Content-Type': CONTENT_TYPES['.html']! });
    }

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
  return async (c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | void> => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    if (isReservedPath(c.req.path)) return next();

    const filePath = resolveWithinRoot(options.publicDir, c.req.path);
    if (filePath === null) return next();

    const contents = await readFileIfPresent(filePath);
    if (contents === null) return next();

    return c.body(new Uint8Array(contents), 200, { 'Content-Type': contentTypeFor(filePath) });
  };
}
