import { createServer, type Server } from 'node:http';

import { contractViolation } from './local-activity-contract.ts';

/**
 * A board that implements the two activity endpoints of the contract and
 * nothing else (LAI-752). LAI-751 builds the real ones in parallel; until they
 * exist, this is what the collector is held to.
 *
 * - `GET /api/v1/me/activity-sharing` answers `sharing`.
 * - `PUT /api/v1/me/local-activity` refuses any body the contract refuses
 *   (422, with the rule it broke recorded), and otherwise answers whatever
 *   `put` says: 200 `{ accepted_days }`, 403 `local_activity_off`, 429 with
 *   `Retry-After`, or a hang that only the client's timeout ends.
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
  | { readonly kind: 'off' }
  | { readonly kind: 'rate-limited'; readonly retryAfter: string }
  | { readonly kind: 'hang' }
  | { readonly kind: 'status'; readonly status: number };

export interface StubBoard {
  readonly url: string;
  readonly requests: Recorded[];
  readonly violations: string[];
  sharing: { org_enabled: boolean; enabled: boolean; scope: string; min_sync_interval_s: number };
  put: PutMode;
  /** When the contract's day range is checked: the collector's clock, not the test machine's. */
  now: () => Date;
  readonly close: () => void;
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
    put: { kind: 'ok' },
    now: () => new Date(),
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

      if (req.headers.authorization !== `Bearer ${token}`) {
        json(401, { code: 'unauthorized' });
        return;
      }
      if (req.method === 'GET' && req.url === '/api/v1/me/activity-sharing') {
        json(200, board.sharing);
        return;
      }
      if (req.method === 'PUT' && req.url === '/api/v1/me/local-activity') {
        const violation = contractViolation(body, board.now());
        if (violation !== undefined) {
          board.violations.push(violation);
          json(422, { code: violation === 'day_out_of_range' ? violation : 'validation_failed' });
          return;
        }
        const mode = board.put;
        if (mode.kind === 'hang') return;
        if (mode.kind === 'off') {
          json(403, { code: 'local_activity_off' });
          return;
        }
        if (mode.kind === 'rate-limited') {
          json(429, { code: 'rate_limited' }, { 'retry-after': mode.retryAfter });
          return;
        }
        if (mode.kind === 'status') {
          json(mode.status, { code: 'error' });
          return;
        }
        const days = (JSON.parse(body) as { days: unknown[] }).days.length;
        json(200, { accepted_days: days });
        return;
      }
      json(404, { code: 'not_found' });
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
