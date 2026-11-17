import { completeAttachment, createAttachment, type Attachment } from './attachments.ts';
import { ApiError, NetworkError } from './errors.ts';

/**
 * Uploading a file (D-150, LAI-1301): ask Laika, send the bytes straight to
 * the store, tell Laika it is done.
 *
 * **Bytes never pass through Laika** (D-150 item 3). `POST
 * /projects/:slug/attachments` answers a presigned `PUT` that signs the key,
 * the type, the length and the disposition; the browser sends the file to the
 * operator's store with exactly the headers it was given — the store refuses
 * anything else with a 403 — and `POST /attachments/:id/complete` has Laika
 * check what arrived.
 *
 * **The one raw request.** `request()` speaks JSON to `/api/v1` with the
 * session cookie; this is a file to another origin, with no cookie, and it
 * has to report progress — which `fetch` cannot do for a request body. So it
 * is an `XMLHttpRequest`, the one exception, as the time report's CSV
 * download is the one raw `fetch` (`time.ts`).
 */

/** What the store is sent, as Laika signed it. */
export interface StoreUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** `content-type` and `content-disposition`, sent exactly as given. */
  readonly headers: Readonly<Record<string, string>>;
}

/** The part of an attachment the text needs. */
export type UploadedAttachment = Pick<
  Attachment,
  'id' | 'filename' | 'content_type' | 'inline' | 'url'
>;

/** A file the text links: its name, Laika's URL for it, and whether it is drawn. */
export interface AttachedFile {
  readonly filename: string;
  readonly url: string;
  /** An image the server verified (`inline` and `image/*`): drawn, not linked. */
  readonly image: boolean;
}

/** Why an upload did not finish, each with its own sentence. */
export type UploadFailure =
  'empty' | 'too_large' | 'off' | 'network' | 'store' | 'incomplete' | 'refused' | 'aborted';

/** An upload that did not finish; `message` says why, for the person. */
export class AttachmentUploadError extends Error {
  readonly reason: UploadFailure;

  constructor(reason: UploadFailure, message: string) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.reason = reason;
  }
}

/**
 * A size as a person reads it: `812 B`, `14 KB`, `3.4 MB`. Steps of 1024,
 * one decimal under ten.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${String(Math.max(0, Math.round(bytes)))} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${shown} ${units[unit] ?? 'GB'}`;
}

/**
 * The name a file is uploaded under. The server refuses `/`, `\` and control
 * characters and more than 255 characters (§4.92); each refused character is
 * a `-` here rather than a refusal there. A file with no name, and a pasted
 * screenshot — every browser calls one `image.png` — is named for when it
 * arrived.
 */
export function uploadName(name: string, contentType: string, now: Date, pasted = false): string {
  const cleaned = Array.from(name.trim())
    .map((c) => (c === '/' || c === '\\' || /\p{Cc}/u.test(c) ? '-' : c))
    .join('')
    .slice(0, 255);
  if (cleaned !== '' && !(pasted && /^image\.(png|jpe?g|gif|webp)$/i.test(cleaned))) {
    return cleaned;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  const extension = /\.([a-z0-9]+)$/i.exec(cleaned)?.[1] ?? contentType.split('/')[1] ?? 'bin';
  return `Pasted ${stamp}.${extension.toLowerCase()}`;
}

/** The type a file is declared as: the browser's, lower-cased, or plain bytes. */
export function declaredType(file: { readonly type: string }): string {
  const type = file.type.trim().toLowerCase();
  return type === '' || type.length > 127 ? 'application/octet-stream' : type;
}

/** The parts of an `XMLHttpRequest` an upload uses — a test drives a fake. */
export interface UploadRequest {
  open: (method: string, url: string) => void;
  setRequestHeader: (name: string, value: string) => void;
  send: (body: Blob) => void;
  abort: () => void;
  readonly status: number;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  onload: ((event: ProgressEvent) => void) | null;
  onerror: ((event: ProgressEvent) => void) | null;
  onabort: ((event: ProgressEvent) => void) | null;
  ontimeout: ((event: ProgressEvent) => void) | null;
}

/**
 * Send `file` to the store as `upload` says: its method, its URL, and **its
 * headers exactly** — one more or one changed and the signature no longer
 * matches. `onProgress` hears the fraction sent, 0 to 1. Resolves on a 2xx;
 * a refusal is `store`, a dropped connection `network`.
 */
export function putToStore(
  upload: StoreUpload,
  file: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  makeRequest: () => UploadRequest = () => new XMLHttpRequest(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AttachmentUploadError('aborted', 'The upload was cancelled.'));
      return;
    }
    const xhr = makeRequest();
    const stop = (): void => {
      xhr.abort();
    };
    const settle = (): void => {
      signal?.removeEventListener('abort', stop);
    };
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(new AttachmentUploadError('store', String(xhr.status)));
    };
    xhr.onerror = () => {
      settle();
      reject(new AttachmentUploadError('network', 'network'));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      settle();
      reject(new AttachmentUploadError('aborted', 'The upload was cancelled.'));
    };
    signal?.addEventListener('abort', stop);
    xhr.send(file);
  });
}

/** What Laika answers when asked for an upload. */
export interface AskAnswer {
  readonly attachment: UploadedAttachment;
  readonly upload: StoreUpload;
}

