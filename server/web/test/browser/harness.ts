import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
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
const BUILT = join(WEB_ROOT, '..', 'public');

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
 * Build the SPA if it is not there.
 *
 * `server/public/` is build output and gitignored, so a fresh checkout has none.
 * Building takes ~150ms; requiring the caller to remember is how a suite starts
 * failing for reasons that are nothing to do with the code.
 */
function ensureBuilt(): void {
  if (existsSync(join(BUILT, 'index.html'))) return;
  execFileSync('npx', ['vite', 'build'], { cwd: WEB_ROOT, stdio: 'inherit' });
}

function serve(stub: ApiStub): Promise<{ server: Server; origin: string }> {
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
    const onDisk = join(BUILT, file);
    // The SPA owns its own routing, so anything without an extension is a route
    // and gets the document — the same fallback the real server applies.
    const target = existsSync(onDisk) && extname(file) !== '' ? onDisk : join(BUILT, 'index.html');

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
}

/** Open `path` in a real browser, against the built SPA and a stubbed API. */
export async function open(path: string, stub: ApiStub): Promise<Harness> {
  ensureBuilt();
  const { server, origin } = await serve(stub);
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
