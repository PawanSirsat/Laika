import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, attachments, comments, unlistedWork, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  attachmentLinksMarkdown,
  describeTaskFiles,
  listTaskAttachments,
  parseAttachmentCaptions,
  pruneAttachments,
  ATTACHMENT_GRACE_MS,
} from '../../src/services/attachments.ts';
import { createProject } from '../../src/services/projects.ts';
import { listTaskRounds } from '../../src/services/rounds.ts';
import { changeStatus, createTask, finishTask } from '../../src/services/tasks.ts';
import { dismissUnlisted, logUnlistedWork, promoteUnlisted } from '../../src/services/unlisted.ts';
import { fakeAttachments, fakeS3 } from '../helpers/fake-s3.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * An agent's outputs (D-162, LAI-1302) in the services: the links a write
 * carries, checked before it saves; a finish's outputs, which belong to its
 * round through the round's own summary; captions read back out of the text;
 * and an unlisted finding's files — linked, moved on promote, removed on
 * dismiss, and spared by the sweep. Over MCP: `test/mcp/attachment-tools.test.ts`.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let other: string;
let taskId: string;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
  other = createProject(t.sqlite, t.db, owner, { name: 'Other', slug: 'other', prefix: 'OTH' }).id;
  taskId = createTask(t.sqlite, t.db, owner, 'laika', { title: 'A task' }).id;
});
afterEach(() => {
  t.close();
});

/** A file in the store, as `completeAttachment` leaves one. */
function file(values: Partial<typeof attachments.$inferInsert> = {}): string {
  const id = newId();
  const projectId = values.projectId ?? s.projectId;
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
      ...values,
    })
    .run();
  return id;
}

const row = (id: string) => t.db.select().from(attachments).where(eq(attachments.id, id)).get()!;
const url = (id: string) => `/api/v1/attachments/${id}/content`;

/** The §6.3 refusal a call throws, or a failure naming what it returned instead. */
function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a refusal, and the call succeeded');
}

describe('attachmentLinksMarkdown — the links a write carries (D-162)', () => {
  const target = () => ({ projectId: s.projectId, taskId });

  it('writes an image as an image and anything else as a link, captioned, under a label', () => {
    const shot = file();
    const sheet = file({ filename: 'accounts.csv', contentType: 'text/csv', inline: 0 });
    const pdf = file({ filename: 'report.pdf', contentType: 'application/pdf', inline: 1 });

    expect(
      attachmentLinksMarkdown(
        t.db,
        owner,
        target(),
        [
          { attachment: shot, caption: 'Board,  dark\n390 px' },
          { attachment: sheet, caption: 'Accounts [masked]' },
          { attachment: pdf, caption: 'Run report' },
          { attachment: shot, caption: 'the same file again' },
        ],
        'Outputs',
      ),
    ).toBe(
      [
        '**Outputs**',
        '',
        `- ![Board, dark 390 px](${url(shot)})`,
        `- [Accounts \\[masked\\]](${url(sheet)})`,
        `- [Run report](${url(pdf)})`,
      ].join('\n'),
    );
  });

  it('writes nothing for no files, and changes no row', () => {
    const shot = file();
    expect(attachmentLinksMarkdown(t.db, owner, target(), [], 'Outputs')).toBe('');
    attachmentLinksMarkdown(t.db, owner, target(), [{ attachment: shot, caption: 'x' }], 'O');
    expect(row(shot).taskId).toBeNull();
  });

  it('refuses a file of another project, another task, a finding, or one not ready', () => {
    const otherTask = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Other task' }).id;
    const finding = logUnlistedWork(t.db, owner, { repo: 'kvell/laika', note: 'n' }).id;
    const cases: [string, string][] = [
      [file({ projectId: other }), 'other_project'],
      [file({ taskId: otherTask }), 'other_task'],
      [file({ unlistedWorkId: finding }), 'on_unlisted_work'],
      [file({ state: 'pending', readyAt: null }), 'not_ready'],
    ];
    for (const [id, reason] of cases) {
      const error = refusal(() =>
        attachmentLinksMarkdown(t.db, owner, target(), [{ attachment: id, caption: 'c' }], 'O'),
      );
      expect(error.code, reason).toBe('unprocessable');
      expect(error.details, reason).toMatchObject({
        field: 'attachments',
        attachment_id: id,
        reason,
      });
    }
  });

  it('answers a missing or removed file as the same 404', () => {
    const gone = file({ deletedAt: 2000, deletedBy: s.userId });
    for (const id of [gone, newId()]) {
      expect(
        refusal(() =>
          attachmentLinksMarkdown(t.db, owner, target(), [{ attachment: id, caption: 'c' }], 'O'),
        ).code,
      ).toBe('not_found');
    }
  });

  it('takes a file the task already has, and one with no task yet for a task about to exist', () => {
    const named = file({ taskId });
    const loose = file();
    expect(
      attachmentLinksMarkdown(t.db, owner, target(), [{ attachment: named, caption: 'a' }], 'O'),
    ).toContain(url(named));
    expect(
      attachmentLinksMarkdown(
        t.db,
        owner,
        { projectId: s.projectId, taskId: null },
        [{ attachment: loose, caption: 'b' }],
        'O',
      ),
    ).toContain(url(loose));
  });
});

