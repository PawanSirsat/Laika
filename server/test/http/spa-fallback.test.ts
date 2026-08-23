import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isReservedPath, resolveWithinRoot } from '../../src/http/static.ts';
import { FALLBACK_DOCUMENT, PUBLIC_DIR } from '../../src/paths.ts';
import { testApp, withTempDir } from '../helpers/app.ts';

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
