import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  cacheControlFor,
  ifNoneMatchHits,
  IMMUTABLE,
  isCompressible,
  isHashedAsset,
  negotiateEncoding,
  REVALIDATE,
  StaticFileCache,
} from '../../src/http/static-cache.ts';
import { withTempDir } from '../helpers/app.ts';

/** Text that compresses, comfortably over the 1 KiB floor. */
const BIG_JS = `export const rows = [${Array.from({ length: 400 }, (_, i) => `"row-${String(i)}"`).join(',')}];\n`;

describe('which files are content-hashed (LAI-722)', () => {
  it('recognises Vite’s hashed output, including hashes with - and _', () => {
    for (const path of [
      '/assets/index-DfSpNg7Z.js',
      '/assets/index-Vu3hX7rC.css',
      '/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2',
      '/assets/plus-jakarta-sans-latin-wght-normal-eXO_dkmS.woff2',
    ]) {
      expect(isHashedAsset(path), path).toBe(true);
      expect(cacheControlFor(path), path).toBe(IMMUTABLE);
    }
  });

  it('treats everything else as revalidate-every-time', () => {
    for (const path of [
      '/',
      '/index.html',
      '/favicon.svg',
      '/robots.txt',
      // Under /assets but with no hash: a name is not a version.
      '/assets/logo.svg',
      // A hash-shaped name outside /assets is still a name somebody chose.
      '/press-kit-download.zip',
    ]) {
      expect(isHashedAsset(path), path).toBe(false);
      expect(cacheControlFor(path), path).toBe(REVALIDATE);
    }
  });
});

describe('Accept-Encoding negotiation', () => {
  const BOTH = ['br', 'gzip'] as const;

  it('prefers brotli when both are acceptable', () => {
    expect(negotiateEncoding('br, gzip', BOTH)).toBe('br');
    expect(negotiateEncoding('gzip, deflate, br, zstd', BOTH)).toBe('br');
  });

  it('honours q-values, including q=0 as a refusal', () => {
    expect(negotiateEncoding('br;q=0, gzip', BOTH)).toBe('gzip');
    expect(negotiateEncoding('br;q=0.2, gzip;q=0.8', BOTH)).toBe('gzip');
    expect(negotiateEncoding('gzip;q=0, br;q=0', BOTH)).toBeNull();
  });

  it('reads * as anything not otherwise named', () => {
    expect(negotiateEncoding('*', BOTH)).toBe('br');
    expect(negotiateEncoding('br;q=0, *', BOTH)).toBe('gzip');
  });

  it('answers identity when nothing usable is offered or acceptable', () => {
    expect(negotiateEncoding(undefined, BOTH)).toBeNull();
    expect(negotiateEncoding('', BOTH)).toBeNull();
    expect(negotiateEncoding('identity', BOTH)).toBeNull();
    expect(negotiateEncoding('deflate', BOTH)).toBeNull();
    expect(negotiateEncoding('br, gzip', [])).toBeNull();
    expect(negotiateEncoding('br', ['gzip'])).toBeNull();
  });
});

describe('If-None-Match', () => {
  it('matches any listed tag, weak or strong, and *', () => {
    expect(ifNoneMatchHits('"a"', ['"a"'])).toBe(true);
    expect(ifNoneMatchHits('"x", "a-br"', ['"a"', '"a-br"'])).toBe(true);
    expect(ifNoneMatchHits('W/"a"', ['"a"'])).toBe(true);
    expect(ifNoneMatchHits('*', ['"a"'])).toBe(true);
  });

  it('misses on a different tag or no header', () => {
    expect(ifNoneMatchHits('"b"', ['"a"'])).toBe(false);
    expect(ifNoneMatchHits(undefined, ['"a"'])).toBe(false);
    expect(ifNoneMatchHits('', ['"a"'])).toBe(false);
  });
});

