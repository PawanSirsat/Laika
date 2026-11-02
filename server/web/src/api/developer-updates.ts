import { request } from './client.ts';

/**
 * `GET /api/v1/developer/compatibility` read whole (LAI-1065), for the update
 * statuses on the Devices tab: the helper commit the board offers, its
 * protocol, each feature's protocol and the release notes. The screen parses
 * it (`update-status.ts`), so an answer it cannot read is *Could not check*
 * there, never a crash here.
 *
 * Not `loadDeveloperAccessMode`'s once-per-page answer: *Retry* must be able
 * to ask again.
 */
export function getCompatibility(signal?: AbortSignal): Promise<unknown> {
  return request<unknown>('/developer/compatibility', signal === undefined ? {} : { signal });
}
