import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type ElementHandle, type Page } from 'playwright';

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

/**
 * A project's statuses as the server seeds them (LAI-738, `DEFAULT_STATUSES`
 * in `server/src/db/project-statuses.ts`): one per category, in category
 * order, named for it, Cancelled hidden. Ids are `st-<category>`.
 *
 * **The one route the stub answers unasked.** Every project has these from
 * its first boot, so a fixture written before LAI-739 — about cards, filters,
 * the drawer — is not about statuses and should not have to say so. A task
 * fixture with no `status_id` files under its category's status, which is
 * `laneStatusId`'s fallback and what the server's backfill does.
 */
export const DEFAULT_STATUSES = (
  [
    ['backlog', 'Backlog'],
    ['todo', 'To do'],
    ['in_progress', 'In progress'],
    ['review', 'Review'],
    ['done', 'Done'],
    ['cancelled', 'Cancelled'],
  ] as const
).map(([category, name], position) => ({
  id: `st-${category}`,
  project_id: 'p1',
  name,
  category,
  position,
  hidden: category === 'cancelled',
  created_at: 1,
  task_count: 0,
}));

const STATUSES_PATH = /^\/api\/v1\/projects\/[^/]+\/statuses$/;

/**
 * The review gate's two reads (D-082, LAI-758), answered for a stub that does
 * not name them: a task panel reads a task's rounds, and the shell reads the
 * review queue for its badge on every page. A task never finished has no
 * rounds and an empty queue waits for nobody; a test about either names its
 * own.
 */
const ROUNDS_PATH = /^\/api\/v1\/tasks\/[^/]+\/rounds$/;
const REVIEW_PATH = '/api/v1/review';
/**
 * A person's token alerts (LAI-773): the shell reads them for the Usage
 * badge on every page. Somebody with none has an empty list; a test about
 * alerts names its own.
 */
const TOKEN_ALERTS_PATH = '/api/v1/me/token-alerts';
/**
 * A person's hand-offs (LAI-1009, LAI-550): the shell reads their counts for
 * the Inbox badge on every page. Somebody with none has nothing waiting; a
 * test about hand-offs names its own.
 */
const HANDOFFS_PATH = '/api/v1/handoff-offers';
const NO_HANDOFFS = {
  data: [],
  next_cursor: null,
  counts: { received: 0, sent: 0, needs_approval: 0, recovery: 0 },
};
/**
 * A space's hand-off policy (§4.74, LAI-550), read on Settings → Access. A
 * space that never set one reads as the defaults; a test about the policy
 * names its own.
 */
const HANDOFF_POLICY_PATH = /^\/api\/v1\/projects\/([^/]+)\/handoff-policy$/;

/**
 * `GET /permissions` as the server answers it under the **default grants**
 * (D-102 rule 6), for a stub that does not name it: what `/me` says the
 * reader is decides what they hold, as it does on a board whose owner changed
 * nothing.
 *
 * **Since LAI-970 every gate denies until this answers**, so a fixture written
 * before that — about cards, columns, sprints — would otherwise lose every
 * control it is about. A test about grants names its own.
 *
 * Generated from the server's own `permissionsCatalogue()` with
 * `DEFAULT_GRANTS` (2026-10-22), not written by hand: a hand copy of §3 is the
 * second source of truth LAI-970 removed from the client.
 */
