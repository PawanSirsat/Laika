import type { AttachedFile } from '../../../../api/attachment-upload.ts';

/**
 * Files in the text (D-150, LAI-1301): which URLs are Laika's own attachments,
 * what a file is called and drawn as, how it is written into markdown, and
 * which files a paste or a drop carries.
 *
 * **Light on purpose.** The reading view (`TaskMarkdown`) and the task panel's
 * Attachments section ask the same questions as the editor, and they are on
 * the board, which never loads TipTap (LAI-827). So nothing here imports the
 * editor: no TipTap, no bridge.
 *
 * ## Only Laika's own URL is an attachment
 *
 * Markdown stores `/api/v1/attachments/<id>/content` and never a store URL
 * (D-150 item 4), so a stored text never expires and the server decides who
 * may read it. That path — relative, or with this board's own origin — is the
 * one image the reading view loads and the one the editor holds as an image.
 * Any other image is still a request to somebody else's server (SPEC §13.4)
 * and stays alt text.
 */

/** A ULID as the server issues it: 26 characters of Crockford base32, upper case. */
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';

/** The path an attachment is read at, and nothing after it. */
const CONTENT_PATH = new RegExp(`^/api/v1/attachments/(${ULID})/content$`);

/**
 * The attachment id in `url`, or `null` when it is not Laika's own
 * attachment URL: the path exactly, relative, or absolute on `origin` (this
 * board's, `location.origin` in the browser). No query, no fragment, no other
 * host, no `//host` that only looks relative.
 */
export function attachmentIdOf(url: string | null | undefined, origin?: string): string | null {
  if (typeof url !== 'string') return null;
  let path = url;
  if (!url.startsWith('/') || url.startsWith('//')) {
    if (origin === undefined || !url.startsWith(`${origin}/`)) return null;
    path = url.slice(origin.length);
  }
  return CONTENT_PATH.exec(path)?.[1] ?? null;
}

/** This board's origin in the browser; none in Node, where only the relative URL counts. */
export function boardOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

/** Is `url` one of this board's attachments? {@link attachmentIdOf}. */
export function isAttachmentUrl(url: string | null | undefined, origin?: string): boolean {
  return attachmentIdOf(url, origin) !== null;
}

/** The URL an attachment is linked by: Laika's own, relative (D-150 item 4). */
export function attachmentUrl(id: string): string {
  return `/api/v1/attachments/${id}/content`;
}

/** How a file is drawn: its glyph and the colour family it wears. */
export type FileKind = 'image' | 'sheet' | 'pdf' | 'doc' | 'file';

const BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  heic: 'image',
  bmp: 'image',
  xlsx: 'sheet',
  xls: 'sheet',
  xlsm: 'sheet',
  csv: 'sheet',
  tsv: 'sheet',
  ods: 'sheet',
  numbers: 'sheet',
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  txt: 'doc',
  md: 'doc',
  pages: 'doc',
};

/**
 * What kind of file this is, for its glyph: by the name's extension, else by
 * the declared type. A guess for drawing only — what the browser is allowed
 * to show inline is the server's, from the file's first bytes.
 */
export function fileKind(filename: string, contentType?: string): FileKind {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  const known = BY_EXTENSION[extension];
  if (known !== undefined) return known;
  const type = (contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/csv' || type.includes('spreadsheet') || type.includes('excel')) return 'sheet';
  if (type.startsWith('text/') || type.includes('word') || type.includes('opendocument.text')) {
    return 'doc';
  }
  return 'file';
}

/**
 * The 24-grid line glyphs files are drawn with (no icon package — CLAUDE.md
 * §5): the paperclip for attaching, and one per {@link FileKind}. Paths in
 * `currentColor`, as `RichEditor`'s toolbar and the sidebar draw theirs.
 */
export const FILE_GLYPHS: Readonly<Record<FileKind | 'paperclip', readonly string[]>> = {
  // A clip bent back on itself: attach.
  paperclip: [
    'M20.5 11.5l-8.1 8.1a5.25 5.25 0 0 1-7.4-7.4l8.4-8.4a3.5 3.5 0 0 1 5 5l-8.4 8.4a1.75 1.75 0 0 1-2.5-2.5l7.8-7.8',
  ],
  // A page with its corner turned.
  file: ['M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z', 'M14 3.5v5h5'],
  // A frame with a hill and the sun.
  image: [
    'M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z',
    'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'm20.5 15-5-5-11 9.5',
  ],
  // A page with a grid on it.
  sheet: [
    'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z',
    'M14 3.5v5h5',
    'M8 12h8M8 15.5h8M11.5 12v6.5',
  ],
  // A page marked PDF by its three bars of type.
  pdf: [
    'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z',
    'M14 3.5v5h5',
    'M8.5 13.5h1.75a1.25 1.25 0 0 0 0-2.5H8.5v5M13 11v5h1a2.5 2.5 0 0 0 0-5z',
  ],
  // A page of lines.
  doc: [
    'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z',
    'M14 3.5v5h5',
    'M8.5 12.5h7M8.5 15.5h7M8.5 9.5h3',
  ],
};

/** An image's alt text as markdown holds it: `\`, `[` and `]` escaped. */
export function escapeAlt(alt: string): string {
  return alt.replace(/[\\[\]]/g, (c) => `\\${c}`);
}

/**
 * A link's words as markdown reads them literally: every character that could
 * start syntax inside them escaped. Safe rather than tidy — the editor writes
 * a link through its own checked writer, and this is for where it cannot.
 */
export function escapeLinkText(text: string): string {
  return text.replace(/[\\`*_~[\]<>&!]/g, (c) => `\\${c}`);
}

/**
 * The markdown that links a file: `![name](url)` for an image, which every
 * reading view draws, and `[name](url)` for anything else, which it draws as
 * a file chip.
 */
export function attachmentSnippet(file: AttachedFile): string {
  return file.image
    ? `![${escapeAlt(file.filename)}](${file.url})`
    : `[${escapeLinkText(file.filename)}](${file.url})`;
}

/** The parts of a `DataTransfer` a paste or a drop is read through. */
export interface FileCarrier {
  readonly files?: ArrayLike<File> | null | undefined;
  readonly items?:
    ArrayLike<{ readonly kind: string; getAsFile: () => File | null }> | null | undefined;
  getData?: (format: string) => string;
}

/**
 * The files a paste or a drop carries: `files` when it has them, else the
 * `items` that are files. Empty when it carries none.
 */
export function filesFrom(carrier: FileCarrier | null | undefined): File[] {
  if (carrier === null || carrier === undefined) return [];
  const files = Array.from(carrier.files ?? []);
  if (files.length > 0) return files;
  return Array.from(carrier.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/**
 * The files a paste should upload — none when it also carries text.
 *
 * A spreadsheet's cells and a document's paragraphs come with a picture of
 * themselves beside the text, so a paste with words in it is a paste of the
 * words; a screenshot or a copied image carries no text, and is the file.
 */
export function pastedFiles(clipboard: FileCarrier | null | undefined): File[] {
  if (clipboard === null || clipboard === undefined) return [];
  const text = clipboard.getData?.('text/plain') ?? '';
  return text.trim() === '' ? filesFrom(clipboard) : [];
}
