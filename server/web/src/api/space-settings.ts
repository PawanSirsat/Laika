import { request } from './client.ts';
import { ApiError } from './errors.ts';
import { fieldErrors } from './setup.ts';
import type { Project } from './projects.ts';
import type { SpaceColor } from '../theme/space-color.ts';

/**
 * A space's settings (D-103, LAI-976 serves them; the page is LAI-977).
 *
 * One `PATCH /projects/:slug` takes every field the page edits — General's
 * form sends what changed, Access sends one field per click — and answers the
 * project as it now stands, which the page renders from rather than patching
 * its own copy.
 */
export interface SpaceSettingsPatch {
  readonly name?: string;
  readonly description?: string;
  /** `owner/name`, or `null` to clear it. */
  readonly repo?: string | null;
  readonly color?: SpaceColor | null;
  /** A new key prefix: new tasks take it, every old key keeps resolving. */
  readonly prefix?: string;
  readonly visibility?: Project['visibility'];
  readonly task_create_min_role?: Project['task_create_min_role'];
  readonly agents_allowed?: boolean;
  readonly archived?: boolean;
}

export function updateSpace(slug: string, patch: SpaceSettingsPatch): Promise<Project> {
  return request<Project>(`/projects/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: patch,
  });
}

/** What `POST /projects/:slug/leave` answers (D-103 item 5). */
export interface LeaveSpaceView {
  readonly slug: string;
  /** The reader can still open the space — an org role holding *Open every project*. */
  readonly implicit_access: boolean;
  /** Says so in words when `implicit_access`; `null` otherwise. */
  readonly notice: string | null;
}

/**
 * Leave a space you are a member of. The last space admin is refused `409`
 * with `reason: 'last_lead'` and a message saying to hand over first, which
 * the page shows as it is.
 */
export function leaveSpace(slug: string): Promise<LeaveSpaceView> {
  return request<LeaveSpaceView>(`/projects/${encodeURIComponent(slug)}/leave`, {
    method: 'POST',
  });
}

/**
 * The server's refusal, by the field it is about.
 *
 * A `422` names fields in `issues` (`fieldErrors`); a `409` names one in
 * `details.field` — a prefix another space holds, or held (`reason:
 * 'former'`). Either way the message goes under that field, in the server's
 * words: it knows why, and a client rewording would be a second source.
 */
export function settingsFieldErrors(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof ApiError)) return {};
  if (error.code === 'conflict') {
    const field = (error.details as { field?: unknown } | null)?.field;
    return typeof field === 'string' ? { [field]: error.message } : {};
  }
  return fieldErrors(error);
}
