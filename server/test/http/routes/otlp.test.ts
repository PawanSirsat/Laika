import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, tokens, tokenSessionDays, tokenUsageDays, users } from '../../../src/db/schema.ts';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { TELEMETRY_COLLECTOR } from '../../../src/services/token-telemetry.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * The OpenTelemetry receiver over HTTP (LAI-773, D-087): the door — the
 * developer's own bearer token, both switches, JSON only — and the refusal of
 * every signal but metrics. The service test owns the dedupe.
 */

const PASSWORD = 'correct-horse-battery-staple';
const SESSION = '3f9c1d2e-8a7b-4c6d-9e0f-1a2b3c4d5e6f';

let h: AuthHarness;
let cookie: string;
let orgId: string;
let userId: string;

async function mint(scope: 'full' | 'read_only' = 'full'): Promise<string> {
  const res = await h.app.request('/api/v1/tokens', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({ name: 'Claude Code telemetry', scope }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
}

function share(on: boolean): void {
  h.db
    .update(orgs)
    .set({ developerInsights: on ? 1 : 0 })
    .where(eq(orgs.id, orgId))
    .run();
  h.db
    .update(users)
    .set({ shareLocalActivity: on ? 1 : 0 })
    .where(eq(users.id, userId))
    .run();
}

const ns = (ms: number) => `${String(ms)}000000`;

function metrics(value: number, session: string | null = SESSION): unknown {
  const now = Date.now();
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'claude_code.token.usage',
                sum: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    {
                      attributes: [
                        ...(session === null
                          ? []
                          : [{ key: 'session.id', value: { stringValue: session } }]),
                        { key: 'model', value: { stringValue: 'claude-opus-5-5' } },
                        { key: 'type', value: { stringValue: 'output' } },
                      ],
                      startTimeUnixNano: ns(now - 60_000),
                      timeUnixNano: ns(now),
                      asInt: String(value),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const post = (path: string, body: unknown, token: string, type = 'application/json') =>
  h.app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': type, Authorization: `Bearer ${token}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function reason(res: Response): Promise<string> {
  const body = (await res.json()) as {
    error: { code: string; details: { reason?: string } | null };
  };
  return `${body.error.code}:${body.error.details?.reason ?? ''}`;
}

beforeEach(async () => {
  h = authHarness({ rateLimiter: new RateLimiter() });
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  userId = h.db.select().from(users).get()?.id ?? '';
  share(true);
});

afterEach(() => {
  h.close();
});

describe('POST /api/v1/otlp/v1/metrics', () => {
  it('takes the developer’s own token and answers OTLP’s empty success', async () => {
    const token = await mint();
    const res = await post('/api/v1/otlp/v1/metrics', metrics(420), token);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({});
    const rows = h.db.select().from(tokenUsageDays).all();
    expect(rows.map((r) => [r.collectorId, r.output])).toEqual([[TELEMETRY_COLLECTOR, 420]]);
  });

  it('is not presence: an open session exporting all day keeps nobody online', async () => {
    const token = await mint();
    await post('/api/v1/otlp/v1/metrics', metrics(1), token);
    const row = h.db.select().from(tokens).get();
    expect(row?.lastRestWriteAt).toBeNull();
  });

  it('refuses nobody signed in, a read-only token, and either switch off — before the body', async () => {
    expect(
      (await h.app.request('/api/v1/otlp/v1/metrics', { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    expect(
      await reason(await post('/api/v1/otlp/v1/metrics', metrics(1), await mint('read_only'))),
    ).toBe('forbidden:');
    share(false);
    const res = await post('/api/v1/otlp/v1/metrics', 'not even json', await mint());
    expect(res.status).toBe(403);
    expect(await reason(res)).toBe('forbidden:local_activity_off');
    expect(h.db.select().from(tokenSessionDays).all()).toHaveLength(0);
  });

  it('asks who is sending, and whether they share, before any body is read — even one over the limit', async () => {
    const big = `{"pad":"${'x'.repeat(300 * 1024)}"}`;
    const anonymous = await h.app.request('/api/v1/otlp/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: big,
    });
    expect(anonymous.status).toBe(401);
    const token = await mint();
    share(false);
    const off = await post('/api/v1/otlp/v1/metrics', big, token);
    expect(off.status).toBe(403);
    expect(await reason(off)).toBe('forbidden:local_activity_off');
  });

  it('refuses protobuf, naming the setting that fixes it', async () => {
    const res = await post(
      '/api/v1/otlp/v1/metrics',
      'binary',
      await mint(),
      'application/x-protobuf',
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string; details: { reason: string } } };
    expect(body.error.details.reason).toBe('protobuf_not_supported');
    expect(body.error.message).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
  });

  it('answers a partial success for points it cannot match, and stores none of them', async () => {
    const res = await post('/api/v1/otlp/v1/metrics', metrics(5, null), await mint());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      partialSuccess: { rejectedDataPoints: number; errorMessage: string };
    };
    expect(body.partialSuccess.rejectedDataPoints).toBe(1);
    expect(body.partialSuccess.errorMessage).toContain('session.id');
    expect(h.db.select().from(tokenSessionDays).all()).toHaveLength(0);
  });

  it('refuses a body over 256 KiB', async () => {
    const res = await post(
      '/api/v1/otlp/v1/metrics',
      `{"pad":"${'x'.repeat(300 * 1024)}"}`,
      await mint(),
    );
    expect(res.status).toBe(413);
  });
});

describe('the signals Laika never takes', () => {
  it('refuses logs and traces with 404, saying why, and reads nothing', async () => {
    const token = await mint();
    for (const signal of ['logs', 'traces']) {
      const res = await post(
        `/api/v1/otlp/v1/${signal}`,
        { resourceLogs: [{ prompt: 'secret' }] },
        token,
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/metrics only/);
    }
    expect(h.db.select().from(tokenSessionDays).all()).toHaveLength(0);
  });
});
