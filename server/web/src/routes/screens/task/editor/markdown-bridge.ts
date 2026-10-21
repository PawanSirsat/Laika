import type { AnyExtension, JSONContent } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import type { Node as ProseNode, Schema } from '@tiptap/pm/model';

/**
 * Markdown in, markdown out, and nothing the person did not touch changes
 * (LAI-827).
 *
 * `description_md`, `acceptance_md` and `body_md` are markdown, and agents read
 * them back through MCP. So the rich editor is a view over the markdown, never
 * a second format: a document is parsed into the editor and written back by
 * `@tiptap/markdown`, and **it is only shown in the rich view when writing it
 * straight back gives the same markdown** (after {@link normaliseMarkdown},
 * and blank lines between blocks aside: {@link sameMarkdown}).
 * Anything else — HTML an agent wrote, `* bullets`, an image — opens as
 * Markdown source with the reason, so a Save there sends the person's own text.
 *
 * ## A save writes only the blocks that changed
 *
 * The document is remembered as its source's top-level blocks. On a save,
 * every block that is still exactly what it was is **copied from the source,
 * byte for byte**; only a new or changed block is written, and each one is
 * checked — parsed back, it must be that very block. A block that cannot be
 * written so is **not saved**: {@link toMarkdown} throws
 * {@link UnwritableMarkdown} with the reason and a draft, and the editor shows
 * the draft as Markdown. Review round 1 found the opposite: one paragraph the
 * faithful form could not write sent the whole document through the library's
 * escaping, and `\# literal hash` came back a heading.
 *
 * ## Why the text encoder is replaced
 *
 * `@tiptap/markdown` escapes every `*`, `_`, `~`, `[`, `` ` `` and `\` in plain
 * text and writes `<`, `>` and `&` as entities. That is always safe for what
 * it covers and almost never what was typed: `next_cursor` became
 * `next\_cursor`, `p95 < 1 s` became `p95 &lt; 1 s`, `A -> B` became
 * `A -&gt; B` — measured on the 3.32.0 serializer. So {@link escapeFaithfully}
 * escapes a character only where it could start markdown syntax, and a block
 * written that way is used only when it reads back exactly; otherwise the
 * library's form of that block, checked the same way.
 *
 * The hook is `MarkdownManager`'s private `encodeTextForMarkdown`, the one
 * place a text node is encoded. A private method can change in any release;
 * the packages are pinned exactly, `markdown-bridge.test.ts` fails if the hook
 * is gone, and without it the bridge falls back to the library's encoder.
 */

type Encode = (text: string, node: JSONContent, parent?: JSONContent) => string;

interface ManagerInternals {
  encodeTextForMarkdown?: Encode;
  codeTypes?: Set<string>;
}

/** Whether the serializer is writing the faithful form or the library's own. */
let faithful = true;

/** Read by the link mark, which writes a bare URL only in the faithful form. */
export function writesFaithfully(): boolean {
  return faithful;
}

/** A save that would not read back as the document in the editor. */
export class UnwritableMarkdown extends Error {
  /**
   * The document as Markdown anyway — every untouched block as it was — for
   * the person to finish by hand. Not saved.
   */
  readonly draft: string;

  constructor(reason: string, draft: string) {
    super(reason);
    this.name = 'UnwritableMarkdown';
    this.draft = draft;
  }
}

/**
 * What surrounds a run of text inside its block: a line's start or end, a
 * space-like edge, or another mark's syntax (`**`, `` ` ``, `[`).
 */
export type Edge = 'line' | 'space' | 'mark';

export interface Around {
  readonly before: Edge;
  readonly after: Edge;
  /** Inside a link's words, where GFM makes no link of its own. */
  readonly inLink: boolean;
}

/** A whole paragraph of plain text. */
const ALONE: Around = { before: 'line', after: 'line', inLink: false };

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** The character a delimiter at an edge sees beyond the run. */
const beyond = (edge: Edge): string => (edge === 'mark' ? '*' : ' ');

/**
 * Could the delimiter at `i` open emphasis or strikethrough, and is there a
 * partner in the same text that could close it — or the other way round? And
 * at the run's edge, next to another mark's syntax, it would join that mark's
 * delimiters (`a *` then `**bold**` reads `a ***bold**`), so it is escaped.
 *
 * CommonMark's flanking rules, simplified on the safe side: a run can open
 * when the next character is not a space, and close when the previous one is
 * not. `_` also cannot open after, or close before, a letter or digit, which is
 * why `next_cursor` needs no escape.
 */