/** The three steps, as calls — the real ones by default, fakes in a test. */
export interface UploadSteps {
  readonly ask: (
    slug: string,
    body: {
      readonly filename: string;
      readonly content_type: string;
      readonly size_bytes: number;
      readonly task_id?: string;
    },
  ) => Promise<AskAnswer>;
  readonly put: typeof putToStore;
  readonly complete: (id: string) => Promise<UploadedAttachment>;
}

/** Where a file goes: the project, and the task when there is one yet. */
export interface UploadTarget {
  readonly slug: string;
  /** Absent while a task is being created: the server links the file on save. */
  readonly taskId?: string | undefined;
  /** `OrgView.attachments.max_bytes`: a bigger file is refused before asking. */
  readonly maxBytes: number;
}

export interface UploadOptions {
  /** A screenshot off the clipboard, named for when it arrived. */
  readonly pasted?: boolean | undefined;
  readonly onProgress?: ((fraction: number) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly now?: Date | undefined;
}

/** The limit a `413` names, else the one the board said. */
function maxFrom(error: ApiError, fallback: number): number {
  const max = (error.details as { max_bytes?: unknown } | null)?.max_bytes;
  return typeof max === 'number' && max > 0 ? max : fallback;
}

const tooLarge = (name: string, size: number, max: number): AttachmentUploadError =>
  new AttachmentUploadError(
    'too_large',
    `“${name}” is ${formatBytes(size)}; a file can be at most ${formatBytes(max)}.`,
  );

/** Is this the server saying the board has no store (D-150 item 1)? */
export function isAttachmentsOff(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 503) return false;
  return (error.details as { reason?: unknown } | null)?.reason === 'attachments_off';
}

/**
 * Upload `file` to `target` — ask, send, complete — and answer what the text
 * links. Every failure is an {@link AttachmentUploadError} whose message says
 * why in a sentence: too big (checked before asking), the board has no store,
 * the connection, the store's refusal, a file that did not arrive whole.
 */
export async function uploadAttachment(
  target: UploadTarget,
  file: File,
  options: UploadOptions,
  steps: UploadSteps,
): Promise<AttachedFile> {
  const type = declaredType(file);
  const name = uploadName(file.name, type, options.now ?? new Date(), options.pasted === true);
  if (file.size === 0) {
    throw new AttachmentUploadError('empty', `“${name}” is empty — there is nothing to attach.`);
  }
  if (file.size > target.maxBytes) throw tooLarge(name, file.size, target.maxBytes);

  const failed = (error: unknown): AttachmentUploadError => {
    if (error instanceof AttachmentUploadError) {
      if (error.reason === 'network') {
        return new AttachmentUploadError(
          'network',
          `Could not upload “${name}”: the connection dropped. Try again.`,
        );
      }
      if (error.reason === 'store') {
        return new AttachmentUploadError(
          'store',
          `The file store refused “${name}” (${error.message}). Try again; if it keeps happening, tell whoever runs this board.`,
        );
      }
      return error;
    }
    if (isAttachmentsOff(error)) {
      return new AttachmentUploadError('off', 'Attachments are off on this board.');
    }
    if (error instanceof ApiError && error.code === 'payload_too_large') {
      return tooLarge(name, file.size, maxFrom(error, target.maxBytes));
    }
    if (error instanceof ApiError && error.code === 'conflict') {
      return new AttachmentUploadError('incomplete', `“${name}” did not arrive whole. Try again.`);
    }
    if (error instanceof NetworkError) {
      return new AttachmentUploadError(
        'network',
        `Could not upload “${name}”: Laika could not be reached. Try again.`,
      );
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return new AttachmentUploadError('aborted', 'The upload was cancelled.');
    }
    return new AttachmentUploadError(
      'refused',
      error instanceof ApiError ? error.message : `Could not upload “${name}”. Try again.`,
    );
  };

  try {
    const asked = await steps.ask(target.slug, {
      filename: name,
      content_type: type,
      size_bytes: file.size,
      ...(target.taskId === undefined ? {} : { task_id: target.taskId }),
    });
    await steps.put(asked.upload, file, options.onProgress ?? (() => undefined), options.signal);
    const done = await steps.complete(asked.attachment.id);
    return {
      filename: done.filename,
      url: done.url,
      image: done.inline && done.content_type.startsWith('image/'),
    };
  } catch (error) {
    throw failed(error);
  }
}

/**
 * What an editor is handed to attach files with (LAI-1301): the board's
 * limit, and an upload already aimed at its project and task. Absent where
 * the board has no store — no paperclip, and a dropped file is refused as
 * before.
 */
export interface EditorAttach {
  readonly maxBytes: number;
  readonly upload: (file: File, options: UploadOptions) => Promise<AttachedFile>;
}

/** The real three steps: Laika's two calls and the store's `PUT`. */
const STEPS: UploadSteps = { ask: createAttachment, put: putToStore, complete: completeAttachment };

/** An uploader aimed at a project and, once it exists, a task. */
export function attachTo(slug: string, taskId: string | undefined, maxBytes: number): EditorAttach {
  return {
    maxBytes,
    upload: (file, options) => uploadAttachment({ slug, taskId, maxBytes }, file, options, STEPS),
  };
}
