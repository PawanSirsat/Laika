import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, attachments, users } from '../../src/db/schema.ts';
import {
  ATTACHMENT_GRACE_MS,
  contentDisposition,
  parseAttachmentRefs,
  pruneAttachments,
  sniffInlineType,
} from '../../src/services/attachments.ts';
import { addComment, deleteComment, editComment } from '../../src/services/comments.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask, updateTask } from '../../src/services/tasks.ts';
import { fakeAttachments, fakeS3, type FakeS3 } from '../helpers/fake-s3.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * The rules of `services/attachments.ts` that need no HTTP (D-150, LAI-1300):
 * what the first bytes say, what text links, what a deleted comment takes
 * with it, and §11.6's sweep. The routes are `test/http/routes/attachments.test.ts`.
 */

const bytes = (...values: number[]) =>
  new Uint8Array([...values, ...new Array<number>(16).fill(0)]);
const text = (value: string) => new TextEncoder().encode(value.padEnd(16, ' '));

describe('sniffInlineType — the five a browser may show, by their first bytes', () => {
  it('knows each of them', () => {
    expect(sniffInlineType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    expect(sniffInlineType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffInlineType(text('GIF89a'))).toBe('image/gif');
    expect(sniffInlineType(text('GIF87a'))).toBe('image/gif');
    expect(sniffInlineType(text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffInlineType(text('%PDF-1.7'))).toBe('application/pdf');
  });

  it('knows nothing else — HTML and SVG above all', () => {
    expect(sniffInlineType(text('<html><body>'))).toBeNull();
    expect(sniffInlineType(text('<svg xmlns="h">'))).toBeNull();
    expect(sniffInlineType(text('RIFF....WAVEfmt '))).toBeNull();
    expect(sniffInlineType(new Uint8Array())).toBeNull();
  });
});

describe('contentDisposition — RFC 6266, ASCII on the wire', () => {
  it('keeps a plain name, and gives any other an ASCII fallback beside the UTF-8 one', () => {
    expect(contentDisposition('attachment', 'report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    const odd = contentDisposition('inline', 'Résumé "final" (2).png');
    expect(odd).toBe(
      `inline; filename="R_sum_ _final_ (2).png"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22%20%282%29.png`,
    );
    expect(/^[\x20-\x7e]+$/.test(odd)).toBe(true);
  });

  it('folds a run of spaces in the fallback, as SigV4 folds the header it signs', () => {
    const spaced = contentDisposition('attachment', 'a  b.png');
    expect(spaced).toBe(`attachment; filename="a b.png"; filename*=UTF-8''a%20%20b.png`);
    expect(spaced).not.toContain('  ');
  });

  it('carries a name with a lone surrogate as U+FFFD rather than throwing (LAI-1315 M1)', () => {
    expect(contentDisposition('attachment', 'a\uD83D.png')).toBe(
      `attachment; filename="a_.png"; filename*=UTF-8''a%EF%BF%BD.png`,
    );
    // A pair is one character, and is kept.
    expect(contentDisposition('attachment', '😀')).toContain(`UTF-8''%F0%9F%98%80`);
  });
});

describe('parseAttachmentRefs', () => {
  const ID = '01JD3ZQ6V7X8Y9Z0A1B2C3D4E5';
  const OTHER = '01JD3ZQ6V7X8Y9Z0A1B2C3D4E6';

  it('reads Laika’s path, relative or on any origin, once each, in order', () => {
    expect(
      parseAttachmentRefs(
        `![shot](/api/v1/attachments/${ID}/content) and [the sheet](https://board.example.test/api/v1/attachments/${OTHER}/content) and again (/api/v1/attachments/${ID}/content)`,
      ),
    ).toEqual([ID, OTHER]);
  });

  it('does not read a longer path, another verb, a lower-case id or nothing', () => {
    expect(parseAttachmentRefs(`/files/api/v1/attachments/${ID}/content`)).toEqual([]);
    expect(parseAttachmentRefs(`/api/v1/attachments/${ID}/complete`)).toEqual([]);
    expect(parseAttachmentRefs(`/api/v1/attachments/${ID}/contents`)).toEqual([]);
    expect(parseAttachmentRefs(`/api/v1/attachments/${ID.toLowerCase()}/content`)).toEqual([]);
    expect(parseAttachmentRefs(null)).toEqual([]);
  });
});

describe('linking from text, and a deleted comment’s files', () => {
  let t: TestDb;
  let s: Seed;
  let owner: ResolvedActor;
  let other: string;

  beforeEach(() => {
    t = freshDb();
    s = seed(t.db);
    owner = loadActor(t.db, s.userId)!;
    other = createProject(t.sqlite, t.db, owner, {
      name: 'Other',
      slug: 'other',
      prefix: 'OTH',
    }).id;
  });
  afterEach(() => {
    t.close();
  });

  /** A file already in the store, as `completeAttachment` leaves one. */
  function file(
    projectId = s.projectId,
    extra: Partial<typeof attachments.$inferInsert> = {},
  ): string {
    const id = newId();
    t.db
      .insert(attachments)
      .values({
        id,
        projectId,
        uploadedBy: s.userId,
        filename: 'shot.png',
        contentType: 'image/png',
        sizeBytes: 20,
        storageKey: `p/${projectId}/${id}`,
        state: 'ready',
        inline: 1,
        createdAt: 1000,
        readyAt: 1000,
        ...extra,
      })
      .run();
    return id;
  }

  const ref = (id: string) => `![shot](/api/v1/attachments/${id}/content)`;
  const row = (id: string) => t.db.select().from(attachments).where(eq(attachments.id, id)).get()!;
  const added = () =>
    t.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.type === 'attachment.added');
  const removed = () =>
    t.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.type === 'attachment.removed');

  it('links a file of the same project on create, once, and not another project’s or a pending one', () => {
    const mine = file();
    const theirs = file(other);
    const pending = file(s.projectId, { state: 'pending', readyAt: null });

    const task = createTask(t.sqlite, t.db, owner, 'laika', {
      title: 'With a screenshot',
      description_md: `${ref(mine)} ${ref(theirs)}`,
      acceptance_md: ref(pending),
    });

    expect(row(mine).taskId).toBe(task.id);
    expect(row(theirs).taskId).toBeNull();
    expect(row(pending).taskId).toBeNull();
    expect(added()).toHaveLength(1);
    expect(added()[0]).toMatchObject({
      taskId: task.id,
      actorId: s.userId,
      projectId: s.projectId,
    });
    expect(JSON.parse(added()[0]!.payloadJson)).toEqual({
      attachment_id: mine,
      filename: 'shot.png',
      content_type: 'image/png',
      size_bytes: 20,
    });

    // Saved again: the file already belongs here, so nothing more is written.
    updateTask(t.db, owner, task.id, { description_md: `${ref(mine)} edited` });
    expect(added()).toHaveLength(1);
  });

  it('never relinks a file another task has, from text or from a comment', () => {
    const first = createTask(t.sqlite, t.db, owner, 'laika', { title: 'First' });
    const second = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Second' });
    const id = file(s.projectId, { taskId: first.id });

    updateTask(t.db, owner, second.id, { acceptance_md: ref(id) });
    addComment(t.db, owner, second.id, ref(id));

    expect(row(id)).toMatchObject({ taskId: first.id, commentId: null });
    expect(added()).toHaveLength(0);
  });

  it('links on an edit of the text, and a comment fills the task and the comment', () => {
    const task = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Plain' });
    const viaEdit = file();
    const viaComment = file();
    const viaCommentEdit = file();

    updateTask(t.db, owner, task.id, { description_md: ref(viaEdit) });
    const comment = addComment(t.db, owner, task.id, `See ${ref(viaComment)}`);
    editComment(t.db, owner, comment.id, `See ${ref(viaComment)} and ${ref(viaCommentEdit)}`);

    expect(row(viaEdit)).toMatchObject({ taskId: task.id, commentId: null });
    expect(row(viaComment)).toMatchObject({ taskId: task.id, commentId: comment.id });
    expect(row(viaCommentEdit)).toMatchObject({ taskId: task.id, commentId: comment.id });
    expect(
      added().map((a) => (JSON.parse(a.payloadJson) as { attachment_id: string }).attachment_id),
    ).toEqual([viaEdit, viaComment, viaCommentEdit]);
  });

  it('takes a deleted comment’s files with it — only the ones nothing else on the task embeds', () => {
    const task = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Thread' });
    const onlyHere = file();
    const alsoInDescription = file();
    const alsoInAnother = file();
    const comment = addComment(
      t.db,
      owner,
      task.id,
      [onlyHere, alsoInDescription, alsoInAnother].map(ref).join(' '),
    );
    updateTask(t.db, owner, task.id, { description_md: ref(alsoInDescription) });
    addComment(t.db, owner, task.id, ref(alsoInAnother));

    deleteComment(t.db, owner, comment.id);

    expect(row(onlyHere)).toMatchObject({ deletedBy: s.userId, purgedAt: null });
    expect(row(onlyHere).deletedAt).not.toBeNull();
    expect(row(alsoInDescription).deletedAt).toBeNull();
    expect(row(alsoInAnother).deletedAt).toBeNull();
    expect(
      removed().map((a) => (JSON.parse(a.payloadJson) as { attachment_id: string }).attachment_id),
    ).toEqual([onlyHere]);
  });
});

describe('a comment delete takes only what the deleter may remove (LAI-1300 review)', () => {
  let t: TestDb;
  let s: Seed;
  let alice: string;
  let bob: string;
  let taskId: string;

  /** A member of `laika`, as the API would make one. */
  function member(name: string): string {
    const id = newId();
    t.db
      .insert(users)
      .values({
        id,
        email: `${name}@example.test`,
        name,
        orgRole: 'member',
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
      })
      .run();
    addMember(t.db, loadActor(t.db, s.userId)!, 'laika', id, 'member');
    return id;
  }
  const as = (id: string) => loadActor(t.db, id)!;

  beforeEach(() => {
    t = freshDb();
    s = seed(t.db);
    alice = member('alice');
    bob = member('bob');
    taskId = createTask(t.sqlite, t.db, as(alice), 'laika', { title: 'T' }).id;
  });
  afterEach(() => {
    t.close();
  });

  function file(uploadedBy: string, taskIdAtUpload: string | null): string {
    const id = newId();
    t.db
      .insert(attachments)
      .values({
        id,
        projectId: s.projectId,
        taskId: taskIdAtUpload,
        uploadedBy,
        filename: 'spec.pdf',
        contentType: 'application/pdf',
        sizeBytes: 20,
        storageKey: `p/${s.projectId}/${id}`,
        state: 'ready',
        inline: 1,
        createdAt: 1000,
        readyAt: 1000,
      })
      .run();
    return id;
  }
  const ref = (id: string) => `[spec](/api/v1/attachments/${id}/content)`;
  const row = (id: string) => t.db.select().from(attachments).where(eq(attachments.id, id)).get()!;
  const removedRows = () =>
    t.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.type === 'attachment.removed');

  it('keeps a file that came to the task by its upload when another member deletes the comment quoting it', () => {
    // Alice attaches to the task itself — the panel's Attach files, `task_id` named.
    const alices = file(alice, taskId);

    const comment = addComment(t.db, as(bob), taskId, `See ${ref(alices)}`);
    // The comment was not first to link it, so it is not the comment's.
    expect(row(alices).commentId).toBeNull();
    deleteComment(t.db, as(bob), comment.id);

    expect(row(alices).deletedAt).toBeNull();
    expect(removedRows()).toEqual([]);
  });

  it('keeps another member’s file even when the deleter’s comment was first to link it', () => {
    // Alice uploaded without a task; Bob's comment is what put it on the task.
    const alices = file(alice, null);
    const comment = addComment(t.db, as(bob), taskId, `See ${ref(alices)}`);
    expect(row(alices)).toMatchObject({ taskId, commentId: comment.id });

    deleteComment(t.db, as(bob), comment.id);

    // `attachment.delete` is own-only for a member: the file stays.
    expect(row(alices).deletedAt).toBeNull();
    expect(removedRows()).toEqual([]);
  });

  it('still takes the deleter’s own file their comment first linked', () => {
    const bobs = file(bob, null);
    const comment = addComment(t.db, as(bob), taskId, `See ${ref(bobs)}`);

    deleteComment(t.db, as(bob), comment.id);

    expect(row(bobs)).toMatchObject({ deletedBy: bob });
    expect(row(bobs).deletedAt).not.toBeNull();
    expect(
      removedRows().map(
        (a) => (JSON.parse(a.payloadJson) as { attachment_id: string }).attachment_id,
      ),
    ).toEqual([bobs]);
  });
});

describe('the sweep (§11.6, attachment.prune)', () => {
  const NOW = 10 * ATTACHMENT_GRACE_MS;
  const OLD = NOW - ATTACHMENT_GRACE_MS - 1;
  const RECENT = NOW - ATTACHMENT_GRACE_MS + 60_000;

  let t: TestDb;
  let s: Seed;
  let fake: FakeS3;
  let taskId: string;

  beforeEach(() => {
    t = freshDb();
    s = seed(t.db);
    fake = fakeS3();
    taskId = createTask(t.sqlite, t.db, loadActor(t.db, s.userId)!, 'laika', { title: 'T' }).id;
  });
  afterEach(() => {
    t.close();
  });

  const deps = () => ({ config: fakeAttachments(), fetchImpl: fake.fetchImpl });

  /** A row and, unless it is said otherwise, its object in the store. */
  function file(values: Partial<typeof attachments.$inferInsert>, stored = true): string {
    const id = newId();
    const storageKey = `p/${s.projectId}/${id}`;
    t.db
      .insert(attachments)
      .values({
        id,
        projectId: s.projectId,
        uploadedBy: s.userId,
        filename: 'f.bin',
        contentType: 'application/octet-stream',
        sizeBytes: 3,
        storageKey,
        state: 'ready',
        inline: 0,
        createdAt: OLD,
        readyAt: OLD,
        ...values,
      })
      .run();
    if (stored) {
      fake.objects.set(storageKey, {
        body: new Uint8Array(3),
        contentType: 'application/octet-stream',
        contentDisposition: 'attachment',
      });
    }
    return id;
  }

  const row = (id: string) => t.db.select().from(attachments).where(eq(attachments.id, id)).get();
  const stored = (id: string) => fake.objects.has(`p/${s.projectId}/${id}`);

  it('deletes an abandoned upload, removes an unlinked file, and purges what was removed', async () => {
    const abandoned = file({ state: 'pending', readyAt: null });
    const neverUploaded = file({ state: 'pending', readyAt: null }, false);
    const unlinked = file({});
    const removed = file({ taskId, deletedAt: OLD, deletedBy: s.userId });
    const activityBefore = t.db.select().from(activity).all().length;

    expect(await pruneAttachments(t.db, deps(), NOW)).toEqual({ changed: 5 });

    expect(row(abandoned)).toBeUndefined();
    expect(stored(abandoned)).toBe(false);
    expect(row(neverUploaded)).toBeUndefined();
    // Removed by nobody, and its object gone in the same run.
    expect(row(unlinked)).toMatchObject({ deletedAt: NOW, deletedBy: null, purgedAt: NOW });
    expect(stored(unlinked)).toBe(false);
    expect(row(removed)).toMatchObject({ purgedAt: NOW });
    expect(stored(removed)).toBe(false);
    // Nobody did it, so no activity.
    expect(t.db.select().from(activity).all()).toHaveLength(activityBefore);

    // Idempotent: the second run finds nothing.
    expect(await pruneAttachments(t.db, deps(), NOW)).toEqual({ changed: 0 });
  });

  it('never touches a ready, linked, live file — nor anything younger than a day', async () => {
    const live = file({ taskId });
    const youngPending = file({ state: 'pending', readyAt: null, createdAt: RECENT });
    const youngUnlinked = file({ createdAt: RECENT, readyAt: RECENT });

    expect(await pruneAttachments(t.db, deps(), NOW)).toEqual({ changed: 0 });

    for (const id of [live, youngPending, youngUnlinked]) {
      expect(row(id)?.deletedAt, id).toBeNull();
      expect(stored(id), id).toBe(true);
    }
    expect(fake.of('DELETE')).toEqual([]);
  });

  it('stops asking the store at its first failure, and leaves the rows for the next run', async () => {
    const abandoned = [1, 2, 3].map(() => file({ state: 'pending', readyAt: null }));
    const removed = file({ taskId, deletedAt: OLD, deletedBy: s.userId });
    const unlinked = file({});
    fake.intercept = () => new Response('STORE-SECRET-WORDS', { status: 500 });

    // Only the unlinked file's stamp — the database's part — changes.
    expect(await pruneAttachments(t.db, deps(), NOW)).toEqual({ changed: 1 });
    // One request: the first failure ended the store's part of the run.
    expect(fake.of('DELETE')).toHaveLength(1);
    for (const id of abandoned) expect(row(id)).toBeDefined();
    expect(row(removed)?.purgedAt).toBeNull();
    expect(row(unlinked)).toMatchObject({ deletedAt: NOW, purgedAt: null });

    fake.intercept = null;
    expect(await pruneAttachments(t.db, deps(), NOW)).toEqual({ changed: 5 });
  });

  it('joins a run still going rather than starting a second', async () => {
    file({ state: 'pending', readyAt: null });
    fake.intercept = () => 'hang';
    const slow = { ...deps(), timeoutMs: 50 };

    const first = pruneAttachments(t.db, slow, NOW);
    const second = pruneAttachments(t.db, slow, NOW);
    expect(second).toBe(first);
    expect(await first).toEqual({ changed: 0 });
    expect(fake.of('DELETE')).toHaveLength(1);
  });

  it('measures a file nothing linked from when it became ready, not from when it was asked for', async () => {
    // Asked for long ago, completed within the hour it may be: a day from ready.
    const lateReady = file({ createdAt: OLD, readyAt: RECENT });

    expect(await pruneAttachments(t.db, deps(), NOW)).toEqual({ changed: 0 });
    expect(row(lateReady)?.deletedAt).toBeNull();
  });

  it('does nothing, and asks no store, when attachments are off', async () => {
    file({ state: 'pending', readyAt: null });
    expect(await pruneAttachments(t.db, { config: null, fetchImpl: fake.fetchImpl }, NOW)).toEqual({
      changed: 0,
    });
    expect(await pruneAttachments(t.db, undefined, NOW)).toEqual({ changed: 0 });
    expect(fake.requests).toEqual([]);
  });
});
