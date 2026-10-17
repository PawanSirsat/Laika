import { createServer, type Server } from 'node:http';

import { contractViolation } from './local-activity-contract.ts';

/**
 * A board that implements the two activity endpoints of the contract and
 * nothing else (LAI-752), answering errors **the way the real server does**:
 * SPEC §6.3's envelope, `{ "error": { "code", "message", "details" } }`, from
 * a closed list of codes — so the contract's `local_activity_off`,
 * `session_required`, `day_out_of_range` and `invalid_tz` arrive as
 * `details.reason` under `forbidden` (403) and `unprocessable` (422). Read from
 * LAI-751's `server/src/errors.ts` and `services/local-activity.ts`.
 *
 * - `GET /api/v1/me/activity-sharing` answers `sharing`, or never (`get`).
 * - `PUT /api/v1/me/local-activity` refuses any body the contract refuses
 *   (422, with the rule it broke recorded), and otherwise answers whatever
 *   `put` says.
 * - Anything without `Authorization: Bearer <token>` is 401.
 */

export interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly auth: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

export type PutMode =
  | { readonly kind: 'ok' }
  /** 403 `forbidden`, `details.reason: local_activity_off` — the real server. */
  | { readonly kind: 'off' }
  /** 403 with a top-level `code: local_activity_off` — the contract's first wording. */
  | { readonly kind: 'off-legacy' }
  /** 403 `forbidden` for any other reason (a token refused a scope, `session_required`). */
  | { readonly kind: 'forbidden'; readonly reason: string }
  /** 422 `unprocessable` with this `details.reason`. */
  | { readonly kind: 'unprocessable'; readonly reason: string }
  | { readonly kind: 'rate-limited'; readonly retryAfter: string }
  | { readonly kind: 'hang' }
  | { readonly kind: 'status'; readonly status: number };

export interface StubBoard {
  readonly url: string;
  readonly requests: Recorded[];
  readonly violations: string[];
  sharing: { org_enabled: boolean; enabled: boolean; scope: string; min_sync_interval_s: number };
  /**
   * The project prefixes the board answers a collector with (§6.4, LAI-770),
   * or `undefined` for an older board that names none.
   */
  prefixes: string[] | undefined;
  /** `hang`: the sharing GET is never answered — a board that is up but stuck. */
  get: 'ok' | 'hang';
  put: PutMode;
  /** When the contract's day range is checked: the collector's clock, not the test machine's. */
  now: () => Date;
  /**
   * What an accepted report leaves on the board, as the real server keeps it
   * (SPEC §4.23, §4.24): a snapshot per (collector, day), replaced; pushed keys
   * a set, each at the earliest day reported. A look-back adds keys only.
   */
  readonly snapshots: Map<string, { readonly commits_local: number }>;
  readonly keys: Map<string, string>;
  /**
   * Usage reports (§6.4, D-084, LAI-769), as the server keeps them (§4.33):
   * a (collector, day)'s rows replaced whole by each report that carries it.
   */
  readonly usage: Map<string, readonly unknown[]>;
  /** An older board: a usage report is an unknown field, 422. */
  refuseUsage: boolean;
  /** Sharing turned off between the snapshot and the usage report. */
  offForUsage: boolean;
  /**
   * The report bucket (§6.3): 30, one back every 120 s, on `now()`. Off unless
   * a test turns it on; `limited` counts the 429s it gave.
   */
  bucket: { on: boolean; tokens: number; at: number; limited: number };
  readonly close: () => void;
}

/** A usage report's row, as far as the stub reads it. */
interface UsageRowLike {
  readonly agent: string;
  readonly output: number;
}

const servers: Server[] = [];

export function closeAll(): void {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
}

