/**
 * `src/routes/screens/task/outputs-derive.ts` — an agent's outputs as the
 * popup draws them (D-162, LAI-1352): which files a round, a comment or an
 * unlisted finding links, what each is, the fold's line, and who it came from.
 *
 * The markdown here is what the server writes (LAI-1302,
 * `attachmentLinksMarkdown`): a `**Outputs**` line, a blank line, then
 * `- ![caption](url)` for an image a browser may show and `- [caption](url)`
 * otherwise, the caption's `\`, `[` and `]` escaped.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Attachment } from '../../../../src/api/attachments.ts';
import type { Round } from '../../../../src/api/review.ts';
import type { UnlistedFile } from '../../../../src/api/unlisted.ts';
import {
  ATTACHMENT_GROUP_TITLES,
  downloadUrl,
  groupAttachments,
  outputBy,
  outputItem,
  outputItems,
  outputKinds,
  outputRefs,
  outputsFoldLabel,
  roundBy,
  roundOutputs,
  splitAttached,
} from '../../../../src/routes/screens/task/outputs-derive.ts';

const A = '01JCZ8Y3V4QK9M2N7P5R6S8T0A';
const B = '01JCZ8Y3V4QK9M2N7P5R6S8T0B';
const C = '01JCZ8Y3V4QK9M2N7P5R6S8T0C';
const D = '01JCZ8Y3V4QK9M2N7P5R6S8T0D';
const E = '01JCZ8Y3V4QK9M2N7P5R6S8T0E';
const url = (id: string): string => `/api/v1/attachments/${id}/content`;
const ORIGIN = 'https://board.example.test';

/** The block the server appends to a finish's summary. */
const OUTPUTS = [
  '**Outputs**',
  '',
  `- ![Board, dark \\[1440\\]](${url(A)})`,
  `- ![Board at 390](${url(B)})`,
  `- [Accounts created (masked)](${url(C)})`,
  `- [Run report](${url(D)})`,
].join('\n');

function file(id: string, filename: string, type: string, over: Partial<Attachment> = {}) {
  return {
    id,
    project_id: 'p',
    task_id: 't',
    comment_id: null,
    filename,
    content_type: type,
    size_bytes: 2048,
    inline: type.startsWith('image/') || type === 'application/pdf' || type.startsWith('video/'),
    uploaded_by: 'u1',
    created_at: 1,
    ready_at: 2,
    url: url(id),
    ...over,
  } satisfies Attachment;
}

function round(number: number, summary: string, over: Partial<Round> = {}): Round {
  return {
    id: `r${String(number)}`,
    task_id: 't',
    number,
    finished_by: 'u1',
    client_name: null,
    agent: null,
    by_registered_agent: false,
    summary_md: summary,
    commits: [],
    branch: null,
    pull_request: null,
    tests: [],
    ci: null,
    decision: null,
    created_at: number,
    ...over,
  };
}

void describe('outputRefs', () => {
  void test('reads each captioned link to a board file, in order, its escapes undone', () => {
    assert.deepEqual(outputRefs(`Done.\n\n${OUTPUTS}`, ORIGIN), [
      { id: A, caption: 'Board, dark [1440]', image: true },
      { id: B, caption: 'Board at 390', image: true },
      { id: C, caption: 'Accounts created (masked)', image: false },
      { id: D, caption: 'Run report', image: false },
    ]);
  });

  void test('a file linked twice is one output, named by its first link', () => {
    const md = `[first](${url(A)}) and again ![second](${url(A)})`;
    assert.deepEqual(outputRefs(md, ORIGIN), [{ id: A, caption: 'first', image: false }]);
  });

  void test('only this board’s own files: no other host, no other path, no //host', () => {
    const md = [
      `[ours](${ORIGIN}${url(A)})`,
      `[elsewhere](https://evil.example${url(B)})`,
      `[protocol-relative](//evil.example${url(C)})`,
      `[not content](/api/v1/attachments/${D})`,
      `[a page](https://example.com)`,
    ].join('\n');
    assert.deepEqual(outputRefs(md, ORIGIN), [{ id: A, caption: 'ours', image: false }]);
  });

  void test('empty, null and undefined text have none', () => {
    assert.deepEqual(outputRefs('', ORIGIN), []);
    assert.deepEqual(outputRefs(null, ORIGIN), []);
    assert.deepEqual(outputRefs(undefined, ORIGIN), []);
  });
});

