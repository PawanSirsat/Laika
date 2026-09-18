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

/** What the stub saw. Recorded for every `/api/` call, in arrival order. */
export interface StubCall {
  readonly method: string;
  readonly path: string;
  /** The parsed JSON body, or `undefined` for a request that sent none. */
  readonly body: unknown;
}

const REPLY = Symbol('laika.stub.reply');

interface StubReply {
  readonly [REPLY]: true;
  readonly status: number;
  readonly body: unknown;
}

/**
 * A non-200 answer from the stub.
 *
 * A symbol key rather than a `{status, body}` shape that a *fixture* could also
 * have: `GET /health` legitimately returns something with a `status` field, and
 * a marker that a plain fixture can accidentally wear is a stub that silently
 * answers `503` because the response happened to look like a directive.
 */
export function reply(status: number, body: unknown): StubReply {
  return { [REPLY]: true, status, body };
}

/** An API error envelope, the shape `toApiError` reads. */
export function refuse(status: number, code: string, message: string): StubReply {
  return reply(status, { error: { code, message } });
}

/**
 * What a route answers with: a JSON fixture, a {@link reply}, or a function of
 * the request returning either.
 *
 * Plain `unknown`, not a union with the function signature — a union containing
 * `unknown` collapses to `unknown`, so spelling the alternatives out would read
 * as precision the type does not have. The shape a caller needs is in this
 * comment and in {@link StubCall}.
 */
export type StubRoute = unknown;

/**
 * Route → JSON. Anything unlisted 404s loudly rather than silently emptying.
 *
 * **A key may carry a query string, and then it is required** (LAI-241):
 * `'/api/v1/users?include_inactive=true'` is served only to a request that
 * actually sends it. Matching is by **subset** — the key names the parameters it
 * cares about, and the request may carry others (`cursor` on a later page).
 *
 * **Opt in, not opt out.** A key with no `?` behaves exactly as it always did
 * and ignores the query, which is right for most fixtures. But once *any* key
 * for a path names a query, an unmatched request to that path **does not fall
 * through to the path-only stub** — falling through is the very defect this
 * exists to close, with an extra step. It is refused and recorded in
 * {@link Harness.unmatched}.
 */
export type ApiStub = Readonly<Record<string, StubRoute>>;

export interface Harness {
  readonly page: Page;
  readonly origin: string;
  /** Every `/api/` call the page made, in order. Live — read it after acting. */
  readonly calls: readonly StubCall[];
  /**
   * Requests refused because a query-keyed stub existed for the path and none
   * matched, each as the **full URL that was actually requested** — the thing
   * you need to see, and the thing a 404 body alone would hide from the test.
   */
  readonly unmatched: readonly string[];
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

function isReply(value: unknown): value is StubReply {
  return typeof value === 'object' && value !== null && REPLY in value;
}

interface Candidate {
  readonly route: StubRoute;
  /** The parameters this key demands. Empty for a path-only key. */
  readonly required: readonly (readonly [string, string])[];
}

/**
 * Which stub answers this request, or `'refused'` if a query-keyed one said no.
 *
 * **Subset matching, most specific first.** A key names the parameters it cares
 * about and the request may carry others — `listAllUsers` adds `cursor` on a
 * later page, and a fixture should not have to predict that. Sorting by how many
 * a key demands means `?a=1&b=2` wins over `?a=1` when both fit, so a narrower
 * fixture is never shadowed by a broader one declared earlier.
 */
function pick(
  stub: ApiStub,
  path: string,
  query: URLSearchParams,
): { route: StubRoute } | 'refused' | undefined {
  const candidates: Candidate[] = [];
  for (const [key, route] of Object.entries(stub)) {
    const mark = key.indexOf('?');
    if ((mark === -1 ? key : key.slice(0, mark)) !== path) continue;
    candidates.push({
      route,
      required: mark === -1 ? [] : [...new URLSearchParams(key.slice(mark + 1)).entries()],
    });
  }
  if (candidates.length === 0) return undefined;

  const keyed = candidates.filter((c) => c.required.length > 0);
  if (keyed.length === 0) {
    // No key for this path mentions a query, so the old behaviour stands and the
    // query is ignored. This is the common case, and it is the default.
    return { route: candidates[0]!.route };
  }

  const fits = keyed
    .filter((c) => c.required.every(([name, value]) => query.get(name) === value))
    .sort((a, b) => b.required.length - a.required.length);

  if (fits.length > 0) return { route: fits[0]!.route };

  // **Deliberately not falling back to a path-only stub.** Once a fixture says a
  // request must carry a query, answering one that does not is precisely the
  // blindness this exists to remove — with an extra step.
  return 'refused';
}

function serve(
  built: string,
  stub: ApiStub,
  calls: StubCall[],
  unmatched: string[],
): Promise<{ server: Server; origin: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      // Read the body before answering — a route function is allowed to decide
      // on it, and `PATCH {is_active:false}` differs from `PATCH {org_role}`.
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let sent: unknown;
        try {
          sent = raw === '' ? undefined : JSON.parse(raw);
        } catch {
          // Not JSON. Record it as it arrived rather than dropping the call:
          // a request the stub cannot parse is itself worth being able to see.
          sent = raw;
        }
        const call: StubCall = { method: req.method ?? 'GET', path, body: sent };
        calls.push(call);

        // Path alone by default — the stub is keyed by route, and a query
        // string is usually the client's business rather than the fixture's.
        // A key that *names* a query opts that path into caring (LAI-241).
        const chosen = pick(stub, path, url.searchParams);

        if (chosen === undefined) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'not_found', message: `no stub for ${path}` } }));
          return;
        }

        if (chosen === 'refused') {
          // **Loud, and naming what was actually requested.** A silent fall
          // through to a path-only stub is the original defect; a 404 body alone
          // would tell the browser and not the test, so it is recorded too.
          const asked = req.url ?? path;
          unmatched.push(asked);
          const declared = Object.keys(stub).filter((k) => k.startsWith(`${path}?`));
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 'not_found',
                message:
                  `no stub matched ${asked} — this path has query-keyed stubs and none ` +
                  `of them fits. Declared: ${declared.join(', ')}`,
              },
            }),
          );
          return;
        }

        const { route } = chosen;
        const answer =
          typeof route === 'function' ? (route as (c: StubCall) => unknown)(call) : route;
        const { status, body } = isReply(answer) ? answer : { status: 200, body: answer };
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
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

/**
 * Put the page in a theme **through the real control** (LAI-249).
 *
 * The control became the design's two-state `ThemeSwitch`, so "select Dark"
 * is now "click if not already dark" — this helper keeps the property the old
 * radio clicks had: a JS-computed colour bug hides from a class-toggle
 * shortcut, and the theme is what these tests are about.
 */
export async function setTheme(page: Page, theme: string) {
  const wantDark = theme.toLowerCase() === 'dark';
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dk'));
  if (wantDark !== isDark) await page.locator('.theme-switch').first().click();
  await page.waitForFunction(
    (want: boolean) => document.documentElement.classList.contains('dk') === want,
    wantDark,
    { timeout: 5000 },
  );
}

/** Open `path` in a real browser, against the built SPA and a stubbed API. */
export async function open(path: string, stub: ApiStub): Promise<Harness> {
  const calls: StubCall[] = [];
  const unmatched: string[] = [];
  const { server, origin } = await serve(ensureBuilt(), stub, calls, unmatched);
  const page = await (await browser()).newPage();
  await page.goto(`${origin}${path}`);

  return {
    page,
    origin,
    calls,
    unmatched,
    close: async () => {
      await page.close();
      await new Promise((done) => server.close(done));
    },
  };
}
