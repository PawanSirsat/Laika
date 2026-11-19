/**
 * An agent's outputs in the browser (D-162, LAI-1352): the folded *Outputs*
 * line under Proof that opens to a strip with *+N*, the viewer — keys, focus,
 * an image, a recording that plays, a PDF in a frame and, where the board's
 * policy refuses the frame, the card instead — a comment's thumbnail row, the
 * Attachments section's groups, and the strip on an unlisted finding. At 1440
 * and 390, in light and dark.
 *
 * **The bytes are real.** The images are PNGs built here, the recording is a
 * WebM the browser itself records from a canvas, and the PDF is a one-page
 * document — so "it plays" means the browser read its metadata, and "it
 * shows" means it decoded a picture, not that an element exists.
 *
 * `LAIKA_OUTPUT_SHOTS=<dir>` writes the strip and the viewer at each size and
 * theme to that directory, for the parent card (the owner's testing ask).
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import type { Locator, Page, Route } from 'playwright';
import {
  closeBrowser,
  fakeStream,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

void after(async () => {
  await closeBrowser();
});

/** A real PNG, `width` × `height`, two bands in two colours, built here. */
function png(width: number, height: number, top: number[], bottom: number[]): Buffer {
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
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    const [r, g, b] = y < height / 2 ? top : bottom;
    for (let x = 0; x < width; x++) {
      row.writeUInt8(r ?? 0, 1 + x * 3);
      row.writeUInt8(g ?? 0, 2 + x * 3);
      row.writeUInt8(b ?? 0, 3 + x * 3);
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

/** A one-page PDF with a line of text, offsets computed so a reader accepts it. */
function pdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 18 Tf 24 72 Td (Run report) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A short WebM, recorded by the browser from a canvas: a recording it can play. */
async function recordWebm(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      chunks.push(event.data);
    };
    const stopped = new Promise((done) => {
      recorder.onstop = done;
    });
    recorder.start();
    for (let i = 0; i < 8; i++) {
      if (context !== null) {
        context.fillStyle = i % 2 === 0 ? '#7c3aed' : '#2fd08a';
        context.fillRect(0, 0, 160, 90);
      }
      await new Promise((done) => setTimeout(done, 60));
    }
    recorder.stop();
    await stopped;
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  return Buffer.from(bytes);
}

const NOW = Date.now();
const STORE = 'https://store.laika.test';
/** Attachment ids as the server issues them: ULIDs, 26 characters of Crockford base32. */
const id = (n: number): string => `01JCZ8Y3V4QK9M2N7P5R6S8T${String(n).padStart(2, '0')}`;
const SHOT_1 = id(1);
const SHOT_2 = id(2);
const SHOT_3 = id(3);
const REC = id(4);
const SHEET = id(5);
const REPORT = id(6);
const C_1 = id(7);
const C_2 = id(8);
const C_3 = id(9);
const C_ONE = id(10);
const NOTE_SHOT = id(11);
const NOTE_LOG = id(12);
const NOTE_GONE = id(13);
const NOTE_HIDDEN = id(14);
const url = (id: string): string => `/api/v1/attachments/${id}/content`;

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

const TASK = {
  id: 't3',
  key: 'LC-3',
  number: 3,
  project_id: 'laika-core',
  title: 'Operator console',
  description_md: 'The console loads slowly.',
  acceptance_md: '',
  status: 'review',
  priority: 'p2',
  assignee_id: 'u1',
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 2,
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
  started_at: NOW - 7_200_000,
  completed_at: null,
};

/** The outputs, as the server writes them into a finish's summary (LAI-1302). */
const OUTPUTS = [
  [SHOT_1, 'Board in light at 1440', true],
  [SHOT_2, 'Board in dark at 1440', true],
  [SHOT_3, 'Board at 390 \\[phone\\]', true],
  [REC, 'Dragging a card', false],
  [SHEET, 'Accounts created (masked)', false],
  [REPORT, 'Run report', false],
] as const;

const SUMMARY = [
  'Built the console.',
  '',
  '**Outputs**',
  '',
  ...OUTPUTS.map(([id, caption, image]) => `- ${image ? '!' : ''}[${caption}](${url(id)})`),
].join('\n');

/** An `AttachmentView` as the server answers it. */
function view(id: string, filename: string, contentType: string, over: object = {}) {
  return {
    id,
    project_id: 'laika-core',
    task_id: 't3',
    comment_id: null,
    filename,
    content_type: contentType,
    size_bytes: 48 * 1024,
    inline:
      contentType.startsWith('image/') ||
      contentType === 'application/pdf' ||
      contentType.startsWith('video/'),
    uploaded_by: 'u1',
    created_at: NOW - 600_000,
    ready_at: NOW - 600_000,
    url: url(id),
    ...over,
  };
}

const FILES = [
  view(SHOT_1, 'light-1440.png', 'image/png', { comment_id: 'c-sum' }),
  view(SHOT_2, 'dark-1440.png', 'image/png', { comment_id: 'c-sum' }),
  view(SHOT_3, 'phone-390.png', 'image/png', { comment_id: 'c-sum' }),
  view(REC, 'drag.webm', 'video/webm', { comment_id: 'c-sum' }),
  view(SHEET, 'accounts-masked.csv', 'text/csv', { comment_id: 'c-sum' }),
  view(REPORT, 'run-report.pdf', 'application/pdf', { comment_id: 'c-sum' }),
  view(C_1, 'before.png', 'image/png', { comment_id: 'c1', uploaded_by: 'u2' }),
  view(C_2, 'after.png', 'image/png', { comment_id: 'c1', uploaded_by: 'u2' }),
  view(C_3, 'diff.png', 'image/png', { comment_id: 'c1', uploaded_by: 'u2' }),
  view(C_ONE, 'single.png', 'image/png', { comment_id: 'c2', uploaded_by: 'u2' }),
  view(NOTE_SHOT, 'spec.png', 'image/png'),
];

const ROUND = {
  id: 'r1',
  task_id: 't3',
  number: 1,
  finished_by: 'u1',
  client_name: 'claude-code',
  agent: { id: 'a1', harness: 'claude-code', device_label: 'Belka' },
  by_registered_agent: true,
  summary_md: SUMMARY,
  commits: [],
  branch: null,
  pull_request: null,
  tests: [],
  ci: null,
  decision: null,
  created_at: NOW - 3_600_000,
};

const COMMENTS = [
  {
    id: 'c1',
    task_id: 't3',
    author_id: 'u2',
    body_md: `Three shots of the bug:\n\n![Before](${url(C_1)})\n![After](${url(C_2)})\n\n- ![The diff](${url(C_3)})`,
    created_via: 'web',
    edited_at: null,
    sent_back: false,
    created_at: NOW - 3_000_000,
    updated_at: NOW - 3_000_000,
  },
  {
    id: 'c2',
    task_id: 't3',
    author_id: 'u2',
    body_md: `Just one: ![Single](${url(C_ONE)})`,
    created_via: 'web',
    edited_at: null,
    sent_back: false,
    created_at: NOW - 2_000_000,
    updated_at: NOW - 2_000_000,
  },
];

function stub(): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      developer_insights: false,
      created_at: 1,
      updated_at: 1,
      attachments: { max_bytes: 100 * 1024 * 1024 },
    },
    '/api/v1/presence': { enabled: false, present: [] },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 1, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: [TASK], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
    '/api/v1/tasks/t3': TASK,
    '/api/v1/tasks/t3/rounds': { rounds: [ROUND], send_back: null },
    '/api/v1/tasks/t3/comments': { data: COMMENTS, next_cursor: null },
    '/api/v1/tasks/t3/watchers': { watchers: [] },
    '/api/v1/tasks/t3/attachments': { data: FILES.filter((f) => f.id !== NOTE_SHOT) },
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