const EVERY_ROLE_ORG = [
  'org.read',
  'presence.read',
  'capacity.read',
  'member_list.read',
  'project.join_public',
  'token.create_own',
  'token.read_own',
  'token.revoke_own',
  'unlisted.log_own',
  'heartbeat.send_own',
  'activity_sharing.read_own',
  'activity_sharing.set_own',
  'local_activity.send_own',
  'local_activity.read_own',
  'local_activity.delete_own',
  'usage.read_own',
  'token_alerts.own',
  'plan_limit.own',
  'time_settings.read_own',
  'time_settings.set_own',
  'time_drafts.send_own',
  'time_drafts.read_own',
  'time_drafts.manage_own',
  'time_entries.read_own',
  'time_entries.write_own',
  'time_sync.own',
  // Everyone may sign themselves out everywhere (LAI-981): conditional, and
  // `/permissions` lists a conditional action the caller holds about themselves.
  'user.sign_out',
  // A person's own registered agents (D-114, LAI-534): every role's, and
  // managing them is a signed-in session's, which a browser always is.
  'agent.read_own',
  'agent.manage_own',
] as const;
const ADMIN_UP_ORG = [
  'org.settings.edit',
  'project.create',
  'project.archive',
  'user.invite',
  'user.deactivate',
  'user.reset_password',
  'token.list_any',
  'token.revoke_any',
  'audit_log.export',
  'webhook.configure',
  'profile.read',
  'profile.set_kind',
  'profile.rate',
  'profile.activity.read',
  'people.analytics.read',
  'org.developer_insights.set',
  'usage.read_org',
  'usage.read_people',
  'org.model_prices.set',
  'org.time.set',
  'time_sync.map',
  'time_sync.import_all',
] as const;
const OWNER_ONLY_ORG = [
  'org.delete',
  'org.transfer_ownership',
  'user.set_role',
  'org.permissions.manage',
] as const;
const PROJECT_ACTIONS_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  lead: [
    'project.members.manage',
    'project.settings.edit',
    'sprint.manage',
    'task.assign_sprint',
    'task.create',
    'task.write',
    'task.claim',
    'task.assign_other',
    'comment.create',
    'comment.edit',
    'comment.delete',
    'task.delete',
    'task.dependency.write',
    'task.watch',
    'project.read',
    'meeting_proposal.apply',
    'usage.read_project',
    'budget.set',
  ],
  member: [
    'task.assign_sprint',
    'task.create',
    'task.write',
    'task.claim',
    'task.assign_other',
    'comment.create',
    'comment.edit',
    'comment.delete',
    'task.delete',
    'task.dependency.write',
    'task.watch',
    'project.read',
    'meeting_proposal.apply',
    'usage.read_project',
  ],
  viewer: ['task.watch', 'project.read', 'usage.read_project'],
};
// `task.create` (LAI-976) is a lead's and a member's under the default rule,
// *Members*; a space set to *Space admins only* withholds it from members —
// a test about that names its own `/permissions` (LAI-178).

interface StubMe {
  readonly org_role?: unknown;
  readonly memberships?: readonly { readonly project_id: string; readonly role: string }[];
}

/** The default-grants answer for this `/me` — see {@link EVERY_ROLE_ORG}. */
export function defaultPermissions(me: StubMe): unknown {
  const role = typeof me.org_role === 'string' ? me.org_role : 'viewer';
  const adminUp = role === 'owner' || role === 'admin';
  const actions = [
    ...EVERY_ROLE_ORG,
    ...(adminUp ? ADMIN_UP_ORG : []),
    ...(role === 'owner' ? OWNER_ONLY_ORG : []),
  ];
  // `effectiveProjectRole`: an implicit lead everywhere, an org viewer capped.
  const effective = (given: string): string =>
    adminUp ? 'lead' : role === 'viewer' ? 'viewer' : given;
  return {
    org_roles: ['owner', 'admin', 'member', 'viewer'],
    project_roles: ['lead', 'member', 'viewer'],
    permissions: [],
    me: {
      org_role: role,
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: adminUp ? 'lead' : null,
      actions,
      projects: (me.memberships ?? []).map((m) => ({
        project_id: m.project_id,
        role: effective(m.role),
        actions: PROJECT_ACTIONS_BY_ROLE[effective(m.role)] ?? [],
      })),
    },
  };
}
const PERMISSIONS_PATH = '/api/v1/permissions';
const ME_PATH = '/api/v1/me';

/**
 * The task list and one task (LAI-795). **The list is answered as the server
 * answers it**: asked `fields=slim`, the stub leaves out `description_md` and
 * `acceptance_md`, so a fixture written in full still reaches the app as the
 * real board would — and a screen that read the texts off the list would draw
 * nothing here, as it would there.
 *
 * **And a task the list served is answered by id** when no stub names that
 * path: the task panel reads its texts with `GET /tasks/:id`, and a fixture
 * about cards, filters or the drawer should not have to say so. A test about
 * the panel's read names its own.
 */
