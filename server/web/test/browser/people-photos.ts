/**
 * People's synced photos, as Laika serves them (D-161, LAI-1330), for the
 * browser tests that draw a person: a directory entry, a small PNG face, the
 * photo route, and the screen in both themes at 1440 and 390. Shared by
 * `people-directory.test.ts`, where they began, and
 * `avatars-everywhere.test.ts` (LAI-1336).
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page } from 'playwright';
import { setTheme, until, type Harness } from './harness.ts';

/** A photo's `?v=`. */
export const V = 1_795_000_000_000;

/** One person's `GET /people/directory` entry: nothing but what `patch` says. */
export const entry = (patch: Record<string, unknown>) => ({
  photo_v: null,
  job_title: null,
  department: null,
  manager_id: null,
  manager_name: null,
  ...patch,
});

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
export function face(hue: number): Buffer {
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

/**
 * Serve each person's photo as Laika does, and count who was asked for. An id
 * in `missing` answers `404`, as a photo deleted after the directory was read.
 */
export function photos(
  asked: string[],
  missing: ReadonlySet<string> = new Set(),
): (page: Page) => Promise<void> {
  return async (page) => {
    await page.route('**/api/v1/users/*/photo?v=*', async (route) => {
      const id = /\/users\/([^/]+)\/photo/.exec(route.request().url())?.[1] ?? '';
      asked.push(id);
      if (missing.has(id)) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
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
export async function bothThemes(h: Harness, name: string, ready: string): Promise<void> {
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