describe('finish_task outputs belong to the task, its comment and its round', () => {
  function finish(outputs: { attachment: string; caption: string }[], summary = 'Done') {
    return finishTask(t.sqlite, t.db, owner, taskId, { summary, outputs, now: 5000 });
  }

  beforeEach(() => {
    changeStatus(t.db, owner, taskId, 'in_progress', 4000);
  });

  it('appends them to the summary, links each, and the round’s summary embeds them', () => {
    const shot = file();
    const sheet = file({ filename: 'export.csv', contentType: 'text/csv', inline: 0 });
    finish([
      { attachment: shot, caption: 'After, light' },
      { attachment: sheet, caption: 'The export, masked' },
    ]);

    const comment = t.db.select().from(comments).where(eq(comments.taskId, taskId)).all().at(-1)!;
    expect(comment.bodyMd).toBe(
      [
        'Done',
        '',
        '**Outputs**',
        '',
        `- ![After, light](${url(shot)})`,
        `- [The export, masked](${url(sheet)})`,
      ].join('\n'),
    );
    for (const id of [shot, sheet]) {
      expect(row(id)).toMatchObject({ taskId, commentId: comment.id });
    }
    const [round] = listTaskRounds(t.db, owner, taskId).rounds;
    expect(round?.summary_md).toBe(comment.bodyMd);
    expect(
      t.db
        .select()
        .from(activity)
        .all()
        .filter((a) => a.type === 'attachment.added'),
    ).toHaveLength(2);
  });

  it('refuses the whole finish when one output is another project’s — nothing moves', () => {
    const theirs = file({ projectId: other });
    expect(refusal(() => finish([{ attachment: theirs, caption: 'x' }])).details).toMatchObject({
      reason: 'other_project',
    });
    expect(listTaskRounds(t.db, owner, taskId).rounds).toEqual([]);
    expect(t.db.select().from(comments).where(eq(comments.taskId, taskId)).all()).toEqual([]);
  });

  it('gives each file its round and its caption back, as get_task_context lists them', () => {
    const first = file();
    finish([{ attachment: first, caption: 'Round one shot' }]);
    changeStatus(t.db, owner, taskId, 'in_progress', 6000);
    const second = file({ filename: 'demo.mp4', contentType: 'video/mp4' });
    finishTask(t.sqlite, t.db, owner, taskId, {
      summary: 'Again',
      outputs: [{ attachment: second, caption: 'Recording [short]' }],
      now: 7000,
    });
    const elsewhere = file({ taskId, filename: 'notes.txt', contentType: 'text/plain' });

    const listed = describeTaskFiles(
      listTaskAttachments(t.db, owner, { config: fakeAttachments() }, taskId).data,
      t.db
        .select()
        .from(comments)
        .where(eq(comments.taskId, taskId))
        .all()
        .map((c) => c.bodyMd),
      listTaskRounds(t.db, owner, taskId).rounds,
    );
    expect(listed.map((f) => [f.id, f.caption, f.round])).toEqual([
      [first, 'Round one shot', 1],
      [second, 'Recording [short]', 2],
      [elsewhere, null, null],
    ]);
    expect(listed[1]).toMatchObject({
      filename: 'demo.mp4',
      content_type: 'video/mp4',
      size_bytes: 20,
      url: url(second),
    });
  });
});

describe('parseAttachmentCaptions', () => {
  it('reads the first non-empty caption of each file, images and links, escapes undone', () => {
    const a = newId();
    const b = newId();
    expect(
      parseAttachmentCaptions([
        `![](/api/v1/attachments/${a}/content)`,
        null,
        `see [Run \\[2\\]](https://ksage.example/api/v1/attachments/${b}/content) and ![A shot](/api/v1/attachments/${a}/content "title")`,
        `[later](/api/v1/attachments/${b}/content)`,
      ]),
    ).toEqual(
      new Map([
        [b, 'Run [2]'],
        [a, 'A shot'],
      ]),
    );
  });
});

