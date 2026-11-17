import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type AppEnv } from '../../src/http/context.ts';
import { createSecurityHeaders } from '../../src/http/middleware/security-headers.ts';
import { buildContentSecurityPolicy } from '../../src/http/security-headers.ts';
import { IMMUTABLE, REVALIDATE } from '../../src/http/static-cache.ts';
import { isReservedPath } from '../../src/http/static.ts';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * The web-serve image (LAI-1308) serves the SPA from nginx, with a copy of the
 * server's response headers and CSP in `docker/web/`. A copy drifts the day
 * either side changes, and nothing else would notice: CI never builds that
 * stage, and the deploy builds only `runtime`.
 *
 * So this renders the config the way the image does at start, and holds it to
 * the server's own code, run rather than read: the CSP to
 * `buildContentSecurityPolicy`, the headers to what the middleware actually
 * sets, the reserved paths to `isReservedPath`.
 *
 * `docker/` is SHELL's under D-016. This reads it and never writes it.
 */

const REPO = join(SERVER_ROOT, '..');
const DOCKERFILE = join(REPO, 'docker', 'Dockerfile');
const DOCKERIGNORE = join(REPO, 'docker', 'Dockerfile.dockerignore');
const TEMPLATE = join(REPO, 'docker', 'web', 'default.conf.template');
const HEADERS = join(REPO, 'docker', 'web', 'security-headers.conf');
const INDEX_HTML = join(SERVER_ROOT, 'web', 'index.html');

const STORE = 'https://store.example';

const read = (path: string): string => readFileSync(path, 'utf8');

/** nginx config without its `#` comments. A `#` inside quotes is kept. */
function withoutComments(conf: string): string {
  return conf
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quote !== null) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '#') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/**
 * What the image's `20-envsubst-on-templates.sh` does: `envsubst` given the
 * defined names, which replaces `$NAME` and `${NAME}` for those names and leaves
 * every other `$` as it was.
 */
function envsubst(text: string, env: ReadonlyMap<string, string>): string {
  return text.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (whole: string, braced: string | undefined, bare: string | undefined) =>
      env.get(braced ?? bare ?? '') ?? whole,
  );
}

/** The server block nginx loads for one value of `LAIKA_STORAGE_ORIGIN`. */
function rendered(storageOrigin: string): string {
  return withoutComments(
    envsubst(read(TEMPLATE), new Map([['LAIKA_STORAGE_ORIGIN', storageOrigin]])),
  );
}

/**
 * An nginx `map`, evaluated: the entry whose key equals the source exactly,
 * else `default`, else empty — nginx's order for literal keys. A regex key
 * (`~…`) is not understood and fails the parse rather than being misread.
 */
function evaluateMap(conf: string, variable: string): string {
  const block = new RegExp(`map\\s+"([^"]*)"\\s+\\$${variable}\\s*\\{([^}]*)\\}`).exec(conf);
  if (block === null) throw new Error(`no map defines $${variable}`);

  const [, source, body] = block;
  let fallback = '';
  for (const raw of body!.split(';')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const parsed = /^(?:default|"([^"]*)")\s+"([^"]*)"$/.exec(entry);
    if (parsed === null) throw new Error(`map entry not understood: ${entry}`);
    const [, key, value] = parsed;
    if (key === undefined) fallback = value!;
    else if (key === source) return value!;
  }
  return fallback;
}

interface AddHeader {
  name: string;
  value: string;
  always: boolean;
}

function addHeaders(conf: string): AddHeader[] {
  return [...conf.matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"(\s+always)?\s*;/gm)].map((m) => ({
    name: m[1]!,
    value: m[2]!,
    always: m[3] !== undefined,
  }));
}

/** The security headers nginx sends, lower-cased, with the store resolved. */
function servedHeaders(storageOrigin: string): Map<string, string> {
  const sources = evaluateMap(rendered(storageOrigin), 'laika_store_sources');
  return new Map(
    addHeaders(withoutComments(read(HEADERS))).map((h) => [
      h.name.toLowerCase(),
      h.value.replaceAll('$laika_store_sources', () => sources),
    ]),
  );
}

/**
 * The headers the server's middleware adds, found by running it over HTTPS
 * (as the proxy reports it) and taking away what the same app sends without it.
 */
async function middlewareHeaders(policy: string): Promise<Map<string, string>> {
  const respond = async (withMiddleware: boolean): Promise<Headers> => {
    const app = new Hono<AppEnv>();
    if (withMiddleware) app.use('*', createSecurityHeaders(policy));
    app.get('/', (c) => c.body(null, 204));
    const res = await app.request('/', { headers: { 'X-Forwarded-Proto': 'https' } });
    return res.headers;
  };

  const bare = new Set((await respond(false)).keys());
  return new Map([...(await respond(true)).entries()].filter(([name]) => !bare.has(name)));
}

