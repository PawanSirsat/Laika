/**
 * People from Microsoft's directory, in a real browser (D-161, LAI-1330): the
 * synced photo on every converged avatar, the job title, department and
 * manager under a name on Capacity and People, and Capacity's *My team*.
 *
 * `GET /people/directory` is stubbed with the people the sync has read; the
 * photos are small PNGs this file makes, served by `page.route` the way Laika
 * serves them, at their `?v=`. `LAIKA_SHOTS=<dir>` also writes the screens'
 * screenshots there, in both themes at 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import type { Page } from 'playwright';
import { NOW, orgStub } from './capacity-org.ts';
import { pick } from './dropdown.ts';
import { closeBrowser, open, setTheme, until, type ApiStub, type Harness } from './harness.ts';

const V = 1_795_000_000_000;

const entry = (patch: Record<string, unknown>) => ({
  photo_v: null,
  job_title: null,
  department: null,
  manager_id: null,
  manager_name: null,
  ...patch,
});

/**
 * Capacity's people (`capacity-org.ts`): Pawan reads, and has no photo; Bea
 * reports to him. Cal, Dee and Eli have never signed in, so they fold into
 * one line rather than cards.
 */
const CAPACITY_DIRECTORY = {
  people: {
    u1: entry({ job_title: 'Founder', department: 'Leadership' }),
    u2: entry({
      photo_v: V,
      job_title: 'Senior engineer',
      department: 'Platform',
      manager_id: 'u1',
      manager_name: 'Pawan Sirsat',
    }),
    u3: entry({ job_title: 'Designer', department: 'Product' }),
    u4: entry({ photo_v: V, job_title: 'Engineer', department: 'Platform' }),
  },
};

/** CRC-32, for the PNG chunks below. */
function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A 96px PNG face: a soft background of `hue`, a head and shoulders — enough
 * to be told from initials at a glance, and real image bytes.
 */
function face(hue: number): Buffer {
  const size = 96;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const rgb = (h: number, s: number, l: number): [number, number, number] => {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  };
  const back = rgb(hue, 0.45, 0.78);
  const skin = rgb(28, 0.45, 0.68);
  const shirt = rgb((hue + 180) % 360, 0.35, 0.42);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const head = (x - 48) ** 2 + (y - 40) ** 2 < 18 ** 2;
      const body = (x - 48) ** 2 / 34 ** 2 + (y - 104) ** 2 / 36 ** 2 < 1;
      const [r, g, b] = head ? skin : body ? shirt : back;
      const at = y * (size * 3 + 1) + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Serve each person's photo as Laika does, and count who was asked for. */
function photos(asked: string[]): (page: Page) => Promise<void> {
  return async (page) => {
    await page.route('**/api/v1/users/*/photo?v=*', async (route) => {
      const id = /\/users\/([^/]+)\/photo/.exec(route.request().url())?.[1] ?? '';
      asked.push(id);
      const hue = [...id].reduce((n, c) => n + c.charCodeAt(0) * 37, 0) % 360;
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'cache-control': 'private, max-age=31536000, immutable' },
        body: face(hue),
      });
    });
  };
}

/** In both themes at 1440 and 390: no sideways scroll, and the shots when asked for. */
async function bothThemes(h: Harness, name: string, ready: string): Promise<void> {
  const shots = process.env.LAIKA_SHOTS;
  for (const theme of ['Light', 'Dark']) {
    await h.page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(h.page, theme);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await h.page.setViewportSize({ width, height });
      await h.page.locator(ready).first().waitFor();
      const spill = () =>
        h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await until(async () => (await spill()) <= 0);
      assert.ok((await spill()) <= 0, `${name}: ${theme} at ${String(width)} scrolls sideways`);
      if (shots !== undefined && shots !== '') {
        mkdirSync(shots, { recursive: true });
        await h.page.waitForTimeout(400);
        await h.page.screenshot({
          path: join(shots, `${name}-${theme.toLowerCase()}-${String(width)}.png`),
        });
      }
    }
  }
}

void after(async () => {
  await closeBrowser();
});

