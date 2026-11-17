/**
 * Attachments in the browser (D-150, LAI-1301): the paperclip, a pasted
 * screenshot and a dropped file each upload — ask Laika, `PUT` the bytes to
 * the store with exactly the signed headers, complete — and the text gets an
 * image or a link; every markdown view draws Laika's own image and a file
 * chip; the task's Attachments section lists, adds and removes files; and a
 * board with no store shows none of it.
 *
 * **The store is another origin**, as it is in production, routed here by
 * Playwright: `PUT https://store.laika.test/…` never leaves the browser, and
 * the test reads the headers it was sent. The content route answers a real
 * PNG, so an image that "renders" has pixels, not a broken frame.
 */

import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { after, describe, test } from 'node:test';
import type { Locator, Page, Request } from 'playwright';
import {
  closeBrowser,
  fakeStream,
  open,
  refuse,
  reply,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
  type StubRoute,
} from './harness.ts';

void after(async () => {
  await closeBrowser();
});

/** A real PNG, `width` × `height`, a two-tone band, built here: no fixture file. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolour
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const band = y < height / 2;
      row.writeUInt8(band ? 124 : 47, 1 + x * 3);
      row.writeUInt8(band ? 58 : 208, 2 + x * 3);
      row.writeUInt8(band ? 237 : 138, 3 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SHOT = png(240, 120);
const MAX = 25 * 1024 * 1024;
const STORE = 'https://store.laika.test';

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const NOW = Date.now();
const ID_SHOT = '01JCZ8Y3V4QK9M2N7P5R6S8T0A';
const ID_SHEET = '01JCZ8Y3V4QK9M2N7P5R6S8T0B';
const ID_PDF = '01JCZ8Y3V4QK9M2N7P5R6S8T0C';
const ID_MORE = '01JCZ8Y3V4QK9M2N7P5R6S8T0D';
/** The ids the board hands out, in order. */
const IDS = [ID_SHOT, ID_SHEET, ID_PDF, ID_MORE] as const;
const url = (id: string): string => `/api/v1/attachments/${id}/content`;

const TASK = {
  id: 't3',
  key: 'LC-3',
  number: 3,
  project_id: 'laika-core',
  title: 'Operator console',
  description_md: '## Context\n\nThe console loads slowly.',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
};

/** An `AttachmentView` (§6.4) as the server answers it. */
function view(id: string, filename: string, contentType: string, over: object = {}) {
  return {
    id,
    project_id: 'laika-core',
    task_id: 't3',
    comment_id: null,
    filename,
    content_type: contentType,
    size_bytes: 2048,
    inline: contentType.startsWith('image/'),
    uploaded_by: 'u1',
    created_at: NOW - 600_000,
    ready_at: NOW - 600_000,
    url: url(id),
    ...over,
  };
}

/** The board's files and the uploads it has handed out, for one test. */
interface Board {
  task: typeof TASK;
  files: ReturnType<typeof view>[];
  /** What each ask named, in order — the id the next one gets. */
  next: string[];
  /** Pending uploads by id: the view `complete` answers. */
  pending: Map<string, ReturnType<typeof view>>;
}

function board(over: Partial<Board> = {}): Board {
  return {
    task: { ...TASK },
    files: [],
    next: [...IDS],
    pending: new Map(),
    ...over,
  };
}

/** `complete` and `DELETE` for every id the board hands out. */
function fileRoutes(b: Board): Record<string, StubRoute> {
  const routes: Record<string, StubRoute> = {};
  for (const id of IDS) {
    routes[`/api/v1/attachments/${id}/complete`] = () => {
      const pending = b.pending.get(id);
      if (pending === undefined) return refuse(409, 'conflict', 'Not pending.');
      const ready = {
        ...pending,
        inline: pending.content_type.startsWith('image/'),
        ready_at: Date.now(),
      };
      b.pending.delete(id);
      b.files.push(ready);
      return ready;
    };
    routes[`/api/v1/attachments/${id}`] = (call: StubCall) => {
      if (call.method !== 'DELETE') return refuse(405, 'method_not_allowed', 'No.');
      b.files = b.files.filter((f) => f.id !== id);
      return reply(204, undefined);
    };
  }
  return routes;
}

