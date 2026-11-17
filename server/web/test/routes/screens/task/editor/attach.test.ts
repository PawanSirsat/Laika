/**
 * Files in the text (D-150, LAI-1301): which URLs are Laika's own
 * attachments, what a file is drawn as and called, the markdown that links
 * it, and which files a paste or a drop carries.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  attachmentIdOf,
  attachmentSnippet,
  attachmentUrl,
  escapeAlt,
  escapeLinkText,
  FILE_GLYPHS,
  fileKind,
  filesFrom,
  isAttachmentUrl,
  pastedFiles,
  type FileCarrier,
} from '../../../../../src/routes/screens/task/editor/attach.ts';

const ID = '01JCZ8Y3V4QK9M2N7P5R6S8T0W';
const URL = `/api/v1/attachments/${ID}/content`;
const ORIGIN = 'https://laika.example.com';

void describe('an attachment URL is Laika’s own path and nothing else', () => {
  void test('the relative path, and the same path on this board’s origin', () => {
    assert.equal(attachmentIdOf(URL), ID);
    assert.equal(attachmentIdOf(`${ORIGIN}${URL}`, ORIGIN), ID);
    assert.equal(isAttachmentUrl(attachmentUrl(ID)), true);
  });

  void test('not another host, a protocol-relative host, or an absolute URL with no origin to match', () => {
    for (const url of [
      `https://evil.example${URL}`,
      `//evil.example${URL}`,
      `${ORIGIN}${URL}`,
      `${ORIGIN}.evil.example${URL}`,
    ]) {
      assert.equal(isAttachmentUrl(url), false, url);
    }
    assert.equal(isAttachmentUrl(`https://evil.example${URL}`, ORIGIN), false);
    assert.equal(isAttachmentUrl(`${ORIGIN}.evil.example${URL}`, ORIGIN), false);
  });

  void test('not a query, a fragment, another route, or an id that is not a ULID', () => {
    for (const url of [
      `${URL}?x=1`,
      `${URL}#a`,
      `/api/v1/attachments/${ID}`,
      `/api/v1/attachments/${ID}/content/x`,
      `/api/v1/attachments/${ID.toLowerCase()}/content`,
      '/api/v1/attachments/01JCZ8Y3V4QK9M2N7P5R6S8T0/content',
      '/api/v1/attachments/01JCZ8Y3V4QK9M2N7P5R6S8TOU/content',
      '/api/v1/attachments/../tasks/content',
      '',
      null,
      undefined,
    ]) {
      assert.equal(isAttachmentUrl(url), false, String(url));
    }
  });
});

void describe('what a file is drawn as', () => {
  void test('by its extension first', () => {
    assert.equal(fileKind('shot.PNG'), 'image');
    assert.equal(fileKind('budget.xlsx'), 'sheet');
    assert.equal(fileKind('export.csv'), 'sheet');
    assert.equal(fileKind('spec.pdf'), 'pdf');
    assert.equal(fileKind('notes.docx'), 'doc');
    assert.equal(fileKind('build.zip'), 'file');
  });

  void test('by its declared type when the name says nothing', () => {
    assert.equal(fileKind('Pasted', 'image/png'), 'image');
    assert.equal(fileKind('scan', 'application/pdf'), 'pdf');
    assert.equal(
      fileKind('sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      'sheet',
    );
    assert.equal(fileKind('.env', 'application/octet-stream'), 'file');
  });

  void test('every kind and the paperclip has a glyph on the 24 grid', () => {
    for (const kind of ['paperclip', 'file', 'image', 'sheet', 'pdf', 'doc'] as const) {
      const paths = FILE_GLYPHS[kind];
      assert.ok(paths.length > 0, kind);
      for (const d of paths) assert.match(d, /^[Mm][\d.\s,a-zA-Z-]+$/, kind);
    }
  });
});

void describe('the markdown that links a file', () => {
  void test('an image is drawn, anything else is linked', () => {
    assert.equal(
      attachmentSnippet({ filename: 'shot.png', url: URL, image: true }),
      `![shot.png](${URL})`,
    );
    assert.equal(
      attachmentSnippet({ filename: 'budget.xlsx', url: URL, image: false }),
      `[budget.xlsx](${URL})`,
    );
  });

  void test('a bracket in a name cannot end the alt text or the link early', () => {
    assert.equal(escapeAlt('a]b [c] \\d'), 'a\\]b \\[c\\] \\\\d');
    assert.equal(
      attachmentSnippet({ filename: 'v2] final.png', url: URL, image: true }),
      `![v2\\] final.png](${URL})`,
    );
    assert.equal(escapeLinkText('a]b'), 'a\\]b');
  });

  void test('a link’s words are literal: no emphasis, code or HTML can start in them', () => {
    assert.equal(
      escapeLinkText('*draft* `x` <b> & ~y~'),
      '\\*draft\\* \\`x\\` \\<b\\> \\& \\~y\\~',
    );
    assert.equal(escapeLinkText('report_v2.pdf'), 'report\\_v2.pdf');
  });
});

/** A `DataTransfer`-shaped stand-in: Node has none. */
function carrier(parts: {
  files?: File[];
  items?: { kind: string; file: File | null }[];
  text?: string;
}): FileCarrier {
  return {
    files: parts.files ?? [],
    items: (parts.items ?? []).map((item) => ({ kind: item.kind, getAsFile: () => item.file })),
    getData: (format: string) => (format === 'text/plain' ? (parts.text ?? '') : ''),
  };
}

void describe('which files a paste or a drop carries', () => {
  const shot = new File(['png'], 'image.png', { type: 'image/png' });
  const sheet = new File(['a,b'], 'a.csv', { type: 'text/csv' });

  void test('its files, or else the items that are files', () => {
    assert.deepEqual(filesFrom(carrier({ files: [shot, sheet] })), [shot, sheet]);
    assert.deepEqual(
      filesFrom(
        carrier({
          items: [
            { kind: 'string', file: null },
            { kind: 'file', file: shot },
            { kind: 'file', file: null },
          ],
        }),
      ),
      [shot],
    );
    assert.deepEqual(filesFrom(carrier({})), []);
    assert.deepEqual(filesFrom(null), []);
  });

  void test('a paste with words in it is a paste of the words, not of its picture', () => {
    // A spreadsheet's cells arrive as text, HTML and a picture of themselves.
    assert.deepEqual(pastedFiles(carrier({ files: [shot], text: 'a\tb' })), []);
    // A screenshot arrives as the file alone.
    assert.deepEqual(pastedFiles(carrier({ files: [shot] })), [shot]);
    assert.deepEqual(pastedFiles(carrier({ files: [shot], text: '  \n' })), [shot]);
  });
});
