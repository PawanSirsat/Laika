/**
 * The task panel's Attachments section, as data (D-150, LAI-1301): the rows,
 * who may remove a file, and which live frames are about this task's files.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  attachmentRows,
  attachmentsHeading,
  changesFilesOf,
  mayDeleteAttachment,
  type AttachmentFacts,
} from '../../../../src/routes/screens/task/attachments-derive.ts';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

const file = (over: Partial<AttachmentFacts> = {}): AttachmentFacts => ({
  id: '01JCZ8Y3V4QK9M2N7P5R6S8T0W',
  filename: 'budget.xlsx',
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 14 * 1024,
  uploaded_by: 'u-ada',
  created_at: NOW - 10 * 60_000,
  ready_at: NOW - 5 * 60_000,
  url: '/api/v1/attachments/01JCZ8Y3V4QK9M2N7P5R6S8T0W/content',
  ...over,
});

void describe('who may remove a file (§3.2: own + any, own, none)', () => {
  void test('a lead any, a member their own, nobody without the action', () => {
    const lead = { meId: 'u-grace', leads: true, holdsDelete: true };
    const member = { meId: 'u-ada', leads: false, holdsDelete: true };
    const viewer = { meId: 'u-ada', leads: false, holdsDelete: false };
    assert.equal(mayDeleteAttachment(file(), lead), true);
    assert.equal(mayDeleteAttachment(file(), member), true);
    assert.equal(mayDeleteAttachment(file({ uploaded_by: 'u-grace' }), member), false);
    assert.equal(mayDeleteAttachment(file(), viewer), false);
    assert.equal(mayDeleteAttachment(file(), { ...member, meId: undefined }), false);
  });
});

void describe('a file as a row', () => {
  void test('its kind, size, who added it and when it was ready', () => {
    const [row] = attachmentRows(
      [file()],
      { meId: 'u-ada', leads: false, holdsDelete: true },
      (id) => (id === 'u-ada' ? 'Ada Lovelace' : id),
      NOW,
    );
    assert.equal(row?.kind, 'sheet');
    assert.equal(row?.size, '14 KB');
    assert.equal(row?.uploader, 'Ada Lovelace');
    assert.equal(row?.when.text, '5 min ago');
    assert.equal(row?.url, file().url);
    assert.equal(row?.mayDelete, true);
  });

  void test('in the order the server sent them', () => {
    const rows = attachmentRows(
      [file({ id: 'a', filename: 'a.pdf' }), file({ id: 'b', filename: 'b.png' })],
      { meId: undefined, leads: false, holdsDelete: false },
      (id) => id,
      NOW,
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.kind, r.mayDelete]),
      [
        ['a', 'pdf', false],
        ['b', 'image', false],
      ],
    );
  });

  void test('the heading counts them, and says nothing extra when there are none', () => {
    assert.equal(attachmentsHeading(0), 'Attachments');
    assert.equal(attachmentsHeading(3), 'Attachments · 3');
  });
});

void describe('a live frame about this task’s files', () => {
  const frame = (type: string, data: unknown) => ({
    type,
    data: typeof data === 'string' ? data : JSON.stringify(data),
  });

  void test('either verb, naming this task', () => {
    assert.equal(changesFilesOf(frame('attachment.added', { task_id: 't1' }), 't1'), true);
    assert.equal(changesFilesOf(frame('attachment.removed', { task_id: 't1' }), 't1'), true);
  });

  void test('not another task, another verb, or a frame that cannot be read', () => {
    assert.equal(changesFilesOf(frame('attachment.added', { task_id: 't2' }), 't1'), false);
    assert.equal(changesFilesOf(frame('comment.added', { task_id: 't1' }), 't1'), false);
    assert.equal(changesFilesOf(frame('attachment.added', '{not json'), 't1'), false);
  });
});
