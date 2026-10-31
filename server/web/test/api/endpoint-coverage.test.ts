/**
 * Every endpoint the server mounts has a caller, or says why not (LAI-460).
 *
 * ## The axis that was missing
 *
 * `docs/CONVENTIONS.md` §5.1 lists six drift checks and **every one compares two
 * things that both exist**. This one has to notice that the second thing is
 * *absent* — and absence has no runtime consequence, so nothing else applies
 * pressure to it.
 *
 * Three features were found built, tested, served and unreachable in a single
 * manual sweep: the Dashboard's metrics (LAI-457), watching and `@` mentions
 * (LAI-458), and org settings (LAI-459). **The server tests passed because the
 * endpoints work; the web tests passed because the screens render. The defect
 * was in the gap.**
 *
 * ## Why this check is the one most likely to pass by finding nothing
 *
 * Two empty sets compare equal, and its whole job is to notice absence. So both
 * sides are asserted non-empty first, and three further guards keep it honest:
 *
 * 1. **Every mounted factory is parsed.** A factory that is mounted but whose
 *    routes are not read contributes nothing and looks like full coverage.
 * 2. **Nothing is called that is not served.** This is the false-positive
 *    detector, and it caught three real parser bugs while this was written —
 *    a regex that stopped at the first `>` and so missed every nested generic
 *    like `request<Page<Task>>`; `${…}` stripping that could not handle the
 *    braces inside `${x === '' ? '' : …}`; and stripping applied before the
 *    path was split, which turned `/projects/${slug}/tasks` into
 *    `projects/tasks`. **A false positive here is worse than no check**,
 *    because the exemption list absorbs it and then hides a real one.
 * 3. **Every call site passes a literal.** A path built from a variable would
 *    be invisible to the scan, and the scan going blind looks exactly like the
 *    product being fully wired.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const SERVER = fileURLToPath(new URL('../../../src/', import.meta.url));
const WEB = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * Endpoints with no browser caller, and the reason.
 *
 * **A screen that has not been built yet is not an exemption — it is a task
 * id.** Only a genuinely non-browser caller belongs in the first group.
 */
