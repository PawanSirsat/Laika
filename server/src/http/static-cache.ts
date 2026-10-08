/**
 * How the build output is cached and compressed (LAI-722).
 *
 * The SPA is one 711 KB script, one 239 KB stylesheet and a handful of fonts,
 * read across a ~215 ms round trip. Before this, every reload downloaded all of
 * it again, uncompressed: no `Cache-Control`, no validator, no encoding.
 *
 * ## Two caching rules, decided by the file name
 *
 * - **Content-hashed files** (`/assets/index-DfSpNg7Z.js`) are immutable by
 *   construction: a change makes a new name. A browser may keep them a year
 *   and never ask again.
 * - **Everything else** — `index.html` above all — must be asked about on every
 *   use (`no-cache`), and is answered `304` from a strong `ETag` when it has
 *   not changed. `index.html` is what names the current hashes, so caching it
 *   would pin a browser to the previous deploy.
 *
 * ## Compressed once per file version
 *
 * Production is a t4g.micro. Compressing per request would spend its CPU on the
 * same bytes over and over, so each file is compressed **once** — on the first
 * request after it changes — and the bytes are kept. Concurrent first requests
 * share the one load. The memory is bounded by the build output itself, since
 * only files under the public directory are ever loaded.
 *
 * Brotli at quality 9, not 11: measured on the real bundle, 11 took 1.6 s on an
 * M4 (longer on a Graviton micro) to save 13 KB over 9's 58 ms. The first
 * visitor after a deploy waits for this, once.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

/** Below this, an encoding's framing costs about what it saves. */
export const COMPRESS_MIN_BYTES = 1024;

/**
 * Vite's output name, `assets/<name>-<hash>.<ext>`. Rolldown's hash is eight
 * characters of URL-safe base64, so it can itself contain `-` and `_`
 * (`…-normal-DBQx-q_a.woff2`). Anchored to `/assets/`, because a name outside
 * it is one somebody chose and can change without the name changing.
 */
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function isHashedAsset(urlPath: string): boolean {
  return HASHED.test(urlPath);
}

export function cacheControlFor(urlPath: string): string {
  return isHashedAsset(urlPath) ? IMMUTABLE : REVALIDATE;
}

/**
 * Text compresses; **raster images and fonts** are already compressed and only
 * grow. SVG and ICO are compressed on purpose: SVG is XML text, and an ICO is
 * mostly uncompressed bitmap data. Decided by type rather than extension so
 * `static.ts` stays the one place that maps a file name to a type.
 */
export function isCompressible(contentType: string): boolean {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/manifest+json' ||
    type === 'image/svg+xml' ||
    type === 'image/x-icon'
  );
}

export type Encoding = 'br' | 'gzip';

/** The server's preference when the client rates two encodings equally. */
const PREFERENCE: readonly Encoding[] = ['br', 'gzip'];

/**
 * The encoding to send, or `null` for identity (RFC 9110 §12.5.3).
 *
 * `q=0` is a refusal, an explicit entry beats `*`, and a tie goes to brotli —
 * it is the smaller of the two on this bundle by about 11%.
 */
export function negotiateEncoding(
  header: string | undefined,
  available: readonly Encoding[],
): Encoding | null {
  if (header === undefined || header.trim() === '' || available.length === 0) return null;

  const weights = new Map<string, number>();
  for (const part of header.split(',')) {
    const [token = '', ...params] = part.trim().toLowerCase().split(';');
    if (token === '') continue;
    const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p)?.[1]).find(Boolean);
    weights.set(token.trim(), q === undefined ? 1 : Number(q));
  }

  let best: Encoding | null = null;
  let bestWeight = 0;
  for (const encoding of PREFERENCE) {
    if (!available.includes(encoding)) continue;
    const weight = weights.get(encoding) ?? weights.get('*') ?? 0;
    if (weight > bestWeight) {
      best = encoding;
      bestWeight = weight;
    }
  }

  return best;
}

/**
 * Does `If-None-Match` name any of these tags? Weak comparison, as RFC 9110
 * §13.1.2 requires for this header, so `W/"x"` matches `"x"`.
 */
export function ifNoneMatchHits(header: string | undefined, etags: readonly string[]): boolean {
  if (header === undefined || header.trim() === '') return false;
  if (header.trim() === '*') return true;

  const wanted = new Set(etags.map((tag) => tag.replace(/^W\//, '')));
  return header.split(',').some((tag) => wanted.has(tag.trim().replace(/^W\//, '')));
}

export interface Representation {
  body: Uint8Array<ArrayBuffer>;
  /** Strong, and distinct per encoding — they are different bytes. */
  etag: string;
}

export interface CachedFile extends Representation {
  contentType: string;
  /** Only the encodings that came out smaller than the file itself. */
  encoded: Partial<Record<Encoding, Representation>>;
}

interface Entry {
  /** `mtimeMs:size` when loaded. A rebuild changes at least one of them. */
  version: string;
  file: Promise<CachedFile>;
}

export class StaticFileCache {
  readonly #entries = new Map<string, Entry>();

  /** How many files are held — what `warmStaticCache` is asserted against. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * The file at `filePath`, read and compressed once per version, or `null`
   * when there is no regular file there.
   *
   * A `stat` per request is the price of noticing a rebuild without a restart
   * — `vite build --watch` into the public directory keeps working — and it is
   * a syscall, not a read.
   */
  async load(filePath: string, contentType: string): Promise<CachedFile | null> {
    let version: string;
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return null;
      version = `${String(stats.mtimeMs)}:${String(stats.size)}`;
    } catch {
      this.#entries.delete(filePath);
      return null;
    }

    const hit = this.#entries.get(filePath);
    const entry = hit?.version === version ? hit : { version, file: build(filePath, contentType) };
    if (entry !== hit) this.#entries.set(filePath, entry);

    try {
      return await entry.file;
    } catch {
      // Gone between the stat and the read. Forget it rather than cache a
      // rejection every later request would inherit.
      if (this.#entries.get(filePath) === entry) this.#entries.delete(filePath);
      return null;
    }
  }
}

async function build(filePath: string, contentType: string): Promise<CachedFile> {
  const body = new Uint8Array(await readFile(filePath));
  const hash = createHash('sha256').update(body).digest('base64url').slice(0, 27);
  const file: CachedFile = { contentType, body, etag: `"${hash}"`, encoded: {} };

  if (!isCompressible(contentType) || body.byteLength < COMPRESS_MIN_BYTES) return file;

  const [br, gz] = await Promise.all([
    brotliAsync(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 9,
        [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
      },
    }),
    gzipAsync(body, { level: 9 }),
  ]);

  if (br.byteLength < body.byteLength) {
    file.encoded.br = { body: new Uint8Array(br), etag: `"${hash}-br"` };
  }
  if (gz.byteLength < body.byteLength) {
    file.encoded.gzip = { body: new Uint8Array(gz), etag: `"${hash}-gz"` };
  }

  return file;
}