let WEBM: Buffer = Buffer.alloc(0);
const PDF = pdf();
const SHOTS = new Map<string, Buffer>([
  [SHOT_1, png(320, 200, [240, 240, 250], [124, 58, 237])],
  [SHOT_2, png(320, 200, [24, 24, 32], [47, 208, 138])],
  [SHOT_3, png(120, 260, [124, 58, 237], [240, 240, 250])],
  [C_1, png(200, 120, [250, 200, 80], [40, 40, 40])],
  [C_2, png(200, 120, [80, 200, 250], [40, 40, 40])],
  [C_3, png(200, 120, [250, 80, 120], [40, 40, 40])],
  [C_ONE, png(200, 120, [47, 208, 138], [24, 24, 32])],
  [NOTE_SHOT, png(200, 120, [124, 58, 237], [24, 24, 32])],
]);

interface ContentOptions {
  /**
   * Answer the PDF as production does: a 302 to the store's origin, carrying
   * the board's own `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so
   * a page's `frame-src` decides and the redirect's headers are the real ones.
   */
  readonly pdfVia302?: boolean;
  /** Files the board answers `404` for: gone, or not this reader's (LAI-1302). */
  readonly missing?: ReadonlySet<string>;
}

/** Every file's content route, as the board and the store answer it. */
async function routeContent(page: Page, options: ContentOptions = {}): Promise<void> {
  await page.route('**/api/v1/attachments/*/content', async (route: Route) => {
    const id = /attachments\/([^/]+)\/content/.exec(route.request().url())?.[1] ?? '';
    if (options.missing?.has(id) === true) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'not_found', message: 'No attachment' } }),
      });
    }
    const shot = SHOTS.get(id);
    if (shot !== undefined)
      return route.fulfill({ status: 200, contentType: 'image/png', body: shot });
    if (id === REC) return route.fulfill({ status: 200, contentType: 'video/webm', body: WEBM });
    if (id === REPORT) {
      if (options.pdfVia302 === true) {
        return route.fulfill({
          status: 302,
          headers: {
            location: `${STORE}/report.pdf`,
            'x-frame-options': 'DENY',
            'content-security-policy': "frame-ancestors 'none'",
          },
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'content-disposition': 'attachment' },
      body: 'name,email\nAda,a***@example.com\n',
    });
  });
  await page.route(`${STORE}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF }),
  );
}

/**
 * A policy on the board's document, as the server sends one — `frame-src`
 * only, the directive the PDF frame lives or dies by — and every violation
 * the page reports, kept for the test to read.
 */
async function withPolicy(page: Page, policy: string): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = seen;
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        seen.push(event.effectiveDirective);
      },
      true,
    );
  });
  await page.route(
    (target) => target.pathname === '/board',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': policy },
      });
    },
  );
}

const violations = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __violations: string[] }).__violations]);

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;

interface PanelOptions extends ContentOptions {
  readonly policy?: string;
  /** The task's file list answers `500`: the Outputs line keeps the links as written. */
  readonly filesFail?: boolean;
  /** Runs before the app boots, after the routes above: a route a test holds. */
  readonly before?: (page: Page) => Promise<void>;
  /** More of the stub board, over `stub()`'s. */
  readonly stub?: ApiStub;
}

const FILES_PATH = '/api/v1/tasks/t3/attachments';

async function panel(
  size: (typeof SIZES)[number] = SIZES[0],
  options: PanelOptions = {},
): Promise<Harness> {
  const routes = {
    ...stub(),
    ...(options.filesFail === true
      ? { [FILES_PATH]: refuse(500, 'internal', 'Something went wrong.') }
      : {}),
    ...options.stub,
  };
  const h = await open('/board?project=laika-core&task=t3', routes, {
    before: async (page) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await fakeStream(page);
      await routeContent(page, options);
      if (options.policy !== undefined) await withPolicy(page, options.policy);
      await options.before?.(page);
    },
  });
  await h.page.locator('[data-section="proof"]').waitFor({ timeout: 20_000 });
  return h;
}

const fold = (h: Harness): Locator => h.page.locator('[data-section="proof"] details.out-fold');
const viewer = (h: Harness): Locator => h.page.locator('[data-output-viewer]');

/** Open the round's Outputs line and wait for its strip. */
async function openStrip(h: Harness): Promise<Locator> {
  await fold(h).locator('summary').click();
  const strip = fold(h).locator('.out-strip');
  await strip.locator('.out-tile').first().waitFor({ timeout: 10_000 });
  return strip;
}

/** Every image in `scope` has decoded: a picture, not a broken frame. */
async function imagesDecoded(scope: Locator): Promise<boolean> {
  return scope
    .locator('img')
    .evaluateAll((imgs) =>
      imgs.every(
        (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
      ),
    );
}

/**
 * Wait for `check`, then **assert** it: the harness's `until` returns quietly
 * when it times out, so a wait alone proves nothing.
 */
async function settle(
  check: () => boolean | Promise<boolean>,
  what: string,
  ms = 10_000,
): Promise<void> {
  await until(check, ms);
  assert.ok(await check(), `${what}, after ${String(ms)} ms`);
}

const SHOT_DIR = process.env.LAIKA_OUTPUT_SHOTS;
async function shoot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  mkdirSync(SHOT_DIR, { recursive: true });
  // The dialog fades in: a picture taken mid-entrance shows half of it. Only
  // what ends is waited for — a pulse or a spinner runs for ever.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        // A transition cut short rejects; it is over all the same.
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

void before(async () => {
  // The recording is the browser's own: open a blank page, record, keep the bytes.
  const h = await open('/nothing-here', {});
  try {
    WEBM = await recordWebm(h.page);
  } finally {
    await h.close();
  }
  assert.ok(WEBM.length > 200, `the recording is ${String(WEBM.length)} bytes`);
});

void describe('the Outputs line under Proof (D-162)', () => {
  for (const size of SIZES) {
    for (const theme of ['light', 'dark'] as const) {
      void test(`at ${size.name} in ${theme}: the count, the strip with +2, and the viewer`, async () => {
        const h = await panel(size);
        try {
          await setTheme(h.page, theme);
          // Folded in review, with the round's Outputs line right under it.
          await h.page.locator('[data-section="proof"][data-folded]').waitFor({ timeout: 10_000 });
          const line = 'Outputs · 6 — 3 screenshots · 1 recording · 1 sheet · 1 report';
          await settle(
            async () =>
              (await fold(h).count()) === 1 &&
              (await fold(h).locator('summary').innerText()).trim() === line,
            'the Outputs line, counted from the file list',
          );
          assert.equal(await fold(h).getAttribute('open'), null, 'it starts folded');
          assert.equal(
            await h.page
              .locator('[data-section="proof"] > details.ev-fold:not(.out-fold) .out-fold')
              .count(),
            0,
            'the latest round’s line is not inside the folded proof as well',
          );

          const strip = await openStrip(h);
          // Four tiles and a +2: Avatar's overflow, five places in all.
          assert.equal(await strip.locator(':scope > li').count(), 5);
          assert.deepEqual(
            await strip
              .locator('.out-tile:not(.out-more)')
              .evaluateAll((tiles) => tiles.map((t) => t.getAttribute('aria-label'))),
            [
              'Board in light at 1440',
              'Board in dark at 1440',
              'Board at 390 [phone]',
              'Dragging a card',
            ],
          );
          assert.equal((await strip.locator('.out-more .out-more-count').innerText()).trim(), '+2');
          assert.equal(
            await strip.locator('.out-more').getAttribute('aria-label'),
            'Open the other 2: Accounts created (masked), Run report',
          );
          // Image tiles are the images, loaded lazily; the recording its glyph.
          assert.equal(await strip.locator('img[loading="lazy"]').count(), 3);
          await settle(() => imagesDecoded(strip), 'the strip’s images decoded');
          assert.equal(await strip.locator('[data-kind="recording"] .file-glyph').count(), 1);

          // No sideways scroll of the page itself, even at 390.
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);
          await strip.scrollIntoViewIfNeeded();
          await shoot(h.page, `outputs-strip-${size.name}-${theme}`);

          await strip.locator('.out-tile').nth(1).click();
          await viewer(h).waitFor({ timeout: 10_000 });
          assert.equal(await viewer(h).getAttribute('role'), 'dialog');
          assert.equal(
            (await viewer(h).locator('.overlay-dialog-title').innerText()).trim(),
            'Board in dark at 1440',
          );
          assert.equal(
            (await viewer(h).locator('.overlay-dialog-desc').innerText()).trim(),
            '2 / 6 · by Ada Lovelace’s Claude Code · Belka',
          );
          const image = viewer(h).locator('.ovw-stage img.ovw-image');
          await settle(
            () => imagesDecoded(viewer(h).locator('.ovw-stage')),
            'the viewer’s image decoded',
          );
          assert.equal(await image.getAttribute('src'), url(SHOT_2));
          // Inside the screen at either size.
          const box = await viewer(h).boundingBox();
          assert.ok(
            box !== null && box.x >= 0 && box.x + box.width <= size.width + 1,
            'off screen',
          );
          assert.equal(
            await viewer(h).getByRole('link', { name: 'Open in a new tab' }).getAttribute('target'),
            '_blank',
          );
          const download = viewer(h).getByRole('link', { name: 'Download' });
          assert.equal(await download.getAttribute('download'), 'dark-1440.png');
          // Saved through `?download=1`, in this tab: no new tab (LAI-1361).
          assert.equal(await download.getAttribute('href'), `${url(SHOT_2)}?download=1`);
          assert.equal(await download.getAttribute('target'), null);
          await shoot(h.page, `outputs-viewer-${size.name}-${theme}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});

