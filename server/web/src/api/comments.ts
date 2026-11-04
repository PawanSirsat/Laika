import { withPage, type PageQuery } from './every-page.ts';
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
  /** Null on a comment mirrored from GitHub, which has no local author (§6.4). */
  readonly author_id: string | null;
  readonly body_md: string;
  /** `'web' | 'mcp' | 'api' | …` — how it arrived. `mcp` means an agent. */
  readonly created_via: string;
  /** Non-null once edited, so a UI can say "edited" without comparing stamps. */
  readonly edited_at: number | null;
  /** The reason a person gave when sending the task back from review (D-082). */
  readonly sent_back: boolean;
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

export function listComments(
  taskId: string,
  signal?: AbortSignal,
  page: PageQuery = {},
): Promise<Page<CommentRow>> {
  const params = withPage(new URLSearchParams({ limit: '100' }), page);
  return request<Page<CommentRow>>(
    `/tasks/${encodeURIComponent(taskId)}/comments?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

export function addComment(taskId: string, bodyMd: string): Promise<Comment> {
  return request<Comment>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    body: { body_md: bodyMd },
  });
}

/**
 * Edit a comment's text (§6.4, LAI-1122): its author, or a lead and an org
 * Admin or Owner for any. A comment mirrored from GitHub has no local author
 * and is refused `409 no_local_author` — the refusal is shown as the server
 * words it.
 */
export function editComment(commentId: string, bodyMd: string): Promise<Comment> {
  return request<Comment>(`/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    body: { body_md: bodyMd },
  });
}

/** Delete a comment (§6.4, LAI-1122): soft, so the history keeps a line saying so. */
export function deleteComment(commentId: string): Promise<void> {
  return request<void>(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
}

/**
 * Whether the thread offers Edit and Delete on a comment (§3.2): the
 * reader's own, or any for a reader who leads the space. A comment with no
 * local author — mirrored from GitHub — is offered to nobody, since the
 * server refuses every change to one. The server decides; this only keeps a
 * control from being offered to someone it would refuse.
 */
export function mayChangeComment(
  comment: { readonly author_id: string | null },
  meId: string | undefined,
  leads: boolean,
): boolean {
  if (comment.author_id === null) return false;
  return leads || (meId !== undefined && comment.author_id === meId);
}
