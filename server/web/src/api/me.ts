import { request } from './client.ts';

/** Wire shape of `GET /api/v1/me` — snake_case, like the rest of the API. */
export interface Membership {
  readonly project_id: string;
  readonly role: string;
}

export interface MeProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly org_role: string;
  readonly is_active: boolean;
  readonly memberships: readonly Membership[];
}

/** Who am I. `401` when not signed in — the service decides, not the route. */
export function getMe(signal?: AbortSignal): Promise<MeProfile> {
  return request<MeProfile>('/me', signal === undefined ? {} : { signal });
}
