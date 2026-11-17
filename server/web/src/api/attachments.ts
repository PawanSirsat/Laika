import { request } from './client.ts';

/**
 * Attachments (SPEC §4.92, §6.4; D-150; the server by LAI-1300).
 *
 * **The bytes never go through Laika.** Attaching is three steps: ask the
 * board for an upload (`createAttachment`), `PUT` the file straight to the
 * store at `upload.url` with `upload.headers` exactly as given — the browser
 * sets `content-length` from the file, and the store refuses any other size
 * or type — then tell the board it is done (`completeAttachment`). The `PUT`
 * is not a `request()`: it goes to another origin, carries no session and
 * answers the store's own way.
 *
 * Markdown embeds `url` — `/api/v1/attachments/<id>/content`, which answers
 * a 302 to the file and never expires — and saving the text links the file
 * to its task and comment on the server. Off on a board with no store: every
 * call answers `503` with `details.reason: 'attachments_off'`, and `GET /org`
 * says `attachments: null` first, so nothing need ask.
 *
 * Mirrors `server/src/services/attachments.ts`, paired in
 * `test/api/view-type-drift.test.ts`.
 */

export interface Attachment {
  readonly id: string;
  readonly project_id: string;
  readonly task_id: string | null;
  readonly comment_id: string | null;
  /** As the uploader named it — shown, never a path. */
  readonly filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
  /**
   * Shown in the page — a png, jpeg, gif, webp or pdf whose first bytes say
   * so. Anything else is served as a download, whatever it was called.
   */
  readonly inline: boolean;
  readonly uploaded_by: string;
  readonly created_at: number;
  /** When the upload was confirmed; null while it is pending. */
  readonly ready_at: number | null;
  /** `/api/v1/attachments/<id>/content` — what markdown embeds. */
  readonly url: string;
}

/** Where and how the browser uploads; good for ten minutes. */
export interface AttachmentUploadTicket {
  readonly url: string;
  readonly method: 'PUT';
  /** Sent exactly as given: the signature covers them. */
  readonly headers: { readonly 'content-type': string; readonly 'content-disposition': string };
  readonly expires_at: number;
}

export interface AttachmentUpload {
  readonly attachment: Attachment;
  readonly upload: AttachmentUploadTicket;
}

export interface AttachmentList {
  readonly data: readonly Attachment[];
}

export interface CreateAttachmentInput {
  /** 1–255 characters, no `/` or `\`. */
  readonly filename: string;
  /** A media type; `application/octet-stream` when the browser has none. */
  readonly content_type: string;
  /** At most `GET /org`'s `attachments.max_bytes`, else `413` with `max_bytes`. */
  readonly size_bytes: number;
  /** A task of the same space; the file belongs to it once completed. */
  readonly task_id?: string;
}

/** Ask for an upload in a space: a pending file and a presigned `PUT`. */
export function createAttachment(
  projectSlug: string,
  input: CreateAttachmentInput,
): Promise<AttachmentUpload> {
  return request<AttachmentUpload>(`/projects/${encodeURIComponent(projectSlug)}/attachments`, {
    method: 'POST',
    body: input,
  });
}

/**
 * The upload is done. Only its uploader may say so; `409` with `reason`
 * `upload_missing` or `size_mismatch` when the store has not got the file as
 * asked for, and the file stays pending.
 */
export function completeAttachment(attachmentId: string): Promise<Attachment> {
  return request<Attachment>(`/attachments/${encodeURIComponent(attachmentId)}/complete`, {
    method: 'POST',
  });
}

/** A task's files: ready, not removed, oldest first. */
export function listTaskAttachments(taskId: string, signal?: AbortSignal): Promise<AttachmentList> {
  return request<AttachmentList>(
    `/tasks/${encodeURIComponent(taskId)}/attachments`,
    signal === undefined ? {} : { signal },
  );
}

/** Remove a file: a lead any, a member their own. */
export function deleteAttachment(attachmentId: string): Promise<void> {
  return request<void>(`/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
}