const TASK_LIST_PATH = /^\/api\/v1\/projects\/[^/]+\/tasks$/;
const ONE_TASK_PATH = /^\/api\/v1\/tasks\/([^/]+)$/;
const SLIM_OMITS = ['description_md', 'acceptance_md'];

/** A list page with the texts left out, remembering each task in full by id. */
function slimPage(body: unknown, seen: Map<string, unknown>): unknown {
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as { data?: unknown }).data)
  ) {
    return body;
  }
  const page = body as { data: unknown[] };
  return {
    ...page,
    data: page.data.map((item) => {
      if (typeof item !== 'object' || item === null) return item;
      const task = item as Record<string, unknown>;
      if (typeof task.id === 'string') seen.set(task.id, task);
      return Object.fromEntries(Object.entries(task).filter(([key]) => !SLIM_OMITS.includes(key)));
    }),
  };
}

/**
 * A fixture task as the server sends it since LAI-738: in its kind's default
 * status, by id and name, unless the fixture names one. For fixtures written
 * before statuses had ids, so a filter or a picker by id has something to
 * match.
 */
export function asServed<T extends { readonly status?: unknown }>(
  task: T,
): T & { status_id: string; status_name: string } {
  const status = DEFAULT_STATUSES.find((s) => s.category === task.status);
  return { status_id: status?.id ?? '', status_name: status?.name ?? '', ...task };
}

/**
 * Apply a `POST /tasks/:id/status` body to a fixture task the way the server
 * does (LAI-738): `{status_id}` puts it in that status, `{status}` in the
 * first status of that kind. Returns the kind it landed in, for stubs that
 * decide on it. Against {@link DEFAULT_STATUSES} unless told otherwise.
 */
export function applyStatusWrite(
  task: { status?: unknown },
  body: unknown,
  statuses: readonly {
    id: string;
    name: string;
    category: string;
    position: number;
  }[] = DEFAULT_STATUSES,
): string | undefined {
  const sent = body as { status?: string; status_id?: string };
  const byPosition = [...statuses].sort((a, b) => a.position - b.position);
  const to =
    sent.status_id !== undefined
      ? byPosition.find((s) => s.id === sent.status_id)
      : byPosition.find((s) => s.category === sent.status);
  if (to === undefined) return undefined;
  Object.assign(task, { status: to.category, status_id: to.id, status_name: to.name });
  return to.category;
}

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
  /** Response headers beside the JSON content type — My day's `X-Undo-Id` (LAI-831). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A non-200 answer from the stub.
 *
 * A symbol key rather than a `{status, body}` shape that a *fixture* could also
 * have: `GET /health` legitimately returns something with a `status` field, and
 * a marker that a plain fixture can accidentally wear is a stub that silently
 * answers `503` because the response happened to look like a directive.
 */
export function reply(
  status: number,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
): StubReply {
  return headers === undefined
    ? { [REPLY]: true, status, body }
    : { [REPLY]: true, status, body, headers };
}

/**
 * `answer` — a fixture or a {@link reply} — with `headers` added, on a success
 * only: a refusal says nothing a success would.
 */
export function withHeaders(answer: unknown, headers: Readonly<Record<string, string>>): StubReply {
  if (!isReply(answer)) return reply(200, answer, headers);
  if (answer.status >= 400) return answer;
  return { ...answer, headers: { ...answer.headers, ...headers } };
}

/** An API error envelope, the shape `toApiError` reads. */
export function refuse(status: number, code: string, message: string): StubReply {
  return reply(status, { error: { code, message } });
}

/**
 * Wait until `done` holds, at most `ms`, rather than pausing a fixed time and
 * then reading. A pause long enough on a laptop is too short on a loaded CI
 * runner (2026-10-12): the read sees the page before the answer, the effect or
 * the render it is about. **It asserts nothing**, and times out quietly, so the
 * assertion after it reports what was actually on screen.
 *
 * Only for something that *will* happen. That something does **not** happen
 * is still a fixed window, because no condition can end it early.
 */
