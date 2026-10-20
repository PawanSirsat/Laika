import { createServer, type Server, type ServerResponse } from 'node:http';

/**
 * A Laika board that answers the calls `laika time connect`, `push`, `pull`,
 * `people`, `map` and `start` make (LAI-788), **the way the real server
 * does**: SPEC §6.4's routes, §6.3's error envelope, and §3.1's rule that every
 * Solidtime route is a signed-in session's — a token is `403` with
 * `details.reason: "session_required"`.
 *
 * It does not reconcile anything: a test says what the outbox holds and what
 * an import answers, and reads back what the CLI sent. The reconciling is the
 * server's, and `server/test/services/time-solidtime.test.ts` holds it.
 */

export interface BoardRequest {
  readonly method: string;
  readonly path: string;
  readonly auth: string | undefined;
  readonly cookie: string | undefined;
  readonly origin: string | undefined;
  readonly body: string;
}

export interface OutboxItem {
  entry_id: string;
  revision: number;
  action: 'create' | 'update' | 'delete';
  day: string;
  tz: string;
  started_at: number | null;
  offset_minutes: number;
  minutes: number;
  task: { key: string; title: string } | null;
  project: { slug: string; name: string } | null;
  solidtime_project_id: string | null;
  note: string | null;
  moved: boolean;
  solidtime: { id: string; hash: string; started_at: number } | null;
}

export interface Outbox {
  closed_through: string | null;
  push: OutboxItem[];
  held: { entry_id: string; day: string; reason: string }[];
  projects: { space: string; space_id: string; solidtime_project_id: string }[];
  taken: string[];
}

export interface SyncBoard {
  readonly url: string;
  readonly token: string;
  readonly email: string;
  readonly password: string;
  readonly requests: BoardRequest[];
  outbox: Outbox;
  /** `fail-once`: the next links PUT answers 500 — the CLI's write landed, the record did not. */
  links: 'ok' | 'fail-once';
  readonly linked: unknown[];
  readonly imports: unknown[];
  readonly orgImports: unknown[];
  importResult: Record<string, unknown>;
  setup: Record<string, unknown>;
  readonly projectsPut: unknown[];
  readonly peoplePut: unknown[];
  users: { id: string; name: string; email: string; org_role: string; is_active: boolean }[];
  readonly tasks: Map<string, { key: string; title: string; project_id: string }>;
  signIns: number;
  signOuts: number;
  close(): Promise<void>;
}

const SESSION = 'better-auth.session_token=stub-session';

export async function stubSyncBoard(
  options: { token?: string; email?: string; password?: string } = {},
): Promise<SyncBoard> {
  const board: SyncBoard = {
    url: '',
    token: options.token ?? 'lai_stub_token_for_tests',
    email: options.email ?? 'ada@example.test',
    password: options.password ?? 'correct-horse',
    requests: [],
    outbox: { closed_through: null, push: [], held: [], projects: [], taken: [] },
    links: 'ok',
    linked: [],
    imports: [],
    orgImports: [],
    importResult: {
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      ignored: 0,
      conflicts: 0,
      flagged: [],
    },
    setup: {
      closed_through: null,
      projects: [],
      people: [],
      not_on_laika: { people: 0, minutes: 0, members: [] },
    },
    projectsPut: [],
    peoplePut: [],
    users: [],
    tasks: new Map(),
    signIns: 0,
    signOuts: 0,
    close: () => Promise.resolve(),
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (res: ServerResponse, status: number, code: string, reason?: string) =>
    send(res, status, { error: { code, message: code, details: reason ? { reason } : null } });

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      board.requests.push({
        method,
        path: `${path}${url.search}`,
        auth: req.headers.authorization,
        cookie: req.headers.cookie,
        origin: req.headers.origin,
        body,
      });
      const token = req.headers.authorization === `Bearer ${board.token}`;
      const session = req.headers.cookie?.includes(SESSION) === true;

      if (method === 'POST' && path === '/api/v1/auth/sign-in/email') {
        const b = JSON.parse(body || '{}') as { email?: string; password?: string };
        if (b.email !== board.email || b.password !== board.password) {
          refuse(res, 401, 'unauthorized');
          return;
        }
        board.signIns += 1;
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `${SESSION}; Path=/; HttpOnly`,
        });
        res.end(JSON.stringify({ token: 'stub' }));
        return;
      }
      if (method === 'POST' && path === '/api/v1/auth/sign-out') {
        if (session) board.signOuts += 1;
        send(res, 200, { success: true });
        return;
      }
      if (!token && !session) {
        refuse(res, 401, 'unauthorized');
        return;
      }
      if (method === 'GET' && path === '/api/v1/me') {
        send(res, 200, { name: 'Ada', email: board.email, org_role: 'owner', memberships: [] });
        return;
      }
      // §7.1's `get_task_context`, as the stateless MCP endpoint answers one
      // JSON-RPC call: the card in `structuredContent.task`, or a tool error.
      if (method === 'POST' && path === '/mcp' && token) {
        const call = JSON.parse(body || '{}') as {
          id?: number;
          params?: { name?: string; arguments?: { task?: string } };
        };
        const found =
          call.params?.name === 'get_task_context'
            ? board.tasks.get(call.params.arguments?.task ?? '')
            : undefined;
        send(res, 200, {
          jsonrpc: '2.0',
          id: call.id ?? null,
          result:
            found === undefined
              ? { isError: true, content: [{ type: 'text', text: 'No task' }] }
              : { content: [], structuredContent: { task: { id: 'task-id', ...found } } },
        });
        return;
      }
      if (method === 'GET' && path === '/api/v1/users') {
        send(res, 200, { data: board.users, next_cursor: null });
        return;
      }

      // Everything below is the Solidtime bridge: session only.
      if (!session) {
        refuse(res, 403, 'forbidden', 'session_required');
        return;
      }
      if (method === 'GET' && path === '/api/v1/me/time/solidtime') {
        send(res, 200, board.outbox);
        return;
      }
      if (method === 'PUT' && path === '/api/v1/me/time/solidtime/links') {
        if (board.links === 'fail-once') {
          board.links = 'ok';
          refuse(res, 500, 'internal');
          return;
        }
        const b = JSON.parse(body) as { links: { removed?: boolean }[] };
        board.linked.push(b);
        send(res, 200, {
          linked: b.links.filter((l) => l.removed !== true).length,
          removed: b.links.filter((l) => l.removed === true).length,
          retired: 0,
        });
        return;
      }
      if (method === 'PUT' && path === '/api/v1/me/time/solidtime/import') {
        board.imports.push(JSON.parse(body));
        send(res, 200, board.importResult);
        return;
      }
      if (method === 'GET' && path === '/api/v1/org/time/solidtime') {
        send(res, 200, board.setup);
        return;
      }
      if (method === 'PUT' && path === '/api/v1/org/time/solidtime/projects') {
        board.projectsPut.push(JSON.parse(body));
        send(res, 200, { projects: [] });
        return;
      }
      if (method === 'PUT' && path === '/api/v1/org/time/solidtime/people') {
        board.peoplePut.push(JSON.parse(body));
        send(res, 200, { people: [] });
        return;
      }
      if (method === 'PUT' && path === '/api/v1/org/time/solidtime/import') {
        board.orgImports.push(JSON.parse(body));
        send(res, 200, { ...board.importResult, not_on_laika: { people: 1, minutes: 90 } });
        return;
      }
      refuse(res, 404, 'not_found');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  (board as { url: string }).url = `http://127.0.0.1:${String(address.port)}`;
  board.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return board;
}