type Who = 'lead' | 'member';

function stub(b: Board, options: { who?: Who; maxBytes?: number | null } = {}): ApiStub {
  const who = options.who ?? 'lead';
  const maxBytes = options.maxBytes === undefined ? MAX : options.maxBytes;
  const me =
    who === 'lead'
      ? { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'lead' }
      : { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', role: 'member' };
  return {
    '/api/v1/me': {
      id: me.id,
      email: me.email,
      name: me.name,
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: me.role }],
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      developer_insights: false,
      created_at: 1,
      updated_at: 1,
      attachments: maxBytes === null ? null : { max_bytes: maxBytes },
    },
    '/api/v1/presence': { enabled: false, present: [] },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': () => ({ data: [b.task], next_cursor: null }),
    '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
    '/api/v1/tasks/t3': (call: StubCall) => {
      if (call.method === 'PATCH') {
        b.task = {
          ...b.task,
          ...(call.body as Record<string, unknown>),
          updated_at: Date.now(),
        };
      }
      return b.task;
    },
    '/api/v1/tasks/t3/comments': (call: StubCall) =>
      call.method === 'POST'
        ? {
            id: 'c9',
            task_id: 't3',
            author_id: me.id,
            body_md: (call.body as { body_md?: string } | undefined)?.body_md ?? '',
            created_via: 'web',
            edited_at: null,
            sent_back: false,
            created_at: Date.now(),
            updated_at: Date.now(),
          }
        : { data: [], next_cursor: null },
    '/api/v1/tasks/t3/watchers': { watchers: [] },
    '/api/v1/tasks/t3/attachments': () => ({ data: b.files }),
    '/api/v1/projects/laika-core/attachments': (call: StubCall) => {
      const body = call.body as { filename: string; content_type: string; size_bytes: number };
      if (body.size_bytes > (maxBytes ?? 0)) {
        return reply(413, {
          error: {
            code: 'payload_too_large',
            message: 'Too large.',
            details: { max_bytes: maxBytes },
          },
        });
      }
      const id = b.next.shift() ?? 'none';
      const pending = view(id, body.filename, body.content_type, {
        size_bytes: body.size_bytes,
        uploaded_by: me.id,
        ready_at: null,
        inline: false,
      });
      b.pending.set(id, pending);
      return reply(201, {
        attachment: pending,
        upload: {
          url: `${STORE}/laika-attachments/p/laika-core/${id}?X-Amz-Signature=sig`,
          method: 'PUT',
          headers: {
            'content-type': body.content_type,
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(body.filename)}`,
          },
          expires_at: Date.now() + 600_000,
        },
      });
    },
    ...fileRoutes(b),
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'lead' },
        { user_id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', role: 'member' },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': {
      users: [
        { id: 'u1', name: 'Ada Lovelace' },
        { id: 'u2', name: 'Grace Hopper' },
      ],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
  };
}

/** What the store was sent: each `PUT`, with its headers as the browser sent them. */
interface StorePut {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: number;
}

/**
 * Route the store and the attachment content before the app boots: the store
 * takes any `PUT` (and answers its preflight), the content route answers the
 * PNG. Returns the `PUT`s the store saw.
 */
async function routeStore(page: Page, puts: StorePut[]): Promise<void> {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': 'content-type, content-disposition',
  };
  await page.route(`${STORE}/**`, async (route) => {
    const request: Request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    puts.push({
      url: request.url(),
      headers: await request.allHeaders(),
      bytes: request.postDataBuffer()?.length ?? 0,
    });
    await route.fulfill({ status: 200, headers: cors, body: '' });
  });
  await page.route('**/api/v1/attachments/*/content', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: SHOT }),
  );
}

async function panel(
  b: Board,
  options: { who?: Who; maxBytes?: number | null } = {},
  puts: StorePut[] = [],
): Promise<Harness> {
  const h = await open('/board?project=laika-core&task=t3', stub(b, options), {
    before: async (page) => {
      await fakeStream(page);
      await routeStore(page, puts);
    },
  });
  await h.page.locator('[data-section="description"] .md h2').waitFor({ timeout: 20_000 });
  return h;
}

const description = (h: Harness): Locator => h.page.locator('[data-section="description"]');
const section = (h: Harness): Locator => h.page.locator('[data-section="attachments"]');

/** Open the description's editor and wait until it has focus. */
async function openEditor(h: Harness): Promise<Locator> {
  await description(h).getByRole('button', { name: 'Edit description' }).focus();
  await h.page.keyboard.press('Enter');
  const editor = description(h).locator('.rich-editor');
  await editor.locator('.ProseMirror').waitFor({ timeout: 10_000 });
  return editor;
}

const asks = (h: Harness): StubCall[] =>
  h.calls.filter(
    (c) => c.method === 'POST' && c.path === '/api/v1/projects/laika-core/attachments',
  );

/** Fire a `paste` carrying one file at `target`, as a screenshot paste does. */
async function pasteFile(
  target: Locator,
  name: string,
  type: string,
  bytes: number[],
): Promise<void> {
  await target.evaluate(
    (element, file) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { name, type, bytes },
  );
}

/** Fire a `drop` carrying one file at the middle of `target`. */
async function dropFile(
  target: Locator,
  name: string,
  type: string,
  bytes: number[],
): Promise<void> {
  await target.evaluate(
    (element, file) => {
      const box = element.getBoundingClientRect();
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      element.dispatchEvent(
        new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true, ...at }),
      );
      element.dispatchEvent(
        new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, ...at }),
      );
    },
    { name, type, bytes },
  );
}

const SHOT_BYTES = [...SHOT];

void describe('the paperclip uploads to the store and puts the image in the text', () => {
  void test('ask, PUT with exactly the signed headers, complete — then an image, saved as markdown', async () => {
    const b = board();
    const puts: StorePut[] = [];
    const h = await panel(b, {}, puts);
    try {
      const editor = await openEditor(h);
      const chooser = h.page.waitForEvent('filechooser', { timeout: 5_000 });
      await editor.getByRole('button', { name: 'Attach files' }).click();
      await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: SHOT });

      await editor.locator(`img.rte-image[src="${url(ID_SHOT)}"]`).waitFor({ timeout: 10_000 });
      assert.deepEqual(
        asks(h).map((c) => c.body),
        [
          {
            filename: 'shot.png',
            content_type: 'image/png',
            size_bytes: SHOT.length,
            task_id: 't3',
          },
        ],
      );
      assert.equal(puts.length, 1, 'the store was not sent the file');
      const put = puts[0]!;
      assert.equal(
        put.url,
        `${STORE}/laika-attachments/p/laika-core/${ID_SHOT}?X-Amz-Signature=sig`,
      );
      assert.equal(put.headers['content-type'], 'image/png');
      assert.equal(put.headers['content-disposition'], "attachment; filename*=UTF-8''shot.png");
      assert.equal(put.headers.cookie, undefined, 'the session cookie went to the store');
      assert.equal(put.bytes, SHOT.length);
      assert.ok(
        h.calls.some(
          (c) => c.method === 'POST' && c.path === `/api/v1/attachments/${ID_SHOT}/complete`,
        ),
      );
      // The placeholder and the progress row are gone once it landed.
      assert.equal(await editor.locator('.rte-uploading, .rte-upload').count(), 0);

      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() => b.task.description_md.includes(url(ID_SHOT)));
      assert.match(
        b.task.description_md,
        new RegExp(`!\\[shot\\.png\\]\\(${url(ID_SHOT).replace(/\//g, '\\/')}\\)`),
      );
    } finally {
      await h.close();
    }
  });

  void test('too big is refused before asking, says why, and the text is as it was', async () => {
    const b = board();
    const h = await panel(b, { maxBytes: 1024 });
    try {
      const editor = await openEditor(h);
      // Not the PNG: two flat bands deflate to a few hundred bytes.
      await editor.locator('input[type="file"]').setInputFiles({
        name: 'big.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(5 * 1024, 1),
      });
      const row = editor.locator('.rte-upload-failed');
      await row.waitFor({ timeout: 5_000 });
      assert.match(await row.innerText(), /“big\.png” is 5 KB; a file can be at most 1 KB\./);
      assert.equal(asks(h).length, 0, 'it asked anyway');
      assert.equal(await editor.locator('img.rte-image').count(), 0);
      assert.equal(await editor.locator('.rte-uploading').count(), 0, 'the placeholder stayed');
    } finally {
      await h.close();
    }
  });
});