describe('an unlisted finding’s files (D-162 item 8)', () => {
  it('links the agent’s own ready files to the finding, and its note carries them', () => {
    const shot = file();
    const logged = logUnlistedWork(t.db, owner, {
      repo: 'kvell/laika',
      note: 'The build script fails on Linux',
      attachments: [{ attachment: shot, caption: 'The failing run' }],
    });
    expect(row(shot).unlistedWorkId).toBe(logged.id);
    expect(logged.note).toBe(
      `The build script fails on Linux\n\n**Attached**\n\n- ![The failing run](${url(shot)})`,
    );
  });

  it('refuses another person’s upload, or one already on a task, and logs nothing', () => {
    const brin = newId();
    t.db
      .insert(users)
      .values({
        id: brin,
        email: 'brin@example.test',
        name: 'Brin',
        orgRole: 'member',
        isActive: 1,
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
      })
      .run();
    for (const [id, reason] of [
      [file({ uploadedBy: brin }), 'not_uploader'],
      [file({ taskId }), 'other_task'],
    ] as const) {
      const error = refusal(() =>
        logUnlistedWork(t.db, owner, {
          repo: 'kvell/laika',
          note: 'n',
          attachments: [{ attachment: id, caption: 'c' }],
        }),
      );
      expect(error.details, reason).toMatchObject({ reason });
      expect(row(id).unlistedWorkId, reason).toBeNull();
    }
    expect(t.db.select().from(unlistedWork).all()).toEqual([]);
  });

  it('moves them to the task a promotion makes — from another project too — with attachment.added', () => {
    const same = file();
    const elsewhere = file({ projectId: other, filename: 'trace.log', contentType: 'text/plain' });
    const logged = logUnlistedWork(t.db, owner, {
      repo: 'kvell/laika',
      note: 'n',
      attachments: [
        { attachment: same, caption: 'Here' },
        { attachment: elsewhere, caption: 'There' },
      ],
    });

    const { task } = promoteUnlisted(t.sqlite, t.db, owner, logged.id, {
      projectSlug: 'laika',
      title: 'Fix the build',
      now: 9000,
    });

    expect(row(same)).toMatchObject({ projectId: s.projectId, taskId: task.id });
    expect(row(elsewhere)).toMatchObject({ projectId: s.projectId, taskId: task.id });
    expect(task.description_md).toContain(url(same));
    const added = t.db
      .select()
      .from(activity)
      .all()
      .filter((a) => a.type === 'attachment.added' && a.taskId === task.id);
    const ids = added.map(
      (a) => (JSON.parse(a.payloadJson) as { attachment_id: string }).attachment_id,
    );
    expect(ids.sort()).toEqual([same, elsewhere].sort());
  });

  it('removes them when it is dismissed, and the sweep then deletes the objects', async () => {
    const shot = file();
    const logged = logUnlistedWork(t.db, owner, {
      repo: 'kvell/laika',
      note: 'n',
      attachments: [{ attachment: shot, caption: 'c' }],
    });
    dismissUnlisted(t.db, owner, logged.id, 9000);
    expect(row(shot)).toMatchObject({ deletedAt: 9000, deletedBy: s.userId, purgedAt: null });

    const fake = fakeS3();
    const deps = { config: fakeAttachments(), fetchImpl: fake.fetchImpl };
    await pruneAttachments(t.db, deps, 9000 + ATTACHMENT_GRACE_MS);
    expect(row(shot).purgedAt).toBe(9000 + ATTACHMENT_GRACE_MS);
  });

  it('is linked as far as the sweep is concerned, a day and more after it was ready', async () => {
    const shot = file();
    logUnlistedWork(t.db, owner, {
      repo: 'kvell/laika',
      note: 'n',
      attachments: [{ attachment: shot, caption: 'c' }],
    });
    const loose = file();
    const fake = fakeS3();
    const deps = { config: fakeAttachments(), fetchImpl: fake.fetchImpl };

    await pruneAttachments(t.db, deps, 1000 + 3 * ATTACHMENT_GRACE_MS);
    expect(row(shot).deletedAt).toBeNull();
    // The control: a file nothing linked, as old, is removed by the same run.
    expect(row(loose).deletedAt).toBe(1000 + 3 * ATTACHMENT_GRACE_MS);
  });
});
