import { request } from './client.ts';

/**
 * `GET /api/v1/health` — the only endpoint that reports a version (LAI-064).
 *
 * **This is the instance's version, not a project's.** Projects have no version
 * column and no field in SPEC §4.3, so the prototype's `laika-core · v0.4`
 * conflates two things, only one of which exists. The shell shows the slug as
 * the project and this as Laika's own version, labelled so the two cannot be
 * read as one.
 *
 * Public: it answers before sign-in, which is what lets the pre-auth shell show
 * a version at all.
 */
export interface Health {
  readonly status: string;
  readonly version: string;
  readonly uptime_ms: number;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return request<Health>('/health', signal === undefined ? {} : { signal });
}
