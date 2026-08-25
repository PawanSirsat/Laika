import { request } from './client.ts';
import { ApiError } from './errors.ts';
import type { Task } from './tasks.ts';

/**
 * Tags (SPEC §4, D-027 — API by LAI-079, this screen by LAI-081).
 *
 * ## The naming rule lives on the server, and only there
 *
 * D-027 put it there and this client does not reimplement it. It trims and
 * lower-cases — which is *shaping what the user typed*, not deciding whether it
 * is allowed — and then sends. Anything the server refuses comes back as a
 * `422` whose message is written for a person to read:
 *
 * > "has space" is not a valid tag: lowercase letters, digits and hyphens,
 * > starting with a letter or digit, up to 24 characters
 *
 * Copying that pattern here would put the rule in two places, and the copy is
 * the one that goes stale — nothing fails when the server tightens it.
 */

/** The cap the server enforces, mirrored so the UI can stop before a refusal. */
export const MAX_TAGS_PER_TASK = 20;

export interface ProjectTag {
  readonly name: string;
  /**
   * How many tasks carry it.
   *
   * The reason the picker shows existing tags at all: a count is what stops
   * someone minting `frontend` when `ui` is already on forty tasks.
   */
  readonly task_count: number;
}

interface ProjectTagList {
  readonly tags: readonly ProjectTag[];
}

/** Every tag used in the project, with its usage count. */
export function listProjectTags(
  slug: string,
  signal?: AbortSignal,
): Promise<readonly ProjectTag[]> {
  return request<ProjectTagList>(
    `/projects/${encodeURIComponent(slug)}/tags`,
    signal === undefined ? {} : { signal },
  ).then((body) => body.tags);
}

/**
 * Set a task's tags. **Replaces the whole set**, it does not add to it.
 *
 * That is the server's shape (`PATCH { tags: [...] }` reads as *these are the
 * task's tags now*), so the caller always sends the complete list. Sending only
 * the new one would silently clear the rest.
 */
export function setTaskTags(taskId: string, tags: readonly string[]): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: { tags },
  });
}

/**
 * What the user typed, shaped — not judged.
 *
 * Trim and lower-case only. `Core` and `core` are the same tag and nobody should
 * have to know that; a leading space is a slip. Everything else is the server's
 * to accept or refuse.
 */
export function normaliseTagInput(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The server's refusal, in a form worth showing.
 *
 * Two shapes come back. The service's own `422` for a bad name is written for a
 * person and is used verbatim. A schema rejection is `"Invalid request body"`
 * with the detail in `issues[]` — showing that headline to someone who typed one
 * word tells them nothing, so the issue's message is used instead.
 */
export function readableRefusal(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'Could not save that tag.';

  const details = cause.details as { readonly issues?: readonly { message: string }[] } | null;
  const issue = details?.issues?.[0]?.message;
  if (cause.message === 'Invalid request body' && issue !== undefined) return issue;

  return cause.message;
}
