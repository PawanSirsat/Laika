import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { StaticFileCache } from '../../src/http/static-cache.ts';
import { isReservedPath, resolveWithinRoot, warmStaticCache } from '../../src/http/static.ts';
import { FALLBACK_DOCUMENT, PUBLIC_DIR } from '../../src/paths.ts';
import { type CapturedLog, captureLog, testApp, withTempDir } from '../helpers/app.ts';

const run = promisify(execFile);

/** `.git` is absent in a Docker build context; the git-backed checks skip there. */
const insideGitWorkTree = ((): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('SPA fallback with no build present', () => {
  /**
   * LAI-002 AC7: this must hold on a clean clone. `testApp()` points `publicDir`
   * at a directory that does not exist, so the assertion does not depend on
   * whether this machine happens to have run a build.
   */
  it('serves the committed fallback document for an unknown non-API path', async () => {
    const { app } = testApp();

    const res = await app.request('/board/LAI-42');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Laika is running.');
  });

  it('serves it at the root as well', async () => {
    const { app } = testApp();

    const res = await app.request('/');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Laika is running.');
  });

  it('does not cache the placeholder, so a later build is not shadowed', async () => {
    const { app } = testApp();

    const res = await app.request('/anything');

    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('the fallback document exists on disk', () => {
    expect(existsSync(FALLBACK_DOCUMENT)).toBe(true);
  });

  /**
   * The LAI-016 invariant, checked against git rather than asserted in prose:
   * the fallback is tracked, and `public/` carries nothing at all. Skipped when
   * there is no work tree — a Docker build context has no `.git`, and a test
   * that cannot run there should say so rather than fail.
   */
  it.skipIf(!insideGitWorkTree)('the fallback document is tracked by git', async () => {
    const { stdout } = await run('git', ['ls-files', '--error-unmatch', FALLBACK_DOCUMENT]);

    expect(stdout.trim()).not.toBe('');
  });

  it.skipIf(!insideGitWorkTree)('nothing is tracked inside server/public (LAI-016)', async () => {
    const { stdout } = await run('git', ['ls-files', '--', PUBLIC_DIR]);

    expect(stdout.trim()).toBe('');
  });
});

describe('SPA fallback with a build present', () => {
  it('prefers the built index.html over the committed fallback', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<!doctype html><title>built spa</title>', 'utf8');

      const { app } = testApp({ publicDir: dir });
      const res = await app.request('/board');

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('built spa');
    });
  });

  it('serves real static assets from the build output', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'assets'));
      await writeFile(join(dir, 'assets', 'app.css'), '.a{color:red}', 'utf8');

      const { app } = testApp({ publicDir: dir });
      const res = await app.request('/assets/app.css');

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/css');
      expect(await res.text()).toBe('.a{color:red}');
    });
  });

  it('still answers unknown API routes as JSON when a build is present', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<!doctype html><title>built spa</title>', 'utf8');

      const { app } = testApp({ publicDir: dir });
      const res = await app.request('/api/v1/nope');

      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
    });
  });
});

