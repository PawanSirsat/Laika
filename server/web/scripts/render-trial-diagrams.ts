/**
 * Mermaid for the deliverable trial (LAI-1131): the CSP spike, and the
 * pre-render that replaces it.
 *
 *     npx tsx scripts/render-trial-diagrams.ts --spike   # report, write nothing
 *     npx tsx scripts/render-trial-diagrams.ts           # write the SVGs
 *
 * **`--spike`** serves Mermaid's own ESM build from this origin under the
 * **production** Content-Security-Policy (built by the server's own
 * `buildContentSecurityPolicy`, not a copy), renders every diagram in the
 * trial fixtures in real Chromium, and prints each `securitypolicyviolation`
 * the page raised. It exits 1 if there were any — that is the finding, not a
 * failure of the script.
 *
 * **Default** renders the same diagrams with no CSP, in a light and a dark
 * theme, and writes them to `src/components/documents/trial/diagrams/` as
 * `<key>-light.svg` / `<key>-dark.svg`, `key` being {@link diagramKey} of the
 * source. The page shows them as `<img>`, which `img-src 'self'` allows and
 * which isolates the SVG's own `<style>` from the page's policy. Mermaid is a
 * devDependency for exactly this reason: it runs here, never in the bundle.
 *
 * `trial-diagrams.test.ts` fails if a fixture gains a diagram this script has
 * not drawn, so a stale picture cannot ship.
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { diagramKey, mermaidSources } from '../src/components/documents/diagram-key.ts';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const TRIAL = join(WEB, 'src', 'components', 'documents', 'trial');
const FIXTURES = join(TRIAL, 'fixtures');
const OUT = join(TRIAL, 'diagrams');
const MERMAID = join(WEB, 'node_modules', 'mermaid', 'dist');

const spike = process.argv.includes('--spike');

/** Every distinct diagram across the fixtures, keyed. */
function diagrams(): Map<string, string> {
  const all = new Map<string, string>();
  for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith('.md'))) {
    for (const source of mermaidSources(readFileSync(join(FIXTURES, name), 'utf8'))) {
      all.set(diagramKey(source), source);
    }
  }
  return all;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>mermaid</title></head>
<body><main id="root"></main><script type="module" src="/run.mjs"></script></body></html>`;

const RUN = `import mermaid from '/mermaid/mermaid.esm.min.mjs';
window.__render = async (id, source, dark) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  });
  const { svg } = await mermaid.render(id, source);
  return svg;
};
window.__ready = true;`;

const TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.map': 'application/json',
};

/**
 * The server's own policy builder, loaded by path: `server/src` is outside
 * this package's `rootDir`, so a static import does not typecheck here, and a
 * copied string would drift from the real header.
 */
async function productionCsp(): Promise<string> {
  const url = pathToFileURL(join(WEB, '..', 'src', 'http', 'security-headers.ts')).href;
  const mod = (await import(url)) as { buildContentSecurityPolicy: (h: string[]) => string };
  return mod.buildContentSecurityPolicy([]);
}

async function main(): Promise<void> {
  const csp = await productionCsp();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const headers: Record<string, string> = spike ? { 'content-security-policy': csp } : {};
    if (path === '/') {
      res.writeHead(200, { ...headers, 'content-type': 'text/html' });
      res.end(PAGE);
      return;
    }
    if (path === '/run.mjs') {
      res.writeHead(200, { ...headers, 'content-type': 'text/javascript' });
      res.end(RUN);
      return;
    }
    if (path.startsWith('/mermaid/')) {
      const file = normalize(join(MERMAID, path.slice('/mermaid/'.length)));
      if (file.startsWith(MERMAID) && existsSync(file)) {
        res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] ?? 'text/plain' });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__violations.push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`);
    });
  });
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${String(port)}/`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

  const all = diagrams();
  let n = 0;
  const written = new Set<string>();
  for (const [key, source] of all) {
    for (const dark of [false, true]) {
      n++;
      const svg = await page.evaluate(
        async ([id, src, d]) =>
          (
            window as unknown as {
              __render: (i: string, s: string, d: boolean) => Promise<string>;
            }
          ).__render(id, src, d),
        [`d${String(n)}`, source, dark] as const,
      );
      if (spike) {
        // Put the SVG in the document the way a runtime renderer would, so its
        // own <style> meets the page's policy too.
        await page.evaluate((markup) => {
          const host = document.createElement('div');
          host.innerHTML = markup;
          document.body.append(host);
        }, svg);
        continue;
      }
      const name = `${key}-${dark ? 'dark' : 'light'}.svg`;
      writeFileSync(join(OUT, name), `${svg}\n`);
      written.add(name);
    }
  }

  const violations = await page.evaluate(
    () => (window as unknown as { __violations: string[] }).__violations,
  );
  await browser.close();
  server.close();

  if (spike) {
    const distinct = [...new Set(violations)];
    console.log(`policy: ${csp}`);
    console.log(`${String(all.size)} diagrams rendered, ${String(violations.length)} violations`);
    for (const v of distinct) console.log(`  ${v}`);
    for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log(`  console: ${e}`);
    process.exitCode = violations.length > 0 ? 1 : 0;
    return;
  }

  // A diagram no fixture names any more takes its pictures with it.
  for (const file of readdirSync(OUT).filter((f) => f.endsWith('.svg'))) {
    if (!written.has(file)) unlinkSync(join(OUT, file));
  }
  console.log(`${String(written.size)} SVGs for ${String(all.size)} diagrams in ${OUT}`);
}

await main();
