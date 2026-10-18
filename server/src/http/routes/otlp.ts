import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { assertMaySendLocalActivity } from '../../services/local-activity.ts';
import { recordArrival } from '../../services/plan-limit.ts';
import { recordTelemetry } from '../../services/token-telemetry.ts';
import { type AppEnv } from '../context.ts';

/**
 * The OpenTelemetry fallback's receiver (LAI-773, D-087, SPEC §6.4):
 * `POST /api/v1/otlp/v1/metrics`, OTLP/HTTP **JSON** only.
 *
 * Transport only: what is read from a body, how it is matched to the session
 * files and why nothing counts twice is `services/token-telemetry.ts`.
 *
 * - **The developer's own Laika token**, as a bearer header the exporter sends
 *   (`OTEL_EXPORTER_OTLP_METRICS_HEADERS`); a web session works too. Both of
 *   D-084's switches are asked **before the body is read**, so a developer who
 *   stopped sharing is refused whatever their exporter sends.
 * - **JSON only** (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`): Laika carries no
 *   protobuf decoder, and a protobuf body is refused `422` naming the setting
 *   rather than guessed at.
 * - **Metrics only.** `/v1/logs` and `/v1/traces` — the exporters that can
 *   carry prompt text — answer `404` without reading a byte. Laika never calls
 *   out (§13.4).
 * - Answers OTLP's own `ExportMetricsServiceResponse`: `{}`, or a
 *   `partialSuccess` naming the points it could not take.
 */

/** An OTLP batch: Claude Code's are a few KiB; this is generous. */
export const OTLP_BODY_MAX = 256 * 1024;

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function otlpRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.post('/v1/metrics', bodyLimit({ maxSize: OTLP_BODY_MAX }), async (c) => {
    const actor = requireActor(c);
    assertMaySendLocalActivity(db, actor);
    const type = (c.req.header('content-type') ?? '').toLowerCase();
    if (!type.startsWith('application/json')) {
      throw new ApiError(
        'unprocessable',
        'Laika takes OTLP/HTTP JSON only: set OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
        { reason: 'protobuf_not_supported' },
      );
    }
    const json: unknown = await c.req.json().catch(() => null);
    const result = recordTelemetry(db, actor, json);
    // Best effort: what arrived feeds the developer's own plan-limit rate.
    try {
      recordArrival(db, actor.userId, result.arrived, Date.now());
    } catch (error) {
      c.get('log').warn('otlp.arrival_unrecorded', {
        request_id: c.get('requestId'),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return c.json(result.response, 200);
  });

  // The exporters that can carry prompt text: no route takes them, said so.
  for (const signal of ['logs', 'traces'] as const) {
    app.post(`/v1/${signal}`, () => {
      throw ApiError.notFound(
        `Laika takes OTLP metrics only, never ${signal}: set OTEL_${signal === 'logs' ? 'LOGS' : 'TRACES'}_EXPORTER=none`,
      );
    });
  }

  return app;
}
