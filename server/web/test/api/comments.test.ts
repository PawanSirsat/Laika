/**
 * `src/api/comments.ts` (LAI-056).
 *
 * Two things worth pinning: tombstones are removals, and "was this an agent?"
 * comes from `created_via` because `CommentView` carries no `actor_kind`.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import {
  deleteComment,
  editComment,
  isAgentComment,
  mayChangeComment,
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
    sent_back: false,
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

interface Captured {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

void describe('editing and deleting a comment (LAI-1122)', () => {
  void test('an edit is a PATCH of the comment with only its new text', async () => {
    const calls = stub(200, comment({ body_md: 'Fixed.', edited_at: 5 }));
    const answer = await editComment('c 1', 'Fixed.');
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/api\/v1\/comments\/c%201$/);
    assert.equal(calls[0]!.init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { body_md: 'Fixed.' });
    assert.equal(answer.edited_at, 5);
  });

  void test('a delete is a DELETE of the comment, and its 204 is an answer', async () => {
    const calls = stub(204, null);
    assert.equal(await deleteComment('c1'), undefined);
    assert.match(calls[0]!.url, /\/api\/v1\/comments\/c1$/);
    assert.equal(calls[0]!.init?.method, 'DELETE');
    assert.equal(calls[0]!.init?.body, undefined);
  });

  void test('a mirrored comment’s refusal reaches the caller with its reason', async () => {
    stub(409, {
      error: {
        code: 'conflict',
        message: 'A mirrored comment has no author and cannot be changed here',
        details: { reason: 'no_local_author' },
      },
    });
    await assert.rejects(editComment('c1', 'x'), (cause: unknown) => {
      assert.ok(cause instanceof ApiError);
      assert.equal(cause.status, 409);
      assert.equal(cause.message, 'A mirrored comment has no author and cannot be changed here');
      return true;
    });
  });
});

void describe('mayChangeComment', () => {
  void test('the author, and a lead for anyone’s; never a comment with no local author', () => {
    assert.equal(mayChangeComment({ author_id: 'u1' }, 'u1', false), true);
    assert.equal(mayChangeComment({ author_id: 'u2' }, 'u1', false), false);
    assert.equal(mayChangeComment({ author_id: 'u2' }, 'u1', true), true);
    assert.equal(mayChangeComment({ author_id: 'u2' }, undefined, false), false);
    assert.equal(mayChangeComment({ author_id: null }, 'u1', true), false);
  });
});
