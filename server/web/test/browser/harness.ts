import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * A real browser against the real built SPA (LAI-227).
 *
 * ## Why a browser at all
 *
 * `node --test` cannot import a `.tsx`, so nothing else in this suite renders a
 * component. That mattered twice in one task: LAI-424's hit area is
 * `::after { inset: 0 }`, and both mistakes made building it were **geometric**
 * while every source assertion stayed green. jsdom cannot reach that class —
 * it has no layout engine, `getBoundingClientRect` returns zeros and
 * `elementFromPoint` is unimplemented. Geometry is the one thing worth a
 * dependency, and it is why this is Playwright rather than jsdom.
 *
 * ## What it deliberately is not
 *
 * The API is **stubbed here**, not the real server. These tests are about what
 * the client renders and how it responds to a click; the server has its own
 * 1360 tests, and booting it would make this suite own a database. The risk of
 * a stub drifting from the real API is the risk `view-type-drift.test.ts`
 * (LAI-213) already covers, in both directions.
 *
 * It also cannot tell you a colour is **right** in dark mode — only what the
 * computed value is. **This retires re-verifying by hand what was already
 * established once. It does not retire looking.**
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB_ROOT = join(HERE, '..', '..');

/**
 * Where the SPA under test is built. **A fresh directory per run, never
 * `server/public/`.**
 *
 * The first version served `server/public/` and rebuilt it only when missing.
 * CHIEF's copy was a week stale, so the harness silently tested week-old code —
 * and the dangerous direction of that is **green on broken code**, which is
 * exactly what it would do to someone iterating on a fix.
 *
 * Two ways out: assert the bundle is newer than `src/`, or build every time.
 * Building wins on measurement rather than principle — it is **0.42s**, against
 * a suite that is 1.5s, and it needs no mtime heuristic that can be wrong in
 * either direction. Building into a temp directory also means a test run cannot
 * disturb a dev server serving `server/public/`.
 */
let BUILT: string | undefined;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** Route → JSON. Anything unlisted 404s loudly rather than silently emptying. */
export type ApiStub = Readonly<Record<string, unknown>>;

export interface Harness {
  readonly page: Page;
  readonly origin: string;
  close: () => Promise<void>;
}

/**
 * Build the SPA from the source in front of you, once per process.
 *
 * Unconditional on purpose — see {@link BUILT}. A cached build is the one thing
 * that can make these tests report on code nobody is looking at.
 */
function ensureBuilt(): string {
  if (BUILT !== undefined) return BUILT;

  const out = mkdtempSync(join(tmpdir(), 'laika-web-'));
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
  });

  // Prove the build produced something before any test trusts it. A missing
  // `index.html` here would otherwise surface as every test failing to find an
  // element, which reads as a product defect.
  const index = join(out, 'index.html');
  if (!existsSync(index)) throw new Error(`the SPA build produced no index.html in ${out}`);

  BUILT = out;
  return out;
}

/** Remove the built copy. Called alongside `closeBrowser`. */
export function cleanBuild(): void {
  if (BUILT === undefined) return;
  rmSync(BUILT, { recursive: true, force: true });
  BUILT = undefined;
}

function serve(built: string, stub: ApiStub): Promise<{ server: Server; origin: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      // Match on path alone: the stub is keyed by route, and a query string is
      // the client's business rather than the fixture's.
      const body = stub[path];
      if (body === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', message: `no stub for ${path}` } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    const file = path === '/' ? '/index.html' : path;
    const onDisk = join(built, file);
    // The SPA owns its own routing, so anything without an extension is a route
    // and gets the document — the same fallback the real server applies.
    const target = existsSync(onDisk) && extname(file) !== '' ? onDisk : join(built, 'index.html');

    res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(readFileSync(target));
  });

  return new Promise((resolve) => {
    // Port 0: the OS picks a free one, so parallel runs cannot collide.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${String(port)}` });
    });
  });
}

let shared: Browser | undefined;

/** One browser for the whole file — launching costs more than every test in it. */
async function browser(): Promise<Browser> {
  shared ??= await chromium.launch();
  return shared;
}

export async function closeBrowser(): Promise<void> {
  await shared?.close();
  shared = undefined;
  cleanBuild();
}

/** Open `path` in a real browser, against the built SPA and a stubbed API. */
export async function open(path: string, stub: ApiStub): Promise<Harness> {
  const { server, origin } = await serve(ensureBuilt(), stub);
  const page = await (await browser()).newPage();
  await page.goto(`${origin}${path}`);

  return {
    page,
    origin,
    close: async () => {
      await page.close();
      await new Promise((done) => server.close(done));
    },
  };
}