void describe('the Outputs line counts once, from the file list', () => {
  void test('while the list is on its way no line is drawn, so it never changes under a reader', async () => {
    // From the links alone the sheet, the report and the recording are only
    // *files*: CI caught the line saying so for a moment (#407, run 44422424529).
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    let asked = false;
    const h = await panel(SIZES[0], {
      before: async (page) => {
        await page.route(`**${FILES_PATH}`, async (route) => {
          asked = true;
          await held;
          await route.fallback();
        });
      },
    });
    try {
      await h.page.locator('[data-section="proof"][data-folded]').waitFor({ timeout: 10_000 });
      await settle(() => asked, 'the file list was asked for');
      // Held: the round's summary has been read, and no line is drawn yet.
      assert.equal(await h.page.locator('[data-section="proof"] .ev-round').count(), 1);
      assert.equal(await fold(h).count(), 0, 'a line was drawn before the file list came');
      release();
      await settle(async () => (await fold(h).count()) === 1, 'the line came with the list');
      assert.equal(
        (await fold(h).locator('summary').innerText()).trim(),
        'Outputs · 6 — 3 screenshots · 1 recording · 1 sheet · 1 report',
      );
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a list that fails still settles it: every link counted as written', async () => {
    const h = await panel(SIZES[0], { filesFail: true });
    try {
      await settle(async () => (await fold(h).count()) === 1, 'the line after a failed read');
      // Without the list only the images are known for what they are.
      assert.equal(
        (await fold(h).locator('summary').innerText()).trim(),
        'Outputs · 6 — 3 screenshots · 3 files',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the viewer', () => {
  void test('← and → step and wrap; Escape closes and focus goes back to the tile; Tab stays in', async () => {
    const h = await panel();
    try {
      const strip = await openStrip(h);
      const tile = strip.locator('.out-tile').nth(1);
      await tile.click();
      await viewer(h).waitFor({ timeout: 10_000 });
      const position = async (): Promise<string> =>
        (await viewer(h).locator('.ovw-count').innerText()).trim();
      assert.equal(await position(), '2 / 6');
      // Focus starts on Next, so Enter steps too.
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-ovw-step')),
        'next',
      );

      await h.page.keyboard.press('ArrowRight');
      await settle(async () => (await position()) === '3 / 6', '→ stepped to 3 / 6');
      for (let i = 0; i < 3; i++) await h.page.keyboard.press('ArrowLeft');
      await settle(async () => (await position()) === '6 / 6', '← three times wrapped to 6 / 6');
      assert.equal(
        (await viewer(h).locator('.overlay-dialog-title').innerText()).trim(),
        'Run report',
      );
      await h.page.keyboard.press('ArrowRight');
      await settle(async () => (await position()) === '1 / 6', '→ from 6 wrapped to 1 / 6');

      // The trap: Tab and Shift+Tab never leave the dialog.
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
        await h.page.keyboard.press(key);
        assert.equal(
          await h.page.evaluate(
            () => document.activeElement?.closest('[data-output-viewer]') !== null,
          ),
          true,
          `${key} left the viewer`,
        );
      }

      await h.page.keyboard.press('Escape');
      await viewer(h).waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Board in dark at 1440',
        'focus did not go back to the tile that opened it',
      );
      // Escape closed the viewer only, not the panel under it.
      assert.equal(await h.page.locator('[data-section="proof"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a recording plays inline, a PDF opens in a frame, and +N opens on the first it hides', async () => {
    const h = await panel();
    try {
      const strip = await openStrip(h);
      await strip.locator('[data-kind="recording"]').click();
      await viewer(h).waitFor({ timeout: 10_000 });
      const video = viewer(h).locator('video.ovw-video');
      await video.waitFor({ timeout: 10_000 });
      assert.equal(await video.getAttribute('src'), url(REC));
      assert.equal(await video.evaluate((v) => (v as HTMLVideoElement).controls), true);
      // `readyState` 1 or more: the browser read the recording's metadata —
      // the bytes are a WebM it understood, not a player over a broken file.
      await settle(
        () => video.evaluate((v) => (v as HTMLVideoElement).readyState >= 1),
        'the recording’s metadata was read',
      );
      await h.page.keyboard.press('Escape');
      await viewer(h).waitFor({ state: 'detached', timeout: 10_000 });

      await strip.locator('.out-more').click();
      await viewer(h).waitFor({ timeout: 10_000 });
      assert.equal((await viewer(h).locator('.ovw-count').innerText()).trim(), '5 / 6');
      // The sheet is no picture: a card with its name, size and the ways out.
      const card = viewer(h).locator('.ovw-card');
      await card.waitFor({ timeout: 10_000 });
      assert.equal(
        (await card.locator('.ovw-card-name').innerText()).trim(),
        'accounts-masked.csv',
      );
      assert.equal((await card.locator('.ovw-card-meta').innerText()).trim(), '48 KB');

      await h.page.keyboard.press('ArrowRight');
      const frame = viewer(h).locator('iframe.ovw-frame');
      await frame.waitFor({ timeout: 10_000 });
      assert.equal(await frame.getAttribute('src'), url(REPORT));
      assert.equal(await frame.getAttribute('aria-label'), 'Run report');
      assert.equal(await viewer(h).locator('.ovw-card').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('where the board’s policy refuses the store in a frame, the PDF is a card instead', async () => {
    const h = await panel(SIZES[0], { pdfVia302: true, policy: "frame-src 'self'" });
    try {
      const strip = await openStrip(h);
      await strip.locator('.out-more').click();
      await viewer(h).waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('ArrowRight');
      assert.equal((await viewer(h).locator('.ovw-count').innerText()).trim(), '6 / 6');
      const card = viewer(h).locator('.ovw-card');
      await card.waitFor({ timeout: 10_000 });
      assert.match(await card.innerText(), /This board does not show PDFs inside the page/);
      assert.equal(await viewer(h).locator('iframe').count(), 0);
      // The refusal was the policy's, which is what turned the frame into a card.
      assert.ok((await violations(h.page)).includes('frame-src'), 'no frame-src refusal seen');
      // Download and Open in a new tab are still there for it.
      assert.equal(await viewer(h).getByRole('link', { name: 'Download' }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('where the policy names the store under frame-src, the PDF frame reaches it', async () => {
    // Production's policy since LAI-1352: `frame-src 'self' <store>`. The 302
    // carries the board's own X-Frame-Options and frame-ancestors, as it does
    // live, and they bind the board's pages, not a redirect away from it.
    const h = await panel(SIZES[0], { pdfVia302: true, policy: `frame-src 'self' ${STORE}` });
    try {
      const fromStore: string[] = [];
      h.page.on('request', (request) => {
        if (request.url().startsWith(STORE) && request.resourceType() === 'document') {
          fromStore.push(request.url());
        }
      });
      const strip = await openStrip(h);
      await strip.locator('.out-more').click();
      await viewer(h).waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('ArrowRight');
      const frame = viewer(h).locator('iframe.ovw-frame');
      await frame.waitFor({ timeout: 10_000 });
      // The frame followed the 302 to the store: allowed, and asked for the PDF.
      await settle(() => fromStore.length > 0, 'the frame asked the store for the PDF');
      assert.deepEqual(fromStore, [`${STORE}/report.pdf`]);
      assert.deepEqual(await violations(h.page), [], 'the policy refused something');
      assert.equal(
        await viewer(h).locator('.ovw-card').count(),
        0,
        'the frame gave way to the card',
      );
      assert.equal(await frame.count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('a comment with several images (D-162)', () => {
  void test('three images are one row of thumbnails that opens the viewer; one stays as it is', async () => {
    const h = await panel();
    try {
      const several = h.page.locator('.cmt', { hasText: 'Three shots of the bug' });
      const row = several.locator('.md-image-row');
      await row.waitFor({ timeout: 20_000 });
      assert.equal(await row.locator('.out-tile').count(), 3);
      assert.deepEqual(
        await row
          .locator('.out-tile')
          .evaluateAll((tiles) => tiles.map((t) => t.getAttribute('aria-label'))),
        ['Before', 'After', 'The diff'],
      );
      // Moved, not repeated: no full-size image, and no empty bullet left behind.
      assert.equal(await several.locator('a.md-image').count(), 0);
      assert.equal(await several.locator('.md li:not(.out-cell)').count(), 0);
      assert.equal(await several.locator('.md p').count(), 1, 'an emptied paragraph stayed');
      // One row from the text's own edge: no list indent, no step between
      // tiles (`.md ul` and `.md li + li` are the reading view's, not the strip's).
      const layout = await row.evaluate((el) => {
        const cells = [...el.querySelectorAll('.out-cell')].map((c) => c.getBoundingClientRect());
        const text = el.closest('.md')?.querySelector('p')?.getBoundingClientRect();
        const strip = el.querySelector('.out-strip');
        return {
          tops: cells.map((c) => Math.round(c.top)),
          firstLeft: Math.round(cells[0]?.left ?? -1),
          textLeft: Math.round(text?.left ?? -2),
          padding: strip === null ? '?' : getComputedStyle(strip).paddingLeft,
        };
      });
      assert.equal(
        new Set(layout.tops).size,
        1,
        `the tiles stepped down: ${layout.tops.join(', ')}`,
      );
      assert.equal(layout.padding, '0px', 'the strip is indented as a list');
      assert.equal(layout.firstLeft, layout.textLeft, 'the first tile is not at the text’s edge');
      await settle(() => imagesDecoded(row), 'the comment row’s images decoded');

      const one = h.page.locator('.cmt', { hasText: 'Just one' });
      await one.locator('a.md-image img').waitFor({ timeout: 10_000 });
      assert.equal(await one.locator('.md-image-row').count(), 0);

      await row.locator('.out-tile').nth(1).click();
      await viewer(h).waitFor({ timeout: 10_000 });
      assert.equal(
        (await viewer(h).locator('.overlay-dialog-desc').innerText()).trim(),
        '2 / 3 · by Grace Hopper',
      );
      await h.page.keyboard.press('ArrowRight');
      await settle(
        async () =>
          (await viewer(h).locator('.overlay-dialog-title').innerText()).trim() === 'The diff',
        '→ stepped to The diff',
      );
      await shoot(h.page, 'outputs-comment-row-viewer');
    } finally {
      await h.close();
    }
  });
});

void describe('the Attachments section (D-162)', () => {
  void test('grouped Outputs / In comments / Other, an image a thumbnail that opens the viewer', async () => {
    const h = await panel();
    try {
      const section = h.page.locator('[data-section="attachments"]');
      await section.locator('.att-group').first().waitFor({ timeout: 20_000 });
      assert.equal((await section.locator('.panel-fold').innerText()).trim(), 'Attachments · 10');
      assert.deepEqual(
        await section
          .locator('.att-group-title')
          .evaluateAll((titles) =>
            titles.map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim()),
          ),
        ['Outputs 6', 'In comments 4'],
      );
      const outputs = section.locator('.att-group[data-group="outputs"]');
      assert.equal(await outputs.locator('.att-preview img').count(), 3);
      await settle(() => imagesDecoded(outputs), 'the Outputs group’s thumbnails decoded');
      await outputs.getByRole('button', { name: 'Preview dark-1440.png' }).click();
      await viewer(h).waitFor({ timeout: 10_000 });
      // The caption the round gave it, and the agent that finished the round.
      assert.equal(
        (await viewer(h).locator('.overlay-dialog-title').innerText()).trim(),
        'Board in dark at 1440',
      );
      assert.equal(
        (await viewer(h).locator('.overlay-dialog-desc').innerText()).trim(),
        '2 / 10 · by Ada Lovelace’s Claude Code · Belka',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Download saves the file, and the board stays in its tab (LAI-1361)', () => {
  void test('an image is saved through ?download=1, in this tab, with no new one opened', async () => {
    // A download's own request is not one `page.route` sees, so the stub
    // board answers it — as the store answers the 302 the real board gives,
    // with the file as an attachment.
    const asked = `${url(SHOT_2)}?download=1`;
    const h = await panel(SIZES[0], {
      stub: {
        [asked]: () =>
          reply(200, 'png bytes', {
            'content-disposition': 'attachment; filename="dark-1440.png"',
          }),
      },
    });
    try {
      const strip = await openStrip(h);
      await strip.locator('.out-tile').nth(1).click();
      await viewer(h).waitFor({ timeout: 10_000 });
      const board = h.page.url();
      const tabs = h.page.context().pages().length;
      let popups = 0;
      h.page.on('popup', () => {
        popups += 1;
      });

      const [saved] = await Promise.all([
        h.page.waitForEvent('download', { timeout: 10_000 }),
        viewer(h).getByRole('link', { name: 'Download' }).click(),
      ]);

      assert.equal(saved.suggestedFilename(), 'dark-1440.png');
      assert.equal(new URL(saved.url()).pathname + new URL(saved.url()).search, asked);
      assert.deepEqual(
        h.requests.filter((r) => r.url.startsWith(url(SHOT_2))).map((r) => r.url),
        [asked],
      );
      // Nothing opened: the same tab, on the same page, with the viewer still up.
      assert.equal(popups, 0);
      assert.equal(h.page.context().pages().length, tabs);
      assert.equal(h.page.url(), board);
      assert.equal(await viewer(h).count(), 1);
      await saved.cancel();
    } finally {
      await h.close();
    }
  });
});

void describe('Inbox › Unlisted (D-162 item 8)', () => {
  void test('a finding’s attached files are the same strip under its note', async () => {
    const note = {
      id: 'n1',
      user_id: 'u1',
      token_id: 'tok1',
      repo: 'PawanSirsat/Laika',
      note: `The deploy script fails on a clean clone.\n\n**Attached**\n\n- ![The error](${url(NOTE_SHOT)})\n- [Deploy output](${url(NOTE_LOG)})\n- ![Before the fix](${url(NOTE_GONE)})\n- [Not yours](${url(NOTE_HIDDEN)})`,
      promoted_task_id: null,
      dismissed_at: null,
      created_at: NOW - 3_600_000,
      // The files this reader may open, as `GET /unlisted` names them
      // (LAI-1361): not NOTE_HIDDEN, so its link draws nothing.
      files: [
        {
          id: NOTE_SHOT,
          filename: 'spec.png',
          content_type: 'image/png',
          size_bytes: 51_200,
          inline: true,
        },
        {
          id: NOTE_LOG,
          filename: 'deploy.log',
          content_type: 'text/plain',
          size_bytes: 2_458,
          inline: false,
        },
        {
          id: NOTE_GONE,
          filename: 'before.png',
          content_type: 'image/png',
          size_bytes: 40_960,
          inline: true,
        },
      ],
    };
    const h = await open(
      '/inbox?tab=unlisted',
      {
        '/api/v1/me': {
          id: 'u1',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          org_role: 'owner',
          is_active: true,
          memberships: [],
        },
        '/api/v1/projects': { data: [], next_cursor: null },
        '/api/v1/users': {
          data: [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', org_role: 'owner' }],
          next_cursor: null,
        },
        '/api/v1/unlisted': () => ({ data: [note], next_cursor: null }),
        '/api/v1/unlisted/n1': () => reply(204, undefined),
      },
      // One was removed after the list was read: the board answers 404.
      { before: (page) => routeContent(page, { missing: new Set([NOTE_GONE]) }) },
    );
    try {
      const line = h.page.locator('.unl-line').first();
      await line.waitFor({ timeout: 20_000 });
      await line.click();
      const detail = h.page.locator('.unl-detail');
      await detail.waitFor({ timeout: 10_000 });
      assert.equal(
        (await detail.locator('.unl-note').innerText()).trim(),
        'The deploy script fails on a clean clone.',
      );
      const strip = detail.locator('.out-strip');
      assert.deepEqual(
        await strip
          .locator('.out-tile')
          .evaluateAll((tiles) => tiles.map((t) => t.getAttribute('aria-label'))),
        ['The error', 'Deploy output', 'Before the fix'],
      );
      // The log is a report by its name, not a bare file by its caption.
      assert.equal(
        await strip.locator(`[data-output="${NOTE_LOG}"]`).getAttribute('data-kind'),
        'report',
      );
      // An image the reader may not open is its glyph, never a broken frame;
      // the one they may is a picture.
      const gone = strip.locator(`[data-output="${NOTE_GONE}"]`);
      await settle(
        async () => (await gone.locator('img').count()) === 0,
        'the 404 image’s tile became its glyph',
      );
      assert.equal(await gone.locator('.file-glyph').count(), 1);
      await settle(() => imagesDecoded(strip), 'the finding’s readable image decoded');
      assert.equal(await strip.locator('img').count(), 1);

      await strip.locator('.out-tile').first().click();
      await viewer(h).waitFor({ timeout: 10_000 });
      assert.equal(
        (await viewer(h).locator('.overlay-dialog-desc').innerText()).trim(),
        '1 / 3 · by Ada Lovelace’s agent',
      );
      // A file that is not an image is named by its file, with its size.
      const title = viewer(h).locator('.overlay-dialog-title');
      const note = viewer(h).locator('.ovw-card-note');
      await h.page.keyboard.press('ArrowRight');
      await settle(
        async () => (await title.innerText()).trim() === 'Deploy output',
        '→ stepped to the log',
      );
      assert.equal((await viewer(h).locator('.ovw-card-name').innerText()).trim(), 'deploy.log');
      assert.equal((await viewer(h).locator('.ovw-card-meta').innerText()).trim(), '2.4 KB');
      await settle(
        async () => (await note.getAttribute('data-readable')) === 'yes',
        'the log: the board would serve it',
      );
      // A file the board answers 404 for says so, not that it opens elsewhere.
      await h.page.keyboard.press('ArrowRight');
      await settle(
        async () => (await title.innerText()).trim() === 'Before the fix',
        '→ stepped to the removed image',
      );
      await settle(
        async () => (await note.getAttribute('data-readable')) === 'no',
        'the removed image: the board said 404',
      );
      assert.equal((await note.innerText()).trim(), 'This file isn’t available to you.');
    } finally {
      await h.close();
    }
  });
});
