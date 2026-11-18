import { inflateRawSync } from 'node:zlib';

/**
 * The text inside a spreadsheet or a Word document, for the secret check
 * `laika attach` runs before an upload (D-162 item 4, LAI-1351).
 *
 * An `.xlsx` or `.docx` is a zip of XML parts. The credentials sheet D-162
 * was written about is exactly such a file, and it is binary on the outside,
 * so a text scan never sees inside it. This reads the zip with Node's own
 * `zlib` — **no new dependency** — and gives back each part's text, laid out
 * as the scanner reads tables: a sheet's rows as tab-separated lines, a
 * document's paragraphs as lines and its table rows tab-separated, with a
 * blank line where a table ends.
 *
 * It reads only what it needs and refuses what it cannot read rather than
 * guessing: a ZIP64 archive, an encrypted entry or a part that inflates past
 * {@link MAX_PART_BYTES} is `undefined`, and the caller treats that as a file
 * it could not check.
 */

/** The largest part inflated: a sheet's XML is far smaller than this unless it is a zip bomb. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;

/** The most entries read from one archive. */
const MAX_ENTRIES = 10_000;

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

/** A zip's first four bytes: `PK\x03\x04`. */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** The central directory's entries, or `undefined` for an archive this cannot read. */
function zipEntries(buf: Buffer): ZipEntry[] | undefined {
  // The end-of-central-directory record is 22 bytes plus a comment of at
  // most 65,535, so it is somewhere in the last 65,557 bytes.
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let end = -1;
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return undefined;
  const count = buf.readUInt16LE(end + 10);
  const offset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff || count > MAX_ENTRIES) return undefined;

  const entries: ZipEntry[] = [];
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return undefined;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) return undefined;
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    entries.push({ name, method, flags, compressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One entry's bytes, inflated, or `undefined` when it cannot be read. */
function readEntry(buf: Buffer, entry: ZipEntry): Buffer | undefined {
  // Bit 0: the entry is encrypted, and there is nothing to read without its key.
  if ((entry.flags & 1) !== 0) return undefined;
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return undefined;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) return undefined;
  if (entry.method === 0) return data.length > MAX_PART_BYTES ? undefined : data;
  if (entry.method !== 8) return undefined;
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
  } catch {
    return undefined;
  }
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** XML character data with its five entities and numeric references decoded. */
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    }
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** The text of every `<t>` in a run of XML, joined. */
function texts(xml: string): string {
  let out = '';
  for (const match of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g)) {
    out += decodeXml(match[1] ?? '');
  }
  return out;
}

/** A cell reference's column, from 0: `A1` is 0, `AB7` is 27. */
function column(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** One part's text, and which row or line of the original each line of it is. */
export interface PartText {
  /** The part, as a person would name it: `sheet 1`, `the document`. */
  readonly where: string;
  readonly text: string;
  /** For each line of `text`, from 1, the row it came from; `null` for a line this added. */
  readonly rows: readonly (number | null)[];
}

/** A worksheet's rows as tab-separated lines, a blank line where rows were skipped. */
function sheetText(xml: string, shared: readonly string[], where: string): PartText {
  const lines: string[] = [];
  const rows: (number | null)[] = [];
  let last = 0;
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const number = Number(/\br="(\d+)"/.exec(row[1] ?? '')?.[1] ?? last + 1);
    // A gap of empty rows separates two tables, as a blank line does in a CSV.
    if (number > last + 1 && lines.length > 0) {
      lines.push('');
      rows.push(null);
    }
    last = number;
    const cells: string[] = [];
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/i.exec(attrs)?.[1];
      const at = ref === undefined ? cells.length : column(ref);
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const value = /<v>([^<]*)<\/v>/.exec(body)?.[1];
      let text: string;
      if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') text = texts(body);
      else text = decodeXml(value ?? '');
      while (cells.length < at) cells.push('');
      cells[at] = text.replace(/[\t\r\n]+/g, ' ');
    }
    lines.push(cells.join('\t'));
    rows.push(number);
  }
  return { where, text: lines.join('\n'), rows };
}

/** A Word part's paragraphs as lines, a table's rows as tab-separated lines. */
function documentText(xml: string, where: string): PartText {
  const lines: string[] = [];
  let line = '';
  let cell = '';
  let cells: string[] | null = null;
  let inText = false;
  const tokens = /<(\/?)w:(tbl|tr|tc|p|t|tab|br|cr)\b[^>]*?(\/?)>|<[^>]*>|([^<]+)/g;
  for (const match of xml.matchAll(tokens)) {
    const [, close, tag, selfClose, chars] = match;
    if (chars !== undefined) {
      if (!inText) continue;
      if (cells !== null) cell += decodeXml(chars);
      else line += decodeXml(chars);
      continue;
    }
    if (tag === undefined) continue;
    const closing = close === '/';
    switch (tag) {
      case 't':
        inText = !closing && selfClose !== '/';
        break;
      case 'tab':
        if (cells !== null) cell += ' ';
        else line += '\t';
        break;
      case 'br':
      case 'cr':
        if (cells !== null) cell += ' ';
        else {
          lines.push(line);
          line = '';
        }
        break;
      case 'p':
        if (!closing) break;
        if (cells !== null) cell += ' ';
        else {
          lines.push(line);
          line = '';
        }
        break;
      case 'tc':
        if (closing && cells !== null) cells.push(cell.trim());
        else cell = '';
        break;
      case 'tr':
        if (closing && cells !== null) {
          lines.push(cells.join('\t'));
          cells = null;
        } else if (!closing) cells = [];
        break;
      case 'tbl':
        // A table stands apart from the paragraphs around it.
        lines.push('');
        break;
    }
  }
  if (line !== '') lines.push(line);
  return { where, text: lines.join('\n'), rows: lines.map((_, i) => i + 1) };
}

/**
 * The text of a spreadsheet's sheets or a Word document's parts, or `null`
 * for a zip that is neither, or `undefined` for one this cannot read.
 */
export function officeText(bytes: Uint8Array): PartText[] | null | undefined {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = zipEntries(buf);
  if (entries === undefined) return undefined;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = (entry: ZipEntry): string | undefined => readEntry(buf, entry)?.toString('utf8');

  if (byName.has('xl/workbook.xml')) {
    const sharedEntry = byName.get('xl/sharedStrings.xml');
    let shared: string[] = [];
    if (sharedEntry !== undefined) {
      const xml = read(sharedEntry);
      if (xml === undefined) return undefined;
      shared = [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1] ?? ''));
    }
    const parts: PartText[] = [];
    const sheets = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => Number(/\d+/.exec(a.name)?.[0]) - Number(/\d+/.exec(b.name)?.[0]));
    for (const entry of sheets) {
      const xml = read(entry);
      if (xml === undefined) return undefined;
      parts.push(sheetText(xml, shared, `sheet ${/\d+/.exec(entry.name)?.[0] ?? '?'}`));
    }
    return parts;
  }

  if (byName.has('word/document.xml')) {
    const parts: PartText[] = [];
    const wanted = entries.filter((e) =>
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(e.name),
    );
    for (const entry of wanted) {
      const xml = read(entry);
      if (xml === undefined) return undefined;
      const name = /^word\/(\w+?)\d*\.xml$/.exec(entry.name)?.[1] ?? 'document';
      parts.push(documentText(xml, name === 'document' ? 'the document' : `its ${name}`));
    }
    return parts;
  }

  return null;
}
