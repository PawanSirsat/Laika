import type {
  AnyExtension,
  JSONContent,
  MarkdownLexerConfiguration,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core';
import { renderNestedMarkdownContent } from '@tiptap/core';
import { Link } from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { StarterKit } from '@tiptap/starter-kit';
import { startsBlock, writesFaithfully } from './markdown-bridge.ts';

/**
 * What the task panel's editor can hold (LAI-827): exactly what markdown can
 * store, and nothing a markdown column would lose.
 *
 * - **No underline, no colour, no image.** Markdown has no underline or colour,
 *   and Laika loads no images (SPEC §13.4). StarterKit's underline is switched
 *   off so `⌘U` cannot make something a save would drop.
 * - **No trailing node.** It appends an empty paragraph the moment the editor
 *   opens on a document ending in a list or a table — a change nobody made,
 *   which would make an untouched Save send something.
 * - **Headings 1–6.** The toolbar offers three, as the owner's reference does,
 *   but an agent's `####` must still open as a heading or it would not
 *   round-trip.
 */

/**
 * Is this link one GFM would make by itself from the bare text — a URL, a
 * `www.` address, an email address?
 *
 * Agents write bare URLs, and the library writes every link as
 * `[text](href)`, so `see https://x.dev` came back as
 * `see [https://x.dev](https://x.dev)`. A link whose text is its own address is
 * written bare instead — only in the faithful form, which the bridge checks by
 * parsing it again, so one GFM would not link reverts to the long form.
 */
export function isBareAutolink(text: string, href: string): boolean {
  if (/\s/.test(text)) return false;
  if (/^https?:\/\/\S+$/i.test(text)) return href === text;
  if (/^www\.\S+$/i.test(text)) return href === `http://${text}`;
  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(text)) return href === `mailto:${text}`;
  return false;
}

const FaithfulLink = Link.extend({
  renderMarkdown(node, helpers, context) {
    const href = typeof node.attrs?.href === 'string' ? node.attrs.href : '';
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
    const text = (context.meta as { markText?: unknown } | undefined)?.markText;
    const inner = helpers.renderChildren(node);
    if (
      writesFaithfully() &&
      title === '' &&
      typeof text === 'string' &&
      isBareAutolink(text, href)
    ) {
      return inner;
    }
    return title === '' ? `[${inner}](${href})` : `[${inner}](${href} "${title}")`;
  },
}).configure({
  // Editing a link's words must not follow it; reading does that.
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
});

/**
 * StarterKit with two of its marks as markdown holds them (LAI-312).
 *
 * - **Code sits inside other marks.** TipTap's `code` excludes every mark, so
 *   `` _from the `.tasks/` folder_ `` or `` [`path`](url) `` — every task
 *   imported from the repo has both — parsed into a document the schema
 *   refused, and the whole description opened as Markdown. CommonMark nests a
 *   code span in emphasis, strikethrough and a link's words.
 * - **Italic remembers its delimiter.** `_a_` and `*a*` are the same emphasis,
 *   and the library writes `*` for both, so `_a_` came back `*a*`. The
 *   `delimiter` is how it was written; the faithful form writes it back, and
 *   anything made in the editor, or a block the underscore would no longer
 *   read back in, is written with `*`. It is spelling, not content: the bridge
 *   ignores it when it compares documents.
 *
 * Both are reached through the kit, so neither mark is a dependency of its own.
 */
const Kit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) => {
      if (extension.name === 'code') return extension.extend({ excludes: '' });
      if (extension.name !== 'italic') return extension;
      return extension.extend({
        // Italic has no attributes of its own in the pinned 3.32.0.
        addAttributes() {
          return { delimiter: { default: '*', rendered: false, keepOnSplit: true } };
        },
        parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
          const delimiter = token.raw?.startsWith('_') === true ? '_' : '*';
          return helpers.applyMark('italic', helpers.parseInline(token.tokens ?? []), {
            delimiter,
          });
        },
        renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
          const delimiter = writesFaithfully() && node.attrs?.delimiter === '_' ? '_' : '*';
          return `${delimiter}${helpers.renderChildren(node)}${delimiter}`;
        },
      });
    });
  },
});

/** A task item's first line: indentation, marker, box, and its text. */
const TASK_ITEM = /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/;

