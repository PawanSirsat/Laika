/**
 * Where an upload will land (D-150, LAI-1301): a placeholder that moves with
 * the text, goes when the text around it goes, and is never in the document.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { MARKDOWN_EXTENSIONS } from '../../../../../src/routes/screens/task/editor/extensions.ts';
import {
  placeholderAt,
  uploadPlaceholdersKey,
  uploadPlaceholdersPlugin,
  type PlaceholderAction,
} from '../../../../../src/routes/screens/task/editor/upload-placeholders.ts';

const schema = getSchema([...MARKDOWN_EXTENSIONS]);

/** A one-paragraph document, `text`, with the plugin. */
function stateWith(text: string): EditorState {
  return EditorState.create({
    schema,
    doc: schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }),
    plugins: [uploadPlaceholdersPlugin()],
  });
}

const act = (state: EditorState, action: PlaceholderAction): EditorState =>
  state.apply(state.tr.setMeta(uploadPlaceholdersKey, action));

void describe('an upload’s placeholder', () => {
  void test('sits where it was put, and is found by its id', () => {
    const state = act(stateWith('See the shot'), { add: { id: 1, pos: 5, label: 'shot.png' } });
    assert.equal(placeholderAt(state, 1), 5);
    assert.equal(placeholderAt(state, 2), null);
  });

  void test('moves with text typed before it', () => {
    let state = act(stateWith('See the shot'), { add: { id: 1, pos: 5, label: 'shot.png' } });
    state = state.apply(state.tr.insertText('Do ', 1));
    assert.equal(placeholderAt(state, 1), 8);
  });

  void test('text typed exactly where it sits goes before it: the file lands after', () => {
    let state = act(stateWith('See the shot'), { add: { id: 1, pos: 5, label: 'shot.png' } });
    state = state.apply(state.tr.insertText('new ', 5));
    assert.equal(placeholderAt(state, 1), 9);
  });

  void test('goes when the text around it is deleted', () => {
    let state = act(stateWith('See the shot'), { add: { id: 1, pos: 5, label: 'shot.png' } });
    state = state.apply(state.tr.delete(2, 9));
    assert.equal(placeholderAt(state, 1), null);
  });

  void test('is removed by its id, and the others stay', () => {
    let state = act(stateWith('See the shot'), { add: { id: 1, pos: 5, label: 'a.png' } });
    state = act(state, { add: { id: 2, pos: 9, label: 'b.png' } });
    state = act(state, { remove: 1 });
    assert.equal(placeholderAt(state, 1), null);
    assert.equal(placeholderAt(state, 2), 9);
  });

  void test('is never in the document', () => {
    const before = stateWith('See the shot');
    const after = act(before, { add: { id: 1, pos: 5, label: 'shot.png' } });
    assert.ok(after.doc.eq(before.doc));
  });
});