export async function stubBoard(token: string): Promise<StubBoard> {
  const board: Omit<StubBoard, 'url' | 'close'> & { url: string; close: () => void } = {
    url: '',
    requests: [],
    violations: [],
    sharing: { org_enabled: true, enabled: true, scope: 'agent-repos', min_sync_interval_s: 600 },
    get: 'ok',
    put: { kind: 'ok' },
    now: () => new Date(),
    snapshots: new Map(),
    keys: new Map(),
    usage: new Map(),
    refuseUsage: false,
    prefixes: undefined,
    offForUsage: false,
    bucket: { on: false, tokens: 30, at: 0, limited: 0 },
    close: () => undefined,
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      board.requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        auth: req.headers.authorization,
        contentType: req.headers['content-type'],
        body,
      });
      const json = (status: number, value: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(value));
      };
      /** §6.3: `{ error: { code, message, details } }`, `details` always present. */
      const refuse = (
        status: number,
        code: string,
        details: Record<string, unknown> | null = null,
        headers: Record<string, string> = {},
      ): void => {
        json(status, { error: { code, message: `${code} (stub)`, details } }, headers);
      };

      if (req.headers.authorization !== `Bearer ${token}`) {
        refuse(401, 'unauthorized');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://stub');
      if (req.method === 'GET' && url.pathname === '/api/v1/me/activity-sharing') {
        if (board.get === 'hang') return;
        // SPEC §6.4 (LAI-769 review 1): with `?collector_id=`, the days other
        // collectors hold tokens for — dates only.
        const asking = url.searchParams.get('collector_id');
        if (asking === null) {
          json(200, board.sharing);
          return;
        }
        const elsewhere = new Set<string>();
        for (const [key, rows] of board.usage) {
          const [collector, day] = key.split('|');
          if (collector !== asking && rows.length > 0 && day !== undefined) elsewhere.add(day);
        }
        json(200, {
          ...board.sharing,
          usage_days_elsewhere: [...elsewhere].sort(),
          ...(board.prefixes === undefined ? {} : { task_prefixes: board.prefixes }),
        });
        return;
      }
      if (req.method === 'PUT' && req.url === '/api/v1/me/local-activity') {
        const violation = contractViolation(body, board.now());
        if (violation !== undefined) {
          board.violations.push(violation);
          const reason =
            violation === 'day_out_of_range'
              ? violation
              : violation.startsWith('tz')
                ? 'invalid_tz'
                : 'validation_failed';
          refuse(422, 'unprocessable', { reason });
          return;
        }
        const isUsage = body.includes('"usage":true');
        if (isUsage && board.refuseUsage) {
          refuse(422, 'unprocessable', { reason: 'validation_failed' });
          return;
        }
        if (isUsage && board.offForUsage) {
          refuse(403, 'forbidden', {
            reason: 'local_activity_off',
            org_enabled: board.sharing.org_enabled,
            enabled: false,
          });
          return;
        }
        const mode = board.put;
        if (mode.kind === 'hang') return;
        if (mode.kind === 'off') {
          refuse(403, 'forbidden', {
            reason: 'local_activity_off',
            org_enabled: board.sharing.org_enabled,
            enabled: false,
          });
          return;
        }
        if (mode.kind === 'off-legacy') {
          json(403, { code: 'local_activity_off' });
          return;
        }
        if (mode.kind === 'forbidden') {
          refuse(403, 'forbidden', { reason: mode.reason });
          return;
        }
        if (mode.kind === 'unprocessable') {
          refuse(422, 'unprocessable', { reason: mode.reason });
          return;
        }
        if (mode.kind === 'rate-limited') {
          refuse(429, 'rate_limited', null, { 'retry-after': mode.retryAfter });
          return;
        }
        if (mode.kind === 'status') {
          refuse(mode.status, 'internal');
          return;
        }
        const bucket = board.bucket;
        if (bucket.on) {
          const at = board.now().getTime();
          if (bucket.at === 0) bucket.at = at;
          bucket.tokens = Math.min(30, bucket.tokens + (at - bucket.at) / 120_000);
          bucket.at = at;
          if (bucket.tokens < 1) {
            bucket.limited += 1;
            const wait = Math.ceil((1 - bucket.tokens) * 120);
            refuse(429, 'rate_limited', null, { 'retry-after': String(wait) });
            return;
          }
          bucket.tokens -= 1;
        }
        const sent = JSON.parse(body) as {
          collector_id: string;
          lookback?: true;
          usage?: true;
          days: {
            day: string;
            commits_local?: number;
            pushed_keys?: string[];
            rows?: unknown[];
          }[];
        };
        if (sent.usage === true) {
          for (const d of sent.days as { day: string; backfill?: true; rows?: UsageRowLike[] }[]) {
            const rows = d.rows ?? [];
            // §4.33: a backfilled day takes every other collector's rows for
            // the day and each agent it names.
            if (d.backfill === true) {
              const agents = new Set(rows.map((r) => r.agent));
              for (const [key, held] of board.usage) {
                if (!key.endsWith(`|${d.day}`) || key.startsWith(`${sent.collector_id}|`)) continue;
                board.usage.set(
                  key,
                  (held as UsageRowLike[]).filter((r) => !agents.has(r.agent)),
                );
              }
            }
            board.usage.set(`${sent.collector_id}|${d.day}`, rows);
          }
          json(200, { accepted_days: sent.days.length });
          return;
        }
        for (const d of sent.days) {
          if (sent.lookback !== true) {
            board.snapshots.set(`${sent.collector_id}|${d.day}`, {
              commits_local: d.commits_local ?? 0,
            });
          }
          for (const key of d.pushed_keys ?? []) {
            const held = board.keys.get(key);
            if (held === undefined || d.day < held) board.keys.set(key, d.day);
          }
        }
        json(200, { accepted_days: sent.days.length });
        return;
      }
      refuse(404, 'not_found');
    });
  });
  servers.push(server);
  server.unref();

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  board.url = `http://127.0.0.1:${String(port)}`;
  board.close = () => {
    server.closeAllConnections();
    server.close();
  };
  return board;
}
