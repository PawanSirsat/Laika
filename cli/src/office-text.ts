import { inflateRawSync } from 'node:zlib';

/**
 * The text inside a spreadsheet, a Word document or a presentation — and the
 * files inside any other zip — for the secret check `laika attach` runs
 * before an upload (D-162 item 4, LAI-1351, LAI-1361).
 *
 * An `.xlsx`, `.docx` or `.pptx` is a zip of XML parts. The credentials sheet
 * D-162 was written about is exactly such a file, and it is binary on the
 * outside, so a text scan never sees inside it. This reads the zip with
 * Node's own `zlib` — **no new dependency** — and gives back each part's
 * text, laid out as the scanner reads tables: a sheet's rows as tab-separated
 * lines, a document's or a slide's paragraphs as lines and its table rows
 * tab-separated, with a blank line where a table ends. **Any other zip, and
 * an office file's embedded objects, are files** (`zipContents`), which the
 * caller looks inside in turn — a zip in a zip included — against the same
 * budget.
 *
 * It reads only what it needs and refuses what it cannot read rather than
 * guessing. **Too large** (LAI-1361 review): a ZIP64 archive, an entry
 * compressed other than by deflate, a part that inflates past
 * {@link MAX_PART_BYTES}, a file whose inflated parts **and the text read out
 * of them** together pass {@link MAX_TOTAL_BYTES}, or more than
 * {@link MAX_FILES} files across every zip in it. **Unreadable**: an
 * encrypted entry, a broken archive, XML with a character reference no
 * character has, or anything else the reader throws. Either way the caller
 * treats it as a file it could not check, and says which.
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

/** The most files looked at in one upload, every zip inside it counted (LAI-1361 review). */
export const MAX_FILES = 20_000;

/** XML this cannot read for what it says: a reference to no character. */
class UnreadableXml extends Error {}

/**
 * More than this reads (LAI-1361 review): past a budget, too many files, or
 * a zip written in a form kept for very large archives — ZIP64, or a method
 * other than deflate such as LZMA. Told apart from a file that cannot be
 * opened at all, because the answer to it is a smaller export.
 */
class TooLarge extends Error {}

/**
 * One allowance for a file, spent by the bytes inflated **and by the text
 * read out of them** (LAI-1351 review): a 1 KiB shared string referenced by a
 * thousand cells, or a cell at column ZZZ on every row, multiplies small XML
 * into text far larger than it. Spending past the end makes the file too
 * large to check before that text is built. **It counts files too**, every
 * zip inside the upload included (LAI-1361 review): forty zips of 9,999
 * entries each are under any one zip's limit and hold 400,000 files.
 */
export class Budget {
  // Fields, not parameter properties: the CLI runs with Node's type
  // stripping, which refuses `constructor(public left …)`.
  left: number;
  filesLeft: number;

  constructor(left: number, files: number = MAX_FILES) {
    this.left = left;
    this.filesLeft = files;
  }

  spend(n: number): void {
    this.left -= n;
    if (this.left < 0) throw new TooLarge('more text than this reads');
  }

  /** `n` more files looked at: a zip's entries, before any of them is read. */
  count(n: number): void {
    this.filesLeft -= n;
    if (this.filesLeft < 0) throw new TooLarge('more files than this reads');
  }
}

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