const NO_BROWSER_CALLER: Readonly<Record<string, string>> = {
  /*
   * **The only half of LAI-458 still open.** LAI-284 wired watching *a task* —
   * `PUT`/`DELETE /tasks/:id/watch` and `GET /tasks/:id/watchers` are called
   * from the task panel — but *"the tasks I watch"* is a list screen nobody has
   * built, and there is nowhere in the app to put it yet.
   */
  'api/v1/me/watching': 'LAI-458 — a "tasks I watch" screen does not exist',
  // Called by something that is not the SPA.
  'webhooks/github': 'GitHub posts here (§9.2); no browser is involved',
  'webhooks/transcript': 'a meeting bot or script posts here (D-052); signed, not session-authed',
  'api/v1/heartbeats': "the plugin's SessionStart/Stop hooks post this (LAI-418), never the SPA",
  'api/v1/tasks/*/finish':
    "finish_task's REST twin (D-082): an agent hands work back for review; a person accepts or sends back instead",
  // LAI-773: Claude Code's own OTLP exporter posts metrics here with the
  // developer's token; the SPA only prints the settings that point it here.
  'api/v1/otlp/v1/metrics':
    "Claude Code's OpenTelemetry exporter posts here (LAI-773); Connect only prints its settings",
  'api/v1/otlp/v1/*':
    'logs and traces are refused there (LAI-773): no client is meant to call them, and none does',
  // LAI-788: the Solidtime bridge is the person's CLI, which holds their
  // Solidtime key on their machine — the browser never has it, and the board
  // never calls Solidtime. The CLI signs in for the run.
  'api/v1/me/time/solidtime':
    'laika time push reads it (LAI-788); only the CLI holds a Solidtime key',
  'api/v1/me/time/solidtime/links': 'laika time push records what it wrote (LAI-788)',
  'api/v1/me/time/solidtime/import': 'laika time pull sends what it read (LAI-788)',
  'api/v1/org/time/solidtime': 'laika time map and people read it (LAI-788)',
  'api/v1/org/time/solidtime/projects': 'laika time map writes it (LAI-788)',
  'api/v1/org/time/solidtime/people': 'laika time people writes it (LAI-788)',
  'api/v1/org/time/solidtime/import': 'laika time pull --all sends everyone’s (LAI-788)',
  // LAI-535 serves it, LAI-566 names it: an agent reads its own open work
  // requests. Permanent — the SPA holds a session, never an agent's token.
  'api/v1/agents/me/work-requests':
    'agent-token only, a session is `403 not_an_agent`; agents read it through MCP `list_ready_tasks`',
  // LAI-541 serves them, LAI-567 names them. Permanent for the same reason: an
  // agent's session and its explicit reclaim are its own token's acts, and the
  // SPA holds a person's session. A person sees their effect on the card
  // (LAI-543) and never calls them.
  'api/v1/agent-sessions':
    'agent-token only, a session is `403 not_an_agent`; the local helper (LAI-542) and MCP `start_working` call it',
  'api/v1/agent-sessions/*/heartbeat':
    'agent-token only, a session is `403 not_an_agent`; the local helper (LAI-542) and MCP `start_working` call it',
  'api/v1/agent-sessions/*/end':
    'agent-token only, a session is `403 not_an_agent`; the local helper (LAI-542) and MCP `start_working` call it',
  'api/v1/tasks/*/claim/reclaim':
    'agent-token only, a session is `403 not_an_agent`; the local helper (LAI-542) and MCP `start_working` call it',
  // LAI-545 and LAI-546 serve them, LAI-549 names them. Permanent for the same
  // reason: re-tagging a save, reading an agent's inbox, and accepting or
  // declining an offer are a registered agent's acts (§3.2), and the SPA holds
  // a person's session. A person reads the saves and offers on the task
  // (`GET /tasks/:id/checkpoints`, `/handoff-offers`) and approves or
  // withdraws an offer — both called from the task drawer.
  'api/v1/checkpoints/*/refs':
    'agent-token only (`task.checkpoint.retag`); `laika agent checkpoint reverify` (D-116 item 7) calls it',
  'api/v1/agents/me/inbox':
    'agent-token only, a session is `403 not_an_agent`; MCP `agent_sync` is its twin',
  'api/v1/handoff-offers/*/accept':
    'agent-token only, a session is `403 not_an_agent`; `laika agent accept` (LAI-548) and MCP `respond_handoff` call it',
  'api/v1/handoff-offers/*/decline':
    'agent-token only, a session is `403 not_an_agent`; MCP `respond_handoff` calls it',
  // LAI-553 serves them. Permanent for the same reason: an agent's event feed
  // and its delivery acknowledgements are its own token's acts, and the SPA
  // holds a person's session. A person sees offers on the task and the
  // Hand-offs inbox, never the agent's delivery states.
  'api/v1/agents/me/events':
    'agent-token only, a session is `403 not_an_agent`; the local helper (LAI-554) polls it and MCP `agent_sync` is its twin',
  'api/v1/agents/me/events/ack':
    'agent-token only, a session is `403 not_an_agent`; the local helper (LAI-554) records received and presented with it',

  // Built, served, and waiting on a screen. Each names the task, not a reason.
  'api/v1/comments/*': 'LAI-234 — a comment cannot be edited or deleted from the UI',
  'api/v1/projects/*/tags/*': 'LAI-235 — a tag cannot be removed from a project',
  'api/v1/activity': 'LAI-237 — the org-wide feed; only the per-project one is read',
};

/** `${...}`, removed with a scanner because a regex cannot match balanced braces. */
function stripInterpolations(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        i += 1;
      }
      i -= 1;
      continue;
    }
    out += text[i];
  }
  return out;
}

/**
 * One comparable shape for both sides.
 *
 * **Per segment, and stripping happens inside the segment.** Stripping the whole
 * path first turns `/projects/${slug}/tasks` into `/projects//tasks`, and
 * dropping the empty piece loses the parameter entirely.
 */