function couldPair(text: string, i: number, mark: string, around: Around): boolean {
  const before = (at: number): string => text[at - 1] ?? beyond(around.before);
  const after = (at: number): string => text[at + 1] ?? beyond(around.after);
  if (i === 0 && around.before === 'mark') return true;
  if (i === text.length - 1 && around.after === 'mark') return true;
  const opens = (at: number): boolean =>
    !isSpace(after(at)) && (mark !== '_' || !isWordChar(before(at)));
  const closes = (at: number): boolean =>
    !isSpace(before(at)) && (mark !== '_' || !isWordChar(after(at)));
  if (opens(i)) {
    for (let j = text.indexOf(mark, i + 1); j !== -1; j = text.indexOf(mark, j + 1)) {
      if (closes(j)) return true;
    }
  }
  if (closes(i)) {
    for (let j = text.lastIndexOf(mark, i - 1); j !== -1; j = text.lastIndexOf(mark, j - 1)) {
      if (opens(j)) return true;
    }
  }
  return false;
}

/**
 * At the start of a line, what would make it something other than text: a
 * heading, a quote, a list item, a rule, a setext underline, or a link
 * reference definition (`[a]: https://x` is no text at all). The index of the
 * character to escape, or -1.
 *
 * `@tiptap/markdown`'s own escaper misses all of these — `# not a heading`
 * typed as text came back as a heading (LAI-827, measured).
 */
function lineStartEscape(line: string): number {
  if (/^(?:[-*_](?:[ \t]*[-*_]){2,}|=+)[ \t]*$/.test(line)) return 0;
  const definition = /^( {0,3})\[(?:[^\]\\\n]|\\.)+\]:/.exec(line);
  if (definition !== null) return definition[1]?.length ?? 0;
  const marker = /^(?:#{1,6}|>|[-+*]|\d{1,9}[.)])(?=[ \t]|$)/.exec(line)?.[0];
  if (marker === undefined) return -1;
  // `1.` is escaped at its `.`, the rest at their first character.
  return /^\d/.test(marker) ? marker.length - 1 : 0;
}

/**
 * Does a raw-HTML construct or an autolink start here? An open or closing
 * tag, a comment, a declaration, a processing instruction, CDATA, `<scheme:…>`
 * or `<a@b>` — what CommonMark reads as HTML or a link instead of text. A `<`
 * before anything else (`a < b`, `Map<string, number>`) is text already.
 */
