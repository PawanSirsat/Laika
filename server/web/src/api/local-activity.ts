import type { AgentClient } from './agent-clients.ts';
import { request } from './client.ts';

/**
 * The developer's side of D-079 (SPEC §6.4, LAI-751): whether they share
 * local activity, which repositories count, what the server holds about them,
 * and erasing it.
 *
 * Every write here is the signed-in person's own consent, so the server takes
 * it from a web session only; the collector on their machine reads the
 * setting with a token and sends counts, and never changes it.
 *
 * Every type mirrors `services/local-activity.ts`; `view-type-drift.test.ts`
 * holds the two in step.
 */

export const LOCAL_ACTIVITY_SCOPES = ['agent-repos', 'laika-repos'] as const;
export type LocalActivityScope = (typeof LOCAL_ACTIVITY_SCOPES)[number];

export interface ActivitySharing {
  /** The organisation's *Developer insights* switch. */
  readonly org_enabled: boolean;
  /** This person's own switch. */
  readonly enabled: boolean;
  readonly scope: LocalActivityScope;
  readonly min_sync_interval_s: number;
}

export interface OwnLocalDay {
  readonly day: string;
  readonly prompts_by_agent: Partial<Record<AgentClient, number>>;
  readonly sessions: number;
  readonly commits_local: number;
  readonly pushed_commits: number;
  /** Their agents' tokens that day, cache reads apart (D-084, LAI-769). */
  readonly tokens: number;
  readonly cache_read: number;
}

export interface OwnLocalActivity {
  readonly start: string;
  readonly end: string;
  readonly tz: string;
  /** Newest first; only days with something held. */
  readonly days: readonly OwnLocalDay[];
  readonly collectors: number;
  readonly oldest_day: string | null;
}

export function getActivitySharing(signal?: AbortSignal): Promise<ActivitySharing> {
  return request<ActivitySharing>('/me/activity-sharing', signal === undefined ? {} : { signal });
}

export function setActivitySharing(change: {
  readonly enabled?: boolean;
  readonly scope?: LocalActivityScope;
}): Promise<ActivitySharing> {
  return request<ActivitySharing>('/me/activity-sharing', { method: 'PUT', body: change });
}

export function getOwnLocalActivity(signal?: AbortSignal): Promise<OwnLocalActivity> {
  return request<OwnLocalActivity>(
    '/me/local-activity?days=14',
    signal === undefined ? {} : { signal },
  );
}

export function deleteOwnLocalActivity(): Promise<void> {
  return request<void>('/me/local-activity', { method: 'DELETE' });
}

/** The receiver's path for OTLP metrics (LAI-773, SPEC §6.4). */
export const OTLP_METRICS_PATH = '/api/v1/otlp/v1/metrics';

/**
 * The OpenTelemetry block (LAI-773, design §3), with this board's address in
 * it and the token left as `$LAIKA_TOKEN` — the variable `laika init` and the
 * Connect steps already set — so the page never prints a secret. Metrics only:
 * JSON over HTTP (Laika has no protobuf decoder), cumulative so a retried
 * export cannot count twice, and logs off, because a log exporter can carry
 * prompt text and Laika refuses it.
 */
export function otelEnvBlock(origin: string): string {
  return [
    'export CLAUDE_CODE_ENABLE_TELEMETRY=1',
    'export OTEL_METRICS_EXPORTER=otlp',
    'export OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
    `export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="${origin}${OTLP_METRICS_PATH}"`,
    'export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer $LAIKA_TOKEN"',
    'export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative',
    'export OTEL_LOGS_EXPORTER=none',
  ].join('\n');
}
