import type { AnyExtension } from '@tiptap/core';
import { Link } from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { StarterKit } from '@tiptap/starter-kit';
import { writesFaithfully } from './markdown-bridge.ts';

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

/** The schema and the markdown handlers: shared by the editor and the bridge. */
export const MARKDOWN_EXTENSIONS: readonly AnyExtension[] = [
  StarterKit.configure({
    link: false,
    underline: false,
    trailingNode: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  FaithfulLink,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
];