const HTML_START =
  /^<(?:[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|\/[A-Za-z][A-Za-z0-9-]*\s*>|!--|![A-Za-z]|!\[CDATA\[|\?|[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|[^\s<>@]+@[^\s<>]+>)/;

/** An entity or a numeric character reference: `&amp;`, `&#38;`, `&#x26;`. */
const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

/**
 * Where GFM would turn plain text into a link by itself: the `:` of
 * `https://`, the `.` of a word-initial `www.`, the `@` of an email address.
 * Only outside a link's own words — inside them GFM links nothing.
 */
function startsAutolink(text: string, i: number, around: Around): boolean {
  if (around.inLink) return false;
  const c = text.charAt(i);
  if (c === ':') {
    return (
      text.startsWith('//', i + 1) && /(?:^|[^A-Za-z0-9])(?:https?|ftp)$/i.test(text.slice(0, i))
    );
  }
  if (c === '.') {
    const start = i - 3;
    return (
      start >= 0 &&
      text.slice(start, i).toLowerCase() === 'www' &&
      (start === 0 || /[\s(*_~]/.test(text.charAt(start - 1))) &&
      isWordChar(text[i + 1])
    );
  }
  if (c === '@') {
    return (
      /[A-Za-z0-9._+-]$/.test(text.slice(0, i)) &&
      /^@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z0-9]+/.test(text.slice(i))
    );
  }
  return false;
}

/**
 * Escape a plain-text run only where it could be read as markdown.
 *
 * - `` ` `` always: a lone backtick can pair with one much later.
 * - `\` before ASCII punctuation or at the end, where it would escape what follows.
 * - `*`, `_` and `~` when {@link couldPair} says they might pair.
 * - `[` and `]` when they could make a link: `[text](` or `[text][`.
 * - `<` where a tag, comment or autolink would start ({@link HTML_START}), and
 *   `&` where an entity would ({@link ENTITY}) — `the <br> tag` and
 *   `use &amp; here` read back as a break and as `&` otherwise.
 * - What GFM would link by itself in plain text ({@link startsAutolink}).
 * - Where a line starts — the run's start, or after a soft line break inside
 *   it — a block marker or a reference definition ({@link lineStartEscape}).
 *
 * `>`, `|` and the rest are written as typed.
 */
export function escapeFaithfully(text: string, around: Around = ALONE): string {
  let out = '';
  let escapeAt = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    const next = text[i + 1];
    if (i === 0 ? around.before === 'line' : text[i - 1] === '\n') {
      const end = text.indexOf('\n', i);
      const at = lineStartEscape(text.slice(i, end === -1 ? undefined : end));
      escapeAt = at === -1 ? -1 : i + at;
    }
    if (i === escapeAt) {
      out += `\\${c}`;
    } else if (c === '`') {
      out += '\\`';
    } else if (c === '\\') {
      out += next === undefined || ASCII_PUNCTUATION.test(next) ? '\\\\' : '\\';
    } else if (c === '*' || c === '_' || c === '~') {
      out += couldPair(text, i, c, around) ? `\\${c}` : c;
    } else if (c === '[') {
      const close = text.indexOf(']', i + 1);
      const after = close === -1 ? undefined : text[close + 1];
      out += after === '(' || after === '[' ? '\\[' : '[';
    } else if (c === ']') {
      out += next === '(' || next === '[' ? '\\]' : ']';
    } else if (c === '<') {
      out += HTML_START.test(text.slice(i)) ? '\\<' : '<';
    } else if (c === '&') {
      out += ENTITY.test(text.slice(i)) ? '\\&' : '&';
    } else if (startsAutolink(text, i, around)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return out;
}

/** What surrounds `node` inside `parent`, for {@link escapeFaithfully}. */
function aroundOf(node: JSONContent, parent: JSONContent | undefined): Around {
  const siblings = parent?.content ?? [];
  const at = siblings.indexOf(node);
  const marked = (node.marks ?? []).length > 0;
  const edge = (neighbour: JSONContent | undefined): Edge => {
    if (neighbour === undefined || neighbour.type === 'hardBreak') return 'line';
    if (marked || (neighbour.type === 'text' && (neighbour.marks ?? []).length > 0)) return 'mark';
    return 'space';
  };
  const before = at === -1 ? 'line' : edge(siblings[at - 1]);
  const after = at === -1 ? 'line' : edge(siblings[at + 1]);
  return {
    // A marked run sits between its own mark's syntax, whatever is beyond.
    before: marked ? 'mark' : before,
    after: marked ? 'mark' : after,
    inLink: (node.marks ?? []).some((m) => m.type === 'link'),
  };
}

/** The parser, the writer and the schema they agree on, for one extension set. */
export interface Bridge {
  readonly manager: MarkdownManager;
  /** A schema built from the same extensions, for deciding before an editor exists. */
  readonly schema: Schema;
}

export function createBridge(extensions: readonly AnyExtension[]): Bridge {
  const manager = new MarkdownManager({ extensions: [...extensions] });
  const internals = manager as unknown as ManagerInternals;
  const library = internals.encodeTextForMarkdown?.bind(manager);
  const codeTypes = internals.codeTypes;
  if (library !== undefined && codeTypes instanceof Set) {
    internals.encodeTextForMarkdown = (text, node, parent) => {
      if (!faithful) return library(text, node, parent);
      const inCode =
        (parent?.type !== undefined && codeTypes.has(parent.type)) ||
        (node.marks ?? []).some((m) => codeTypes.has(m.type));
      return inCode ? text : escapeFaithfully(text, aroundOf(node, parent));
    };
  }
  return { manager, schema: getSchema([...extensions]) };
}

/** Is the private hook {@link createBridge} relies on still there? For the test. */
export function hookPresent(bridge: Bridge): boolean {
  const internals = bridge.manager as unknown as ManagerInternals;
  return (
    typeof internals.encodeTextForMarkdown === 'function' && internals.codeTypes instanceof Set
  );
}

/**
 * Each line of `markdown`, and whether it belongs to a fenced code block (its
 * fences included).
 *
 * CommonMark's rules: a fence is three or more backticks or tildes, indented at
 * most three spaces; it closes on the same character, at least as long, with
 * **nothing after it** — so a ```` ```js ```` line inside a ```` ``` ```` block is
 * code, not its close (review round 1).
 */
function linesWithCode(markdown: string): { readonly line: string; readonly code: boolean }[] {
  const out: { line: string; code: boolean }[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      const marker = open?.[1];
      if (marker !== undefined && !(marker.startsWith('`') && (open?.[2] ?? '').includes('`'))) {
        fence = marker;
        out.push({ line, code: true });
        continue;
      }
      out.push({ line, code: false });
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
    if (close !== undefined && close.startsWith(fence.charAt(0)) && close.length >= fence.length) {
      fence = null;
    }
    out.push({ line, code: true });
  }
  return out;
}

/**
 * What a save sends: no leading blank lines, no trailing whitespace, and one
 * blank line between blocks — the library puts two before a table. Inside
 * fenced code every line is kept as it is; a blank line there is code.
 */
function tidy(markdown: string): string {
  const kept: { line: string; code: boolean }[] = [];
  for (const entry of linesWithCode(markdown)) {
    const previous = kept.at(-1);
    if (
      !entry.code &&
      entry.line.trim() === '' &&
      previous !== undefined &&
      !previous.code &&
      previous.line.trim() === ''
    ) {
      continue;
    }
    kept.push(entry);
  }
  return kept
    .map((entry) => entry.line)
    .join('\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '');
}

function serializeAs(bridge: Bridge, doc: ProseNode, asFaithful: boolean): string {
  faithful = asFaithful;
  try {
    return tidy(bridge.manager.serialize(doc.toJSON() as JSONContent));
  } finally {
    faithful = true;
  }
}

/** Parse markdown into a document of `schema`, or `null` if it will not fit it. */
export function parseMarkdown(bridge: Bridge, markdown: string, schema: Schema): ProseNode | null {
  if (markdown.trim() === '') return schema.topNodeType.createAndFill();
  try {
    const doc = schema.nodeFromJSON(bridge.manager.parse(markdown));
    doc.check();
    return doc;
  } catch {
    return null;
  }
}

/**
 * A text block's inline content as markdown can hold it: no spaces or tabs at
 * either end and no line break last. Markdown keeps none of them — a paragraph
 * is trimmed when it is read — so a mention, which ends with a space, or a
 * stray Enter, must not make the text read back as "different" (review
 * round 1, measured: every save after a mention was refused).
 */
function trimInline(content: readonly JSONContent[]): JSONContent[] {
  const out = [...content];
  while (out.at(-1)?.type === 'hardBreak') out.pop();
  const first = out[0];
  if (first?.type === 'text') {
    const text = (first.text ?? '').replace(/^[ \t]+/, '');
    if (text === '') out.shift();
    else out[0] = { ...first, text };
  }
  const last = out.at(-1);
  if (last?.type === 'text') {
    const text = (last.text ?? '').replace(/[ \t]+$/, '');
    if (text === '') out.pop();
    else out[out.length - 1] = { ...last, text };
  }
  return out;
}

/** A node's JSON with every text block's ends as markdown keeps them. */
function canonical(json: JSONContent, schema: Schema): JSONContent {
  if (json.content === undefined) return json;
  const type = json.type === undefined ? undefined : schema.nodes[json.type];
  let content = json.content.map((child) => canonical(child, schema));
  if (type?.isTextblock === true && type.spec.code !== true) content = trimInline(content);
  if (content.length > 0) return { ...json, content };
  const { content: _dropped, ...rest } = json;
  return rest;
}

/**
 * One block as a comparable key: its {@link canonical} JSON. JSON rather than
 * `Node.eq`, because the editor's schema and the bridge's are two instances of
 * the same definition, and `eq` compares node types by identity.
 */
const keyOf = (node: ProseNode): string =>
  JSON.stringify(canonical(node.toJSON() as JSONContent, node.type.schema));

/**
 * A document's top-level blocks, without its empty paragraphs — a paragraph
 * of nothing but spaces is one.
 *
 * Markdown has no empty paragraph: the library writes one as extra blank
 * lines, and a trailing one disappears in the trimming — so a person pressing
 * Enter at the end must not make the written text read back as a different
 * document.
 */
function blocksOf(doc: ProseNode): ProseNode[] {
  const blocks: ProseNode[] = [];
  doc.forEach((child) => {
    const empty =
      child.type.name === 'paragraph' &&
      canonical(child.toJSON() as JSONContent, child.type.schema).content === undefined;
    if (!empty) blocks.push(child);
  });
  return blocks;
}

const sameBlocks = (a: readonly ProseNode[], b: readonly ProseNode[]): boolean =>
  a.length === b.length && a.every((node, i) => keyOf(node) === keyOf(b[i]!));

/**
 * Does `markdown` read back as `doc` — block for block, as markdown can hold
 * it ({@link canonical})? The check every save passes.
 */
export function readsBackAs(bridge: Bridge, markdown: string, doc: ProseNode): boolean {
  const back = parseMarkdown(bridge, markdown, doc.type.schema);
  return back !== null && sameBlocks(blocksOf(back), blocksOf(doc));
}

/**
 * One block as markdown that reads back as that very block: the faithful form,
 * else the library's — each checked — else `null`.
 */
function writeBlock(bridge: Bridge, node: ProseNode, schema: Schema): string | null {
  const alone = schema.topNodeType.create(null, node);
  for (const asFaithful of [true, false]) {
    const markdown = serializeAs(bridge, alone, asFaithful);
    const back = parseMarkdown(bridge, markdown, schema);
    if (back !== null && sameBlocks(blocksOf(back), [node])) return markdown;
  }
  return null;
}

/** A top-level block of the source: where it is, and the blocks it parses to. */
export interface SourceUnit {
  readonly start: number;
  readonly end: number;
  /** {@link keyOf} each block it parses to, alone; none for a definition. */
  readonly blocks: readonly string[];
}

type Piece = { readonly text: string } | { readonly node: ProseNode };

/**
 * The save, as pieces: runs of untouched source copied verbatim, and the
 * blocks that are new or changed. An alignment of the source's units to the
 * document's blocks that keeps the most units untouched.
 */
function plan(blocks: readonly ProseNode[], source: string, units: readonly SourceUnit[]): Piece[] {
  const keys = blocks.map(keyOf);
  const U = units.length;
  const C = blocks.length;
  const unit = (u: number): SourceUnit => units[u]!;
  const fits = (u: number, i: number): boolean => {
    const want = unit(u).blocks;
    return i + want.length <= C && want.every((key, d) => keys[i + d] === key);
  };
  const score: number[][] = Array.from({ length: U + 1 }, () => new Array<number>(C + 1).fill(0));
  const at = (u: number, i: number): number => score[u]?.[i] ?? 0;
  for (let u = U - 1; u >= 0; u--) {
    for (let i = C; i >= 0; i--) {
      let best = at(u + 1, i);
      if (i < C) best = Math.max(best, at(u, i + 1));
      if (fits(u, i)) best = Math.max(best, 1 + at(u + 1, i + unit(u).blocks.length));
      score[u]![i] = best;
    }
  }

  const pieces: Piece[] = [];
  let run: { start: number; end: number; last: number } | null = null;
  const flush = (): void => {
    if (run === null) return;
    pieces.push({ text: source.slice(run.start, run.end).replace(/\n+$/, '') });
    run = null;
  };
  let u = 0;
  let i = 0;
  while (u < U || i < C) {
    if (u < U && fits(u, i) && at(u, i) === 1 + at(u + 1, i + unit(u).blocks.length)) {
      const kept = unit(u);
      if (run !== null && run.last === u - 1) {
        run.end = kept.end;
        run.last = u;
      } else {
        flush();
        run = { start: kept.start, end: kept.end, last: u };
      }
      i += kept.blocks.length;
      u += 1;
    } else if (i < C && (u >= U || at(u, i) === at(u, i + 1))) {
      flush();
      pieces.push({ node: blocks[i]! });
      i += 1;
    } else {
      // A unit that is gone: the next one kept starts a new run.
      u += 1;
    }
  }
  flush();
  return pieces;
}

const clip = (s: string): string => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

/**
 * The markdown for a document.
 *
 * Given `from` — the opening it was edited from — every block still as it was
 * is copied from the source byte for byte, and only new or changed blocks are
 * written, each by {@link writeBlock}. Without it every block is written.
 * Either way the whole result must read back as the document; if a block
 * cannot be written so, or the whole does not read back, it throws
 * {@link UnwritableMarkdown} rather than return text that means something else.
 */
export function toMarkdown(bridge: Bridge, doc: ProseNode, from?: Opening): string {
  const schema = doc.type.schema;
  const blocks = blocksOf(doc);
  const pieces: Piece[] =
    from?.kind === 'rich'
      ? plan(blocks, from.source, from.units)
      : blocks.map((node) => ({ node }));

  const written: string[] = [];
  let unwritable: ProseNode | undefined;
  for (const piece of pieces) {
    if ('text' in piece) {
      written.push(piece.text);
      continue;
    }
    const markdown = writeBlock(bridge, piece.node, schema);
    if (markdown === null) {
      unwritable ??= piece.node;
      written.push(serializeAs(bridge, schema.topNodeType.create(null, piece.node), true));
    } else {
      written.push(markdown);
    }
  }
  const markdown = written
    .filter((text) => text !== '')
    .join('\n\n')
    .replace(/\s+$/, '');

  if (unwritable !== undefined) {
    throw new UnwritableMarkdown(
      `“${clip(unwritable.textContent)}” would not read back as typed if saved — as Markdown it means something else.`,
      markdown,
    );
  }
  if (!readsBackAs(bridge, markdown, doc)) {
    throw new UnwritableMarkdown(
      'Written out, two of its blocks would run into one — two lists side by side, say.',
      markdown,
    );
  }
  return markdown;
}

/**
 * The stated normalisation (LAI-827): what two markdown texts may differ by
 * and still be "the same" for the round-trip check. **Layout only, and never
 * inside fenced code:**
 *
 * 1. line endings become `\n`;
 * 2. spaces and tabs at the end of a line go;
 * 3. a run of blank lines becomes one, and blank lines at either end go;
 * 4. in a table row, the padding around each cell goes, and a delimiter cell
 *    is `---` keeping its alignment colons — `|---|` and `| :---- |` are both
 *    one column, and the editor writes tables padded.
 *
 * Nothing else is forgiven: `*` for `-`, `_` for `*`, a loose list made tight
 * — each is a different text, so that document opens as Markdown. Inside code
 * a blank line or a trailing space is code, and differs. The round-trip check
 * adds one thing on top, the blank lines between top-level blocks
 * ({@link sameMarkdown}).
 */
export function normaliseMarkdown(markdown: string): string {
  return normalisedLines(markdown)
    .map((entry) => entry.text)
    .join('\n');
}

/** A line of the stated normalisation, and where it was. */
interface NumberedLine {
  readonly text: string;
  /** Its line number in the text it came from, as the Markdown view shows it. */
  readonly line: number;
}

/**
 * {@link normaliseMarkdown} line by line, each kept line with its number in
 * `markdown`, the first counted as `first` — so a notice names the line a
 * person sees, not its place after blank lines were collapsed (LAI-849).
 */
function normalisedLines(markdown: string, first = 1): NumberedLine[] {
  const kept: (NumberedLine & { readonly code: boolean })[] = [];
  linesWithCode(markdown.replace(/\r\n?/g, '\n')).forEach((entry, i) => {
    if (entry.code) {
      kept.push({ text: entry.line, line: first + i, code: true });
      return;
    }
    const trimmed = entry.line.replace(/[ \t]+$/, '');
    const text = /^\s*\|.*\|$/.test(trimmed) ? normaliseTableRow(trimmed) : trimmed;
    const previous = kept.at(-1);
    // Blank lines at the start go, and a run of them outside code is one.
    if (text === '' && (previous === undefined || (!previous.code && previous.text === ''))) {
      return;
    }
    kept.push({ text, line: first + i, code: false });
  });
  // And blank lines at the end.
  while (kept.at(-1)?.text === '') kept.pop();
  return kept;
}

function normaliseTableRow(line: string): string {
  const cells = line.trim().slice(1, -1).split('|');
  const tidyCells = cells.map((cell) => {
    const t = cell.trim();
    if (!/^:?-+:?$/.test(t)) return t;
    return `${t.startsWith(':') ? ':' : ''}---${t.endsWith(':') ? ':' : ''}`;
  });
  return `|${tidyCells.join('|')}|`;
}

export type Opening =
  | {
      readonly kind: 'rich';
      /** The document, as JSON the editor is created from. */
      readonly content: JSONContent;
      /** The whole document written out: what the round-trip check compares. */
      readonly markdown: string;
      /** The source, line endings as `\n`: what an untouched block is copied from. */
      readonly source: string;
      /** The source's top-level blocks, in order. */
      readonly units: readonly SourceUnit[];
    }
  | { readonly kind: 'source'; readonly reason: string };

interface TokenLike {
  readonly type?: unknown;
  readonly raw?: unknown;
  readonly text?: unknown;
}

/** Every token marked produced, depth first. */
function* walkTokens(value: unknown): Generator<TokenLike> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkTokens(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const token = value as TokenLike & Record<string, unknown>;
  if (typeof token.type === 'string') yield token;
  for (const key of ['tokens', 'items', 'header', 'rows', 'cells']) yield* walkTokens(token[key]);
}

/**
 * The source's top-level blocks, each parsed alone — or `null` when parsing
 * them one at a time does not give the document, because one depends on
 * another (a reference-style link and its definition) and copying one
 * untouched beside a rewritten other could change what it means.
 */
function splitUnits(bridge: Bridge, source: string, doc: ProseNode): SourceUnit[] | null {
  let tokens: unknown;
  try {
    tokens = bridge.manager.instance.lexer(source);
  } catch {
    return null;
  }
  if (!Array.isArray(tokens)) return null;
  const units: SourceUnit[] = [];
  let offset = 0;
  for (const token of tokens as TokenLike[]) {
    // Found in the source rather than summed: a TipTap tokenizer reports its
    // `raw` with a newline the source does not have (the task list, measured).
    const raw = (typeof token.raw === 'string' ? token.raw : '').replace(/\n+$/, '');
    if (token.type === 'space' || raw.trim() === '') continue;
    const start = source.indexOf(raw, offset);
    if (start === -1 || source.slice(offset, start).trim() !== '') return null;
    offset = start + raw.length;
    const part = parseMarkdown(bridge, raw, bridge.schema);
    if (part === null) return null;
    units.push({ start, end: offset, blocks: blocksOf(part).map(keyOf) });
  }
  if (source.slice(offset).trim() !== '') return null;
  const parsed = units.flatMap((unit) => unit.blocks);
  const whole = blocksOf(doc).map(keyOf);
  return parsed.length === whole.length && parsed.every((key, i) => key === whole[i])
    ? units
    : null;
}

/** A top-level block of a markdown text, as the slice of it that it is. */
interface TextBlock {
  readonly text: string;
  /** The line it starts on. */
  readonly line: number;
}

/**
 * `markdown`'s top-level blocks, each the exact slice of `markdown` the lexer
 * read it from — or `null` when they do not account for every character
 * outside blank lines: a token whose `raw` is not where it should be, a block
 * that starts partway into a line, anything but whitespace between two blocks.
 * So two texts whose blocks match differ by blank lines between blocks, and by
 * nothing else.
 */
function topLevelBlocks(bridge: Bridge, markdown: string): TextBlock[] | null {
  let tokens: unknown;
  try {
    tokens = bridge.manager.instance.lexer(markdown);
  } catch {
    return null;
  }
  if (!Array.isArray(tokens)) return null;
  const blocks: TextBlock[] = [];
  let offset = 0;
  let line = 1;
  for (const token of tokens as TokenLike[]) {
    // The newlines at either end are the gap's: a TipTap tokenizer reports
    // the task list's `raw` with one in front (measured, LAI-849).
    const raw = (typeof token.raw === 'string' ? token.raw : '')
      .replace(/^(?:[ \t]*\n)+/, '')
      .replace(/\n+$/, '');
    if (token.type === 'space' || raw.trim() === '') continue;
    const start = markdown.indexOf(raw, offset);
    if (start === -1 || markdown.slice(offset, start).trim() !== '') return null;
    if (start > 0 && markdown.charAt(start - 1) !== '\n') return null;
    for (let at = offset; at < start; at++) if (markdown.charAt(at) === '\n') line += 1;
    blocks.push({ text: raw, line });
    for (let at = start; at < start + raw.length; at++) if (markdown.charAt(at) === '\n') line += 1;
    offset = start + raw.length;
  }
  return markdown.slice(offset).trim() === '' ? blocks : null;
}

/**
 * Do two markdown texts count as the same for the round-trip check? The
 * stated normalisation ({@link normaliseMarkdown}), and one thing more: **the
 * blank lines between top-level blocks** (LAI-849).
 *
 * A list directly under a paragraph is legal CommonMark, and agents write it
 * so; the editor writes a blank line before every block. That line changes no
 * character of any block, and the text still reads back as the same document
 * ({@link toMarkdown} checks), yet refusing it kept an agent's whole
 * description out of the rich editor. Inside a block a blank line still counts:
 * it is what makes `- one\n\n- two` a loose list. A save copies an untouched
 * block as it was, so a paragraph and the list under it stay as written until
 * one of them is edited.
 */
export function sameMarkdown(bridge: Bridge, a: string, b: string): boolean {
  if (normaliseMarkdown(a) === normaliseMarkdown(b)) return true;
  const was = topLevelBlocks(bridge, a.replace(/\r\n?/g, '\n'));
  const would = topLevelBlocks(bridge, b.replace(/\r\n?/g, '\n'));
  return (
    was !== null &&
    would !== null &&
    was.length === would.length &&
    was.every(
      (block, i) => normaliseMarkdown(block.text) === normaliseMarkdown(would[i]?.text ?? ''),
    )
  );
}

/** One place two texts differ: lines of the first removed, lines added in their place. */
interface Hunk {
  readonly removed: readonly NumberedLine[];
  readonly added: readonly string[];
  /** The first text's lines on either side of it. */
  readonly before: NumberedLine | undefined;
  readonly after: NumberedLine | undefined;
}

/**
 * Where `would` differs from `was`, in order: a longest-common-subsequence
 * diff of their lines. **Not a comparison by position**, which is what LAI-849
 * found: one added blank line shifted every line after it, so the notice
 * compared line 7 with the blank line now in its place — "as ''".
 */
function hunks(was: readonly NumberedLine[], would: readonly string[]): Hunk[] {
  let head = 0;
  while (head < was.length && head < would.length && was[head]?.text === would[head]) head += 1;
  let tail = 0;
  while (
    tail < was.length - head &&
    tail < would.length - head &&
    was[was.length - 1 - tail]?.text === would[would.length - 1 - tail]
  ) {
    tail += 1;
  }
  const a = was.slice(head, was.length - tail);
  const b = would.slice(head, would.length - tail);
  const around = (from: number, to: number) => ({
    before: was[head + from - 1],
    after: was[head + to],
  });
  if (a.length === 0 && b.length === 0) return [];
  // Past a million cells, what differs is most of the text: one hunk says so.
  if (a.length * b.length > 1_000_000) return [{ removed: a, added: b, ...around(0, a.length) }];

  // common[i][j]: how many lines a[i…] and b[j…] have in common, in order.
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  const at = (i: number, j: number): number => common[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i]![j] =
        a[i]?.text === b[j] ? 1 + at(i + 1, j + 1) : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: Hunk[] = [];
  let removed: NumberedLine[] = [];
  let added: string[] = [];
  let start = 0;
  let i = 0;
  let j = 0;
  const flush = (): void => {
    if (removed.length > 0 || added.length > 0) out.push({ removed, added, ...around(start, i) });
    removed = [];
    added = [];
  };
  while (i < a.length || j < b.length) {
    const left = a[i];
    if (left !== undefined && j < b.length && left.text === b[j]) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    if (removed.length === 0 && added.length === 0) start = i;
    if (left !== undefined && (j >= b.length || at(i + 1, j) >= at(i, j + 1))) {
      removed.push(left);
      i += 1;
    } else {
      added.push(b[j] ?? '');
      j += 1;
    }
  }
  flush();
  return out;
}

const isBlank = (hunk: Hunk): boolean =>
  hunk.removed.every((line) => line.text === '') && hunk.added.every((text) => text === '');

/**
 * The first difference worth naming. Block by block when both texts split into
 * as many top-level blocks, so a blank line added between two blocks — which
 * {@link sameMarkdown} forgives — is never the one named; else over the whole
 * text, a change of words before a change of blank lines.
 */
function firstDifference(bridge: Bridge, source: string, written: string): Hunk | undefined {
  const was = topLevelBlocks(bridge, source);
  const would = topLevelBlocks(bridge, written);
  if (was !== null && would !== null && was.length === would.length) {
    for (const [i, block] of was.entries()) {
      const into = normalisedLines(would[i]?.text ?? '').map((entry) => entry.text);
      const found = hunks(normalisedLines(block.text, block.line), into)[0];
      if (found !== undefined) return found;
    }
    // Every block reads as it was: only blank lines between them differ.
    return undefined;
  }
  const all = hunks(
    normalisedLines(source),
    normalisedLines(written).map((entry) => entry.text),
  );
  return all.find((hunk) => !isBlank(hunk)) ?? all[0];
}

/** A difference as a sentence: the line, and what it would become. */
function inWords(hunk: Hunk): string {
  const removed = hunk.removed.find((line) => line.text !== '');
  const added = hunk.added.find((text) => text !== '');
  if (removed !== undefined && added !== undefined) {
    return `The rich editor would rewrite line ${String(removed.line)}: “${clip(removed.text)}” as “${clip(added)}”.`;
  }
  if (removed !== undefined) {
    return `The rich editor would drop line ${String(removed.line)}: “${clip(removed.text)}”.`;
  }
  const where =
    hunk.after !== undefined
      ? `before line ${String(hunk.after.line)}: “${clip(hunk.after.text)}”`
      : hunk.before !== undefined
        ? `after line ${String(hunk.before.line)}: “${clip(hunk.before.text)}”`
        : 'at the start';
  if (added !== undefined) return `The rich editor would add “${clip(added)}” ${where}.`;
  return hunk.added.length > 0
    ? `The rich editor would add a blank line ${where}.`
    : `The rich editor would remove the blank line ${where}.`;
}

/** Why a document opens as Markdown, in a sentence a person can act on. */
function explain(bridge: Bridge, source: string, written: string | null): string {
  try {
    for (const token of walkTokens(bridge.manager.instance.lexer(source))) {
      if (token.type === 'html' && typeof token.raw === 'string' && token.raw.trim() !== '') {
        const tag = /<\/?([a-zA-Z][\w-]*)/.exec(token.raw)?.[1];
        return `It contains HTML${tag === undefined ? '' : ` (<${tag}>)`}, which the rich editor would not keep as written.`;
      }
      if (token.type === 'image') {
        return 'It contains an image, which Laika does not show, so the rich editor would drop it.';
      }
    }
  } catch {
    // The diff below still says what would change.
  }
  if (written === null) return 'The rich editor could not read it.';
  const difference = firstDifference(bridge, source, written);
  return difference === undefined
    ? 'The rich editor would not write it back exactly.'
    : inWords(difference);
}

/**
 * How a document opens: in the rich view when it round-trips and its blocks
 * stand alone, in Markdown source with the reason when not.
 */
export function openDocument(bridge: Bridge, source: string): Opening {
  const text = source.replace(/\r\n?/g, '\n');
  const doc = parseMarkdown(bridge, text, bridge.schema);
  if (doc === null) return { kind: 'source', reason: explain(bridge, text, null) };
  let written: string;
  try {
    written = toMarkdown(bridge, doc);
  } catch (error) {
    return {
      kind: 'source',
      reason: explain(bridge, text, error instanceof UnwritableMarkdown ? error.draft : null),
    };
  }
  if (!sameMarkdown(bridge, written, text)) {
    return { kind: 'source', reason: explain(bridge, text, written) };
  }
  const units = splitUnits(bridge, text, doc);
  if (units === null) {
    return {
      kind: 'source',
      reason:
        'Its blocks depend on one another — a reference-style link and its definition, say — so changing one could change another.',
    };
  }
  return {
    kind: 'rich',
    content: doc.toJSON() as JSONContent,
    markdown: written,
    source: text,
    units,
  };
}
