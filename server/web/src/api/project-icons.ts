import { putToStore, type UploadRequest } from './attachment-upload.ts';
import type { AttachmentUploadTicket } from './attachments.ts';
import { request } from './client.ts';
import { remembered, type Project } from './projects.ts';
import { updateSpace } from './space-settings.ts';

/**
 * A space's icon (D-152, LAI-1311): an image in the attachments store, an
 * emoji, or neither — when `ProjectMark` draws the first letter. Owners and
 * admins only (`project.icon.write`); the server says so on every route.
 *
 * The image is three steps, the attachments' shape: ask for a presigned `PUT`
 * (`POST /projects/:slug/icon`), send the bytes straight to the store, then
 * say it is done (`POST /projects/:slug/icon/complete`), which answers the
 * space as it now stands. Every answer is remembered, so each mark of the
 * space on the page changes at once.
 */

/** The types the server takes for an icon — never SVG (D-152). */
export const ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type IconType = (typeof ICON_TYPES)[number];

/** The most an icon may be — the server's cap; a board with smaller attachments takes less. */
export const ICON_MAX_BYTES = 1024 * 1024;

/** What `POST /projects/:slug/icon` answers. */
export interface ProjectIconUpload {
  /** What completing names. */
  readonly upload_id: string;
  readonly upload: AttachmentUploadTicket;
  readonly max_bytes: number;
}

export function isIconType(type: string): type is IconType {
  return (ICON_TYPES as readonly string[]).includes(type);
}

export function askProjectIcon(
  slug: string,
  input: { readonly content_type: IconType; readonly size_bytes: number },
): Promise<ProjectIconUpload> {
  return request<ProjectIconUpload>(`/projects/${encodeURIComponent(slug)}/icon`, {
    method: 'POST',
    body: input,
  });
}

export function completeProjectIcon(
  slug: string,
  input: {
    readonly upload_id: string;
    readonly content_type: IconType;
    readonly size_bytes: number;
  },
): Promise<Project> {
  return request<Project>(`/projects/${encodeURIComponent(slug)}/icon/complete`, {
    method: 'POST',
    body: input,
  }).then(remembered);
}

/** Take the icon away — image and emoji alike — so the space shows its letter. */
export function removeProjectIcon(slug: string): Promise<Project> {
  return request<Project>(`/projects/${encodeURIComponent(slug)}/icon`, {
    method: 'DELETE',
  }).then(remembered);
}

/** Make one emoji the space's icon, or clear it with `null`. */
export function setProjectEmoji(slug: string, emoji: string | null): Promise<Project> {
  return updateSpace(slug, { icon_emoji: emoji });
}

/** Why an image was not taken before anything was sent. */
export class IconFileError extends Error {
  readonly reason: 'type' | 'size' | 'empty';

  constructor(reason: 'type' | 'size' | 'empty', message: string) {
    super(message);
    this.name = 'IconFileError';
    this.reason = reason;
  }
}

/**
 * The file's problem, worded for the person who picked it, or `null` when it
 * may be sent: png, jpeg or webp, and no more than `maxBytes`.
 */
export function iconFileProblem(
  file: { readonly type: string; readonly size: number },
  maxBytes: number = ICON_MAX_BYTES,
): IconFileError | null {
  if (!isIconType(file.type)) {
    return new IconFileError('type', 'An icon is a PNG, JPEG or WebP image.');
  }
  if (file.size === 0) return new IconFileError('empty', 'That file is empty.');
  if (file.size > maxBytes) {
    return new IconFileError(
      'size',
      `An icon is at most ${String(Math.floor(maxBytes / 1024))} KB — that one is ${String(Math.ceil(file.size / 1024))} KB.`,
    );
  }
  return null;
}

/** The steps staging takes — the network's by default, a test's in a test. */
export interface IconStageSteps {
  readonly ask: typeof askProjectIcon;
  readonly makeRequest?: (() => UploadRequest) | undefined;
}

const NETWORK: IconStageSteps = { ask: askProjectIcon };

/** An image in the store, not yet the space's icon: what `completeProjectIcon` takes. */
export interface StagedIcon {
  readonly upload_id: string;
  readonly content_type: IconType;
  readonly size_bytes: number;
}

/**
 * Put `file` in the store as a candidate icon (LAI-1321): ask, then `PUT` —
 * **not** complete. The space's icon does not change until Save changes
 * completes it (`completeProjectIcon`), so a person can still discard it.
 *
 * Nothing is stored between asking and completing (D-152), so a staged image
 * has no deadline: only the presigned `PUT` is ten minutes long, and it is
 * spent here, at once. One that is never completed stays in the store — the
 * limit D-152 records. A file of the wrong type or size is refused before
 * anything is sent (`IconFileError`).
 */
export async function stageProjectIcon(
  slug: string,
  file: Blob & { readonly type: string },
  onProgress: (fraction: number) => void = () => undefined,
  signal?: AbortSignal,
  steps: IconStageSteps = NETWORK,
): Promise<StagedIcon> {
  const problem = iconFileProblem(file);
  if (problem !== null) throw problem;
  const contentType = file.type as IconType;
  // A board whose limit is under a megabyte refuses a bigger file here, `413`.
  const ticket = await steps.ask(slug, { content_type: contentType, size_bytes: file.size });
  await putToStore(ticket.upload, file, onProgress, signal, steps.makeRequest);
  return { upload_id: ticket.upload_id, content_type: contentType, size_bytes: file.size };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20e3}/u;
const NOT_EMOJI = /[\s\p{Cc}]/u;

/**
 * Whether `value`, trimmed, is exactly one emoji — the server's rule
 * (`parseIconEmoji`), so the field can say so before Save rather than after.
 */
export function isOneEmoji(value: string): boolean {
  const emoji = value.trim();
  if (emoji === '' || NOT_EMOJI.test(emoji) || [...emoji].length > 32) return false;
  if ([...graphemes.segment(emoji)].length !== 1) return false;
  return PICTOGRAPH.test(emoji);
}
