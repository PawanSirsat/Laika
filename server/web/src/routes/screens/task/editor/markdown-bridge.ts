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
 * straight back gives the same markdown** (after {@link normaliseMarkdown}).
 * Anything else — HTML an agent wrote, `* bullets`, an image — opens as
 * Markdown source with the reason, so a Save there sends the person's own text.
 *
 * ## Why the text encoder is replaced
 *
 * `@tiptap/markdown` escapes every `*`, `_`, `~`, `[`, `` ` `` and `\` in plain
 * text and writes `<`, `>` and `&` as entities. That is always safe and almost
 * never what was typed: `next_cursor` became `next\_cursor`, `p95 < 1 s`
 * became `p95 &lt; 1 s`, `A -> B` became `A -&gt; B` — measured on the
 * 3.32.0 serializer, and enough to push nearly every agent-written document
 * into source mode, and to fill what a person writes with backslashes an agent
 * then reads.
 *
 * So {@link escapeFaithfully} escapes a character only where it could start
 * markdown syntax, **and the result is checked, not trusted**: the minimal
 * markdown is parsed again, and only if that gives the very document in the
 * editor is it used. Otherwise the library's own conservative output is sent.
 * The check costs one parse per save, which is nothing next to a request.
 *
 * The hook is `MarkdownManager`'s private `encodeTextForMarkdown`, the one
 * place a text node is encoded. A private method can change in any release;
 * the packages are pinned exactly, `markdown-bridge.test.ts` fails if the hook
 * is gone, and without it the bridge falls back to the library's encoder —
 * correct, only noisier.
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

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * Could the delimiter at `i` open emphasis or strikethrough, and is there a
 * partner in the same text that could close it — or the other way round?
 *
 * CommonMark's flanking rules, simplified on the safe side: a run can open
 * when the next character is not a space, and close when the previous one is
 * not. `_` also cannot open after, or close before, a letter or digit, which is
 * why `next_cursor` needs no escape. A partner in another text node — across a
 * bold word, say — is not seen here; the re-parse in {@link toMarkdown} is what
 * catches that.
 */
function couldPair(text: string, i: number, mark: string): boolean {
  const opens = (at: number): boolean =>
    !isSpace(text[at + 1]) && (mark !== '_' || !isWordChar(text[at - 1]));
  const closes = (at: number): boolean =>
    !isSpace(text[at - 1]) && (mark !== '_' || !isWordChar(text[at + 1]));
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
 * At the start of a line, what would make it a block rather than text: a
 * heading, a quote, a list item, a rule or a setext underline. The length of
 * the marker, up to and including the character to escape, or 0.
 *
 * `@tiptap/markdown`'s own escaper misses these — `# not a heading` typed as
 * text came back as a heading (LAI-827, measured).
 */
function blockMarker(line: string): number {
  const rule = /^(?:[-*_](?:[ \t]*[-*_]){2,}|=+)[ \t]*$/.test(line);
  if (rule) return 1;
  const marker = /^(?:#{1,6}|>|[-+*]|\d{1,9}[.)])(?=[ \t]|$)/.exec(line)?.[0];
  if (marker === undefined) return 0;
  // `1.` is escaped at its `.`, the rest at their first character.
  return /^\d/.test(marker) ? marker.length : 1;
}

/**
 * Escape a plain-text run only where it could be read as markdown.
 *
 * - `` ` `` always: a lone backtick can pair with one much later.
 * - `\` before ASCII punctuation or at the end, where it would escape what follows.
 * - `*`, `_` and `~` when {@link couldPair} says they might pair.
 * - `[` and `]` when they could make a link: `[text](` or `[text][`.
 * - A block marker where a line starts — the run's start, or after a soft
 *   line break inside it ({@link blockMarker}).
 *
 * Everything else — `<`, `>`, `&`, `|` — is written as typed. A `<` that reads
 * as HTML is caught by the re-parse.
 */
export function escapeFaithfully(text: string): string {
  let out = '';
  let escapeAt = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    const next = text[i + 1];
    if (i === 0 || text[i - 1] === '\n') {
      const end = text.indexOf('\n', i);
      const length = blockMarker(text.slice(i, end === -1 ? undefined : end));
      escapeAt = length === 0 ? -1 : i + length - 1;
    }
    if (i === escapeAt) {
      out += `\\${c}`;
    } else if (c === '`') {
      out += '\\`';
    } else if (c === '\\') {
      out += next === undefined || ASCII_PUNCTUATION.test(next) ? '\\\\' : '\\';
    } else if (c === '*' || c === '_' || c === '~') {
      out += couldPair(text, i, c) ? `\\${c}` : c;
    } else if (c === '[') {
      const close = text.indexOf(']', i + 1);
      const after = close === -1 ? undefined : text[close + 1];
      out += after === '(' || after === '[' ? '\\[' : '[';
    } else if (c === ']') {
      out += next === '(' || next === '[' ? '\\]' : ']';
    } else {
      out += c;
    }
  }
  return out;
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
      return inCode ? text : escapeFaithfully(text);
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
 * What a save sends: no leading blank lines, no trailing whitespace, and one
 * blank line between blocks — the library puts two before a table. Inside a
 * fenced code block every line is kept as it is; a blank line there is code.
 */
function tidy(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined && (fence === null || marker.startsWith(fence))) {
      fence = fence === null ? marker : null;
    } else if (fence === null && line.trim() === '' && out.at(-1)?.trim() === '') {
      continue;
    }
    out.push(line);
  }
  return out
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
 * The document without its empty top-level paragraphs.
 *
 * Markdown has no empty paragraph: the library writes one as extra blank
 * lines, and a trailing one disappears in the trimming — so a person pressing
 * Enter at the end would make the written text read back as a different
 * document, and lose the faithful form for the whole save.
 */
