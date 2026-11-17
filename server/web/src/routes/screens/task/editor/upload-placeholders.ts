import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Where an upload will land, while it is on its way (D-150, LAI-1301).
 *
 * **A decoration, never a node** — the shape of `mention-pills.ts`. A
 * placeholder is not in the document, so nothing a save writes can carry it,
 * and the round-trip guard compares exactly what it compared before. It is a
 * widget at a position that **moves with the text**: type above it, and it
 * moves down; delete the text around it, and it goes, and the file lands at
 * the caret instead.
 *
 * When the file arrives, the editor asks {@link placeholderAt} where it is
 * now, removes it, and puts the image or the link there.
 */

export const uploadPlaceholdersKey = new PluginKey<DecorationSet>('uploadPlaceholders');

/** What a transaction tells the plugin: put one down, or take one away. */
export type PlaceholderAction =
  | { readonly add: { readonly id: number; readonly pos: number; readonly label: string } }
  | { readonly remove: number };

/** Is this decoration's spec placeholder `id`'s? */
const isPlaceholder =
  (id: number) =>
  (spec: { readonly id?: unknown }): boolean =>
    spec.id === id;

/** The widget a placeholder draws: `Uploading shot.png…`, in the line. */
function widget(label: string): () => HTMLElement {
  return () => {
    const element = document.createElement('span');
    element.className = 'rte-uploading';
    element.setAttribute('contenteditable', 'false');
    element.textContent = `Uploading ${label}…`;
    return element;
  };
}

/** The placeholders after `tr`: moved with its changes, then its action applied. */
export function applyPlaceholders(set: DecorationSet, tr: Transaction): DecorationSet {
  let next = set.map(tr.mapping, tr.doc);
  const action = tr.getMeta(uploadPlaceholdersKey) as PlaceholderAction | undefined;
  if (action === undefined) return next;
  if ('add' in action) {
    const pos = Math.max(0, Math.min(action.add.pos, tr.doc.content.size));
    next = next.add(tr.doc, [
      Decoration.widget(pos, widget(action.add.label), {
        id: action.add.id,
        key: `upload-${String(action.add.id)}`,
        // Text typed exactly where it sits goes before it: the file lands after.
        side: 1,
      }),
    ]);
  } else {
    next = next.remove(next.find(undefined, undefined, isPlaceholder(action.remove)));
  }
  return next;
}

/** Where placeholder `id` is now, or `null` when the text around it was deleted. */
export function placeholderAt(state: EditorState, id: number): number | null {
  const set = uploadPlaceholdersKey.getState(state);
  const found = set?.find(undefined, undefined, isPlaceholder(id)) ?? [];
  return found[0]?.from ?? null;
}

/** The ProseMirror plugin: the placeholders, drawn. */
export function uploadPlaceholdersPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadPlaceholdersKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => applyPlaceholders(set, tr),
    },
    props: {
      decorations: (state) => uploadPlaceholdersKey.getState(state),
    },
  });
}

/** The plugin, as an extension beside the pills — not in the bridge's schema. */
export const UploadPlaceholders = Extension.create({
  name: 'uploadPlaceholders',
  addProseMirrorPlugins() {
    return [uploadPlaceholdersPlugin()];
  },
});