function normalise(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return '*';
      const stripped = stripInterpolations(segment).split('?')[0] ?? '';
      if (stripped === '' && segment.includes('${')) return '*';
      return stripped;
    })
    .filter((segment) => segment !== '')
    .join('/');
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`],
  );
}

const appSource = readFileSync(`${SERVER}app.ts`, 'utf8');
const API_BASE = /const API_BASE = ['"`]([^'"`]+)/.exec(appSource)?.[1] ?? '/api/v1';

/** Factory name → the prefixes it is mounted at. One factory may have several. */
function mountedFactories(): ReadonlyMap<string, string[]> {
  const mounts = new Map<string, string[]>();
  for (const m of appSource.matchAll(
    /app\.route\(\s*([`'"][^`'"]*[`'"])\s*,\s*([A-Za-z]+)\s*\(/g,
  )) {
    const prefix = (m[1] ?? '').slice(1, -1).replace('${API_BASE}', API_BASE);
    const factory = m[2] ?? '';
    mounts.set(factory, [...(mounts.get(factory) ?? []), prefix]);
  }
  return mounts;
}

/**
 * Routes attributed to the factory that declares them, by body extent.
 *
 * **Not by file.** `tasks.ts` exports `projectTaskRoutes` and `taskRoutes`,
 * mounted at `/projects` and `/tasks`; attributing a file's routes to both
 * prefixes is the cross-product that invents `GET /activity/:slug/metrics`.
 */
function routesByFactory(): ReadonlyMap<string, { path: string }[]> {
  const byFactory = new Map<string, { path: string }[]>();
  for (const file of readdirSync(`${SERVER}http/routes`).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(`${SERVER}http/routes/${file}`, 'utf8');
    const factories = [...source.matchAll(/export function ([A-Za-z]+Routes)\s*\(/g)];
    for (const [index, match] of factories.entries()) {
      const next = factories[index + 1];
      const body = source.slice(match.index, next === undefined ? source.length : next.index);
      byFactory.set(
        match[1] ?? '',
        [...body.matchAll(/app\.(?:get|post|patch|delete|put)\(\s*['"`]([^'"`]*)['"`]/g)].map(
          (r) => ({ path: r[1] ?? '' }),
        ),
      );
    }
  }
  return byFactory;
}

function servedPaths(): ReadonlySet<string> {
  const mounts = mountedFactories();
  const routes = routesByFactory();
  const served = new Set<string>();
  for (const [factory, prefixes] of mounts) {
    for (const prefix of prefixes) {
      for (const route of routes.get(factory) ?? []) {
        served.add(normalise(`${prefix}/${route.path}`));
      }
    }
  }
  return served;
}

const clientFiles = walk(WEB).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

function calledPaths(): ReadonlySet<string> {
  const called = new Set<string>();
  for (const file of clientFiles) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/request\s*<[^(]*\(\s*([`'][^`']*[`'])/g)) {
      called.add(normalise(`${API_BASE}/${(m[1] ?? '').slice(1, -1)}`));
    }
    // `EventSource` is a caller too — `GET /events` is consumed by the stream
    // rather than by `request`, and counting it is more honest than exempting
    // it. An exemption would say "nothing calls this", when something does.
    for (const m of source.matchAll(/new EventSource\(\s*([`'][^`']*[`'])/g)) {
      called.add(normalise((m[1] ?? '').slice(1, -1).replace('${API_BASE}', API_BASE)));
    }
  }
  return called;
}

void describe('the check can see both sides', () => {
  void test('both sets are non-empty — two empty sets compare equal', () => {
    assert.ok(servedPaths().size > 30, `only ${String(servedPaths().size)} served paths derived`);
    assert.ok(calledPaths().size > 20, `only ${String(calledPaths().size)} client calls derived`);
  });

  void test('every mounted factory had its routes read', () => {
    // A factory mounted but not parsed contributes nothing, and silence here
    // looks exactly like full coverage.
    const routes = routesByFactory();
    const unparsed = [...mountedFactories().keys()].filter((f) => !routes.has(f));
    assert.deepEqual(unparsed, [], 'a mounted router was never read');
  });

  void test('every request() call site passes a literal path', () => {
    // A path built from a variable is invisible to the scan, and a blind scan
    // looks like a fully wired product.
    const hidden: string[] = [];
    for (const file of clientFiles) {
      if (file.endsWith('api/client.ts')) continue; // `request`'s own definition
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/request\s*<[^(]*\(/g)) {
        const after = source.slice(m.index + m[0].length).trimStart();
        if (!after.startsWith('`') && !after.startsWith("'")) {
          hidden.push(`${file}: ${after.slice(0, 60)}`);
        }
      }
    }
    assert.deepEqual(hidden, [], 'a call site builds its path dynamically and cannot be scanned');
  });

  void test('nothing is called that is not served — the false-positive detector', () => {
    // Every entry here is a parser bug, not a product defect: the client cannot
    // be calling something the server does not mount, or it would 404 in use.
    const served = servedPaths();
    const invented = [...calledPaths()].filter((p) => !served.has(p)).sort();
    assert.deepEqual(
      invented,
      [],
      'the parser invented a path — the exemption list would absorb it',
    );
  });
});

void describe('every served endpoint has a caller, or a named reason', () => {
  void test('no endpoint is served, uncalled and unexplained', () => {
    const called = calledPaths();
    const orphans = [...servedPaths()]
      .filter((p) => !called.has(p) && !(p in NO_BROWSER_CALLER))
      .sort();

    assert.deepEqual(
      orphans,
      [],
      'served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not',
    );
  });

  void test('the exemption list has no stale entries', () => {
    // An exemption for something now called, or no longer served, is a lie that
    // outlives the thing it described.
    const served = servedPaths();
    const called = calledPaths();
    const stale = Object.keys(NO_BROWSER_CALLER)
      .filter((p) => !served.has(p) || called.has(p))
      .sort();
    assert.deepEqual(stale, [], 'an exemption names something no longer served, or now called');
  });

  void test('every exemption gives a reason or a task id', () => {
    const empty = Object.entries(NO_BROWSER_CALLER)
      .filter(([, reason]) => reason.trim().length < 4)
      .map(([path]) => path);
    assert.deepEqual(empty, [], 'an exemption with no reason is a silenced check');
  });
});