function withoutEmptyParagraphs(doc: ProseNode): ProseNode {
  const kept: ProseNode[] = [];
  doc.forEach((child) => {
    if (!(child.type.name === 'paragraph' && child.content.size === 0)) kept.push(child);
  });
  if (kept.length === doc.childCount) return doc;
  return kept.length === 0
    ? (doc.type.createAndFill() ?? doc)
    : doc.type.create(doc.attrs, kept, doc.marks);
}

/**
 * The markdown for a document: the faithful form when it reads back as this
 * very document, the library's own otherwise.
 */
export function toMarkdown(bridge: Bridge, doc: ProseNode): string {
  const written = withoutEmptyParagraphs(doc);
  const minimal = serializeAs(bridge, written, true);
  const back = parseMarkdown(bridge, minimal, written.type.schema);
  if (back?.eq(written) === true) return minimal;
  return serializeAs(bridge, written, false);
}

/**
 * The stated normalisation (LAI-827): what two markdown texts may differ by
 * and still be "the same" for the round-trip check — and therefore what a save
 * from the rich view may change in text nobody touched. **Layout only:**
 *
 * 1. line endings become `\n`;
 * 2. spaces and tabs at the end of a line go;
 * 3. a run of blank lines becomes one, and blank lines at either end go;
 * 4. in a table row, the padding around each cell goes, and a delimiter cell
 *    is `---` keeping its alignment colons — `|---|` and `| :---- |` are both
 *    one column, and the editor writes tables padded.
 *
 * Nothing else is forgiven: `*` for `-`, `_` for `*`, a loose list made tight
 * — each is a different text, so that document opens as Markdown.
 */
export function normaliseMarkdown(markdown: string): string {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .map((line) => (/^\s*\|.*\|$/.test(line) ? normaliseTableRow(line) : line));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
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
      /** What a Save of the untouched document would send. */
      readonly markdown: string;
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

const clip = (s: string): string => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

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
  const was = normaliseMarkdown(source).split('\n');
  const would = normaliseMarkdown(written).split('\n');
  for (let i = 0; i < Math.max(was.length, would.length); i++) {
    if (was[i] !== would[i]) {
      return `The rich editor would rewrite line ${String(i + 1)}: “${clip(was[i] ?? '')}” as “${clip(would[i] ?? '')}”.`;
    }
  }
  return 'The rich editor would not write it back exactly.';
}

/**
 * How a document opens: in the rich view when it round-trips, in Markdown
 * source with the reason when it does not.
 */
export function openDocument(bridge: Bridge, source: string): Opening {
  const doc = parseMarkdown(bridge, source, bridge.schema);
  if (doc === null) return { kind: 'source', reason: explain(bridge, source, null) };
  const written = toMarkdown(bridge, doc);
  if (normaliseMarkdown(written) === normaliseMarkdown(source)) {
    return { kind: 'rich', content: doc.toJSON() as JSONContent, markdown: written };
  }
  return { kind: 'source', reason: explain(bridge, source, written) };
}