/** `location <match> { <body> }` blocks. None of ours nests braces. */
function locations(conf: string): { match: string; body: string }[] {
  return [...conf.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((m) => ({
    match: m[1]!,
    body: m[2]!,
  }));
}

/** The one location whose match is exactly `match`. */
function location(conf: string, match: string): string {
  const found = locations(conf).filter((l) => l.match === match);
  expect(found, `location ${match}`).toHaveLength(1);
  return found[0]!.body;
}

interface Stage {
  image: string;
  name: string;
  /** Its instructions, with `\` continuations joined onto one line. */
  body: string;
}

function stages(dockerfile: string): Stage[] {
  const joined = dockerfile.replace(/\\\n\s*/g, ' ');
  const froms = [...joined.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/gm)];
  return froms.map((m, i) => ({
    image: m[1]!,
    name: m[2] ?? '',
    body: joined.slice(m.index, froms[i + 1]?.index ?? joined.length),
  }));
}

function webServeStage(): Stage {
  const stage = stages(read(DOCKERFILE)).find((s) => s.name === 'web-serve');
  if (stage === undefined) throw new Error('docker/Dockerfile has no web-serve stage');
  return stage;
}

/** `COPY` lines from the build context (not `--from`), as source → destination. */
function contextCopies(stage: Stage): Map<string, string> {
  return new Map(
    [...stage.body.matchAll(/^COPY\s+(.+)$/gm)]
      .map((m) => m[1]!.split(/\s+/))
      .filter((args) => !args.some((a) => a.startsWith('--from=')))
      .map((args) => args.filter((a) => !a.startsWith('--')))
      .map((args) => [args[0]!, args[1]!]),
  );
}

describe('web-serve: the CSP is the server’s (LAI-1308)', () => {
  it('is the attachments-off policy when LAIKA_STORAGE_ORIGIN is empty', () => {
    expect(servedHeaders('').get('content-security-policy')).toBe(
      buildContentSecurityPolicy([], { storageOrigin: null }),
    );
  });

  it('adds the store exactly where the server does when it is set', () => {
    expect(servedHeaders(STORE).get('content-security-policy')).toBe(
      buildContentSecurityPolicy([], { storageOrigin: STORE }),
    );
  });

  it('defines LAIKA_STORAGE_ORIGIN in the image and substitutes only LAIKA_ names', () => {
    // Undefined, envsubst would leave `${LAIKA_STORAGE_ORIGIN}` in the config
    // for nginx to read as a variable of its own.
    const { body } = webServeStage();
    expect(body).toMatch(/^ENV .*\bLAIKA_STORAGE_ORIGIN=""/m);
    expect(body).toMatch(/^ENV .*\bNGINX_ENVSUBST_FILTER=\^LAIKA_(\s|$)/m);
  });
});

describe('web-serve: the headers are the middleware’s', () => {
  it('sends every header the middleware sets, with its value, and no other', async () => {
    const served = servedHeaders('');
    const server = await middlewareHeaders(buildContentSecurityPolicy([], { storageOrigin: null }));

    expect([...served.entries()].sort()).toEqual([...server.entries()].sort());
  });

  it('sends them on every status, 404s included', () => {
    const notAlways = addHeaders(withoutComments(read(HEADERS)))
      .filter((h) => !h.always)
      .map((h) => h.name);
    expect(notAlways).toEqual([]);
  });

  it('includes them in the server block and in every location that sets a header', () => {
    // nginx drops the outer add_header lines from a block that has any of its
    // own, so a location with a Cache-Control and no include answers bare.
    const conf = rendered('');
    const destination = contextCopies(webServeStage()).get('docker/web/security-headers.conf');
    expect(destination, 'the stage copies docker/web/security-headers.conf').toBeDefined();
    const include = `include ${destination};`;

    const outside = conf.replace(/location\s+[^{]+\{[^}]*\}/g, '');
    expect(outside).toContain(include);

    const bare = locations(conf)
      .filter((l) => /\badd_header\b/.test(l.body) && !l.body.includes(include))
      .map((l) => l.match);
    expect(bare).toEqual([]);
  });
});