/**
 * A task list read as CommonMark reads it (LAI-302): each item's paragraph is
 * its first line **and every line under it that starts no block of its own**,
 * however far indented — `- [ ] a criterion that\n      wraps` is one
 * paragraph, as the reading view shows it, and so is a lazy `wraps` flush
 * left. TipTap's own tokenizer took only the first line, and read the rest as
 * blocks: a code block at six spaces, a second paragraph at two. Past the
 * paragraph it is the library's: lines indented under the item are its nested
 * blocks, a nested task list among them.
 */
function tokenizeTaskList(
  src: string,
  lexer: MarkdownLexerConfiguration,
): { readonly tokens: MarkdownToken[]; readonly raw: string } | undefined {
  const lines = src.split('\n');
  const items: MarkdownToken[] = [];
  let raw = '';
  let i = 0;
  const indentOf = (line: string): number => /^\s*/.exec(line)?.[0].length ?? 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = TASK_ITEM.exec(line);
    if (match === null) {
      if (items.length > 0) break;
      if (line.trim() !== '') return undefined;
      raw += `${line}\n`;
      i += 1;
      continue;
    }
    const indent = match[1]?.length ?? 0;
    const words = [match[4] ?? ''];
    raw += `${line}\n`;
    i += 1;
    for (let next = lines[i]; next !== undefined; next = lines[i]) {
      const text = next.trimStart();
      if (text === '' || startsBlock(text)) break;
      words.push(text);
      raw += `${next}\n`;
      i += 1;
    }
    const nested: string[] = [];
    for (let next = lines[i]; next !== undefined; next = lines[i]) {
      if (next.trim() === '') {
        // A blank line stays in the item only if what follows is indented under it.
        const after = lines.slice(i + 1).find((l) => l.trim() !== '');
        if (after === undefined || indentOf(after) <= indent) break;
      } else if (indentOf(next) <= indent) {
        break;
      }
      nested.push(next);
      raw += `${next}\n`;
      i += 1;
    }
    const body = nested.map((l) => l.slice(indent + 2)).join('\n');
    const text = words.join('\n');
    items.push({
      type: 'taskItem',
      raw: '',
      checked: match[3]?.toLowerCase() === 'x',
      text,
      tokens: lexer.inlineTokens(text),
      nestedTokens: body.trim() === '' ? undefined : nestedBlocks(body, lexer),
    });
  }
  return items.length === 0 ? undefined : { tokens: items, raw };
}

/** What sits under a task item: a task list and whatever follows, or other blocks. */
function nestedBlocks(src: string, lexer: MarkdownLexerConfiguration): MarkdownToken[] {
  const list = tokenizeTaskList(src, lexer);
  if (list === undefined) return lexer.blockTokens(src);
  const token: MarkdownToken = { type: 'taskList', raw: list.raw, items: list.tokens };
  const rest = src.slice(list.raw.length);
  return rest.trim() === '' ? [token] : [token, ...lexer.blockTokens(rest)];
}

const WrappingTaskList = TaskList.extend({
  markdownTokenizer: {
    name: 'taskList',
    level: 'block',
    start: (src: string) => /^\s*[-+*]\s+\[([ xX])\]\s+/.exec(src)?.index ?? -1,
    tokenize: (src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) => {
      const list = tokenizeTaskList(src, lexer);
      return list === undefined
        ? undefined
        : { type: 'taskList', raw: list.raw, items: list.tokens };
    },
  },
});

/**
 * A task item written as the tokenizer above reads it: a wrapped line of its
 * text indented under the text, past the box — how this repo's task files
 * write a criterion (LAI-302). The library wrote it flush left, which reads
 * back the same; this is what a person would have typed.
 */
const WrappingTaskItem = TaskItem.extend({
  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
    const prefix = `- [${node.attrs?.checked === true ? 'x' : ' '}] `;
    const written = renderNestedMarkdownContent(node, helpers, prefix);
    const first = node.content?.[0];
    if (first === undefined) return written;
    const text = helpers.renderChildren([first]);
    if (!written.startsWith(`${prefix}${text}`)) return written;
    const under = ' '.repeat(prefix.length);
    const wrapped = text
      .split('\n')
      .map((line, n) => (n === 0 || line === '' ? line : `${under}${line}`))
      .join('\n');
    return `${prefix}${wrapped}${written.slice(prefix.length + text.length)}`;
  },
});

/** The schema and the markdown handlers: shared by the editor and the bridge. */
export const MARKDOWN_EXTENSIONS: readonly AnyExtension[] = [
  Kit.configure({
    link: false,
    underline: false,
    trailingNode: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  FaithfulLink,
  WrappingTaskList,
  WrappingTaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
];