/**
 * The central directory's entries, or `undefined` for an archive this cannot
 * read. ZIP64, or more entries than {@link MAX_ENTRIES}, is too large.
 */
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
  if (count === 0xffff || offset === 0xffffffff || count > MAX_ENTRIES) {
    throw new TooLarge('a ZIP64 archive, or more entries than this reads');
  }

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
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new TooLarge('a ZIP64 entry');
    }
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    entries.push({ name, method, flags, compressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * One entry's bytes, inflated to at most `limit`, or `undefined` when it
 * cannot be read. Past `limit`, or compressed other than by deflate — LZMA,
 * bzip2, deflate64 — is too large.
 */
function readEntry(buf: Buffer, entry: ZipEntry, limit: number): Buffer | undefined {
  // Bit 0: the entry is encrypted, and there is nothing to read without its key.
  if ((entry.flags & 1) !== 0) return undefined;
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return undefined;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) return undefined;
  if (entry.method === 0) {
    if (data.length > limit) throw new TooLarge('a stored entry past the limit');
    return data;
  }
  if (entry.method !== 8) throw new TooLarge(`compression method ${String(entry.method)}`);
  try {
    return inflateRawSync(data, { maxOutputLength: limit });
  } catch (err) {
    // zlib refuses to grow past `maxOutputLength` with this code; anything
    // else is data that is not deflate.
    if ((err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new TooLarge('an entry past the limit');
    }
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
function sheetText(
  xml: string,
  shared: readonly string[],
  where: string,
  budget: Budget,
): PartText {
  // Read first, as references and column numbers, every cell and every tab
  // of padding spent against the budget; the text is built only once the
  // whole sheet is within it, so no amplified row is ever made.
  const read: { readonly number: number | null; readonly cells: [number, string][] }[] = [];
  let last = 0;
  for (const row of elements(xml, 'row')) {
    const number = Number(/\br="(\d{1,7})"/.exec(row.attrs)?.[1] ?? last + 1);
    // A gap of empty rows separates two tables, as a blank line does in a CSV.
    if (number > last + 1 && read.length > 0) {
      budget.spend(1);
      read.push({ number: null, cells: [] });
    }
    last = number;
    const cells: [number, string][] = [];
    let next = 0;
    let widest = -1;
    for (const cell of elements(row.body, 'c')) {
      const ref = /\br="([A-Z]{1,3})\d{1,7}"/i.exec(cell.attrs)?.[1];
      const at = ref === undefined ? next : column(ref);
      next = at + 1;
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
      budget.spend(text.length);
      cells.push([at, text]);
      widest = Math.max(widest, at);
    }
    // The tabs that put the last cell in its column, and the line's end.
    budget.spend(Math.max(widest, 0) + 1);
    read.push({ number, cells: cells.sort((a, b) => a[0] - b[0]) });
  }

  const lines = read.map(({ cells }) => {
    let line = '';
    let column = 0;
    for (const [at, text] of cells) {
      line += '\t'.repeat(Math.max(0, at - column)) + text.replace(/[\t\r\n]+/g, ' ');
      column = at;
    }
    return line;
  });
  return { where, text: lines.join('\n'), rows: read.map((r) => r.number) };
}

/** A Word part's paragraphs as lines, a table's rows as tab-separated lines. */
function documentText(xml: string, where: string, budget: Budget): PartText {
  const lines: string[] = [];
  let line = '';
  let cell = '';
  let cells: string[] | null = null;
  let inText = false;
  const add = (text: string): void => {
    budget.spend(text.length);
    if (cells !== null) cell += text;
    else line += text;
  };
  const endLine = (): void => {
    budget.spend(1);
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
 * The most inflated from one part, and from one file — every archive inside
 * it included — and the most files looked at in it ({@link MAX_FILES}).
 */
export interface OfficeLimits {
  readonly part: number;
  readonly total: number;
  readonly files?: number | undefined;
}

export const DEFAULT_LIMITS: OfficeLimits = {
  part: MAX_PART_BYTES,
  total: MAX_TOTAL_BYTES,
  files: MAX_FILES,
};

/**
 * The text of a spreadsheet's sheets, a Word document's parts or a
 * presentation's slides, or `null` for a zip that is none of them, or
 * `undefined` for one this cannot read.
 */
export function officeText(
  bytes: Uint8Array,
  limits: OfficeLimits = DEFAULT_LIMITS,
): PartText[] | null | undefined {
  const contents = zipContents(bytes, new Budget(limits.total, limits.files), limits.part);
  if ('refused' in contents) return undefined;
  return contents.office ? contents.parts : null;
}

/** A file inside a zip, by its path there, inflated. */
export interface ZipFile {
  readonly path: string;
  readonly bytes: Buffer;
}

/** What one zip holds, for the scan. */
export interface ZipContents {
  /** Whether it is a spreadsheet, a Word document or a presentation. */
  readonly office: boolean;
  /** An office file's text: its sheets, its document's parts, its slides and notes. */
  readonly parts: PartText[];
  /**
   * Every other file to look inside (LAI-1361): each entry of a plain zip,
   * and an office file's embedded objects — a workbook in a document, a zip
   * in a presentation — which may be archives themselves.
   */
  readonly files: ZipFile[];
}

/** Why a zip was not read: it cannot be opened, or it holds more than this reads. */
export interface ZipRefusal {
  readonly refused: 'unreadable' | 'too_large';
}

/**
 * Everything a zip holds that the scan reads, spending `budget` — which the
 * caller shares with every archive found inside this one, so nesting never
 * buys a second allowance — and inflating no entry past `part`; or why not.
 */
export function zipContents(
  bytes: Uint8Array,
  budget: Budget,
  part: number = MAX_PART_BYTES,
): ZipContents | ZipRefusal {
  try {
    return readZip(bytes, budget, part) ?? { refused: 'unreadable' };
  } catch (err) {
    // A budget spent, too many files, ZIP64 or LZMA, or a string too long
    // for the engine is more than this reads; unreadable XML, or anything
    // else the reader throws, is a file it could not open. Either is
    // refused, never a crash with nothing said.
    return {
      refused: err instanceof TooLarge || err instanceof RangeError ? 'too_large' : 'unreadable',
    };
  }
}

/** An office file's embedded objects: `word/embeddings/…`, `xl/…`, `ppt/…`. */
const EMBEDDED = /^(?:word|xl|ppt)\/embeddings\/[^/]/;

/** The number in a part's name, `sheet12.xml` → 12, for sorting and naming. */
function numberOf(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function readZip(bytes: Uint8Array, budget: Budget, part: number): ZipContents | undefined {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = zipEntries(buf);
  if (entries === undefined) return undefined;
  budget.count(entries.length);
  const byName = new Map(entries.map((e) => [e.name, e]));
  // Every entry read counts against one budget, so many small parts cannot
  // add up to what one large part is refused for.
  const read = (entry: ZipEntry): Buffer | undefined => {
    if (budget.left <= 0) throw new TooLarge('the budget is spent');
    const data = readEntry(buf, entry, Math.min(part, budget.left));
    if (data === undefined) return undefined;
    budget.spend(data.length);
    return data;
  };
  const xmlOf = (entry: ZipEntry): string | undefined => read(entry)?.toString('utf8');
  /** The files `wanted` names, inflated — or `undefined` when one cannot be. */
  const filesOf = (wanted: (name: string) => boolean): ZipFile[] | undefined => {
    const files: ZipFile[] = [];
    for (const entry of entries) {
      // A directory is a name and no bytes.
      if (entry.name.endsWith('/') || !wanted(entry.name)) continue;
      const data = read(entry);
      if (data === undefined) return undefined;
      files.push({ path: entry.name, bytes: data });
    }
    return files;
  };
  const office = (parts: PartText[] | undefined): ZipContents | undefined => {
    if (parts === undefined) return undefined;
    const files = filesOf((name) => EMBEDDED.test(name));
    return files === undefined ? undefined : { office: true, parts, files };
  };

  if (byName.has('xl/workbook.xml')) {
    const sharedEntry = byName.get('xl/sharedStrings.xml');
    let shared: string[] = [];
    if (sharedEntry !== undefined) {
      const xml = xmlOf(sharedEntry);
      if (xml === undefined) return undefined;
      shared = [...elements(unprefixed(xml), 'si')].map((si) => {
        const text = texts(si.body);
        budget.spend(text.length);
        return text;
      });
    }
    const parts: PartText[] = [];
    const sheets = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => numberOf(a.name) - numberOf(b.name));
    for (const entry of sheets) {
      const xml = xmlOf(entry);
      if (xml === undefined) return undefined;
      parts.push(
        sheetText(unprefixed(xml), shared, `sheet ${String(numberOf(entry.name))}`, budget),
      );
    }
    return office(parts);
  }

  if (byName.has('word/document.xml')) {
    const parts: PartText[] = [];
    const wanted = entries.filter((e) =>
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(e.name),
    );
    for (const entry of wanted) {
      const xml = xmlOf(entry);
      if (xml === undefined) return undefined;
      const name = /^word\/(\w+?)\d*\.xml$/.exec(entry.name)?.[1] ?? 'document';
      parts.push(documentText(xml, name === 'document' ? 'the document' : `its ${name}`, budget));
    }
    return office(parts);
  }

  // A presentation (LAI-1361): DrawingML keeps a slide's text as a Word
  // document keeps it — `a:p` paragraphs of `a:t` runs, `a:tbl` tables of
  // `a:tr` rows of `a:tc` cells — so the same reader reads it.
  if (byName.has('ppt/presentation.xml')) {
    const parts: PartText[] = [];
    const wanted = entries
      .filter((e) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(e.name))
      .sort(
        (a, b) =>
          Number(a.name.includes('notes')) - Number(b.name.includes('notes')) ||
          numberOf(a.name) - numberOf(b.name),
      );
    for (const entry of wanted) {
      const xml = xmlOf(entry);
      if (xml === undefined) return undefined;
      const n = String(numberOf(entry.name));
      parts.push(
        documentText(xml, entry.name.includes('notes') ? `notes ${n}` : `slide ${n}`, budget),
      );
    }
    return office(parts);
  }

  // Any other zip is a folder of files, every one of them looked inside.
  const files = filesOf(() => true);
  return files === undefined ? undefined : { office: false, parts: [], files };
}