void describe('roundOutputs', () => {
  void test('a file belongs to the first round whose summary links it', () => {
    const rounds = [
      round(2, `Fixed.\n\n**Outputs**\n\n- ![again](${url(A)})\n- ![new](${url(E)})`),
      round(1, `First go.\n\n${OUTPUTS}`),
    ];
    const by = roundOutputs(rounds, ORIGIN);
    assert.deepEqual(
      by.get(1)?.map((r) => r.id),
      [A, B, C, D],
    );
    assert.deepEqual(
      by.get(2)?.map((r) => r.id),
      [E],
    );
  });

  void test('a round with no links has none', () => {
    assert.deepEqual(roundOutputs([round(1, 'No outputs here.')], ORIGIN).get(1), []);
  });
});

void describe('outputItem', () => {
  void test('the server’s inline types are shown; anything else is a card', () => {
    const shows = [
      file(A, 'shot.png', 'image/png'),
      file(B, 'demo.webm', 'video/webm'),
      file(C, 'report.pdf', 'application/pdf'),
      file(D, 'budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      file(E, 'page.svg', 'image/svg+xml', { inline: false }),
    ].map((f) => outputItem({ id: f.id, caption: f.filename, image: false }, f, null).show);
    assert.deepEqual(shows, ['image', 'video', 'pdf', 'card', 'card']);
  });

  void test('a recording the server would not show inline is a card, not a broken player', () => {
    const f = file(B, 'demo.mov', 'video/quicktime', { inline: false });
    assert.equal(outputItem({ id: B, caption: 'Demo', image: false }, f, null).show, 'card');
  });

  void test('kinds: screenshot, recording, sheet, report and file', () => {
    const kinds = [
      file(A, 'shot.png', 'image/png'),
      file(B, 'demo.mp4', 'video/mp4'),
      file(C, 'accounts.csv', 'text/csv', { inline: false }),
      file(D, 'run.pdf', 'application/pdf'),
      file(E, 'junit.html', 'text/html', { inline: false }),
      file('01JCZ8Y3V4QK9M2N7P5R6S8T0F', 'dump.bin', 'application/octet-stream', {
        inline: false,
      }),
    ].map((f) => outputItem({ id: f.id, caption: 'x', image: false }, f, null).kind);
    assert.deepEqual(kinds, ['screenshot', 'recording', 'sheet', 'report', 'report', 'file']);
  });

  void test('with no file read, only a link written as an image is shown', () => {
    const image = outputItem({ id: A, caption: 'Shot', image: true }, undefined, 'by Ada');
    assert.equal(image.show, 'image');
    assert.equal(image.kind, 'screenshot');
    assert.equal(image.url, url(A));
    assert.equal(image.filename, null);
    assert.equal(image.size, null);
    assert.equal(image.by, 'by Ada');
    // A PDF the server may not have sniffed inline would download into a frame.
    const pdf = outputItem({ id: C, caption: 'report.pdf', image: false }, undefined, null);
    assert.equal(pdf.show, 'card');
    assert.equal(pdf.glyph, 'pdf');
  });

  void test('an empty caption falls back to the file’s name, and the size is said', () => {
    const item = outputItem(
      { id: A, caption: '', image: false },
      file(A, 'shot.png', 'image/png'),
      null,
    );
    assert.equal(item.caption, 'shot.png');
    assert.equal(item.size, '2 KB');
  });
});

void describe('outputItems', () => {
  const refs = outputRefs(OUTPUTS, ORIGIN);

  void test('with the files read, a link to a file since removed is left out', () => {
    const items = outputItems(
      refs,
      [file(A, 'a.png', 'image/png'), file(C, 'c.csv', 'text/csv')],
      null,
    );
    assert.deepEqual(
      items.map((i) => i.id),
      [A, C],
    );
  });

  void test('unread, every link is kept as written', () => {
    assert.equal(outputItems(refs, undefined, null).length, 4);
  });

  void test('an unlisted note’s files name a file its link only captions (LAI-1361)', () => {
    // As `GET /unlisted` lists them: no `url`, so each opens at its content route.
    const files: UnlistedFile[] = [
      {
        id: C,
        filename: 'accounts.csv',
        content_type: 'text/csv',
        size_bytes: 2048,
        inline: false,
      },
      {
        id: D,
        filename: 'run.pdf',
        content_type: 'application/pdf',
        size_bytes: 4096,
        inline: true,
      },
    ];
    const items = outputItems(refs, files, null);
    assert.deepEqual(
      items.map((i) => [i.caption, i.filename, i.kind, i.size, i.url]),
      [
        ['Accounts created (masked)', 'accounts.csv', 'sheet', '2 KB', url(C)],
        ['Run report', 'run.pdf', 'report', '4 KB', url(D)],
      ],
    );
  });
});

void describe('downloadUrl', () => {
  void test('asks the board to have the file saved, not opened (LAI-1361)', () => {
    assert.equal(downloadUrl(url(A)), `${url(A)}?download=1`);
    assert.equal(downloadUrl('/x?v=2'), '/x?v=2&download=1');
  });
});

void describe('the fold’s line', () => {
  void test('Outputs · 6 — 4 screenshots · 1 sheet · 1 report, as the owner’s preview', () => {
    const items = [
      ...Array.from({ length: 4 }, () => ({ kind: 'screenshot' as const })),
      { kind: 'report' as const },
      { kind: 'sheet' as const },
    ];
    assert.equal(outputsFoldLabel(items), 'Outputs · 6 — 4 screenshots · 1 sheet · 1 report');
  });

  void test('one of a kind is singular, and the order is fixed', () => {
    assert.equal(
      outputKinds([{ kind: 'file' }, { kind: 'recording' }, { kind: 'screenshot' }]),
      '1 screenshot · 1 recording · 1 file',
    );
  });
});

void describe('who an output came from', () => {
  void test('the owner and the agent, as the viewer says it', () => {
    assert.equal(outputBy('Ada', 'Claude Code · Belka'), 'by Ada’s Claude Code · Belka');
    assert.equal(outputBy('Ada', 'an agent'), 'by Ada’s agent');
    assert.equal(outputBy('Ada', null), 'by Ada');
  });

  void test('a round names the agent that finished it, for the person it acted for', () => {
    const names = (id: string) => (id === 'u1' ? 'Ada Lovelace' : 'Someone');
    const agent = { id: 'a1', harness: 'claude-code', device_label: 'Belka' };
    assert.equal(roundBy(round(1, '', { agent }), names), 'by Ada Lovelace’s Claude Code · Belka');
    assert.equal(
      roundBy(round(1, '', { by_registered_agent: true }), names),
      'by Ada Lovelace’s agent',
    );
    assert.equal(roundBy(round(1, ''), names), 'by Ada Lovelace');
  });
});

void describe('splitAttached', () => {
  void test('the note as written, and the files the server attached under it', () => {
    const note = `The deploy script fails on a clean clone.\n\nSee the log.\n\n**Attached**\n\n- ![Error](${url(A)})\n- [deploy.log](${url(B)})`;
    const { text, refs } = splitAttached(note, ORIGIN);
    assert.equal(text, 'The deploy script fails on a clean clone.\n\nSee the log.');
    assert.deepEqual(refs, [
      { id: A, caption: 'Error', image: true },
      { id: B, caption: 'deploy.log', image: false },
    ]);
  });

  void test('a note with no attached block is left whole', () => {
    assert.deepEqual(splitAttached('Just a note.', ORIGIN), { text: 'Just a note.', refs: [] });
  });

  void test('**Attached** in a note with no file under it is the note’s own words', () => {
    const note = 'Fix it.\n\n**Attached**\nnothing here';
    assert.deepEqual(splitAttached(note, ORIGIN), { text: note, refs: [] });
  });
});

void describe('groupAttachments', () => {
  void test('Outputs, In comments, Other — in that order, each in the server’s order', () => {
    const files = [
      { id: A, comment_id: null },
      { id: B, comment_id: 'c1' },
      { id: C, comment_id: 'c9' },
      { id: D, comment_id: null },
    ];
    const groups = groupAttachments(files, new Set([C]));
    assert.deepEqual(
      groups.map((g) => [g.group, g.files.map((f) => f.id)]),
      [
        ['outputs', [C]],
        ['comments', [B]],
        ['other', [A, D]],
      ],
    );
    assert.deepEqual(
      groups.map((g) => ATTACHMENT_GROUP_TITLES[g.group]),
      ['Outputs', 'In comments', 'Other'],
    );
  });

  void test('an empty group is left out', () => {
    assert.deepEqual(
      groupAttachments([{ id: A, comment_id: null }], new Set()).map((g) => g.group),
      ['other'],
    );
  });
});