void describe('Capacity (D-161)', () => {
  const stub = (): ApiStub => ({
    ...orgStub('owner'),
    '/api/v1/people/directory': CAPACITY_DIRECTORY,
  });

  void test('photos on the cards, the facts under each name, and My team', async () => {
    const asked: string[] = [];
    const h = await open('/insights?tab=capacity', stub(), { before: photos(asked) });
    try {
      await h.page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });
      const bea = h.page.locator('.cap-grid > .cap-card', {
        has: h.page.locator('.cap-name', { hasText: 'Bea Nkosi' }),
      });
      await until(async () => (await bea.locator('img.avatar-img').count()) === 1);
      assert.equal(
        await bea.locator('img.avatar-img').getAttribute('src'),
        `/api/v1/users/u2/photo?v=${String(V)}`,
      );
      assert.equal(
        await bea.locator('[data-person-facts]').getAttribute('data-person-facts'),
        'Senior engineer · Platform · reports to Pawan Sirsat',
      );
      // No photo is initials, never a broken image — and nothing is asked for.
      const pawan = h.page.locator('.cap-grid > .cap-card', {
        has: h.page.locator('.cap-name', { hasText: 'Pawan Sirsat' }),
      });
      assert.equal(await pawan.locator('img').count(), 0);
      assert.equal((await pawan.locator('.cap-avatar').innerText()).trim(), 'PS');
      assert.equal(asked.includes('u1'), false, 'a photo asked for someone with none');

      // My team: the one whose manager is the reader.
      const people = h.page.getByRole('combobox', { name: 'People' });
      await pick(people, 'team');
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 1);
      const names = await h.page.locator('.cap-grid > .cap-card .cap-name').allInnerTexts();
      assert.deepEqual(
        names.map((n) => n.trim()),
        ['Bea Nkosi'],
      );
      assert.match(h.page.url(), /[?&]team=mine\b/);

      await pick(people, 'everyone');
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) > 1);
      await bothThemes(h, 'capacity', '.cap-grid > .cap-card');
    } finally {
      await h.close();
    }
  });

  void test('no My team for a reader nobody reports to', async () => {
    const h = await open('/insights?tab=capacity', {
      ...orgStub('owner'),
      '/api/v1/people/directory': { people: {} },
    });
    try {
      await h.page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('combobox', { name: 'People' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('People (D-161)', () => {
  const user = (id: string, name: string, org_role: string) => ({
    id,
    name,
    email: `${id}@example.com`,
    org_role,
    is_active: true,
    created_at: 1,
    updated_at: 1,
  });
  const PEOPLE = [
    user('u1', 'Ada Lovelace', 'owner'),
    user('u2', 'Tomas Nel', 'member'),
    user('u3', 'Priya Raman', 'admin'),
    user('u5', 'Bea Nkosi', 'member'),
  ];

  void test('a photo and the directory’s facts on each row', async () => {
    const asked: string[] = [];
    const h = await open(
      '/organisation?tab=people',
      {
        '/api/v1/projects': { data: [], next_cursor: null },
        '/api/v1/users': { data: PEOPLE, next_cursor: null },
        '/api/v1/invites': { data: [], next_cursor: null },
        '/api/v1/org': {
          id: 'o1',
          name: 'Kvelld Dynamics',
          presence_enabled: true,
          created_at: NOW - 60 * 86_400_000,
          updated_at: 2,
        },
        '/api/v1/capacity': { enabled: true, people: [] },
        '/api/v1/me': { ...PEOPLE[0], memberships: [] },
        '/api/v1/people/directory': {
          people: {
            u1: entry({ photo_v: V, job_title: 'Founder', department: 'Leadership' }),
            u2: entry({
              photo_v: V,
              job_title: 'Engineer',
              department: 'Platform',
              manager_id: 'u3',
              manager_name: 'Priya Raman',
            }),
            u3: entry({ photo_v: V, job_title: 'Head of engineering', department: 'Platform' }),
          },
        },
      },
      { before: photos(asked) },
    );
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      const tomas = h.page.locator('.org-person[data-person="u2"]');
      await until(async () => (await tomas.locator('img.avatar-img').count()) === 1);
      assert.equal(
        await tomas.locator('[data-person-facts]').getAttribute('data-person-facts'),
        'Engineer · Platform · reports to Priya Raman',
      );
      const bea = h.page.locator('.org-person[data-person="u5"]');
      assert.equal(await bea.locator('[data-person-facts]').count(), 0, 'nothing for no entry');
      assert.equal(await bea.locator('img').count(), 0);
      await bothThemes(h, 'people', '.org-person');
    } finally {
      await h.close();
    }
  });
});
