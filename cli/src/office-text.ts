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
 * guessing: a ZIP64 archive, an encrypted entry, a part that inflates past
 * {@link MAX_PART_BYTES}, parts that together pass {@link MAX_TOTAL_BYTES}, or
 * XML with a character reference no character has is `undefined`, and the
 * caller treats that as a file it could not check.
 *
 * **Every scan is linear** (LAI-1351 review). The XML is the file's, so it may
 * be crafted: elements are found with `indexOf` — an opening tag, its `>`, its
 * closing tag, each searched forward from the last — and an element left
 * unclosed makes the file unreadable instead of being searched for again from
 * every later `<`. `secret-scan.test.ts` times crafted 2 MiB parts.
 */

/** The largest part inflated: a sheet's XML is far smaller than this unless it is a zip bomb. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;

/** The most inflated across every part read from one file. */
export const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/** XML this cannot read for what it says: a reference to no character. */
class UnreadableXml extends Error {}

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

/** One entry's bytes, inflated to at most `limit`, or `undefined` when it cannot be read. */
function readEntry(buf: Buffer, entry: ZipEntry, limit: number): Buffer | undefined {
  // Bit 0: the entry is encrypted, and there is nothing to read without its key.
  if ((entry.flags & 1) !== 0) return undefined;
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return undefined;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) return undefined;
  if (entry.method === 0) return data.length > limit ? undefined : data;
  if (entry.method !== 8) return undefined;
  try {
    return inflateRawSync(data, { maxOutputLength: limit });
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

/**
 * XML character data with its five entities and numeric references decoded.
 * A reference to no character — `&#x110000;` — is unreadable XML, and the
 * file one that could not be checked.
 */
function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]{1,8}|#[0-9]{1,10}|[a-z]{1,8});/gi, (whole, ref: string) => {
    const hex = ref.startsWith('#x') || ref.startsWith('#X');
    if (hex || ref.startsWith('#')) {
      const code = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!(code >= 0 && code <= 0x10ffff)) throw new UnreadableXml(`no character ${ref}`);
      return String.fromCodePoint(code);
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

const NAME_ENDS = new Set([' ', '\t', '\n', '\r', '>', '/']);

interface Element {
  /** What is between the name and the `>`. */
  readonly attrs: string;
  /** What is between the opening and the closing tag; empty for `<name/>`. */
  readonly body: string;
}

/**
 * Every `<name …>…</name>` and `<name …/>` in `xml`, in order, found with
 * `indexOf` only: linear in `xml`. One left unclosed is XML that cannot be
 * read — never a place to stop reading, which would let what follows it pass
 * unscanned.
 */
function* elements(xml: string, name: string): Generator<Element> {
  const open = `<${name}`;
  const close = `</${name}>`;
  let at = 0;
  for (;;) {
    const start = xml.indexOf(open, at);
    if (start < 0) return;
    // `<c` is not `<cols`: the name ends at a space, `>` or `/`.
    if (!NAME_ENDS.has(xml.charAt(start + open.length))) {
      at = start + open.length;
      continue;
    }
    const end = xml.indexOf('>', start + open.length);
    if (end < 0) throw new UnreadableXml(`an unclosed <${name}`);
    if (xml.charAt(end - 1) === '/') {
      yield { attrs: xml.slice(start + open.length, end - 1), body: '' };
      at = end + 1;
      continue;
    }
    const finish = xml.indexOf(close, end + 1);
    if (finish < 0) throw new UnreadableXml(`an unclosed <${name}>`);
    yield { attrs: xml.slice(start + open.length, end), body: xml.slice(end + 1, finish) };
    at = finish + close.length;
  }
}

/**
 * SpreadsheetML with its element prefixes taken off — `<x:row>` is `<row>` —
 * for the generators that write a prefixed namespace. A file written that way
 * must not pass because its rows go unrecognised.
 */
function unprefixed(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]{0,31}:/g, '<$1');
}