export async function until(done: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await done()) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
  /** Every task a list has served, in full, by id — see {@link ONE_TASK_PATH}. */
  const listed = new Map<string, unknown>();
  /** The last `/me` this server answered, for {@link defaultPermissions}. */
  let lastMe: StubMe | undefined;
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

        if (chosen === undefined && req.method === 'GET' && STATUSES_PATH.test(path)) {
          // Every project has statuses from its first boot (LAI-738), so a
          // stub that does not name them gets the server's default six — see
          // DEFAULT_STATUSES. A test about columns names its own.
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: DEFAULT_STATUSES }));
          return;
        }

        if (chosen === undefined && req.method === 'GET' && path === HANDOFFS_PATH) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(NO_HANDOFFS));
          return;
        }

        if (chosen === undefined && req.method === 'GET' && HANDOFF_POLICY_PATH.test(path)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              project_id: decodeURIComponent(HANDOFF_POLICY_PATH.exec(path)?.[1] ?? ''),
              allow_other_owners: false,
              cross_owner_requires_approval: true,
              max_handoffs: 3,
              offer_ttl_minutes: 30,
              updated_by: null,
              is_set: false,
            }),
          );
          return;
        }

        if (
          chosen === undefined &&
          req.method === 'GET' &&
          (ROUNDS_PATH.test(path) || path === REVIEW_PATH || path === TOKEN_ALERTS_PATH)
        ) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify(
              path === REVIEW_PATH
                ? { tasks: [], truncated: false }
                : path === TOKEN_ALERTS_PATH
                  ? { alerts: [] }
                  : { rounds: [], send_back: null },
            ),
          );
          return;
        }

        const listedTask =
          chosen === undefined && req.method === 'GET'
            ? listed.get(decodeURIComponent(ONE_TASK_PATH.exec(path)?.[1] ?? ''))
            : undefined;
        if (listedTask !== undefined) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(listedTask));
          return;
        }

        if (
          chosen === undefined &&
          req.method === 'GET' &&
          path === PERMISSIONS_PATH &&
          lastMe !== undefined
        ) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(defaultPermissions(lastMe)));
          return;
        }

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
        const { status, body, headers } = isReply(answer)
          ? answer
          : { status: 200, body: answer, headers: undefined };
        const slim =
          req.method === 'GET' &&
          status === 200 &&
          TASK_LIST_PATH.test(path) &&
          url.searchParams.get('fields') === 'slim';
        // Whose answer `/permissions` defaults to: the user `/me` last named.
        if (path === ME_PATH && req.method === 'GET') {
          lastMe = status === 200 && typeof body === 'object' && body !== null ? body : undefined;
        }
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(slim ? slimPage(body, listed) : body));
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

/**
 * A host name that reaches the stub server and is **not** a secure context
 * (LAI-760). The live board is plain HTTP on an IP, where `navigator.clipboard`
 * does not exist; `127.0.0.1` is a secure context, so a test there cannot see
 * what the board's readers see. Chromium resolves this name to the loopback
 * address by a launch flag, and the page's origin stays `http://laika.test`.
 */
export const INSECURE_HOST = 'laika.test';

let shared: Browser | undefined;

