/**
 * `src/api/comments.ts` (LAI-056).
 *
 * Two things worth pinning: tombstones are removals, and "was this an agent?"
 * comes from `created_via` because `CommentView` carries no `actor_kind`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isAgentComment,
  isComment,
  isCommentTombstone,
  type Comment,
  type CommentRow,
} from '../../src/api/comments.ts';

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    task_id: 't1',
    author_id: 'u1',
    body_md: 'A comment.',
    created_via: 'web',
    edited_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

void describe('tombstones', () => {
  void test('a tombstone is recognised and a comment is not', () => {
    assert.equal(isCommentTombstone({ id: 'c1', deleted: true }), true);
    assert.equal(isCommentTombstone(comment()), false);
  });

  void test('isComment narrows in a filter, where negating the other does not', () => {
    const rows: CommentRow[] = [{ id: 'gone', deleted: true }, comment({ body_md: 'Kept.' })];
    assert.deepEqual(
      rows.filter(isComment).map((c) => c.body_md),
      ['Kept.'],
    );
  });

  void test('a deleted comment never reaches the thread', () => {
    // Rendering one gives an empty bubble with no author, which reads as a bug.
    const rows: CommentRow[] = [{ id: 'gone', deleted: true }];
    assert.deepEqual(rows.filter(isComment), []);
  });
});

void describe('isAgentComment', () => {
  void test('mcp means an agent wrote it', () => {
    assert.equal(isAgentComment(comment({ created_via: 'mcp' })), true);
  });

  void test('web and api are not agents', () => {
    // `api` is a token-authenticated human script as often as not, and the
    // badge claims something specific. Only MCP is unambiguously an agent.
    assert.equal(isAgentComment(comment({ created_via: 'web' })), false);
    assert.equal(isAgentComment(comment({ created_via: 'api' })), false);
  });

  void test('an unknown transport is not badged', () => {
    assert.equal(isAgentComment(comment({ created_via: 'carrier-pigeon' })), false);
  });
});