void describe('a pasted screenshot and a dropped file', () => {
  void test('a paste with only an image uploads it, named for when it arrived', async () => {
    const b = board();
    const h = await panel(b);
    try {
      const editor = await openEditor(h);
      await pasteFile(editor.locator('.ProseMirror'), 'image.png', 'image/png', SHOT_BYTES);
      await editor.locator(`img.rte-image[src="${url(ID_SHOT)}"]`).waitFor({ timeout: 10_000 });
      const asked = asks(h)[0]?.body as { filename?: string } | undefined;
      assert.match(asked?.filename ?? '', /^Pasted \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    } finally {
      await h.close();
    }
  });

  void test('a dropped spreadsheet becomes a link to it, where it was dropped', async () => {
    const b = board();
    const h = await panel(b);
    try {
      const editor = await openEditor(h);
      await dropFile(
        editor.locator('.ProseMirror p').first(),
        'budget.xlsx',
        'application/vnd.ms-excel',
        [1, 2, 3],
      );
      const link = editor.locator(`.ProseMirror a[href="${url(ID_SHOT)}"]`);
      await link.waitFor({ timeout: 10_000 });
      assert.equal(await link.innerText(), 'budget.xlsx');
      assert.equal(await editor.locator('.ProseMirror img').count(), 0, 'a sheet became an image');
    } finally {
      await h.close();
    }
  });

  void test('in the Markdown view the snippet goes in at the caret', async () => {
    const b = board();
    const h = await panel(b);
    try {
      const editor = await openEditor(h);
      await editor.getByRole('button', { name: 'Markdown' }).click();
      const field = editor.locator('textarea.rich-editor-source');
      await field.waitFor();
      await field.evaluate((element: HTMLTextAreaElement) => {
        element.focus();
        element.setSelectionRange(0, 0);
      });
      await pasteFile(field, 'image.png', 'image/png', SHOT_BYTES);
      await until(async () => (await field.inputValue()).includes(url(ID_SHOT)));
      assert.match(
        await field.inputValue(),
        new RegExp(
          `^!\\[Pasted [^\\]]+\\.png\\]\\(${url(ID_SHOT).replace(/\//g, '\\/')}\\)## Context`,
        ),
      );
    } finally {
      await h.close();
    }
  });
});

void describe('every markdown view draws Laika’s own image and a file chip', () => {
  void test('an attachment image loads, lazily; a spreadsheet is a chip; an outside image is alt text', async () => {
    const b = board();
    b.task = {
      ...b.task,
      description_md: [
        '## Context',
        '',
        `The run: ![run.png](${url(ID_SHOT)})`,
        '',
        `The numbers: [budget.xlsx](${url(ID_SHEET)})`,
        '',
        '![tracker](https://tracker.example.com/pixel.png)',
      ].join('\n'),
    };
    const h = await panel(b);
    try {
      const md = description(h).locator('.md');
      const image = md.locator('.md-image img');
      await image.waitFor({ timeout: 10_000 });
      assert.equal(await image.getAttribute('src'), url(ID_SHOT));
      assert.equal(await image.getAttribute('loading'), 'lazy');
      await until(() =>
        image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      );
      assert.equal(await image.evaluate((img: HTMLImageElement) => img.naturalWidth), 240);
      assert.equal(await md.locator('.md-image').getAttribute('target'), '_blank');

      const chip = md.locator('a.md-file');
      assert.equal(await chip.getAttribute('href'), url(ID_SHEET));
      assert.equal(await chip.getAttribute('data-kind'), 'sheet');
      assert.equal(await chip.getAttribute('target'), '_blank');
      assert.equal(await chip.locator('svg.file-glyph').count(), 1);
      assert.equal(await chip.innerText(), 'budget.xlsx');

      assert.equal(await md.locator('img').count(), 1, 'the outside image was loaded');
      assert.equal(await md.locator('.md-img-alt').innerText(), 'tracker');
    } finally {
      await h.close();
    }
  });

  void test('a comment draws them too', async () => {
    const b = board();
    const comments = {
      data: [
        {
          id: 'c1',
          task_id: 't3',
          author_id: 'u1',
          body_md: `See ![run.png](${url(ID_SHOT)}) and [budget.xlsx](${url(ID_SHEET)}).`,
          created_via: 'web',
          edited_at: null,
          sent_back: false,
          created_at: NOW - 60_000,
          updated_at: NOW - 60_000,
        },
      ],
      next_cursor: null,
    };
    const h = await open(
      '/board?project=laika-core&task=t3',
      { ...stub(b), '/api/v1/tasks/t3/comments': comments },
      {
        before: async (page) => {
          await fakeStream(page);
          await routeStore(page, []);
        },
      },
    );
    try {
      const body = h.page.locator('.cmt-body .md').first();
      await body.locator('.md-image img').waitFor({ timeout: 20_000 });
      assert.equal(await body.locator('a.md-file').getAttribute('data-kind'), 'sheet');
    } finally {
      await h.close();
    }
  });
});

void describe('the Attachments section', () => {
  void test('sits after the proof and before the activity, and lists each file', async () => {
    const b = board({
      files: [
        view(ID_SHOT, 'run.png', 'image/png'),
        view(ID_SHEET, 'budget.xlsx', 'text/csv', { uploaded_by: 'u2', size_bytes: 14 * 1024 }),
      ],
    });
    const h = await panel(b);
    try {
      await section(h).locator('.att-row').nth(1).waitFor({ timeout: 10_000 });
      // After the description (and the proof, when there is one), before the activity.
      const placed = await h.page.evaluate(() => {
        const files = document.querySelector('[data-section="attachments"]');
        const before = document.querySelector('[data-section="description"]');
        const after = document.querySelector('#activity');
        if (files === null || before === null || after === null) return 'missing';
        const follows = (a: Element, b: Element): boolean =>
          (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        return follows(before, files) && follows(files, after) ? 'between' : 'elsewhere';
      });
      assert.equal(placed, 'between');
      assert.equal(await section(h).locator('.panel-fold').innerText(), 'Attachments · 2');
      const second = section(h).locator('.att-row').nth(1);
      assert.equal(await second.locator('.att-name').innerText(), 'budget.xlsx');
      assert.equal(await second.locator('.att-name').getAttribute('href'), url(ID_SHEET));
      assert.match(
        await second.locator('.att-meta').innerText(),
        /^14 KB · Grace Hopper · 10 min ago$/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a member removes their own file, not another’s; a lead removes any', async () => {
    const files = () => [
      view(ID_SHOT, 'run.png', 'image/png', { uploaded_by: 'u2' }),
      view(ID_SHEET, 'budget.xlsx', 'text/csv', { uploaded_by: 'u1' }),
    ];
    const member = await panel(board({ files: files() }), { who: 'member' });
    try {
      await section(member).locator('.att-row').nth(1).waitFor({ timeout: 10_000 });
      assert.deepEqual(
        await section(member)
          .getByRole('button', { name: /^Remove / })
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
        ['Remove run.png'],
      );
    } finally {
      await member.close();
    }

    const b = board({ files: files() });
    const lead = await panel(b, { who: 'lead' });
    try {
      await section(lead).locator('.att-row').nth(1).waitFor({ timeout: 10_000 });
      assert.equal(
        await section(lead)
          .getByRole('button', { name: /^Remove / })
          .count(),
        2,
      );
      await section(lead).getByRole('button', { name: 'Remove budget.xlsx' }).click();
      await lead.page.getByRole('button', { name: 'Remove', exact: true }).click();
      await until(async () => (await section(lead).locator('.att-row').count()) === 1);
      assert.ok(
        lead.calls.some(
          (c) => c.method === 'DELETE' && c.path === `/api/v1/attachments/${ID_SHEET}`,
        ),
      );
      assert.equal(await section(lead).locator('.att-row .att-name').innerText(), 'run.png');
    } finally {
      await lead.close();
    }
  });

  void test('Attach files uploads to the task, and a dropped file does too', async () => {
    const b = board();
    const h = await panel(b);
    try {
      await section(h).getByRole('button', { name: 'Attach files' }).waitFor({ timeout: 10_000 });
      await section(h)
        .locator('input[type="file"]')
        .setInputFiles({
          name: 'spec.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7 tiny'),
        });
      await section(h).locator('.att-row').first().waitFor({ timeout: 10_000 });
      assert.equal((asks(h)[0]?.body as { task_id?: string }).task_id, 't3');
      assert.equal(
        await section(h)
          .locator('.att-row')
          .first()
          .locator('.file-glyph')
          .getAttribute('data-kind'),
        'pdf',
      );

      await dropFile(section(h), 'numbers.csv', 'text/csv', [97, 44, 98]);
      await until(async () => (await section(h).locator('.att-row').count()) === 2);
      assert.equal(
        await section(h).locator('.att-row').nth(1).locator('.att-name').innerText(),
        'numbers.csv',
      );
    } finally {
      await h.close();
    }
  });

  void test('a file added elsewhere arrives on its live frame', async () => {
    const b = board();
    const h = await panel(b);
    try {
      await section(h).getByText('No files yet.', { exact: false }).waitFor({ timeout: 10_000 });
      b.files.push(view(ID_SHOT, 'from-an-agent.png', 'image/png'));
      await h.page.evaluate(() => {
        (
          window as unknown as {
            __laikaStream: { emit: (t: string, d: unknown, id: string) => void };
          }
        ).__laikaStream.emit(
          'attachment.added',
          {
            id: 'a1',
            type: 'attachment.added',
            task_id: 't3',
            project_id: 'laika-core',
            payload: {},
          },
          '42',
        );
      });
      await section(h).locator('.att-row').first().waitFor({ timeout: 10_000 });
      assert.equal(await section(h).locator('.att-name').innerText(), 'from-an-agent.png');
    } finally {
      await h.close();
    }
  });
});

void describe('a board with no store (OrgView.attachments null)', () => {
  void test('no paperclip, no section, no request — and a dropped file is still refused', async () => {
    const b = board({ files: [view(ID_SHOT, 'run.png', 'image/png')] });
    const h = await panel(b, { maxBytes: null });
    try {
      const editor = await openEditor(h);
      const before = await editor.locator('.ProseMirror').innerHTML();
      assert.equal(await editor.getByRole('button', { name: 'Attach files' }).count(), 0);
      assert.equal(await editor.locator('input[type="file"]').count(), 0);
      await dropFile(editor.locator('.ProseMirror p').first(), 'budget.xlsx', 'text/csv', [1]);
      await pasteFile(editor.locator('.ProseMirror'), 'image.png', 'image/png', SHOT_BYTES);
      await h.page.waitForTimeout(300);
      assert.equal(await editor.locator('.ProseMirror').innerHTML(), before, 'the text changed');
      assert.equal(await section(h).count(), 0, 'the section was drawn');
      assert.equal(asks(h).length, 0);
      assert.ok(
        !h.calls.some((c) => c.path.includes('/attachments')),
        'an attachments call was made',
      );
    } finally {
      await h.close();
    }
  });
});
