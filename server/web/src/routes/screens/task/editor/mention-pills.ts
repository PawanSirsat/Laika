import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMentions, mentionClass, mentionKind, type MentionDirectory } from '../mentions.ts';

/**
 * `@name` pills while editing (LAI-868), drawn as the reading view draws them.
 *
 * **A decoration, never a mark or a node.** A decoration is how the view
 * paints a range; it is not in the document, so the schema, the parse and the
 * Markdown the bridge writes are the same with it as without it, and the
 * round-trip guard (LAI-827, LAI-849) compares exactly what it compared
 * before. That is why this sits beside `Placeholder` in the editor and not in
 * `MARKDOWN_EXTENSIONS`, which is the bridge's schema.
 *
 * The rules are `../mentions.ts`: the server's grammar, a pill only for a
 * handle exactly one person holds, the machines softer. Like the reading view,
 * a mention inside code or a link's words is not one, and each run of text is
 * matched on its own, so `**@grace**` is a mention here as it is there.
 */

export const mentionPillsKey = new PluginKey<DecorationSet>('mentionPills');

/** Marks whose text is never a pill: code shows `@` literally, a link has a target. */
const NO_MENTIONS_UNDER = new Set(['code', 'link']);

/** The pill for each mention in `doc` that names somebody. */
export function mentionDecorations(
  doc: ProseMirrorNode,
  directory: MentionDirectory,
): DecorationSet {
  const pills: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code === true) return false;
    if (!node.isText || node.text === undefined) return true;
    if (node.marks.some((mark) => NO_MENTIONS_UNDER.has(mark.type.name))) return false;
    for (const found of findMentions(node.text)) {
      const kind = mentionKind(found.handle, directory);
      if (kind === null) continue;
      pills.push(
        Decoration.inline(
          pos + found.start,
          pos + found.end,
          { class: mentionClass(kind) },
          { mention: kind },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, pills);
}

/**
 * Ask the editor to draw the pills again, with no change to the document:
 * the people list arrived, or the reader did.
 */
export function redrawMentions(tr: Transaction): Transaction {
  return tr.setMeta(mentionPillsKey, true).setMeta('addToHistory', false);
}

export interface MentionPillsOptions {
  /** Read on every redraw: the editor is built once, the people list later. */
  readonly directory: () => MentionDirectory;
}

export const MentionPills = Extension.create<MentionPillsOptions>({
  name: 'mentionPills',

  addOptions() {
    return { directory: () => ({ people: [] }) };
  },

  addProseMirrorPlugins() {
    const read = this.options.directory;
    return [
      new Plugin<DecorationSet>({
        key: mentionPillsKey,
        state: {
          init: (_config, state) => mentionDecorations(state.doc, read()),
          apply: (tr, pills) =>
            tr.docChanged || tr.getMeta(mentionPillsKey) === true
              ? mentionDecorations(tr.doc, read())
              : pills,
        },
        props: {
          decorations: (state) => mentionPillsKey.getState(state),
        },
      }),
    ];
  },
});
