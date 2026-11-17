import { formatBytes } from '../../../api/attachment-upload.ts';
import type { Attachment } from '../../../api/attachments.ts';
import { timeLabel, type TimeLabel } from '../../../api/time-label.ts';
import { fileKind, type FileKind } from './editor/attach.ts';

/**
 * The task panel's Attachments section, as data (D-150, LAI-1301): one row
 * per file — what it is, how big, who added it and when — and whether the
 * reader may remove it.
 */

/** The fields of an attachment the section draws. */
export type AttachmentFacts = Pick<
  Attachment,
  | 'id'
  | 'filename'
  | 'content_type'
  | 'size_bytes'
  | 'uploaded_by'
  | 'created_at'
  | 'ready_at'
  | 'url'
>;

/** Who is reading, and what they hold here. */
export interface AttachmentReader {
  readonly meId: string | undefined;
  /** Leads the space: removes any file (§3.2 *Remove an attachment*: own + any). */
  readonly leads: boolean;
  /** Holds `attachment.delete` on the project at all — a viewer does not. */
  readonly holdsDelete: boolean;
}

/**
 * May the reader remove this file? §3.2: a lead any, a member their own, a
 * viewer none. The server decides again; this only keeps a control from being
 * offered to someone it would refuse — the rule comments follow
 * (`mayChangeComment`).
 */
export function mayDeleteAttachment(
  attachment: Pick<AttachmentFacts, 'uploaded_by'>,
  reader: AttachmentReader,
): boolean {
  if (!reader.holdsDelete) return false;
  return reader.leads || (reader.meId !== undefined && attachment.uploaded_by === reader.meId);
}

/** One row of the section. */
export interface AttachmentRow {
  readonly id: string;
  readonly filename: string;
  readonly kind: FileKind;
  readonly size: string;
  readonly uploader: string;
  /** When it was ready to read — the moment it was added, as a person saw it. */
  readonly when: TimeLabel;
  readonly url: string;
  readonly mayDelete: boolean;
}

/** The rows, in the server's order: oldest first. */
export function attachmentRows(
  attachments: readonly AttachmentFacts[],
  reader: AttachmentReader,
  nameOf: (userId: string) => string,
  now: number,
): AttachmentRow[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    kind: fileKind(attachment.filename, attachment.content_type),
    size: formatBytes(attachment.size_bytes),
    uploader: nameOf(attachment.uploaded_by),
    when: timeLabel(attachment.ready_at ?? attachment.created_at, now),
    url: attachment.url,
    mayDelete: mayDeleteAttachment(attachment, reader),
  }));
}

/** The two verbs that change a task's files (§4.8, D-150 item 7). */
export const ATTACHMENT_VERBS: ReadonlySet<string> = new Set([
  'attachment.added',
  'attachment.removed',
]);

/**
 * Is this live frame a change to `taskId`'s files? Its verb, and the task its
 * row names; a frame that cannot be read is not.
 */
export function changesFilesOf(
  frame: { readonly type: string; readonly data: string },
  taskId: string,
): boolean {
  if (!ATTACHMENT_VERBS.has(frame.type)) return false;
  try {
    return (JSON.parse(frame.data) as { task_id?: unknown }).task_id === taskId;
  } catch {
    return false;
  }
}

/** The heading's count: *Attachments · 3*, nothing after it when there are none. */
export function attachmentsHeading(count: number): string {
  return count === 0 ? 'Attachments' : `Attachments · ${String(count)}`;
}