describe('web-serve: what it answers', () => {
  it('answers 404 for exactly the paths the server reserves, and for source maps', () => {
    const notFound = locations(rendered(''))
      .filter((l) => l.body.trim() === 'return 404;')
      .map((l) => {
        const [, modifier, pattern] = /^(~\*?)\s+(\S+)$/.exec(l.match) ?? [];
        if (pattern === undefined) throw new Error(`not a regex location: ${l.match}`);
        return new RegExp(pattern, modifier === '~*' ? 'i' : '');
      });
    const refused = (path: string) => notFound.some((re) => re.test(path));

    const paths = [
      '/api',
      '/api/',
      '/api/v1/health',
      '/apix',
      '/mcp',
      '/mcp/',
      '/mcpx',
      '/webhooks',
      '/webhooks/github',
      '/webhooksx',
      '/x/api',
      '/',
      '/my-day',
      '/board/LAI-1',
      '/assets/index-jTGqQcjA.js',
      '/index.html',
      '/healthz',
    ];
    expect(paths.filter(refused)).toEqual(paths.filter(isReservedPath));
    expect(refused('/assets/index-jTGqQcjA.js.map')).toBe(true);
  });

  it('caches hashed assets as the server does, and refuses a missing one', () => {
    const assets = location(rendered(''), '/assets/');
    expect(addHeaders(assets).find((h) => h.name === 'Cache-Control')?.value).toBe(IMMUTABLE);
    expect(assets).toMatch(/^\s*try_files \$uri =404;/m);
  });

  it('serves the document for every other route, revalidated every time', () => {
    const conf = rendered('');
    expect(location(conf, '/')).toMatch(/^\s*try_files \$uri \/index\.html;/m);
    for (const match of ['/', '= /index.html']) {
      const value = addHeaders(location(conf, match)).find((h) => h.name === 'Cache-Control');
      expect(value?.value, match).toBe(REVALIDATE);
    }
  });

  it('names no nginx version and compresses text', () => {
    const conf = rendered('');
    expect(conf).toMatch(/^\s*server_tokens off;/m);
    expect(conf).toMatch(/^\s*gzip on;/m);
    const types = /^\s*gzip_types ([^;]+);/m.exec(conf)?.[1]?.split(/\s+/) ?? [];
    expect(types).toEqual(
      expect.arrayContaining([
        'text/css',
        'application/javascript',
        'application/json',
        'image/svg+xml',
      ]),
    );
  });
});

describe('web-serve: the Dockerfile stage', () => {
  it('sits above runtime, which stays the last stage and so the default target', () => {
    const names = stages(read(DOCKERFILE)).map((s) => s.name);
    expect(names.at(-1)).toBe('runtime');
    expect(names.indexOf('web-serve')).toBeGreaterThan(names.indexOf('web'));
    expect(names.indexOf('web-serve')).toBeLessThan(names.indexOf('runtime'));
  });

  it('pins nginx-unprivileged by version and by digest', () => {
    expect(webServeStage().image).toMatch(
      /^nginxinc\/nginx-unprivileged:\d+\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$/,
    );
  });

  it('serves the web stage’s build, with the template where the image renders it', () => {
    const stage = webServeStage();
    expect(stage.body).toMatch(/^COPY --from=web (--\S+ )*\/out \/usr\/share\/nginx\/html$/m);
    expect(contextCopies(stage).get('docker/web/default.conf.template')).toBe(
      '/etc/nginx/templates/default.conf.template',
    );
  });

  it('runs as nginx, and its health check reaches the port and path nginx serves', () => {
    const { body } = webServeStage();
    const conf = rendered('');
    const port = /^\s*listen (\d+);/m.exec(conf)?.[1];

    expect([...body.matchAll(/^USER (\S+)$/gm)].at(-1)?.[1]).toBe('nginx');
    expect(body).toMatch(new RegExp(`^EXPOSE ${port}$`, 'm'));

    const check =
      /^HEALTHCHECK .*CMD \["wget", "-q", "-O", "\/dev\/null", "http:\/\/127\.0\.0\.1:(\d+)(\/[^"]*)"\]$/m.exec(
        body,
      );
    expect(check?.[1]).toBe(port);
    expect(location(conf, `= ${check?.[2]}`)).toMatch(/^\s*return 200 /m);
  });

  it('keeps every file the stage copies in the build context', () => {
    // By the ignore file's literal entries only: the last one equal to the path
    // or to a directory above it decides. Glob entries are not evaluated, so
    // this proves that docker/'s own exclusion is undone for these files.
    const entries = read(DOCKERIGNORE)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const kept = (path: string): boolean => {
      const decisive = entries.filter((e) => {
        const p = e.replace(/^!/, '');
        return path === p || path.startsWith(`${p}/`);
      });
      return decisive.at(-1)?.startsWith('!') ?? true;
    };

    const sources = [...contextCopies(webServeStage()).keys()];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((s) => !kept(s))).toEqual([]);
  });
});

describe('web-serve: the SPA document needs no inline anything', () => {
  it('has no inline <style> or <script> and no event-handler attribute in server/web/index.html', () => {
    // The static CSP carries no hashes, so the browser would refuse any of
    // these. Comments go first: the file's own comments name both tags.
    const html = read(INDEX_HTML).replace(/<!--[\s\S]*?-->/g, '');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

    expect(html).not.toMatch(/<style[\s>]/i);
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, content] of scripts) {
      expect(attributes).toMatch(/\ssrc=/);
      expect(content!.trim()).toBe('');
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