/** One browser for the whole file — launching costs more than every test in it. */
async function browser(): Promise<Browser> {
  shared ??= await chromium.launch({
    args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`],
  });
  return shared;
}

export async function closeBrowser(): Promise<void> {
  await shared?.close();
  shared = undefined;
  cleanBuild();
}

/**
 * How long one attempt at the theme control may take (LAI-578). A control
 * still in the document after this has refused, and `setTheme` fails with
 * the refusal rather than trying again.
 */
export const THEME_CLICK_MS = 10_000;

/**
 * Run `act` on `control`. `true` if it failed because `control` left the
 * document — the signed-in shell replaced it — so the caller chooses again;
 * every other failure is rethrown unchanged (LAI-578).
 */
async function replacedDuring(control: ElementHandle, act: () => Promise<void>): Promise<boolean> {
  try {
    await act();
    return false;
  } catch (error) {
    let connected = true;
    try {
      connected = await control.evaluate((el) => el.isConnected);
    } catch {
      // The page itself went away; that is not the replacement this allows.
    }
    if (connected) throw error;
    return true;
  }
}

/**
 * Put the page in a theme **through the real control** (LAI-249).
 *
 * The control became the design's two-state `ThemeSwitch`, so "select Dark"
 * is now "click if not already dark" — this helper keeps the property the old
 * radio clicks had: a JS-computed colour bug hides from a class-toggle
 * shortcut, and the theme is what these tests are about. Signed in, the
 * control is the user menu's *Switch to dark / light* (LAI-796).
 */
export async function setTheme(page: Page, theme: string) {
  /*
   * **`data-theme`, not a `.dk` class** (LAI-606).
   *
   * The engine moved to an attribute, and dark is the bare `:root` — it sets
   * *no* attribute at all, so "is it dark" is "is the attribute absent", not
   * "is it 'dark'". This helper kept watching for the class and waited the full
   * five seconds on every theme switch in the suite, which surfaced as two
   * unrelated tests timing out rather than as a theme problem.
   */
  const wantDark = theme.toLowerCase() === 'dark';
  const reads = () => document.documentElement.getAttribute('data-theme') !== 'light';

  /*
   * **Two real controls since LAI-796.** Signed in, the theme is an item in
   * the user menu at the foot of the sidebar; before a session there is no
   * sidebar and the header carries `ThemeSwitch`. Both write the one store.
   *
   * The menu's clicks are dispatched rather than pointed: on a phone the
   * sidebar is off-canvas, so its button is outside the viewport, and the
   * question here is the theme, not whether the off-canvas menu is open.
   *
   * **Each control is chosen afresh only when the session replaced the last
   * one** (LAI-576, narrowed by LAI-578). A test calls this straight after
   * `open`, while `/me` may still be in flight, so the header's switch can be
   * detached by the signed-in shell between being chosen and being clicked.
   * One locator for both then re-resolved to the user menu and *pointed* at
   * it, which on a phone waited thirty seconds for a button that is
   * off-canvas by design.
   *
   * So the control is held as an element, not a selector, and a failure is
   * retried only if that element has left the document. Anything else — a
   * click refused while the switch stays mounted, a menu that never shows its
   * item — is the failure, and is thrown as it was. #116 retried every error
   * and would have passed a switch that refused its first click.
   */
  const deadline = Date.now() + 20_000;
  while ((await page.evaluate(reads)) !== wantDark) {
    if (Date.now() > deadline) {
      throw new Error('setTheme: the session replaced the theme control on every try for 20s');
    }
    await page
      .locator('.theme-switch, .user-menu-trigger')
      .first()
      .waitFor({ state: 'attached', timeout: 10_000 });
    const menu = await page.$('.user-menu-trigger');
    const control = menu ?? (await page.$('.theme-switch'));
    // One was attached a moment ago and neither is now: the swap is mid-way.
    if (control === null) continue;

    const replaced = await replacedDuring(control, async () => {
      if (menu === null) {
        await control.click({ timeout: THEME_CLICK_MS });
        return;
      }
      if ((await page.$('.user-menu-theme')) === null) await menu.dispatchEvent('click');
      const item = await page.waitForSelector('.user-menu-theme', {
        state: 'attached',
        timeout: THEME_CLICK_MS,
      });
      await item.dispatchEvent('click');
    });
    if (!replaced) break;
  }

  await page.waitForFunction(
    (want: boolean) => (document.documentElement.getAttribute('data-theme') !== 'light') === want,
    wantDark,
    { timeout: 5000 },
  );
}

export interface OpenOptions {
  /**
   * Runs on the page before the first navigation (LAI-707): routes that must
   * catch the very first request, and init scripts such as {@link fakeStream},
   * have to be in place before the app boots.
   */
  readonly before?: (page: Page) => Promise<void>;
  /**
   * Serve the page from `http://laika.test:<port>`, which is not a secure
   * context, as the live board is not (LAI-760). `origin` reports that host.
   */
  readonly insecure?: boolean;
}

/** Open `path` in a real browser, against the built SPA and a stubbed API. */
export async function open(
  path: string,
  stub: ApiStub,
  options: OpenOptions = {},
): Promise<Harness> {
  const calls: StubCall[] = [];
  const unmatched: string[] = [];
  const served = await serve(ensureBuilt(), stub, calls, unmatched);
  const { server } = served;
  const origin =
    options.insecure === true ? served.origin.replace('127.0.0.1', INSECURE_HOST) : served.origin;
  const page = await (await browser()).newPage();
  if (options.before !== undefined) await options.before(page);
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

/**
 * A stand-in for `EventSource` the test drives (LAI-707).
 *
 * The stub server answers every `/api/` request as JSON, so the real stream
 * gets a 404 and reads as refused. Installed with `open(path, stub, { before:
 * fakeStream })`, this replaces the browser's `EventSource` with one that
 * opens at once, says `ready`, and fires whatever the test emits:
 *
 *     await h.page.evaluate(() => window.__laikaStream.emit('task.status_changed', {...}, '7'));
 *
 * Every source the app opened receives the frame, as the shared connection
 * would.
 */
export async function fakeStream(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      (() => {
        const sources = [];
        class FakeEventSource {
          constructor(url) {
            this.url = String(url);
            this.readyState = 0;
            this.listeners = new Map();
            this.onopen = null;
            this.onerror = null;
            this.onmessage = null;
            sources.push(this);
            setTimeout(() => {
              if (this.readyState === 2) return;
              this.readyState = 1;
              if (this.onopen) this.onopen(new Event('open'));
              this.dispatch('ready', '{}', '');
            }, 0);
          }
          addEventListener(type, listener) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(listener);
          }
          removeEventListener(type, listener) {
            if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
          }
          dispatch(type, data, id) {
            const event = new MessageEvent(type, { data, lastEventId: id });
            for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
          }
          close() {
            this.readyState = 2;
          }
        }
        FakeEventSource.CONNECTING = 0;
        FakeEventSource.OPEN = 1;
        FakeEventSource.CLOSED = 2;
        window.EventSource = FakeEventSource;
        window.__laikaStream = {
          emit(type, data, id) {
            const body = typeof data === 'string' ? data : JSON.stringify(data);
            for (const source of sources) {
              if (source.readyState === 1) source.dispatch(type, body, String(id ?? ''));
            }
          },
          count() {
            return sources.filter((source) => source.readyState === 1).length;
          },
        };
      })();
    `,
  });
}

/**
 * Record whether any of `selectors` is **ever** in the document, from before
 * the app boots (LAI-970). Pass as `open(path, stub, { before: (p) =>
 * watchFor(p, [...]) })`, then ask {@link everSeen}.
 *
 * A gate that shows a control for one frame and then withdraws it passes
 * every "is it there now" check taken after the frame; that frame is the bug
 * when the reader is somebody the owner withdrew it from. A MutationObserver
 * sees every frame the DOM had.
 */
export async function watchFor(page: Page, selectors: readonly string[]): Promise<void> {
  await page.addInitScript({
    content: `
      (() => {
        const selectors = ${JSON.stringify(selectors)};
        const seen = (window.__laikaSeen = {});
        const check = () => {
          for (const s of selectors) if (document.querySelector(s)) seen[s] = true;
        };
        new MutationObserver(check).observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      })();
    `,
  });
}

/** Whether `selector`, given to {@link watchFor}, was ever in the document. */
export async function everSeen(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (s) =>
      (window as unknown as { __laikaSeen?: Record<string, boolean> }).__laikaSeen?.[s] === true,
    selector,
  );
}

/** Go to `to` inside the app, as a link would: no reload, so module state survives. */
export async function navigateInApp(page: Page, to: string): Promise<void> {
  await page.evaluate((path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, to);
}