describe('what is worth compressing', () => {
  it('compresses text, never fonts or images', () => {
    expect(isCompressible('text/javascript; charset=utf-8')).toBe(true);
    expect(isCompressible('text/css; charset=utf-8')).toBe(true);
    expect(isCompressible('text/html; charset=utf-8')).toBe(true);
    expect(isCompressible('application/json; charset=utf-8')).toBe(true);
    expect(isCompressible('image/svg+xml')).toBe(true);

    expect(isCompressible('font/woff2')).toBe(false);
    expect(isCompressible('font/woff')).toBe(false);
    expect(isCompressible('image/png')).toBe(false);
    expect(isCompressible('image/webp')).toBe(false);
    expect(isCompressible('application/octet-stream')).toBe(false);
  });
});

describe('StaticFileCache', () => {
  it('compresses once per file version and hands back the same bytes after', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'app.js');
      await writeFile(path, BIG_JS, 'utf8');
      const cache = new StaticFileCache();

      const first = await cache.load(path, 'text/javascript; charset=utf-8');
      const second = await cache.load(path, 'text/javascript; charset=utf-8');

      expect(first).not.toBeNull();
      // Identity, not equality: the same buffer means it was not recompressed.
      expect(second?.encoded.br?.body).toBe(first?.encoded.br?.body);
      expect(second?.encoded.gzip?.body).toBe(first?.encoded.gzip?.body);

      expect(Buffer.from(brotliDecompressSync(first!.encoded.br!.body)).toString()).toBe(BIG_JS);
      expect(Buffer.from(gunzipSync(first!.encoded.gzip!.body)).toString()).toBe(BIG_JS);
      expect(first!.encoded.br!.body.byteLength).toBeLessThan(BIG_JS.length);
    });
  });

  it('shares one load between concurrent first requests', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'app.js');
      await writeFile(path, BIG_JS, 'utf8');
      const cache = new StaticFileCache();

      const [a, b] = await Promise.all([
        cache.load(path, 'text/javascript; charset=utf-8'),
        cache.load(path, 'text/javascript; charset=utf-8'),
      ]);

      expect(a).toBe(b);
    });
  });

  it('notices a rebuilt file and gives it a new ETag', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'index.html');
      await writeFile(path, '<!doctype html><title>one</title>', 'utf8');
      const cache = new StaticFileCache();
      const before = await cache.load(path, 'text/html; charset=utf-8');

      await writeFile(path, '<!doctype html><title>two, longer</title>', 'utf8');
      const after = await cache.load(path, 'text/html; charset=utf-8');

      expect(Buffer.from(after!.body).toString()).toContain('two, longer');
      expect(after!.etag).not.toBe(before!.etag);
    });
  });

  it('gives each representation its own strong ETag', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'app.js');
      await writeFile(path, BIG_JS, 'utf8');
      const file = await new StaticFileCache().load(path, 'text/javascript; charset=utf-8');

      const tags = [file!.etag, file!.encoded.br!.etag, file!.encoded.gzip!.etag];
      expect(new Set(tags).size).toBe(3);
      for (const tag of tags) expect(tag).toMatch(/^"[^"]+"$/);
    });
  });

  it('leaves small files and incompressible types alone', async () => {
    await withTempDir(async (dir) => {
      const small = join(dir, 'a.css');
      const font = join(dir, 'f.woff2');
      await writeFile(small, '.a{color:red}', 'utf8');
      await writeFile(font, BIG_JS, 'utf8');
      const cache = new StaticFileCache();

      expect((await cache.load(small, 'text/css; charset=utf-8'))?.encoded).toEqual({});
      expect((await cache.load(font, 'font/woff2'))?.encoded).toEqual({});
    });
  });

  it('answers null for a missing path or a directory', async () => {
    await withTempDir(async (dir) => {
      const cache = new StaticFileCache();

      expect(await cache.load(join(dir, 'nope.js'), 'text/javascript')).toBeNull();
      expect(await cache.load(dir, 'text/html')).toBeNull();
    });
  });
});