/** The text of every `<t>` in a run of a spreadsheet's XML, joined. */
function texts(xml: string): string {
  let out = '';
  for (const t of elements(xml, 't')) out += decodeXml(t.body);
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
  for (const row of elements(xml, 'row')) {
    const number = Number(/\br="(\d{1,7})"/.exec(row.attrs)?.[1] ?? last + 1);
    // A gap of empty rows separates two tables, as a blank line does in a CSV.
    if (number > last + 1 && lines.length > 0) {
      lines.push('');
      rows.push(null);
    }
    last = number;
    const cells: string[] = [];
    for (const cell of elements(row.body, 'c')) {
      const ref = /\br="([A-Z]{1,3})\d{1,7}"/i.exec(cell.attrs)?.[1];
      const at = ref === undefined ? cells.length : column(ref);
      const type = /\bt="(\w{1,16})"/.exec(cell.attrs)?.[1];
      let value: string | undefined;
      for (const v of elements(cell.body, 'v')) {
        value = v.body;
        break;
      }
      let text: string;
      if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') text = texts(cell.body);
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
  const add = (text: string): void => {
    if (cells !== null) cell += text;
    else line += text;
  };
  const endLine = (): void => {
    if (cells !== null) cell += ' ';
    else {
      lines.push(line);
      line = '';
    }
  };
  // A tag at a time, with `indexOf`: linear however the XML is shaped.
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf('<', at);
    if (inText) add(decodeXml(xml.slice(at, lt < 0 ? xml.length : lt)));
    if (lt < 0) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) throw new UnreadableXml('a tag with no end');
    at = gt + 1;
    const closing = xml.charAt(lt + 1) === '/';
    const selfClose = xml.charAt(gt - 1) === '/';
    const from = lt + (closing ? 2 : 1);
    let end = from;
    while (end < gt && !NAME_ENDS.has(xml.charAt(end))) end++;
    // The local name, whatever prefix the document gave WordprocessingML.
    const name = xml.slice(from, end);
    switch (name.slice(name.indexOf(':') + 1)) {
      case 't':
        inText = !closing && !selfClose;
        break;
      case 'tab':
        add(cells !== null ? ' ' : '\t');
        break;
      case 'br':
      case 'cr':
        endLine();
        break;
      case 'p':
        if (closing) endLine();
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
export interface OfficeLimits {
  readonly part: number;
  readonly total: number;
}

export function officeText(
  bytes: Uint8Array,
  limits: OfficeLimits = { part: MAX_PART_BYTES, total: MAX_TOTAL_BYTES },
): PartText[] | null | undefined {
  try {
    return readOffice(bytes, limits);
  } catch (error) {
    if (error instanceof UnreadableXml) return undefined;
    throw error;
  }
}

function readOffice(bytes: Uint8Array, limits: OfficeLimits): PartText[] | null | undefined {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = zipEntries(buf);
  if (entries === undefined) return undefined;
  const byName = new Map(entries.map((e) => [e.name, e]));
  // Every part read counts against one budget, so many small parts cannot
  // add up to what one large part is refused for.
  let budget = limits.total;
  const read = (entry: ZipEntry): string | undefined => {
    if (budget <= 0) return undefined;
    const data = readEntry(buf, entry, Math.min(limits.part, budget));
    if (data === undefined) return undefined;
    budget -= data.length;
    return data.toString('utf8');
  };

  if (byName.has('xl/workbook.xml')) {
    const sharedEntry = byName.get('xl/sharedStrings.xml');
    let shared: string[] = [];
    if (sharedEntry !== undefined) {
      const xml = read(sharedEntry);
      if (xml === undefined) return undefined;
      shared = [...elements(unprefixed(xml), 'si')].map((si) => texts(si.body));
    }
    const parts: PartText[] = [];
    const sheets = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => Number(/\d+/.exec(a.name)?.[0]) - Number(/\d+/.exec(b.name)?.[0]));
    for (const entry of sheets) {
      const xml = read(entry);
      if (xml === undefined) return undefined;
      parts.push(sheetText(unprefixed(xml), shared, `sheet ${/\d+/.exec(entry.name)?.[0] ?? '?'}`));
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