describe('caching and compression of the build output (LAI-722)', () => {
  const JS = `export const rows = [${Array.from({ length: 400 }, (_, i) => `"row-${String(i)}"`).join(',')}];\n`;
  const HASHED_JS = '/assets/index-DfSpNg7Z.js';
  const FONT = '/assets/mono-latin-wght-normal-DBQx-q_a.woff2';

  /** A build output this test owns: an index, a hashed bundle, a font, a map. */
  async function withBuild<T>(fn: (app: ReturnType<typeof testApp>['app']) => Promise<T>) {
    return withTempDir(async (dir) => {
      await mkdir(join(dir, 'assets'));
      await writeFile(join(dir, 'index.html'), '<!doctype html><title>built spa</title>', 'utf8');
      await writeFile(join(dir, HASHED_JS), JS, 'utf8');
      await writeFile(join(dir, `${HASHED_JS}.map`), '{"version":3,"sources":["src/secret.ts"]}');
      await writeFile(join(dir, FONT), JS, 'utf8');
      await writeFile(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      return fn(testApp({ publicDir: dir }).app);
    });
  }

  it('lets a browser keep a hashed asset for a year without asking again', async () => {
    await withBuild(async (app) => {
      for (const path of [HASHED_JS, FONT]) {
        const res = await app.request(path);
        expect(res.status, path).toBe(200);
        expect(res.headers.get('cache-control'), path).toBe('public, max-age=31536000, immutable');
      }
    });
  });

  it('makes the SPA document revalidate, and answers 304 when it has not changed', async () => {
    await withBuild(async (app) => {
      for (const path of ['/', '/board/LAI-1', '/index.html']) {
        const first = await app.request(path);
        const etag = first.headers.get('etag');

        expect(first.status, path).toBe(200);
        expect(first.headers.get('cache-control'), path).toBe('no-cache');
        expect(etag, path).toMatch(/^"[^"]+"$/);

        const again = await app.request(path, { headers: { 'If-None-Match': etag! } });
        expect(again.status, path).toBe(304);
        expect(await again.text(), path).toBe('');
        expect(again.headers.get('etag'), path).toBe(etag);
      }
    });
  });

  it('serves a changed document in full to a browser holding the old ETag', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<!doctype html><title>one</title>', 'utf8');
      const { app } = testApp({ publicDir: dir });
      const old = (await app.request('/')).headers.get('etag')!;

      await writeFile(
        join(dir, 'index.html'),
        '<!doctype html><title>two, rebuilt</title>',
        'utf8',
      );
      const res = await app.request('/', { headers: { 'If-None-Match': old } });

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('two, rebuilt');
    });
  });

  it('makes a non-hashed public file revalidate too', async () => {
    await withBuild(async (app) => {
      const res = await app.request('/favicon.svg');

      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('etag')).toMatch(/^"[^"]+"$/);
    });
  });

  it('serves brotli, then gzip, then identity, by Accept-Encoding', async () => {
    await withBuild(async (app) => {
      const br = await app.request(HASHED_JS, { headers: { 'Accept-Encoding': 'gzip, br' } });
      expect(br.headers.get('content-encoding')).toBe('br');
      const brBytes = Buffer.from(await br.arrayBuffer());
      expect(brotliDecompressSync(brBytes).toString()).toBe(JS);
      expect(Number(br.headers.get('content-length'))).toBe(brBytes.length);
      expect(brBytes.length).toBeLessThan(JS.length);

      const gz = await app.request(HASHED_JS, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(gz.headers.get('content-encoding')).toBe('gzip');
      expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(JS);

      const plain = await app.request(HASHED_JS);
      expect(plain.headers.get('content-encoding')).toBeNull();
      expect(await plain.text()).toBe(JS);

      // Every one of the three says it varies, or a shared cache could hand
      // brotli to a client that never asked for it.
      for (const res of [br, gz, plain]) {
        expect(res.headers.get('vary')).toMatch(/\bAccept-Encoding\b/);
      }
    });
  });

  it('never compresses a font, whatever the client accepts', async () => {
    await withBuild(async (app) => {
      const res = await app.request(FONT, { headers: { 'Accept-Encoding': 'br, gzip' } });

      expect(res.headers.get('content-encoding')).toBeNull();
      expect(await res.text()).toBe(JS);
    });
  });

  it('answers HEAD with the headers of the representation GET would send', async () => {
    await withBuild(async (app) => {
      const get = await app.request(HASHED_JS, { headers: { 'Accept-Encoding': 'br' } });
      const head = await app.request(HASHED_JS, {
        method: 'HEAD',
        headers: { 'Accept-Encoding': 'br' },
      });

      expect(head.status).toBe(200);
      expect(head.headers.get('content-encoding')).toBe('br');
      expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
      expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
      expect(await head.text()).toBe('');
    });
  });

  it('answers 304 only to the ETag of the representation it would send', async () => {
    // A 304 tells a cache to reuse the response stored under that validator.
    // Answering one for a br tag to a gzip-only client would point it at bytes
    // it never stored, so a different representation gets a full 200.
    await withBuild(async (app) => {
      const br = await app.request(HASHED_JS, { headers: { 'Accept-Encoding': 'br' } });
      const brTag = br.headers.get('etag')!;

      const same = await app.request(HASHED_JS, {
        headers: { 'Accept-Encoding': 'br', 'If-None-Match': brTag },
      });
      expect(same.status).toBe(304);
      expect(same.headers.get('etag')).toBe(brTag);
      expect(same.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(same.headers.get('vary')).toMatch(/\bAccept-Encoding\b/);

      const other = await app.request(HASHED_JS, {
        headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': brTag },
      });
      expect(other.status).toBe(200);
      expect(other.headers.get('content-encoding')).toBe('gzip');
      expect(other.headers.get('etag')).not.toBe(brTag);
      expect(gunzipSync(Buffer.from(await other.arrayBuffer())).toString()).toBe(JS);
    });
  });

  it('ignores Range rather than answering compressed bytes against an identity range', async () => {
    // No Range support is a legal answer (RFC 9110 §14.2). A 206 whose
    // Content-Range counted bytes of a different encoding would not be.
    await withBuild(async (app) => {
      const res = await app.request(HASHED_JS, {
        headers: { 'Accept-Encoding': 'br', Range: 'bytes=0-9' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-range')).toBeNull();
      expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(JS);
    });
  });

  it('refuses source maps with 404, even when one is on disk', async () => {
    await withBuild(async (app) => {
      const res = await app.request(`${HASHED_JS}.map`);

      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain('secret.ts');
      expect(body).not.toContain('built spa');
    });
  });
});

describe('reserved paths', () => {
  it('never lets the SPA swallow an API, MCP or webhook path', () => {
    for (const path of [
      '/api',
      '/api/',
      '/api/v1/health',
      '/mcp',
      '/mcp/tools',
      '/mcpanything',
      '/webhooks',
      '/webhooks/github',
    ]) {
      expect(isReservedPath(path), path).toBe(true);
    }
  });

  it('leaves ordinary SPA routes alone', () => {
    for (const path of ['/', '/board', '/projects/laika/tasks', '/apifoo', '/webhook']) {
      expect(isReservedPath(path), path).toBe(false);
    }
  });
});

describe('static path traversal', () => {
  const ROOT = '/srv/public';

  /**
   * The invariant is containment, not rejection: `..` segments are normalised
   * away and the result is clamped inside the root, so `/../package.json` lands
   * on `/srv/public/package.json` rather than escaping. Either outcome — a path
   * inside the root, or `null` — is safe; anything above the root is not.
   */
  it('never resolves above the public directory', () => {
    for (const attempt of [
      '/../package.json',
      '/../../etc/passwd',
      '/assets/../../src/index.ts',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/....//....//etc/passwd',
      '/foo%00.css',
      '/%zz',
    ]) {
      const resolved = resolveWithinRoot(ROOT, attempt);

      if (resolved !== null) {
        expect(resolved.startsWith(`${ROOT}/`), `${attempt} -> ${resolved}`).toBe(true);
      }
    }
  });

  it('rejects a null byte and malformed percent-encoding outright', () => {
    expect(resolveWithinRoot(ROOT, '/foo%00.css')).toBeNull();
    expect(resolveWithinRoot(ROOT, '/%zz')).toBeNull();
  });

  it('resolves ordinary asset paths', () => {
    expect(resolveWithinRoot(ROOT, '/assets/app.css')).toBe('/srv/public/assets/app.css');
  });

  it('does not serve files outside the build output over HTTP', async () => {
    const { app } = testApp({ publicDir: PUBLIC_DIR });

    const res = await app.request('/../package.json');

    // Either refused outright or answered with the SPA document — never the file.
    expect(await res.text()).not.toContain('"@laika/server"');
  });
});

describe('the static cache is warmed at boot (LAI-722 review)', () => {
  const JS = `export const rows = [${Array.from({ length: 400 }, (_, i) => `"row-${String(i)}"`).join(',')}];\n`;

  async function writeBuild(dir: string): Promise<void> {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>built spa</title>', 'utf8');
    await writeFile(join(dir, 'assets', 'index-DfSpNg7Z.js'), JS, 'utf8');
    await writeFile(join(dir, 'assets', 'index-DfSpNg7Z.js.map'), '{"version":3}', 'utf8');
    await writeFile(join(dir, 'assets', 'mono-normal-DBQx-q_a.woff2'), JS, 'utf8');
  }

  /** Wait for a log record the app writes after `createApp` has returned. */
  async function eventually(log: CapturedLog, event: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 200; i++) {
      const record = log.find(event);
      if (record !== undefined) return record;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no ${event} record within 2 s`);
  }

  it('loads index.html and every asset except source maps', async () => {
    await withTempDir(async (dir) => {
      await writeBuild(dir);
      const cache = new StaticFileCache();

      const loaded = await warmStaticCache({ publicDir: dir, cache, log: captureLog().logger });

      expect(loaded).toBe(3);
      expect(cache.size).toBe(3);
    });
  });

  it('is fire-and-forget from createApp, and says when it is done', async () => {
    await withTempDir(async (dir) => {
      await writeBuild(dir);
      const { app, log } = testApp({ publicDir: dir, warmStaticCache: true });

      // `createApp` returned without waiting: the warm-up reads files, so it
      // cannot have finished synchronously. Nothing waits on it to listen.
      expect(log.find('static.warmed')).toBeUndefined();

      expect((await eventually(log, 'static.warmed')).files).toBe(3);
      expect((await app.request('/assets/index-DfSpNg7Z.js')).status).toBe(200);
    });
  });

  it('treats a missing build as nothing to warm, not an error', async () => {
    const { log } = testApp({ warmStaticCache: true });

    expect((await eventually(log, 'static.warmed')).files).toBe(0);
    expect(log.find('static.warm_failed')).toBeUndefined();
  });

  it('logs a failure instead of throwing it', async () => {
    await withTempDir(async (dir) => {
      // A regular file where the build directory should be: `readdir` fails
      // with ENOTDIR, which is not "no build yet".
      const notADirectory = join(dir, 'public');
      await writeFile(notADirectory, 'not a directory', 'utf8');

      const { log } = testApp({ publicDir: notADirectory, warmStaticCache: true });

      expect((await eventually(log, 'static.warm_failed')).error).toMatch(/ENOTDIR/);
    });
  });

  it('does not warm unless asked — tests and tools build apps too', async () => {
    await withTempDir(async (dir) => {
      await writeBuild(dir);
      const { log } = testApp({ publicDir: dir });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(log.find('static.warmed')).toBeUndefined();
    });
  });
});
