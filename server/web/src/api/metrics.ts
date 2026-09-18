import { request } from './client.ts';

/**
 * A project's throughput and cycle time (`GET /projects/:slug/metrics`).
 *
 * **Served since LAI-124 and never called** until now — it was on
 * `endpoint-coverage.test.ts`'s `NO_BROWSER_CALLER` list, which is the guard
 * that made the gap visible rather than a comment claiming it was wired.
 *
 * The server decides every figure here. This module sends the request and
 * names the shape; it computes nothing, because a throughput a client
 * recalculated would be a second answer to a question the server already
 * answered.
 */

export interface ThroughputBucket {
  /** `2026-09-18` — a UTC day, not a timestamp. */
  readonly day: string;
  readonly completed: number;
}

export interface CycleTime {
  /** Completed tasks that had a `started_at` to measure from. */
  readonly measured: number;
  /** Completed tasks with no `started_at` — counted, not measured. */
  readonly unmeasured: number;
  readonly p50_ms: number;
  readonly p75_ms: number;
  readonly p90_ms: number;
}

export interface MetricsView {
  readonly since: number;
  /**
   * Days with **no** completions are present and zero.
   *
   * That is the server's choice and it matters to every caller: a chart can
   * plot the array straight through without inventing the gaps, and a gap
   * invented on the client is how two dashboards come to disagree about a
   * quiet week.
   */
  readonly throughput: readonly ThroughputBucket[];
  /**
   * `null` when nothing completed in the window — **not** a zeroed shape.
   *
   * `{ p50_ms: 0 }` would claim every task finished instantly; `null` says
   * there was nothing to measure, which is a different statement.
   */
  readonly cycle_time: CycleTime | null;
}

export async function getMetrics(
  slug: string,
  since?: number,
  signal?: AbortSignal,
): Promise<MetricsView> {
  const query = since === undefined ? '' : `?since=${String(since)}`;
  return request<MetricsView>(
    `/projects/${encodeURIComponent(slug)}/metrics${query}`,
    signal === undefined ? {} : { signal },
  );
}
