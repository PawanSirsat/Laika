/**
 * Fenced code in a comment (LAI-284).
 *
 * The design quotes a `POST /tasks/…` line in a bordered monospace box; ours
 * rendered `body_md` as one flat paragraph, so a pasted request arrived wrapped
 * into prose.
 *
 * **This is a parser of one construct, not a markdown renderer**, and these
 * tests are what keeps it that way: a comment body is untrusted text written by
 * anyone who can comment, and every construct added here is a new way for it to
 * do something other than be read.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { splitFences } from '../../../../src/routes/screens/task/comment-body.ts';

void describe('splitFences', () => {
  void test('leaves a plain comment as one block', () => {
    const blocks = splitFences('Just a sentence.\nAnd another.');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.kind, 'text');
    assert.equal(blocks[0]?.content, 'Just a sentence.\nAnd another.');
  });

  void test('splits prose, code and prose', () => {
    const blocks = splitFences('Before.\n```\nPOST /tasks\n```\nAfter.');
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['text', 'code', 'text'],
    );
    assert.equal(blocks[1]?.content, 'POST /tasks');
  });

  void test('keeps the language tag when one is given', () => {
    const blocks = splitFences('```http\nGET /health\n```');
    assert.equal(blocks[0]?.language, 'http');
    assert.equal(blocks[0]?.content, 'GET /health');
  });

  void test('has no language when the fence is bare', () => {
    const blocks = splitFences('```\nplain\n```');
    assert.equal(blocks[0]?.language, undefined);
  });

  void test('keeps indentation and blank lines inside code', () => {
    // Code is the one place whitespace is content; trimming it would rewrite
    // what somebody pasted.
    const blocks = splitFences('```\n{\n  "a": 1\n\n  "b": 2\n}\n```');
    assert.equal(blocks[0]?.content, '{\n  "a": 1\n\n  "b": 2\n}');
  });

  void test('an unclosed fence makes the rest code', () => {
    /*
     * What every editor does, and what somebody who opened a fence meant. The
     * alternative — dropping the fence and running the code back into the prose
     * — loses the distinction the author was drawing.
     */
    const blocks = splitFences('Look:\n```\nnever closed');
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['text', 'code'],
    );
    assert.equal(blocks[1]?.content, 'never closed');
  });

  void test('drops nothing but empty text runs', () => {
    const blocks = splitFences('```\ncode\n```\n\n');
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['code'],
    );
  });

  void test('is not a markdown renderer', () => {
    /*
     * **The guard that keeps the surface small.** Bold, links and lists are
     * left exactly as typed; if one of these ever starts passing, someone has
     * begun growing a renderer here and should be made to say so out loud.
     */
    const body = '**bold** [link](http://x) \n- item\n<img src=x onerror=1>';
    const blocks = splitFences(body);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.kind, 'text');
    assert.match(blocks[0]?.content ?? '', /\*\*bold\*\*/);
    assert.match(blocks[0]?.content ?? '', /\[link\]/);
    // The tag survives as characters — React renders these as a text node, so
    // there is no path from a comment to markup.
    assert.match(blocks[0]?.content ?? '', /<img src=x onerror=1>/);
  });
});
