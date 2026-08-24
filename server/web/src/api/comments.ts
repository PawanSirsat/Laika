import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * Task comments (SPEC §6.4, LAI-047).
 *
 * Returned **oldest-first**, which is the opposite of the activity feed. Both
 * are deliberate: a comment thread reads as a conversation, so it runs forward;
 * a feed is scanned from the top, so it runs backward. See `activity.ts`.
 *
 * The list carries tombstones for deleted comments, same convention as projects
 * (§6.3) — a deleted comment must reach a client that is catching up, or its
 * copy keeps a message the server no longer has.
 */

export interface Comment {
  readonly id: string;
  readonly task_id: string;
  readonly author_id: string;
  readonly body_md: string;
  /** `'web' | 'mcp' | 'api' | …` — how it arrived. `mcp` means an agent. */
  readonly created_via: string;
  /** Non-null once edited, so a UI can say "edited" without comparing stamps. */
  readonly edited_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface CommentTombstone {
  readonly id: string;
  readonly deleted: true;
}

export type CommentRow = Comment | CommentTombstone;

export function isCommentTombstone(row: CommentRow): row is CommentTombstone {
  return (row as CommentTombstone).deleted === true;
}

/** The positive half — `.filter(isComment)` narrows where negation does not. */
export function isComment(row: CommentRow): row is Comment {
  return !isCommentTombstone(row);
}

/**
 * Was this written by an agent?
 *
 * `created_via`, because `CommentView` carries no `actor_kind` — only the
 * activity feed does. A comment that arrived over MCP is agent-authored by
 * definition, so this is the same fact by a different route rather than a
 * guess. LAI-056 AC4 names `actor_kind`; see the task file.
 */
export function isAgentComment(comment: Comment): boolean {
  return comment.created_via === 'mcp';
}

export function listComments(taskId: string, signal?: AbortSignal): Promise<Page<CommentRow>> {
  return request<Page<CommentRow>>(
    `/tasks/${encodeURIComponent(taskId)}/comments?limit=100`,
    signal === undefined ? {} : { signal },
  );
}

export function addComment(taskId: string, bodyMd: string): Promise<Comment> {
  return request<Comment>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    body: { body_md: bodyMd },
  });
}
