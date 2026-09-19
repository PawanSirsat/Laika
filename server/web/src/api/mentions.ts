import { request } from './client.ts';

/**
 * Who can be `@`-mentioned in a space (`GET /projects/:slug/mentionable`).
 *
 * Served since mentions were built and never called from the browser — it was
 * on `endpoint-coverage.test.ts`'s `NO_BROWSER_CALLER` list as half of LAI-458.
 *
 * **The server decides who is mentionable**, not the client. It is not simply
 * "the members": who may be *told* about a task depends on who can read it, and
 * a list built from members here would be a second, wrong answer for a private
 * space.
 *
 * ## The shape is the route's, not a guess
 *
 * `{ users: [{ id, name }] }` — **not** a `Page`, and the field is `id`, not
 * `user_id`. The first version of this file assumed both, because every
 * neighbouring endpoint is paginated and every other person-shaped payload says
 * `user_id`. `page.data` was `undefined`, `people.length` threw, and the whole
 * drawer went blank. Read the route; do not pattern-match its neighbours.
 */
export interface MentionableUser {
  /** The user's id. The route calls it `id` here and `user_id` elsewhere. */
  readonly id: string;
  readonly name: string;
}

export interface MentionableList {
  readonly users: readonly MentionableUser[];
}

export function listMentionable(slug: string, signal?: AbortSignal): Promise<MentionableList> {
  return request<MentionableList>(
    `/projects/${encodeURIComponent(slug)}/mentionable`,
    signal === undefined ? {} : { signal },
  );
}
